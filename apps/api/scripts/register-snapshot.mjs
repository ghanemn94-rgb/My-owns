#!/usr/bin/env node
// The build-time register snapshot (ADR-0071 §2; p7-work-split §I.1, §I.3; D-243 Q11; REQ-S02-003; T-DG7-BE-H).
//
//   node apps/api/scripts/register-snapshot.mjs --csv <requirements.csv> [--deps <external-dependencies.json>] --out <snapshot.json>
//   node apps/api/scripts/register-snapshot.mjs --check <snapshot.json> --csv <requirements.csv>
//
// Strictly parses docs/delivery/requirements.csv (UTF-8 without a BOM, RFC 4180 quoting, the 19 register columns in
// order, one record per row) and writes `mth-register-snapshot/1`, the only file the `release` module reads at run time
// (ADR-0071 §1, G7). Field values are never trimmed, normalized or re-encoded: a field is the file's text verbatim, and
// a line break inside a quoted field is kept as "\n" (ADR-0071 §2.2). `externalDependencies` is the array of
// docs/handover/external-dependencies.json validated against the contract's ExternalDependency, or null when `--deps`
// is absent or names no file: never [] by default, because an empty array would claim "no external dependency".
//
// Exit codes (p7-work-split §2 rule 4): 0 written or fresh; 1 a refusal or a stale snapshot (the I.3 lines); 2 BLOCKED
// (a missing input or a usage error). Node built-ins only; no network; reads only the files named on the command line.
// A register status is an engineering delivery state: nothing here is a DG0-DG7 gate decision or a G1-G6 approval.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const SCHEMA_VERSION = "mth-register-snapshot/1";
export const SOURCE_PATH = "docs/delivery/requirements.csv";
export const REGISTER_COLUMNS = Object.freeze([
  "req_id",
  "class",
  "title",
  "source_ref",
  "source_heading",
  "template_id",
  "input_fields",
  "procedure",
  "output",
  "owner_roles",
  "permissions",
  "automation",
  "screen_api",
  "acceptance",
  "increments",
  "final_gate",
  "status",
  "evidence",
  "notes",
]);
export const REQ_ID = /^REQ-([A-Z0-9]+)-[0-9]{3}$/;
export const AREA = /^(PB|DLV|S(0[1-9]|1[0-9]|2[01]))$/;
export const CLASSES = Object.freeze(["SOURCE", "USER", "ENGINEERING"]);
export const STATUSES = Object.freeze(["PLANNED", "SPECIFIED", "IMPLEMENTED", "BLOCKED"]);
export const FINAL_GATE = /^DG[0-7]$/;
const DEP_KEY = /^[a-z][a-z0-9_.-]{1,63}$/;
const DEP_STATUSES = Object.freeze(["not_configured", "not_verified", "blocked"]);

/** A refusal of the register or of the dependency list: printed as `register-snapshot: <line>: <reason>`, exit 1. */
export class RegisterError extends Error {
  /** @param {number | string} line @param {string} reason */
  constructor(line, reason) {
    super(`${line}: ${reason}`);
    this.name = "RegisterError";
    this.line = line;
    this.reason = reason;
  }
}

/**
 * Splits RFC 4180 text into records. Each record carries the 1-based line its first field starts on. Quoted fields may
 * hold commas, doubled quotes and line breaks (CRLF or LF, kept as "\n"); records end with LF or CRLF; a final line end
 * is optional. Nothing is trimmed.
 * @param {string} text
 * @returns {{ line: number, fields: string[] }[]}
 */
function splitRecords(text) {
  const records = [];
  let line = 1;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const start = line;
    const fields = [];
    let field = "";
    for (;;) {
      if (text[i] === '"') {
        // Quoted field.
        const quoteLine = line;
        i += 1;
        for (;;) {
          if (i >= n) throw new RegisterError(quoteLine, "unterminated quoted field");
          const c = text[i];
          if (c === '"') {
            if (text[i + 1] === '"') {
              field += '"';
              i += 2;
              continue;
            }
            i += 1;
            break;
          }
          if (c === "\r" && text[i + 1] === "\n") {
            field += "\n";
            line += 1;
            i += 2;
            continue;
          }
          if (c === "\n") line += 1;
          field += c;
          i += 1;
        }
        const after = text[i];
        if (i < n && after !== "," && after !== "\n" && !(after === "\r" && text[i + 1] === "\n"))
          throw new RegisterError(line, "unexpected character after a closing quote");
      } else {
        // Unquoted field: up to the next comma or line end (a lone CR or a quote is kept as text).
        while (i < n && text[i] !== "," && text[i] !== "\n" && !(text[i] === "\r" && text[i + 1] === "\n")) {
          field += text[i];
          i += 1;
        }
      }
      fields.push(field);
      field = "";
      if (i >= n) break;
      if (text[i] === ",") {
        i += 1;
        continue;
      }
      // Line end: CRLF or LF.
      i += text[i] === "\r" ? 2 : 1;
      line += 1;
      break;
    }
    records.push({ line: start, fields });
  }
  return records;
}

/**
 * Strictly parses the register (ADR-0071 §2.2). Throws RegisterError on the first violation.
 * @param {string | Uint8Array} input the file's bytes (or its already decoded text)
 * @returns {{ columns: string[], rows: string[][] }}
 */
export function parseRegister(input) {
  let text;
  if (typeof input === "string") {
    if (input.charCodeAt(0) === 0xfeff) throw new RegisterError(1, "byte order mark not allowed");
    text = input;
  } else {
    const bytes = Buffer.from(input);
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
      throw new RegisterError(1, "byte order mark not allowed");
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      throw new RegisterError(1, "the file is not valid UTF-8");
    }
  }
  const records = splitRecords(text);
  const header = records[0];
  if (
    header === undefined ||
    header.fields.length !== REGISTER_COLUMNS.length ||
    header.fields.some((f, k) => f !== REGISTER_COLUMNS[k])
  )
    throw new RegisterError(1, "header differs from the 19 register columns");
  const seen = new Set();
  const rows = [];
  for (const { line, fields } of records.slice(1)) {
    if (fields.length !== REGISTER_COLUMNS.length)
      throw new RegisterError(line, `expected 19 fields, found ${fields.length}`);
    const [id, cls] = fields;
    const area = REQ_ID.exec(id)?.[1];
    if (area === undefined || !AREA.test(area)) throw new RegisterError(line, `invalid req_id '${id}'`);
    if (seen.has(id)) throw new RegisterError(line, `duplicate req_id '${id}'`);
    seen.add(id);
    if (!CLASSES.includes(cls)) throw new RegisterError(line, `invalid class '${cls}'`);
    if (!STATUSES.includes(fields[16])) throw new RegisterError(line, `invalid status '${fields[16]}'`);
    if (!FINAL_GATE.test(fields[15])) throw new RegisterError(line, `invalid final_gate '${fields[15]}'`);
    rows.push(fields);
  }
  return { columns: [...REGISTER_COLUMNS], rows };
}

/**
 * Validates docs/handover/external-dependencies.json against the contract's ExternalDependency (an array; strict keys).
 * @param {string} text @param {string} label
 * @returns {{ key: string, title: string, owner: string, status: string }[]}
 */
export function parseDependencies(text, label = "external-dependencies") {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new RegisterError(label, "the dependency list is not valid JSON");
  }
  if (!Array.isArray(value)) throw new RegisterError(label, "the dependency list is not an array");
  const keys = new Set();
  return value.map((entry, k) => {
    const where = `${label}[${k}]`;
    const ok =
      entry !== null &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      Object.keys(entry).sort().join(",") === "key,owner,status,title" &&
      typeof entry.key === "string" &&
      DEP_KEY.test(entry.key) &&
      typeof entry.title === "string" &&
      entry.title.length <= 500 &&
      typeof entry.owner === "string" &&
      entry.owner.length <= 200 &&
      DEP_STATUSES.includes(entry.status);
    if (!ok) throw new RegisterError(where, "invalid dependency entry");
    if (keys.has(entry.key)) throw new RegisterError(where, `duplicate dependency key '${entry.key}'`);
    keys.add(entry.key);
    return { key: entry.key, title: entry.title, owner: entry.owner, status: entry.status };
  });
}

/** RFC 3339 UTC of SOURCE_DATE_EPOCH when set (ADR-0062), else of `now`. */
export function generatedAtOf(env = process.env, now = new Date()) {
  const epoch = env.SOURCE_DATE_EPOCH;
  const at = epoch !== undefined && /^[0-9]{1,12}$/.test(epoch) ? new Date(Number(epoch) * 1000) : now;
  return at.toISOString().replace(/\.[0-9]{3}Z$/, "Z");
}

/**
 * The snapshot object, keys in the ADR-0071 §2.3 order.
 * @param {{ csvBytes: Uint8Array, parsed: { columns: string[], rows: string[][] },
 *           externalDependencies: object[] | null, generatedAt: string }} input
 */
export function buildSnapshot({ csvBytes, parsed, externalDependencies, generatedAt }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    sourcePath: SOURCE_PATH,
    sourceSha256: createHash("sha256").update(csvBytes).digest("hex"),
    rowCount: parsed.rows.length,
    generatedAt,
    columns: [...parsed.columns],
    rows: parsed.rows.map((r) => [...r]),
    externalDependencies,
  };
}

/** Parses argv; returns null on a usage error. */
function parseArgs(argv) {
  const out = {};
  for (let k = 0; k < argv.length; k += 1) {
    const flag = argv[k];
    if (!["--csv", "--deps", "--out", "--check"].includes(flag)) return null;
    const value = argv[k + 1];
    if (value === undefined || value.startsWith("--")) return null;
    out[flag.slice(2)] = value;
    k += 1;
  }
  return out;
}

/**
 * The command line. Returns the exit code; writes its lines through `print`/`printError`.
 * @param {string[]} argv
 */
export function main(argv, { env = process.env, print = console.log, printError = console.error } = {}) {
  const args = parseArgs(argv);
  const usage =
    "usage: register-snapshot.mjs --csv <requirements.csv> [--deps <external-dependencies.json>] --out <snapshot.json> | --check <snapshot.json> --csv <requirements.csv>";
  if (args === null || (args.check === undefined) === (args.out === undefined)) {
    printError(`register-snapshot: BLOCKED: ${usage}`);
    return 2;
  }
  if (args.csv === undefined) {
    printError("register-snapshot: BLOCKED: --csv not found");
    return 2;
  }
  if (!existsSync(args.csv)) {
    printError(`register-snapshot: BLOCKED: ${args.csv} not found`);
    return 2;
  }
  const csvBytes = readFileSync(args.csv);
  if (args.check !== undefined) {
    if (!existsSync(args.check)) {
      printError(`register-snapshot: BLOCKED: ${args.check} not found`);
      return 2;
    }
    let built;
    try {
      built = JSON.parse(readFileSync(args.check, "utf8")).sourceSha256;
    } catch {
      built = undefined;
    }
    const actual = createHash("sha256").update(csvBytes).digest("hex");
    if (built !== actual) {
      printError(
        `register-snapshot: ${args.check} is stale: it was built from sha256 ${typeof built === "string" ? built : "(none)"}, the register is sha256 ${actual}`,
      );
      return 1;
    }
    print(`register-snapshot: ${args.check} is fresh (sha256 ${actual.slice(0, 12)})`);
    return 0;
  }
  try {
    const parsed = parseRegister(csvBytes);
    const externalDependencies =
      args.deps !== undefined && existsSync(args.deps)
        ? parseDependencies(readFileSync(args.deps, "utf8"), args.deps)
        : null;
    const snapshot = buildSnapshot({ csvBytes, parsed, externalDependencies, generatedAt: generatedAtOf(env) });
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, `${JSON.stringify(snapshot)}\n`, "utf8");
    print(
      `register-snapshot: wrote ${args.out} (${snapshot.rowCount} rows, sha256 ${snapshot.sourceSha256.slice(0, 12)})`,
    );
    return 0;
  } catch (error) {
    if (error instanceof RegisterError) {
      printError(`register-snapshot: ${error.line}: ${error.reason}`);
      return 1;
    }
    throw error;
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}

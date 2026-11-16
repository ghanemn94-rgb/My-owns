#!/usr/bin/env node
// OpenAPI completeness report (ADR-0070 §2; REQ-S19-007 "every endpoint … in the release is described and passes its
// contract test"; p7-work-split §F.1, T-F4, T-F5).
//
//   node tools/release/openapi-coverage.mjs --vitest-json <file> [--out <file>]
//        [--openapi <file>] [--contract-dir <dir>] [--support-dir <dir>]
//
// <file> is the vitest `json` reporter output of the contract suite on the candidate:
//   tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/contract \
//     --reporter=json --outputFile.json=<file>
//
// The report joins three facts and fails if any one is missing (there is no skip list):
//  1. described: every operation of the document has an operationId, a summary, at least one tag declared under
//     `tags`, at least one response, and a schema for every 2xx JSON body (`pnpm openapi:lint` is a separate check);
//  2. routed and exercised: the two route-coverage tests passed; every pending list (apps/api/test/support/
//     p*-pending*.ts) is empty; no contract test source has `.skip`, `.skipIf`, `.runIf`, `.todo` or `.only`; the
//     count pin in contract.test.ts equals the number of operations; every test of the contract files in the run
//     passed (none failed, skipped or todo);
//  3. response-validated: response-validation.test.ts ran in the same run and every test in it passed.
// NO_400_OPERATIONS (malformed-input.ts) is printed with its reason. It is not a skip and is not counted as one.
//
// Exit codes (p7-work-split §2 rule 4): 0 PASS, 1 FAIL, 2 BLOCKED (missing or unreadable input, usage), 3 BLOCKED (the
// `yaml` package is not installed: no installed workspace). Uses only the lockfile's yaml 2.8.1 through createRequire.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, "..", "..");
export const SCHEMA_VERSION = "mth-openapi-coverage/1";
export const DEFAULTS = Object.freeze({
  openapi: "docs/api/openapi.yaml",
  contractDir: "apps/api/test/integration/contract",
  supportDir: "apps/api/test/support",
});
export const REQUIRED_TESTS = Object.freeze([
  "maps every governed Fastify route to an OpenAPI operation with the same method, and back",
  "covers every operation with at least one success and every successful body with its zod mirror",
]);
export const RESPONSE_VALIDATION_FILE = "response-validation.test.ts";
export const NO_400_REASON = "no input that can be invalid";
const METHODS = ["get", "put", "post", "delete", "patch", "head", "options", "trace"];

export class Blocked extends Error {
  constructor(message, code = 2) {
    super(message);
    this.code = code;
  }
}

const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const rel = (p) => relative(REPO, resolve(p)).split("\\").join("/");

function loadYaml() {
  try {
    return createRequire(join(REPO, "apps", "api", "package.json"))("yaml");
  } catch {
    throw new Blocked("the yaml package is not installed (run pnpm install --offline)", 3);
  }
}

/** Operations of an OpenAPI document with the "described" problems of each. */
export function describedProblems(doc) {
  const declared = new Set((doc.tags ?? []).map((t) => t?.name));
  const deref = (r) => {
    if (r && typeof r.$ref === "string" && r.$ref.startsWith("#/")) {
      let cur = doc;
      for (const p of r.$ref.slice(2).split("/")) cur = cur?.[p.replace(/~1/g, "/").replace(/~0/g, "~")];
      return cur;
    }
    return r;
  };
  const ops = [];
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const method of METHODS) {
      const op = item?.[method];
      if (!op) continue;
      const id = op.operationId ?? `${method.toUpperCase()} ${path}`;
      const why = [];
      if (!op.operationId) why.push("no operationId");
      if (typeof op.summary !== "string" || op.summary.trim() === "") why.push("no summary");
      const tags = op.tags ?? [];
      if (tags.length === 0) why.push("no tag");
      for (const t of tags) if (!declared.has(t)) why.push(`tag ${t} is not declared under tags`);
      const responses = Object.entries(op.responses ?? {});
      if (responses.length === 0) why.push("no response");
      for (const [status, raw] of responses) {
        if (!/^2/.test(status)) continue;
        const r = deref(raw);
        for (const [mt, media] of Object.entries(r?.content ?? {}))
          if (/json/.test(mt) && !media?.schema) why.push(`${status} ${mt} has no schema`);
      }
      ops.push({ operationId: id, method, path, problems: why });
    }
  }
  return ops;
}

/** String-literal entries of every exported array in the pending list files. */
export function pendingEntries(supportDir) {
  if (!existsSync(supportDir)) throw new Blocked(`support directory ${rel(supportDir)} not found`);
  const out = [];
  for (const f of readdirSync(supportDir)
    .filter((n) => /^p\d+-pending.*\.ts$/.test(n))
    .sort()) {
    const src = stripComments(readFileSync(join(supportDir, f), "utf8"));
    const lists = [];
    const re = /(?:const|let)\s+([A-Za-z0-9_]+)\s*(?::[^=]+)?=\s*(?:new Set\(\s*)?\[([\s\S]*?)\]/g;
    let m;
    while ((m = re.exec(src))) {
      const entries = [...m[2].matchAll(/(["'`])((?:(?!\1).)*)\1/g)].map((x) => x[2]);
      lists.push({ name: m[1], entries });
    }
    out.push({ file: f, lists, entries: lists.flatMap((l) => l.entries) });
  }
  return out;
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

/** `.skip`, `.skipIf`, `.runIf`, `.todo`, `.only` in the contract test sources, as `<file>:<line>`. */
export function skippedTests(contractDir) {
  if (!existsSync(contractDir)) throw new Blocked(`contract directory ${rel(contractDir)} not found`);
  const hits = [];
  const re = /\b(?:it|test|describe|suite|bench)\s*\.\s*(?:skip|skipIf|runIf|todo|only)\b|\b(?:xit|xdescribe|fit|fdescribe)\s*\(/;
  for (const f of readdirSync(contractDir)
    .filter((n) => n.endsWith(".ts"))
    .sort()) {
    readFileSync(join(contractDir, f), "utf8")
      .split(/\r?\n/)
      .forEach((l, i) => {
        const code = l.replace(/\/\/.*$/, "");
        if (re.test(code)) hits.push(`${f}:${i + 1}`);
      });
  }
  return hits;
}

/** The pinned operation count: `expect(operations).toHaveLength(<n>)` in contract.test.ts. */
export function countPin(contractDir) {
  const f = join(contractDir, "contract.test.ts");
  if (!existsSync(f)) throw new Blocked(`${rel(f)} not found`);
  const m = /expect\(\s*operations\s*\)\s*\.toHaveLength\(\s*(\d+)\s*\)/.exec(readFileSync(f, "utf8"));
  if (!m) throw new Blocked(`no count pin expect(operations).toHaveLength(<n>) in ${rel(f)}`);
  return Number(m[1]);
}

/** NO_400_OPERATIONS from malformed-input.ts (printed with its reason; never a skip). */
export function no400Operations(contractDir) {
  const f = join(contractDir, "malformed-input.ts");
  if (!existsSync(f)) return [];
  const m = /NO_400_OPERATIONS[^=]*=\s*new Set\(\s*\[([\s\S]*?)\]\s*\)/.exec(readFileSync(f, "utf8"));
  if (!m) return [];
  return [...m[1].matchAll(/(["'])([^"']+)\1/g)].map((x) => ({ operationId: x[2], reason: NO_400_REASON }));
}

/** The contract files' tests from a vitest `json` reporter output. */
export function contractRun(vitest, contractDir) {
  const abs = `${resolve(contractDir).split("\\").join("/")}/`;
  const r = rel(contractDir);
  const marker = r.startsWith("..") ? null : `/${r}/`;
  const files = (vitest.testResults ?? []).filter((t) => {
    const n = String(t.name ?? "").split("\\").join("/");
    return n.startsWith(abs) || (marker !== null && n.includes(marker));
  });
  const tests = files.flatMap((f) =>
    (f.assertionResults ?? []).map((a) => ({
      file: basename(String(f.name)),
      title: a.title,
      fullName: a.fullName ?? a.title,
      status: a.status,
    })),
  );
  return { files: files.map((f) => ({ file: basename(String(f.name)), status: f.status })), tests };
}

export function evaluate({ doc, openapiText, vitest, contractDir, supportDir }) {
  const reasons = [];
  const ops = describedProblems(doc);
  for (const o of ops) for (const p of o.problems) reasons.push(`operation ${o.operationId} is not described: ${p}`);
  const pending = pendingEntries(supportDir);
  for (const p of pending) for (const e of p.entries) reasons.push(`pending operation ${e} (${p.file})`);
  const skips = skippedTests(contractDir);
  for (const s of skips) reasons.push(`skipped test in ${s}`);
  const pin = countPin(contractDir);
  if (pin !== ops.length) reasons.push(`count pin ${pin} does not equal ${ops.length} operations`);

  const run = contractRun(vitest, contractDir);
  const required = REQUIRED_TESTS.map((name) => {
    const t = run.tests.filter((x) => x.title === name);
    const status = t.length === 0 ? "not in the run" : t.every((x) => x.status === "passed") ? "passed" : t[0].status;
    return { name, status };
  });
  for (const r of required) if (r.status !== "passed") reasons.push(`required test failed: ${r.name} (${r.status})`);
  const rv = run.tests.filter((t) => t.file === RESPONSE_VALIDATION_FILE);
  if (rv.length === 0) reasons.push(`required test failed: ${RESPONSE_VALIDATION_FILE} (not in the run)`);
  const notPassed = run.tests.filter((t) => t.status !== "passed");
  for (const t of notPassed) reasons.push(`required test failed: ${t.file}: ${t.fullName} (${t.status})`);
  for (const f of run.files)
    if (f.status !== "passed" && !run.tests.some((t) => t.file === f.file && t.status !== "passed"))
      reasons.push(`required test failed: ${f.file} (file ${f.status})`);

  const routeOk = required.every((r) => r.status === "passed") && pending.every((p) => p.entries.length === 0);
  const pass = reasons.length === 0;
  return {
    schemaVersion: SCHEMA_VERSION,
    result: pass ? "PASS" : "FAIL",
    contractVersion: String(doc.info?.version ?? ""),
    openapiSha256: sha256(openapiText),
    operations: ops.length,
    // Unknown (null), never zero, when the run does not prove it.
    described: ops.filter((o) => o.problems.length === 0).length,
    routed: routeOk ? ops.length : null,
    exercised: routeOk ? ops.length : null,
    responseValidated: rv.length > 0 && rv.every((t) => t.status === "passed"),
    countPin: pin,
    pendingLists: pending.map((p) => ({ file: p.file, entries: p.entries })),
    pendingEntries: pending.reduce((n, p) => n + p.entries.length, 0),
    skippedTests: skips,
    requiredTests: required,
    contractRun: {
      files: run.files.length,
      tests: run.tests.length,
      passed: run.tests.filter((t) => t.status === "passed").length,
      notPassed: notPassed.length,
      responseValidationTests: rv.length,
    },
    no400Operations: no400Operations(contractDir),
    reasons,
  };
}

export function summary(r) {
  const lines = [];
  if (r.result === "PASS")
    lines.push(
      `openapi-coverage: PASS: ${r.operations} operations described, routed and exercised; no pending entry; no skipped contract test`,
    );
  else for (const x of r.reasons) lines.push(`openapi-coverage: FAIL: ${x}`);
  for (const n of r.no400Operations)
    lines.push(`openapi-coverage: note: NO_400_OPERATIONS ${n.operationId}: ${n.reason} (not a skip)`);
  return lines;
}

async function main(argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        "vitest-json": { type: "string" },
        out: { type: "string" },
        openapi: { type: "string" },
        "contract-dir": { type: "string" },
        "support-dir": { type: "string" },
      },
    }));
  } catch (e) {
    console.log(`openapi-coverage: BLOCKED: usage: ${e.message}`);
    return 2;
  }
  try {
    if (!values["vitest-json"]) throw new Blocked("usage: --vitest-json <file> is required");
    const vj = resolve(values["vitest-json"]);
    if (!existsSync(vj)) throw new Blocked(`vitest JSON ${values["vitest-json"]} not found`);
    let vitest;
    try {
      vitest = JSON.parse(readFileSync(vj, "utf8"));
    } catch (e) {
      throw new Blocked(`vitest JSON is not valid JSON: ${e.message}`);
    }
    if (!Array.isArray(vitest.testResults)) throw new Blocked("vitest JSON has no testResults (not a json reporter output)");
    const openapi = resolve(values.openapi ?? join(REPO, DEFAULTS.openapi));
    if (!existsSync(openapi)) throw new Blocked(`${rel(openapi)} not found`);
    const openapiText = readFileSync(openapi, "utf8");
    let doc;
    try {
      doc = loadYaml().parse(openapiText);
    } catch (e) {
      if (e instanceof Blocked) throw e;
      throw new Blocked(`${rel(openapi)} does not parse: ${e.message}`);
    }
    const r = evaluate({
      doc,
      openapiText,
      vitest,
      contractDir: resolve(values["contract-dir"] ?? join(REPO, DEFAULTS.contractDir)),
      supportDir: resolve(values["support-dir"] ?? join(REPO, DEFAULTS.supportDir)),
    });
    if (values.out) {
      mkdirSync(dirname(resolve(values.out)), { recursive: true });
      writeFileSync(resolve(values.out), `${JSON.stringify(r, null, 2)}\n`);
    }
    for (const l of summary(r)) console.log(l);
    return r.result === "PASS" ? 0 : 1;
  } catch (e) {
    if (!(e instanceof Blocked)) throw e;
    console.log(`openapi-coverage: BLOCKED: ${e.message}`);
    return e.code;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = await main(process.argv.slice(2));

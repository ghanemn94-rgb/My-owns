// transfer-attachments (ADR-0064 §5, §6 step 3; ADR-0066 §1, §4; p7-work-split §C.3, §2 rule 4; D-248 O1;
// T-DG7-BE-E): the IT operator's evidence-byte copy for a migration package or a backup set.
//
//   transfer-attachments copy-in  --from <dir>
//   transfer-attachments verify   --from <dir> --out <json>
//   transfer-attachments copy-out --to <dir> --out <attachments.json> [--export-id <uuid>]
//
// The store is this installation's evidence store from the environment (EVIDENCE_STORAGE_DRIVER, EVIDENCE_STORAGE_PATH,
// the ADR-0010/ADR-0011 variables the API reads). copy-out also reads DATABASE_URL (the rows that name objects).
// `<dir>` holds `attachments.json` and `attachments/<sha256>`; when it also holds a migration `manifest.json`, the
// attachments.json SHA-256 and count must equal the manifest's `attachmentManifest`.
//
// Exit codes (p7-work-split §2 rule 4): 0 PASS; 1 FAIL (a missing object or a differing size or SHA-256 after the
// copy, in the store or at the copy-out source); 2 BLOCKED, invalid input or usage (a missing or invalid manifest, a
// package file that differs, a target object that already holds other bytes; nothing is written); 3 BLOCKED, a missing
// platform capability (the s3 driver through this CLI: see the handback). Every BLOCKED line starts `BLOCKED:`.
// Output names objects, parent tables and counts only, never bytes, secrets or store URLs.
// Running it approves nothing (no G1-G6, Finance or IT approval) and never reads or writes DG0-DG7.
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { v7 as uuidv7 } from "uuid";
import {
  ATTACHMENT_MANIFEST_FILE,
  createDb,
  createPool,
  MANIFEST_FILE,
  ManifestFormatError,
  parseAttachmentManifest,
  parseManifest,
  transferSha256,
  type AttachmentManifest,
  type AttachmentMismatch,
} from "@mth/db";
import { FilesystemEvidenceStore } from "../modules/evidence/stores/filesystem.ts";
import type { EvidenceStore } from "../modules/evidence/store.ts";
import {
  AttachmentCopyRefused,
  canonicalVerifyReport,
  copyIn,
  copyOut,
  listObjectRows,
  verify,
  verifyReport,
  writeFileAtomic,
  type ObjectRow,
} from "../modules/transfer/attachments.ts";

export interface TransferAttachmentsIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

export interface TransferAttachmentsDeps {
  /** The evidence store (tests inject one; default: from the environment). */
  readonly store?: EvidenceStore;
  /** The rows that name objects, for copy-out (tests inject them; default: listObjectRows over DATABASE_URL). */
  readonly listRows?: () => Promise<readonly ObjectRow[]>;
}

const NAME = "transfer-attachments";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const USAGE =
  `usage: ${NAME} copy-in --from <dir> | verify --from <dir> --out <json> | ` +
  `copy-out --to <dir> --out <attachments.json> [--export-id <uuid>]`;

class Blocked extends Error {
  readonly code: 2 | 3;
  constructor(code: 2 | 3, message: string) {
    super(message);
    this.code = code;
  }
}

/** The store of the environment: the filesystem adapter at EVIDENCE_STORAGE_PATH. */
export function storeFromEnvironment(env: Readonly<Record<string, string | undefined>>): EvidenceStore {
  const driver = env["EVIDENCE_STORAGE_DRIVER"] ?? "filesystem";
  if (driver === "s3")
    throw new Blocked(
      3,
      "the s3 evidence store is not reachable through this CLI in this release: its settings and credential " +
        "references are in the target's database, which is empty before the import (copy through the module " +
        "functions, or stage the objects on a filesystem store)",
    );
  if (driver !== "filesystem") throw new Blocked(2, `EVIDENCE_STORAGE_DRIVER must be filesystem or s3, not ${driver}`);
  const path = env["EVIDENCE_STORAGE_PATH"];
  if (path === undefined || path === "") throw new Blocked(2, "EVIDENCE_STORAGE_PATH is not set");
  return new FilesystemEvidenceStore(path);
}

/** Reads and checks `<dir>/attachments.json` (and, when present, its record in `<dir>/manifest.json`). */
export async function readPackageAttachments(dir: string): Promise<{ manifest: AttachmentManifest; sha256: string }> {
  let bytes: Buffer;
  try {
    bytes = await readFile(join(dir, ATTACHMENT_MANIFEST_FILE));
  } catch {
    throw new Blocked(2, `${ATTACHMENT_MANIFEST_FILE} cannot be read in ${dir}`);
  }
  const sha256 = transferSha256(bytes);
  let manifest: AttachmentManifest;
  try {
    manifest = parseAttachmentManifest(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (err) {
    const detail = err instanceof ManifestFormatError ? err.message : `${ATTACHMENT_MANIFEST_FILE}: not valid UTF-8`;
    throw new Blocked(2, detail);
  }
  let migrationText: string | null = null;
  try {
    migrationText = await readFile(join(dir, MANIFEST_FILE), "utf8");
  } catch {
    migrationText = null; // a backup set has no migration manifest
  }
  if (migrationText !== null) {
    let recorded;
    try {
      recorded = parseManifest(migrationText).attachmentManifest;
    } catch (err) {
      throw new Blocked(2, err instanceof Error ? err.message : `${MANIFEST_FILE}: invalid`);
    }
    if (recorded.sha256 !== sha256) throw new Blocked(2, `checksum mismatch for ${ATTACHMENT_MANIFEST_FILE}`);
    if (recorded.count !== manifest.items.length)
      throw new Blocked(
        2,
        `${MANIFEST_FILE} lists ${recorded.count} attachments, ${ATTACHMENT_MANIFEST_FILE} lists ${manifest.items.length}`,
      );
  }
  return { manifest, sha256 };
}

function mismatchLine(m: AttachmentMismatch): string {
  return `  ${m.problem} ${m.objectName} (${m.parentTable}): expected ${m.expectedSize} bytes, found ${m.actualSize ?? "none"}`;
}

/** The CLI (exported for tests). Returns the exit code. */
export async function runTransferAttachments(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  io: TransferAttachmentsIo,
  deps: TransferAttachmentsDeps = {},
): Promise<number> {
  const [command, ...rest] = argv;
  let values: Record<string, string | undefined>;
  try {
    ({ values } = parseArgs({
      args: rest,
      options: {
        from: { type: "string" },
        to: { type: "string" },
        out: { type: "string" },
        "export-id": { type: "string" },
      },
      strict: true,
    }));
  } catch {
    io.err(`BLOCKED: ${USAGE}`);
    return 2;
  }
  const allowed: Record<string, readonly string[]> = {
    "copy-in": ["from"],
    verify: ["from", "out"],
    "copy-out": ["to", "out", "export-id"],
  };
  const required: Record<string, readonly string[]> = {
    "copy-in": ["from"],
    verify: ["from", "out"],
    "copy-out": ["to", "out"],
  };
  const given = Object.keys(values).filter((k) => values[k] !== undefined);
  if (
    command === undefined ||
    !(command in allowed) ||
    given.some((k) => !allowed[command]!.includes(k)) ||
    required[command]!.some((k) => values[k] === undefined || values[k] === "")
  ) {
    io.err(`BLOCKED: ${USAGE}`);
    return 2;
  }
  try {
    if (command === "copy-in") return await commandCopyIn(values["from"]!, env, io, deps);
    if (command === "verify") return await commandVerify(values["from"]!, values["out"]!, env, io, deps);
    return await commandCopyOut(values["to"]!, values["out"]!, values["export-id"], env, io, deps);
  } catch (err) {
    if (err instanceof Blocked) {
      io.err(`BLOCKED: ${NAME} ${command}: ${err.message}`);
      return err.code;
    }
    io.err(`${NAME} ${command}: failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

async function commandCopyIn(dir: string, env: Env, io: TransferAttachmentsIo, deps: TransferAttachmentsDeps) {
  const { manifest } = await readPackageAttachments(dir);
  const store = deps.store ?? storeFromEnvironment(env);
  let result;
  try {
    result = await copyIn(store, dir, manifest);
  } catch (err) {
    if (!(err instanceof AttachmentCopyRefused)) throw err;
    io.err(
      `BLOCKED: ${NAME} copy-in: refused: ${err.message}; nothing was written` +
        (err.reason === "target_conflict" ? " (the target is not empty)" : ""),
    );
    for (const p of err.problems) io.err(mismatchLine(p));
    return 2;
  }
  if (result.mismatches.length > 0) {
    io.err(
      `${NAME} copy-in: mismatch: ${result.mismatches.length} of ${manifest.items.length} objects differ after the copy`,
    );
    for (const m of result.mismatches) io.err(mismatchLine(m));
    return 1;
  }
  io.out(
    `${NAME} copy-in: copied ${result.written} objects, ${result.present} already present; ` +
      `${manifest.items.length} entries verified`,
  );
  return 0;
}

type Env = Readonly<Record<string, string | undefined>>;

async function commandVerify(
  dir: string,
  out: string,
  env: Env,
  io: TransferAttachmentsIo,
  deps: TransferAttachmentsDeps,
) {
  const { manifest, sha256 } = await readPackageAttachments(dir);
  const store = deps.store ?? storeFromEnvironment(env);
  const mismatches = await verify(store, manifest);
  const report = verifyReport(sha256, manifest.items.length, mismatches);
  await writeFileAtomic(resolve(out), Buffer.from(canonicalVerifyReport(report), "utf8"));
  if (mismatches.length > 0) {
    io.err(`${NAME} verify: mismatch: ${mismatches.length} of ${manifest.items.length} objects differ`);
    for (const m of mismatches) io.err(mismatchLine(m));
    return 1;
  }
  io.out(`${NAME} verify: matched: ${manifest.items.length} objects`);
  return 0;
}

async function commandCopyOut(
  dir: string,
  out: string,
  exportId: string | undefined,
  env: Env,
  io: TransferAttachmentsIo,
  deps: TransferAttachmentsDeps,
) {
  if (exportId !== undefined && !UUID.test(exportId)) throw new Blocked(2, "--export-id must be a lower-case uuid");
  const store = deps.store ?? storeFromEnvironment(env);
  let rows: readonly ObjectRow[];
  if (deps.listRows !== undefined) rows = await deps.listRows();
  else {
    const url = env["DATABASE_URL"];
    if (url === undefined || url === "") throw new Blocked(2, "DATABASE_URL is not set");
    const db = createDb(createPool(url, { max: 1 }));
    try {
      rows = await listObjectRows(db);
    } finally {
      await db.destroy();
    }
  }
  const result = await copyOut(store, resolve(dir), rows, exportId ?? uuidv7());
  if (result.problems.length > 0) {
    io.err(
      `${NAME} copy-out: failed: ${result.problems.length} of ${rows.length} objects are missing or differ from ` +
        `their rows; ${ATTACHMENT_MANIFEST_FILE} was not written`,
    );
    for (const p of result.problems) io.err(mismatchLine(p));
    return 1;
  }
  await writeFileAtomic(resolve(out), Buffer.from(result.manifestText, "utf8"));
  io.out(
    `${NAME} copy-out: copied ${result.manifest.items.length} objects (${result.filesWritten} distinct files, ` +
      `${result.bytes} bytes)`,
  );
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const code = await runTransferAttachments(process.argv.slice(2), process.env, {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  });
  process.exitCode = code;
}

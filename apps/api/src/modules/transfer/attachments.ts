// The evidence bytes of a migration package (ADR-0064 §5, §6 step 3; ADR-0066 §1, §4; p7-work-split §C.3, D-248 O1;
// T-DG7-BE-E). The EvidenceStore port and both adapters live in apps/api, and packages/db must not import apps/api
// (ADR-0002), so the byte copy is here and the entry `apps/api/src/cli/transfer-attachments.ts` drives it:
//   - readForExport(store, entry): the bytes of one object through the port (an ObjectSource for exportPackage), or
//     null when the store does not hold it. Through the API's SelectingEvidenceStore it reads the store each row's
//     `storage_driver` names, so S3-held evidence is read the same way as filesystem evidence.
//   - copyIn(store, dir, manifest): writes every listed object under its SAME object name through the target's port
//     (either adapter), then reads it back and compares size and SHA-256. Before any write it checks every package file
//     against its entry and every target name: a package file that is missing or differs, or a target object that
//     already holds OTHER bytes under the name, refuses the whole copy (nothing is written). A target object with the
//     same bytes is left as it is (the re-run of an interrupted copy).
//   - verify(store, manifest): one mismatch per missing object or differing size or SHA-256 (the shape of
//     packages/db reconcile.ts AttachmentMismatch). Every entry is checked; a problem is reported, never skipped.
//   - listObjectRows(db) + copyOut(store, dir, rows, exportId): the backup set's evidence (ADR-0066 §1): every row that
//     names an object (the catalogue's `storage_key` columns, as the export finds them), each object read through the
//     port, checked against its row's SHA-256 and size, and written once per distinct SHA-256 as
//     `<dir>/attachments/<sha256>`, with the `mth-attachment-manifest/1` text of the copied entries.
// Nothing here returns or logs evidence bytes; output names objects (opaque keys), parent tables and parent ids only.
// No HTTP operation reaches this file: the copy is an IT operator's CLI step, like the import (p7-work-split §C.11).
// A copy approves nothing (no G1-G6, Finance or IT approval) and never reads or writes DG0-DG7.
import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import {
  ATTACHMENT_MANIFEST_SCHEMA_VERSION,
  buildPlan,
  byCodePoint,
  canonicalAttachmentManifest,
  confinedPath,
  sql,
  transferSha256,
  type AttachmentEntry,
  type AttachmentManifest,
  type AttachmentMismatch,
  type Db,
  type ObjectRef,
  type ObjectSource,
} from "@mth/db";
import type { EvidenceStore } from "../evidence/index.ts";

/** The format of `transfer-attachments verify --out <json>` (read by reconcile-migration and the backup checks). */
export const ATTACHMENT_VERIFY_SCHEMA_VERSION = "mth-attachment-verify/1";

/** The result file of `verify`: canonical JSON, keys in this order, one final newline. */
export interface AttachmentVerifyReport {
  readonly schemaVersion: typeof ATTACHMENT_VERIFY_SCHEMA_VERSION;
  /** SHA-256 of the attachments.json bytes that were verified. */
  readonly attachmentManifestSha256: string;
  readonly checked: number;
  readonly result: "matched" | "mismatched";
  readonly mismatches: readonly AttachmentMismatch[];
}

export function canonicalVerifyReport(r: AttachmentVerifyReport): string {
  return `${JSON.stringify({
    schemaVersion: r.schemaVersion,
    attachmentManifestSha256: r.attachmentManifestSha256,
    checked: r.checked,
    result: r.result,
    mismatches: r.mismatches.map(mismatchKeys),
  })}\n`;
}

function mismatchKeys(m: AttachmentMismatch): AttachmentMismatch {
  return {
    parentTable: m.parentTable,
    objectName: m.objectName,
    problem: m.problem,
    expectedSize: m.expectedSize,
    actualSize: m.actualSize,
    expectedSha256: m.expectedSha256,
    actualSha256: m.actualSha256,
  };
}

export function verifyReport(manifestSha256: string, checked: number, mismatches: readonly AttachmentMismatch[]) {
  const report: AttachmentVerifyReport = {
    schemaVersion: ATTACHMENT_VERIFY_SCHEMA_VERSION,
    attachmentManifestSha256: manifestSha256,
    checked,
    result: mismatches.length === 0 ? "matched" : "mismatched",
    mismatches,
  };
  return report;
}

/** What the store holds under a name: its size and SHA-256 (hashed while streaming), or null when absent. */
export async function describeObject(
  store: EvidenceStore,
  objectName: string,
): Promise<{ readonly size: number; readonly sha256: string } | null> {
  if ((await store.head(objectName)) === null) return null;
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of await store.get(objectName)) {
    hash.update(chunk);
    size += chunk.byteLength;
  }
  return { size, sha256: hash.digest("hex") };
}

/** The bytes of one object through the port, or null when the store does not hold it. */
async function readObject(store: EvidenceStore, objectName: string): Promise<Uint8Array | null> {
  if ((await store.head(objectName)) === null) return null;
  const chunks: Uint8Array[] = [];
  for await (const chunk of await store.get(objectName)) chunks.push(chunk);
  return new Uint8Array(Buffer.concat(chunks));
}

/** ADR-0064 §5: the export reads each object through the EvidenceStore port. Null when the object is missing. */
export function readForExport(store: EvidenceStore, entry: Pick<ObjectRef, "objectName">): Promise<Uint8Array | null> {
  return readObject(store, entry.objectName);
}

/** The port as the export's ObjectSource (`exportPackage(db, sink, { objects: evidenceStoreObjectSource(store) })`). */
export function evidenceStoreObjectSource(store: EvidenceStore): ObjectSource {
  return { read: (ref) => readForExport(store, ref) };
}

/** Compares one entry with what the store holds under its object name. */
async function checkEntry(store: EvidenceStore, entry: AttachmentEntry): Promise<AttachmentMismatch | null> {
  const actual = await describeObject(store, entry.objectName);
  const base = {
    parentTable: entry.parentTable,
    objectName: entry.objectName,
    expectedSize: entry.sizeBytes,
    expectedSha256: entry.sha256,
  };
  if (actual === null) return { ...base, problem: "missing", actualSize: null, actualSha256: null };
  const actualSize = String(actual.size);
  if (actualSize !== entry.sizeBytes)
    return { ...base, problem: "size_mismatch", actualSize, actualSha256: actual.sha256 };
  if (actual.sha256 !== entry.sha256)
    return { ...base, problem: "sha256_mismatch", actualSize, actualSha256: actual.sha256 };
  return null;
}

/** Every entry checked against the store; one mismatch per missing object or differing size or SHA-256. */
export async function verify(store: EvidenceStore, manifest: AttachmentManifest): Promise<AttachmentMismatch[]> {
  const out: AttachmentMismatch[] = [];
  for (const entry of manifest.items) {
    const m = await checkEntry(store, entry);
    if (m !== null) out.push(m);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ copy-in

/** A copy-in refused before any write: the package's own files, or the target already holding other bytes. */
export class AttachmentCopyRefused extends Error {
  readonly reason: "package" | "target_conflict";
  readonly problems: readonly AttachmentMismatch[];
  constructor(reason: "package" | "target_conflict", problems: readonly AttachmentMismatch[]) {
    super(
      reason === "package"
        ? `${problems.length} package attachment files are missing or differ from attachments.json`
        : `${problems.length} target objects already hold other bytes under their names`,
    );
    this.name = "AttachmentCopyRefused";
    this.reason = reason;
    this.problems = problems;
  }
}

export interface CopyInResult {
  /** Objects written under their names. */
  readonly written: number;
  /** Objects the target already held with identical bytes (not rewritten). */
  readonly present: number;
  /** The read-back verification of every entry after the copy (empty when every object matches). */
  readonly mismatches: readonly AttachmentMismatch[];
}

async function readPackageFile(dir: string, file: string): Promise<Buffer | null> {
  try {
    return await readFile(confinedPath(dir, file));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** The package file of an entry, checked against the entry (null when it matches). */
function packageProblem(entry: AttachmentEntry, bytes: Buffer | null): AttachmentMismatch | null {
  const base = {
    parentTable: entry.parentTable,
    objectName: entry.objectName,
    expectedSize: entry.sizeBytes,
    expectedSha256: entry.sha256,
  };
  if (bytes === null) return { ...base, problem: "missing", actualSize: null, actualSha256: null };
  const sha = transferSha256(bytes);
  const size = String(bytes.byteLength);
  if (size !== entry.sizeBytes) return { ...base, problem: "size_mismatch", actualSize: size, actualSha256: sha };
  if (sha !== entry.sha256) return { ...base, problem: "sha256_mismatch", actualSize: size, actualSha256: sha };
  return null;
}

/**
 * ADR-0064 §5, §6 step 3: writes every object of `manifest` (files under `dir`) under its same object name through
 * `store`, then reads each back. Throws AttachmentCopyRefused, before any write, when a package file is missing or
 * differs, or when the target holds other bytes under a listed name.
 */
export async function copyIn(store: EvidenceStore, dir: string, manifest: AttachmentManifest): Promise<CopyInResult> {
  // 1. The package's files (each distinct file read and checked once).
  const files = new Map<string, Buffer | null>();
  const packageProblems: AttachmentMismatch[] = [];
  for (const entry of manifest.items) {
    if (!files.has(entry.file)) files.set(entry.file, await readPackageFile(dir, entry.file));
    const p = packageProblem(entry, files.get(entry.file)!);
    if (p !== null) packageProblems.push(p);
  }
  if (packageProblems.length > 0) throw new AttachmentCopyRefused("package", packageProblems);

  // 2. The target's names: absent (to write), the same bytes (left), or other bytes (refused).
  const toWrite: AttachmentEntry[] = [];
  const conflicts: AttachmentMismatch[] = [];
  const names = new Set<string>();
  let present = 0;
  for (const entry of manifest.items) {
    if (names.has(entry.objectName)) continue;
    names.add(entry.objectName);
    const m = await checkEntry(store, entry);
    if (m === null) present += 1;
    else if (m.problem === "missing") toWrite.push(entry);
    else conflicts.push(m);
  }
  if (conflicts.length > 0) throw new AttachmentCopyRefused("target_conflict", conflicts);

  // 3. Write, then read every entry back.
  for (const entry of toWrite) {
    const bytes = files.get(entry.file)!;
    const stored = await store.put(entry.objectName, new Uint8Array(bytes), Math.max(1, bytes.byteLength));
    if (stored.sha256 !== entry.sha256 || String(stored.size) !== entry.sizeBytes)
      throw new Error(`the store reported other bytes for ${entry.objectName} than were written`);
  }
  return { written: toWrite.length, present, mismatches: await verify(store, manifest) };
}

// ------------------------------------------------------------------------------------------------ copy-out

/** A row that names an evidence object, with what the row says the object is. */
export interface ObjectRow {
  readonly objectName: string;
  readonly parentTable: string;
  readonly parentId: string;
  readonly sha256: string;
  /** Decimal string. */
  readonly sizeBytes: string;
}

/**
 * Every row that names an object (the plan's `storage_key` columns: evidence_content and export_job today), read in
 * one REPEATABLE READ, READ ONLY transaction. The checksum columns are those the export uses (`sha256`/`size_bytes`,
 * else `file_sha256`/`file_size_bytes`).
 */
export async function listObjectRows(db: Db): Promise<ObjectRow[]> {
  return db
    .transaction()
    .setIsolationLevel("repeatable read")
    .setAccessMode("read only")
    .execute(async (tx) => {
      const plan = await buildPlan(tx);
      const out: ObjectRow[] = [];
      for (const oc of plan.objectColumns) {
        const table = plan.tables.find((t) => t.name === oc.table)!;
        const has = (n: string) => table.columns.some((c) => c.name === n);
        const [sha, size] =
          has("sha256") && has("size_bytes")
            ? ["sha256", "size_bytes"]
            : has("file_sha256") && has("file_size_bytes")
              ? ["file_sha256", "file_size_bytes"]
              : [null, null];
        if (sha === null || size === null || !has("id"))
          throw new Error(`table ${table.name} names evidence objects but records no id, SHA-256 and size`);
        const q = (n: string) => `"${n.replace(/"/g, '""')}"`;
        const r = await sql<{ id: string; key: string; sha: string | null; size: string | null }>`${sql.raw(
          `SELECT id::text AS id, ${q(oc.column)} AS key, ${q(sha)}::text AS sha, ${q(size)}::text AS size ` +
            `FROM ${q(table.name)} WHERE ${q(oc.column)} IS NOT NULL ORDER BY id::text COLLATE "C"`,
        )}`.execute(tx);
        for (const row of r.rows)
          out.push({
            objectName: row.key,
            parentTable: table.name,
            parentId: row.id,
            sha256: (row.sha ?? "").trim(),
            sizeBytes: row.size ?? "",
          });
      }
      return out.sort(
        (a, b) =>
          byCodePoint(a.parentTable, b.parentTable) ||
          byCodePoint(a.parentId, b.parentId) ||
          byCodePoint(a.objectName, b.objectName),
      );
    });
}

export interface CopyOutResult {
  /** The attachments.json text of the copied entries (written by the caller only when `problems` is empty). */
  readonly manifestText: string;
  readonly manifest: AttachmentManifest;
  /** Distinct objects written under `<dir>/attachments/`. */
  readonly filesWritten: number;
  /** Total bytes of the entries (decimal string). */
  readonly bytes: string;
  /** A missing object or one whose bytes differ from its row: reported, never skipped. */
  readonly problems: readonly AttachmentMismatch[];
}

/** Writes `bytes` to `path` atomically (temporary file, fsync, rename). */
export async function writeFileAtomic(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.part`;
  const handle = await open(temp, "w", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temp, path);
  } catch (err) {
    await rm(temp, { force: true });
    throw err;
  }
}

/**
 * D-248 O1, ADR-0066 §1: copies every object `rows` names out of `store` into `<dir>/attachments/<sha256>` (once per
 * distinct SHA-256, each re-read and checked after the write) and returns the attachment manifest of the copied
 * entries. A missing object, or one whose size or SHA-256 differs from its row, is a problem (never skipped).
 */
export async function copyOut(
  store: EvidenceStore,
  dir: string,
  rows: readonly ObjectRow[],
  exportId: string,
): Promise<CopyOutResult> {
  const items: AttachmentEntry[] = [];
  const problems: AttachmentMismatch[] = [];
  const written = new Set<string>();
  let bytes = 0n;
  for (const row of rows) {
    const data = await readObject(store, row.objectName);
    const base = {
      parentTable: row.parentTable,
      objectName: row.objectName,
      expectedSize: row.sizeBytes,
      expectedSha256: row.sha256,
    };
    if (data === null) {
      problems.push({ ...base, problem: "missing", actualSize: null, actualSha256: null });
      continue;
    }
    const sha = transferSha256(data);
    const size = String(data.byteLength);
    if (size !== row.sizeBytes || sha !== row.sha256) {
      problems.push({
        ...base,
        problem: size !== row.sizeBytes ? "size_mismatch" : "sha256_mismatch",
        actualSize: size,
        actualSha256: sha,
      });
      continue;
    }
    const file = `attachments/${sha}`;
    if (!written.has(sha)) {
      const path = confinedPath(dir, file);
      await writeFileAtomic(path, data);
      if (transferSha256(await readFile(path)) !== sha) throw new Error(`the copied file ${file} does not match`);
      written.add(sha);
    }
    bytes += BigInt(data.byteLength);
    items.push({
      objectName: row.objectName,
      sizeBytes: size,
      sha256: sha,
      parentTable: row.parentTable,
      parentId: row.parentId,
      file,
    });
  }
  const manifest: AttachmentManifest = { schemaVersion: ATTACHMENT_MANIFEST_SCHEMA_VERSION, exportId, items };
  return {
    manifestText: canonicalAttachmentManifest(manifest),
    manifest,
    filesWritten: written.size,
    bytes: String(bytes),
    problems,
  };
}

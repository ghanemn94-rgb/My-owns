// The migration import (ADR-0064 §6; p7-work-split §C.2, §C.5; T-DG7-BE-D): `mth-db import-migration --from <dir>
// --operator <name> [--manifest-sha256 <hex>]`, owner role (DATABASE_OWNER_URL), session lock of class migrationImport
// (key "migration-import", reconcile.ts).
//
// Delivered here (each refusal changes nothing in the target):
//   step 1  package checks: `schemaVersion` must be mth-migration/1 (exit 2 `unsupported manifest schema version`);
//           manifest.json must be canonical; its SHA-256 must equal --manifest-sha256 when given; every table file's
//           SHA-256 must equal its `fileSha256`, and attachments.json's the manifest's (exit 2 `checksum mismatch for
//           <file>`).
//   step 2  target checks: no pending migration and the highest applied one equal to `migrationLevel` (exit 2 `the
//           target is at <level>, the package at <level>`); the release equal to `appVersion` (exit 2 `the target runs
//           <appVersion>, the package was written by <appVersion>`).
//   step 4  empty target: refused (exit 3 `the target database is not empty`) when any row exists in organization,
//           app_user, transformation, audit_event or deployment_environment.
//
// NOT delivered (T-DG7-BE-D handback §4, open question Q1): steps 5-7 and 9, the load. ADR-0064 §6 states that "a
// freshly migrated database passes" step 4 and that audit_event loads by plain INSERT with its original id and seq while
// its two triggers stay enabled. Measured on PostgreSQL 16.15: a freshly migrated database already holds audit_event
// rows written by the migrations themselves (uuid v7 ids and seq 1..n generated at migrate time, e.g. job_schedule.create).
// So step 4 refuses every migrated target, and without step 4 the source's rows collide on audit_event_seq_key while
// the target's own seeded rows cannot be removed without disabling audit_event's triggers, which p7-work-split C.11
// forbids ("stop and report: it would be a DG1 reopen, seam 8"). The command therefore never loads anything: after the
// checks it exits 1 with `import-migration: failed: <reason>` naming this.
//
// An import approves nothing (no G1-G6, Finance or IT approval) and never reads or writes DG0-DG7.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sql } from "kysely";
import { compareStatus, listMigrationFiles } from "../migrate.ts";
import type { Db } from "../pool.ts";
import { confinedPath, transferSha256 } from "./export.ts";
import {
  ATTACHMENT_MANIFEST_FILE,
  decodeStrictUtf8,
  MANIFEST_FILE,
  MANIFEST_SCHEMA_VERSION,
  manifestSchemaVersion,
  ManifestFormatError,
  packageAppVersion,
  parseManifest,
  type MigrationManifest,
} from "./manifest.ts";
import { withMigrationImportLock } from "./reconcile.ts";

/** The tables whose rows make a target "not empty" (ADR-0064 §6 step 4). */
export const EMPTY_TARGET_TABLES = [
  "organization",
  "app_user",
  "transformation",
  "audit_event",
  "deployment_environment",
] as const;

/** Why the load is not run (see the header). */
export const LOAD_BLOCKED_REASON =
  "the load is not available in this release: a migrated target already holds migration-written audit_event rows, " +
  "which ADR-0064 section 6 does not provide for (handback T-DG7-BE-D, open question Q1)";

/** A refusal with its exit code and C.5 line. */
export class ImportRefused extends Error {
  readonly exitCode: 1 | 2 | 3 | 4;
  constructor(exitCode: 1 | 2 | 3 | 4, line: string) {
    super(line);
    this.name = "ImportRefused";
    this.exitCode = exitCode;
  }
}

const refuse = (exitCode: 2 | 3, why: string) => new ImportRefused(exitCode, `import-migration: refused: ${why}`);

export interface CheckedPackage {
  readonly dir: string;
  readonly manifest: MigrationManifest;
  readonly manifestSha256: string;
}

/** Step 1: the package checks (no database access). */
export async function checkPackage(dir: string, expectedManifestSha256?: string): Promise<CheckedPackage> {
  const root = resolve(dir);
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(confinedPath(root, MANIFEST_FILE)));
  } catch {
    throw refuse(2, `checksum mismatch for ${MANIFEST_FILE}`);
  }
  let text: string;
  try {
    text = decodeStrictUtf8(bytes);
  } catch {
    throw refuse(2, `checksum mismatch for ${MANIFEST_FILE}`);
  }
  const version = manifestSchemaVersion(text);
  if (version !== MANIFEST_SCHEMA_VERSION) throw refuse(2, `unsupported manifest schema version '${version ?? ""}'`);
  const manifestSha256 = transferSha256(bytes);
  if (expectedManifestSha256 !== undefined && expectedManifestSha256.toLowerCase() !== manifestSha256)
    throw refuse(2, `checksum mismatch for ${MANIFEST_FILE}`);
  let manifest: MigrationManifest;
  try {
    manifest = parseManifest(text);
  } catch (err) {
    if (err instanceof ManifestFormatError) throw refuse(2, `checksum mismatch for ${MANIFEST_FILE}`);
    throw err;
  }
  const fileSha = async (file: string): Promise<string | null> => {
    try {
      return transferSha256(await readFile(confinedPath(root, file)));
    } catch {
      return null;
    }
  };
  if ((await fileSha(ATTACHMENT_MANIFEST_FILE)) !== manifest.attachmentManifest.sha256)
    throw refuse(2, `checksum mismatch for ${ATTACHMENT_MANIFEST_FILE}`);
  for (const t of manifest.tables)
    if ((await fileSha(t.file)) !== t.fileSha256) throw refuse(2, `checksum mismatch for ${t.file}`);
  return { dir: root, manifest, manifestSha256 };
}

/** Step 2: the target is migrated (up to date with this build), at the package's level, and runs its release. */
export async function checkTarget(
  db: Db,
  manifest: MigrationManifest,
  appVersion = packageAppVersion(),
): Promise<void> {
  const applied = (
    await sql<{
      id: number;
      name: string;
      sha256: string;
    }>`SELECT id, name, sha256 FROM schema_migration ORDER BY id`.execute(db)
  ).rows;
  const status = compareStatus(listMigrationFiles(), applied);
  const highest = applied[applied.length - 1]?.name.replace(/\.sql$/, "") ?? "none";
  if (!status.upToDate || highest !== manifest.migrationLevel)
    throw refuse(
      2,
      `the target is at ${status.upToDate ? highest : `${highest} (not up to date)`}, the package at ${manifest.migrationLevel}`,
    );
  if (appVersion !== manifest.appVersion)
    throw refuse(2, `the target runs ${appVersion}, the package was written by ${manifest.appVersion}`);
}

/** Step 4: refuses unless every table of EMPTY_TARGET_TABLES is empty. */
export async function checkEmptyTarget(db: Db): Promise<void> {
  for (const t of EMPTY_TARGET_TABLES) {
    const r = await sql<{ present: boolean }>`SELECT EXISTS (SELECT 1 FROM ${sql.table(t)}) AS present`.execute(db);
    if (r.rows[0]?.present === true) throw refuse(3, "the target database is not empty");
  }
}

export interface ImportCliIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

export interface ImportCliOptions {
  readonly from: string | undefined;
  readonly operator: string | undefined;
  readonly manifestSha256?: string | undefined;
  /** Default: the @mth/db package version. */
  readonly appVersion?: string;
}

const OPERATOR = /^[\p{L}\p{N} ._@-]{1,100}$/u;

/** `mth-db import-migration`; returns the exit code. */
export async function runImportMigrationCommand(db: Db, opts: ImportCliOptions, io: ImportCliIo): Promise<number> {
  if (
    opts.from === undefined ||
    opts.from === "" ||
    opts.operator === undefined ||
    !OPERATOR.test(opts.operator) ||
    (opts.manifestSha256 !== undefined && !/^[0-9a-fA-F]{64}$/.test(opts.manifestSha256))
  ) {
    io.err("BLOCKED: usage: mth-db import-migration --from <dir> --operator <name> [--manifest-sha256 <hex>]");
    return 2;
  }
  const from = opts.from;
  try {
    const pkg = await checkPackage(from, opts.manifestSha256);
    return await withMigrationImportLock(db, async (conn) => {
      await checkTarget(conn, pkg.manifest, opts.appVersion);
      await checkEmptyTarget(conn);
      throw new ImportRefused(1, `import-migration: failed: ${LOAD_BLOCKED_REASON}`);
    });
  } catch (err) {
    if (err instanceof ImportRefused) {
      io.err(err.message);
      return err.exitCode;
    }
    throw err;
  }
}

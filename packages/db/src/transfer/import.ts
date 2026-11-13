// The migration import (ADR-0064 §6; p7-work-split §C.2, §C.5; T-DG7-BE-D): `mth-db import-migration --from <dir>
// --operator <name> [--manifest-sha256 <hex>]`, owner role (DATABASE_OWNER_URL), session lock of class migrationImport
// (key "migration-import", reconcile.ts).
//
// Delivered here (ADR-0064 §6 steps 1-3 and Amendment 1 §A1.3-A1.8; T-DG7-BE-D, repaired by T-DG7-BE-R1):
//   step 1  package checks: `schemaVersion` must be mth-migration/1 (exit 2 `unsupported manifest schema version`);
//           manifest.json must be canonical; its SHA-256 must equal --manifest-sha256 when given; every table file's
//           SHA-256 must equal its `fileSha256`, and attachments.json's the manifest's (exit 2 `checksum mismatch for
//           <file>`). Then the attachment verify report (A1.8, attachment-report.ts) when the package lists any.
//   step 2  target checks: no pending migration and the highest applied one equal to `migrationLevel` (exit 2 `the
//           target is at <level>, the package at <level>`); the release equal to `appVersion` (exit 2 `the target runs
//           <appVersion>, the package was written by <appVersion>`).
//   L0-L12  ONE transaction under the session lock 730403 (A1.4): pinned encoder settings and
//           `LOCK TABLE audit_event IN EXCLUSIVE MODE`; E1-E4 (A1.3: no use, baseline-only audit rows, the audit
//           sequence reserved above the package's highest seq M, both audit triggers enabled); the baseline recorded;
//           user triggers off on every exported table EXCEPT audit_event; the migration seeds deleted (never from
//           audit_event, never TRUNCATE); every table loaded with its own ids (audit_event too, with its own id and
//           seq); the deferred columns set; sequences raised, never lowered; user triggers back on; the
//           reconciliation (audit_event over seq <= M, the baseline re-checked, the attachment report); on a mismatch
//           ROLLBACK and exit 4; else migration_import, the holds, the reconciliation rows and the appended audit
//           events migration.imported, migration.reconciled and identity.binding_held, then COMMIT.
// audit_event is never updated, deleted from or truncated, and its triggers are never disabled (D-258).
//
// An import approves nothing (no G1-G6, Finance or IT approval) and never reads or writes DG0-DG7.
import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { sql } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { insertAuditEvent } from "../audit.ts";
import { compareStatus, listMigrationFiles } from "../migrate.ts";
import type { Db, DbOrTx, Tx } from "../pool.ts";
import {
  AttachmentReportRefused,
  parseAttachmentReport,
  requireAttachmentReport,
  type ParsedAttachmentReport,
} from "./attachment-report.ts";
import { confinedPath, encodeTable, transferSha256 } from "./export.ts";
import {
  ATTACHMENT_MANIFEST_FILE,
  decodeStrictUtf8,
  MANIFEST_FILE,
  MANIFEST_SCHEMA_VERSION,
  manifestSchemaVersion,
  ManifestFormatError,
  demoChecksumFor,
  packageAppVersion,
  parseManifest,
  type MigrationManifest,
} from "./manifest.ts";
import { buildPlan, selfReferenceOrder, type TransferPlan, type TransferPlanTable } from "./plan.ts";
import {
  auditReconciliation,
  buildReport,
  pinEncoderSettings,
  reconcileTables,
  recordReconciliation,
  withMigrationImportLock,
  type ReconciliationDelta,
  type ReconciliationReport,
} from "./reconcile.ts";

/** A refusal with its exit code and C.5 line. */
export class ImportRefused extends Error {
  readonly exitCode: 1 | 2 | 3 | 4;
  /** Further lines printed after the first (E1/E2 detail lines). */
  readonly details: readonly string[];
  constructor(exitCode: 1 | 2 | 3 | 4, line: string, details: readonly string[] = []) {
    super(line);
    this.name = "ImportRefused";
    this.exitCode = exitCode;
    this.details = details;
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

// ------------------------------------------------------------------------------------------------ A1.2: M

/** The package's carried audit range, by streaming tables/audit_event.ndjson (A1.2 step 3; never from the target). */
export interface PackageAuditRange {
  /** Decimal-exact. */
  readonly rows: bigint;
  /** M: the highest seq, 0 when the file has no row. */
  readonly seqMax: bigint;
  /** The lowest seq, null when the file has no row. */
  readonly seqMin: bigint | null;
  /** Every carried id (for the id-collision check at L1). */
  readonly ids: readonly string[];
}

export async function packageAuditRange(pkg: CheckedPackage): Promise<PackageAuditRange> {
  const t = pkg.manifest.tables.find((x) => x.name === "audit_event");
  if (t === undefined) throw refuse(2, "checksum mismatch for tables/audit_event.ndjson");
  const lines = createInterface({
    input: createReadStream(confinedPath(pkg.dir, t.file), { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  let rows = 0n;
  let seqMax = 0n;
  let seqMin: bigint | null = null;
  const ids: string[] = [];
  for await (const line of lines) {
    if (line === "") continue;
    let seq: unknown;
    let id: unknown;
    try {
      ({ seq, id } = JSON.parse(line) as { seq?: unknown; id?: unknown });
    } catch {
      seq = undefined;
    }
    if (typeof id !== "string") throw refuse(2, `checksum mismatch for ${t.file}`);
    ids.push(id);
    if (typeof seq !== "string" || !/^[1-9][0-9]*$/.test(seq)) throw refuse(2, `checksum mismatch for ${t.file}`);
    const n = BigInt(seq);
    rows += 1n;
    if (n > seqMax) seqMax = n;
    if (seqMin === null || n < seqMin) seqMin = n;
  }
  return { rows, seqMax, seqMin, ids };
}

/** `mth-db migrate --reserve-audit-seq-for <dir>` (A1.2): the package checks, then M, before any connection. */
export async function reservedAuditStart(dir: string): Promise<{ readonly start: bigint; readonly seqMax: bigint }> {
  let pkg: CheckedPackage;
  try {
    pkg = await checkPackage(dir);
  } catch (err) {
    if (err instanceof ImportRefused)
      throw new ImportRefused(
        2,
        `migrate: refused: the package at ${dir} failed its checks: ${err.message.replace(/^import-migration: refused: /, "")}`,
      );
    throw err;
  }
  let range: PackageAuditRange;
  try {
    range = await packageAuditRange(pkg);
  } catch (err) {
    if (err instanceof ImportRefused)
      throw new ImportRefused(
        2,
        `migrate: refused: the package at ${dir} failed its checks: ${err.message.replace(/^import-migration: refused: /, "")}`,
      );
    throw err;
  }
  return { start: range.seqMax + 1n, seqMax: range.seqMax };
}

// ------------------------------------------------------------------------------------------------ A1.3: E1-E4

/** E1: rows in any of these tables mean the target has been used. */
export const E1_TABLES = [
  "organization",
  "app_user",
  "user_identity",
  "transformation",
  "deployment_environment",
  "evidence_content",
  "export_job",
  "migration_import",
  "identity_binding_hold",
  "session",
  "worker_heartbeat",
] as const;

/** E2: a baseline row, written by a migration of this release (A1.3). */
export const BASELINE_PREDICATE =
  "source = 'migration' AND actor_type = 'system' AND actor_user_id IS NULL AND on_behalf_of_user_id IS NULL " +
  "AND organization_id IS NULL AND transformation_id IS NULL";

/** E4: the two triggers of audit_event that must stay enabled ('O') throughout. */
export const AUDIT_TRIGGERS = ["audit_event_immutable", "audit_event_immutable_truncate"] as const;

export const NOT_EMPTY_LINE = "import-migration: refused: the target database is not empty";

/** E4. */
export async function assertAuditTriggersEnabled(tx: DbOrTx): Promise<void> {
  const r = await sql<{ tgname: string; tgenabled: string }>`
    SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'audit_event'::regclass AND NOT tgisinternal`.execute(tx);
  for (const name of AUDIT_TRIGGERS) {
    const t = r.rows.find((x) => x.tgname === name);
    if (t === undefined || t.tgenabled !== "O") throw refuse(2, `audit_event trigger ${name} is not enabled`);
  }
}

const countOf = async (tx: DbOrTx, query: string): Promise<bigint> =>
  BigInt((await sql<{ n: string }>`${sql.raw(query)}`.execute(tx)).rows[0]?.n ?? "0");

/** E1-E4 (A1.3), in the load transaction after `LOCK TABLE audit_event IN EXCLUSIVE MODE`. */
export async function checkEmptyTarget(tx: DbOrTx, carriedSeqMax: bigint, dir: string): Promise<void> {
  const details: string[] = [];
  for (const t of E1_TABLES) {
    const n = await countOf(tx, `SELECT count(*)::text AS n FROM ${quoteIdent(t)}`);
    if (n > 0n) details.push(`import-migration: ${t} holds ${n} rows`);
  }
  const used = await countOf(tx, `SELECT count(*)::text AS n FROM audit_event WHERE NOT (${BASELINE_PREDICATE})`);
  if (used > 0n) details.push(`import-migration: audit_event holds ${used} rows not written by migrations`);
  if (details.length > 0) throw new ImportRefused(3, NOT_EMPTY_LINE, details);
  const min = (await sql<{ s: string | null }>`SELECT min(seq)::text AS s FROM audit_event`.execute(tx)).rows[0]?.s;
  if (min !== null && min !== undefined && BigInt(min) <= carriedSeqMax)
    throw refuse(
      2,
      `the target's audit events start at seq ${min}, at or below the package's highest audit seq ${carriedSeqMax}; ` +
        `recreate the target with mth-db migrate --reserve-audit-seq-for ${dir}`,
    );
  await assertAuditTriggersEnabled(tx);
}

/**
 * Measured by T-DG7-BE-R1 (handback §4, open question R1): migrations 0068, 0069 and 0095 write audit_event rows with
 * DETERMINISTIC ids, so a source's carried history and a target's migration baseline hold rows with the same id. A1.4
 * L5 assumes no carried id collides with a baseline row; the PRIMARY KEY would refuse the load. The import does not
 * skip, renumber or re-identify any audit row (C.12 hard rules), so it stops here, inside the transaction, before
 * anything is changed, and reports the count (exit 1) until the architect decides.
 */
export async function checkAuditIdCollisions(tx: DbOrTx, carried: PackageAuditRange): Promise<void> {
  if (carried.ids.length === 0) return;
  const r = (
    await sql<{ n: string; first: string | null }>`
      SELECT count(*)::text AS n, min(id::text) AS first FROM audit_event WHERE id = ANY(${carried.ids}::uuid[])`.execute(
      tx,
    )
  ).rows[0]!;
  if (r.n !== "0")
    throw new ImportRefused(
      1,
      `import-migration: failed: ${r.n} carried audit events share their id with the target's migration baseline ` +
        `(first ${r.first}); ADR-0064 Amendment 1 does not provide for this, and no audit row is skipped or renumbered`,
    );
}

// ------------------------------------------------------------------------------------------------ A1.4: the load

export type LoadStep = "L0" | "L1" | "L2" | "L3" | "L4" | "L5" | "L6" | "L7" | "L8" | "L9" | "L11" | "L12";

const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`;

/** The rows of a package table file, as their raw JSON lines (never re-serialized: numbers keep their digits). */
async function tableLines(pkg: CheckedPackage, file: string): Promise<string[]> {
  const text = await readFile(confinedPath(pkg.dir, file), "utf8");
  return text.split("\n").filter((l) => l !== "");
}

/** The self-reference order of a table's rows (parents before children) unless every self column is deferred. */
function orderedLines(table: TransferPlanTable, lines: string[]): string[] {
  const fks = table.selfReferences.filter((fk) => !fk.columns.every((c) => table.deferredColumns.includes(c)));
  if (fks.length === 0) return lines;
  const key = fks[0]!.referencedColumns;
  const same = fks.filter((fk) => fk.referencedColumns.join("\u0000") === key.join("\u0000"));
  const parsed = lines.map((line) => ({ line, row: JSON.parse(line) as Record<string, unknown> }));
  const text = (row: Record<string, unknown>, cols: readonly string[]): string | null => {
    const vals = cols.map((c) => row[c]);
    return vals.some((v) => v === null || v === undefined) ? null : JSON.stringify(vals);
  };
  return selfReferenceOrder(
    parsed,
    (p) => text(p.row, key) ?? "",
    (p) => same.map((fk) => text(p.row, fk.columns)),
  ).map((p) => p.line);
}

const BATCH = 500;

interface LoadContext {
  readonly tx: Tx;
  readonly pkg: CheckedPackage;
  readonly plan: TransferPlan;
}

/**
 * The deferred columns that every foreign key on them is DEFERRABLE: with `SET CONSTRAINTS ALL DEFERRED` (L0) they are
 * checked at COMMIT, so they load with their value at L5 (a CHECK such as automation_rule_enabled_needs_version may
 * forbid the null), and L6 finds nothing left to set.
 */
async function directDeferred(tx: Tx, table: TransferPlanTable): Promise<Set<string>> {
  if (table.deferredColumns.length === 0) return new Set();
  const r = await sql<{ col: string; all_deferrable: boolean }>`
    SELECT a.attname AS col, bool_and(con.condeferrable) AS all_deferrable
      FROM pg_constraint con
      CROSS JOIN LATERAL unnest(con.conkey) AS k(attnum)
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
     WHERE con.contype = 'f' AND con.conrelid = ${quoteIdent(table.name)}::regclass
     GROUP BY a.attname`.execute(tx);
  return new Set(r.rows.filter((x) => x.all_deferrable && table.deferredColumns.includes(x.col)).map((x) => x.col));
}

async function generatedAndIdentity(tx: Tx, table: string): Promise<{ generated: Set<string>; identity: boolean }> {
  const r = await sql<{ attname: string; attgenerated: string; attidentity: string }>`
    SELECT attname, attgenerated, attidentity FROM pg_attribute
     WHERE attrelid = ${quoteIdent(table)}::regclass AND attnum > 0 AND NOT attisdropped`.execute(tx);
  return {
    generated: new Set(r.rows.filter((x) => x.attgenerated !== "").map((x) => x.attname)),
    identity: r.rows.some((x) => x.attidentity !== ""),
  };
}

/** L5: one table, in batches, deferred columns as null. */
async function loadTable(ctx: LoadContext, table: TransferPlanTable, file: string): Promise<void> {
  const { generated, identity } = await generatedAndIdentity(ctx.tx, table.name);
  const direct = await directDeferred(ctx.tx, table);
  const cols = table.columns.map((c) => c.name).filter((c) => !generated.has(c));
  const select = cols
    .map((c) => (table.deferredColumns.includes(c) && !direct.has(c) ? "NULL" : `r.${quoteIdent(c)}`))
    .join(", ");
  const lines = orderedLines(table, await tableLines(ctx.pkg, file));
  const head =
    `INSERT INTO ${quoteIdent(table.name)} (${cols.map(quoteIdent).join(", ")})` +
    `${identity ? " OVERRIDING SYSTEM VALUE" : ""} SELECT ${select} ` +
    `FROM jsonb_populate_recordset(NULL::${quoteIdent(table.name)}, `;
  for (let i = 0; i < lines.length; i += BATCH) {
    const json = `[${lines.slice(i, i + BATCH).join(",")}]`;
    await sql`${sql.raw(head)}${json}::jsonb${sql.raw(") AS r")}`.execute(ctx.tx);
  }
}

/** L6: the deferred columns, set from the package by primary key. */
async function secondPass(ctx: LoadContext, table: TransferPlanTable, file: string): Promise<void> {
  const direct = await directDeferred(ctx.tx, table);
  const columns = table.deferredColumns.filter((c) => !direct.has(c));
  if (columns.length === 0) return;
  const t = quoteIdent(table.name);
  const set = columns.map((c) => `${quoteIdent(c)} = r.${quoteIdent(c)}`).join(", ");
  const on = table.primaryKey.map((c) => `${t}.${quoteIdent(c)} = r.${quoteIdent(c)}`).join(" AND ");
  const any = columns.map((c) => `r.${quoteIdent(c)} IS NOT NULL`).join(" OR ");
  const lines = await tableLines(ctx.pkg, file);
  for (let i = 0; i < lines.length; i += BATCH)
    await sql`${sql.raw(`UPDATE ${t} SET ${set} FROM jsonb_populate_recordset(NULL::${t}, `)}${`[${lines
      .slice(i, i + BATCH)
      .join(",")}]`}${sql.raw(`::jsonb) AS r WHERE ${on} AND (${any})`)}`.execute(ctx.tx);
}

/** L7: every identity or serial sequence of an exported table raised to the column's maximum, never lowered. */
async function raiseSequences(ctx: LoadContext): Promise<void> {
  const names = ctx.plan.tables.map((t) => t.name);
  const seqs = await sql<{ t: string; col: string; seq: string }>`
    SELECT c.relname AS t, a.attname AS col, pg_get_serial_sequence(quote_ident(c.relname), a.attname) AS seq
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
     WHERE c.relname = ANY(${names}::text[]) AND a.attnum > 0 AND NOT a.attisdropped
       AND pg_get_serial_sequence(quote_ident(c.relname), a.attname) IS NOT NULL
     ORDER BY 1, 2`.execute(ctx.tx);
  for (const s of seqs.rows) {
    const max = (
      await sql<{
        m: string | null;
      }>`${sql.raw(`SELECT max(${quoteIdent(s.col)})::text AS m FROM ${quoteIdent(s.t)}`)}`.execute(ctx.tx)
    ).rows[0]?.m;
    if (max === null || max === undefined) continue;
    const cur = (
      await sql<{
        last: string;
        called: boolean;
      }>`${sql.raw(`SELECT last_value::text AS last, is_called AS called FROM ${s.seq}`)}`.execute(ctx.tx)
    ).rows[0]!;
    const next = cur.called ? BigInt(cur.last) + 1n : BigInt(cur.last);
    if (BigInt(max) >= next) await sql`SELECT setval(${s.seq}::regclass, ${max}::bigint, true)`.execute(ctx.tx);
  }
}

interface Baseline {
  readonly rows: bigint;
  readonly seqMin: bigint | null;
  readonly seqMax: bigint | null;
  readonly digest: string;
}

/** L2 (and its re-check at L9 and in every recheck): the target's migration baseline above M. */
export async function measureBaseline(
  tx: DbOrTx,
  carriedSeqMax: bigint,
  baselineSeqMax?: bigint | null,
): Promise<Baseline> {
  const plan = await buildPlan(tx);
  const audit = plan.tables.find((t) => t.name === "audit_event");
  if (audit === undefined) throw new ImportRefused(1, "import-migration: failed: audit_event is not an exported table");
  const where =
    baselineSeqMax === undefined
      ? `seq > ${carriedSeqMax.toString()}`
      : baselineSeqMax === null
        ? "false"
        : `seq > ${carriedSeqMax.toString()} AND seq <= ${baselineSeqMax.toString()}`;
  const r = (
    await sql<{ n: string; lo: string | null; hi: string | null }>`${sql.raw(
      `SELECT count(*)::text AS n, min(seq)::text AS lo, max(seq)::text AS hi FROM audit_event WHERE ${where}`,
    )}`.execute(tx)
  ).rows[0]!;
  const encoded = await encodeTable(tx, audit, plan.rewrittenColumns, { where });
  return {
    rows: BigInt(r.n),
    seqMin: r.lo === null ? null : BigInt(r.lo),
    seqMax: r.hi === null ? null : BigInt(r.hi),
    digest: encoded.contentDigest,
  };
}

const sameBaseline = (a: Baseline, b: Baseline): boolean =>
  a.rows === b.rows && a.seqMin === b.seqMin && a.seqMax === b.seqMax && a.digest === b.digest;

/** A reconciliation mismatch inside the load: the transaction rolls back (L10). */
class LoadMismatch extends Error {
  readonly report: ReconciliationReport;
  readonly lines: readonly string[];
  constructor(report: ReconciliationReport, lines: readonly string[]) {
    super("reconciliation mismatch");
    this.report = report;
    this.lines = lines;
  }
}

export interface ImportSummary {
  readonly importId: string;
  readonly rows: string;
  readonly tables: number;
  readonly attachments: number;
  readonly holds: number;
  readonly carried: PackageAuditRange;
  readonly baseline: Baseline;
  readonly seedRowsReplaced: ReadonlyMap<string, bigint>;
}

interface LoadInput {
  readonly pkg: CheckedPackage;
  readonly carried: PackageAuditRange;
  readonly attachments: ParsedAttachmentReport;
  readonly operator: string;
  readonly onStep?: (step: LoadStep, tx: Tx) => Promise<void>;
}

const ACTOR = { actorType: "system", actorUserId: null, source: "cli" } as const;

/** L0-L12 in the caller's transaction. Throws ImportRefused (refusals) or LoadMismatch (L10). */
async function loadInTransaction(tx: Tx, input: LoadInput): Promise<ImportSummary> {
  const { pkg, carried, operator } = input;
  const { manifest } = pkg;
  const step = async (s: LoadStep) => input.onStep?.(s, tx);
  const startedAt = (await sql<{ now: Date }>`SELECT clock_timestamp() AS now`.execute(tx)).rows[0]!.now;

  // L0
  await pinEncoderSettings(tx);
  await sql`SET CONSTRAINTS ALL DEFERRED`.execute(tx);
  await sql`LOCK TABLE audit_event IN EXCLUSIVE MODE`.execute(tx);
  await step("L0");
  // L1
  await checkEmptyTarget(tx, carried.seqMax, pkg.dir);
  await checkAuditIdCollisions(tx, carried);
  const plan = await buildPlan(tx);
  const ctx: LoadContext = { tx, pkg, plan };
  const fileOf = new Map(manifest.tables.map((t) => [t.name, t]));
  const planNames = plan.tables.map((t) => t.name).join(",");
  const packageNames = manifest.tables.map((t) => t.name).join(",");
  if (planNames !== packageNames)
    throw new ImportRefused(1, "import-migration: failed: the package's tables differ from the target's plan");
  for (const t of plan.tables) {
    const m = fileOf.get(t.name)!;
    if (m.columns.join(",") !== t.columns.map((c) => c.name).join(","))
      throw new ImportRefused(1, `import-migration: failed: the columns of ${t.name} differ from the target's`);
  }
  if ((plan.tables.find((t) => t.name === "audit_event")?.deferredColumns.length ?? 0) > 0)
    throw new ImportRefused(
      1,
      "import-migration: failed: the plan defers a column of audit_event, which can never be updated",
    );
  await step("L1");
  // L2
  const baseline = await measureBaseline(tx, carried.seqMax);
  await step("L2");
  // L3
  const others = plan.tables.filter((t) => t.name !== "audit_event");
  for (const t of others) await sql`${sql.raw(`ALTER TABLE ${quoteIdent(t.name)} DISABLE TRIGGER USER`)}`.execute(tx);
  await assertAuditTriggersEnabled(tx);
  await step("L3");
  // L4
  const seedRowsReplaced = new Map<string, bigint>();
  // One statement (data-modifying CTEs): the RESTRICT checks of a cycle broken by the plan (for example
  // automation_rule <-> automation_rule_version) run once at its end, when both sides are gone. audit_event is not
  // among `others`, so it is never a target of DELETE; TRUNCATE is never used.
  const deletes = others.map((t, i) => `d${i} AS (DELETE FROM ${quoteIdent(t.name)} RETURNING 1)`).join(", ");
  const counted = others.map((_, i) => `(SELECT count(*) FROM d${i})::text AS c${i}`).join(", ");
  const deleted = (await sql<Record<string, string>>`${sql.raw(`WITH ${deletes} SELECT ${counted}`)}`.execute(tx))
    .rows[0]!;
  others.forEach((t, i) => {
    const n = BigInt(deleted[`c${i}`] ?? "0");
    if (n > 0n) seedRowsReplaced.set(t.name, n);
  });
  await step("L4");
  // L5
  for (const t of plan.tables) await loadTable(ctx, t, fileOf.get(t.name)!.file);
  await step("L5");
  // L6
  for (const t of plan.tables) await secondPass(ctx, t, fileOf.get(t.name)!.file);
  await step("L6");
  // L7
  await raiseSequences(ctx);
  await step("L7");
  // L8
  for (const t of others) await sql`${sql.raw(`ALTER TABLE ${quoteIdent(t.name)} ENABLE TRIGGER USER`)}`.execute(tx);
  await assertAuditTriggersEnabled(tx);
  await step("L8");
  // L9
  const tables = await reconcileTables(tx, manifest.tables, { auditCarriedSeqMax: carried.seqMax });
  const again = await measureBaseline(tx, carried.seqMax);
  const baselineKept = sameBaseline(baseline, again);
  const deltas: ReconciliationDelta[] = [
    {
      tableName: "audit_event",
      basis: "audit_baseline",
      rowsAdded: baseline.rows.toString(),
      rowsChanged: "0",
      rowsMissing: "0",
      allowed: baselineKept,
    },
  ];
  const lines: string[] = [];
  for (const t of tables.filter((x) => !x.matched))
    lines.push(
      `  ${t.tableName}: expected ${t.expectedRows} rows ${t.expectedDigest}, found ${t.actualRows} rows ${t.actualDigest}`,
    );
  if (!baselineKept) lines.push("  audit_event: the target's migration baseline changed during the load");
  let demoMatched = true;
  if (manifest.demoChecksum !== null) {
    const live = await demoChecksumFor(tx, manifest.sourceEnvironment);
    demoMatched = live === manifest.demoChecksum;
    if (!demoMatched) lines.push(`  demo checksum: expected ${manifest.demoChecksum}, found ${live ?? "none"}`);
  }
  const report = buildReport(tables, input.attachments.checked, input.attachments.mismatches, deltas, "import");
  for (const a of report.attachmentMismatches) lines.push(`  attachment ${a.objectName}: ${a.problem}`);
  await step("L9");
  // L10
  if (report.result !== "matched" || !demoMatched) throw new LoadMismatch(report, lines);
  // L11
  const importId = uuidv7();
  const importedAt = (await sql<{ now: Date }>`SELECT clock_timestamp() AS now`.execute(tx)).rows[0]!.now;
  const seedTotal = [...seedRowsReplaced.values()].reduce((a, b) => a + b, 0n);
  await tx
    .insertInto("migration_import")
    .values({
      id: importId,
      schema_version: manifest.schemaVersion,
      source_environment: manifest.sourceEnvironment,
      source_export_reference: manifest.exportId,
      migration_level: manifest.migrationLevel,
      manifest_sha256: pkg.manifestSha256,
      attachment_manifest_sha256: manifest.attachmentManifest.sha256,
      demo_checksum: manifest.demoChecksum,
      table_count: manifest.totals.tables,
      row_count: manifest.totals.rows,
      attachment_count: manifest.attachmentManifest.count,
      attachment_bytes: manifest.attachmentManifest.bytes,
      operator_name: operator,
      started_at: startedAt,
      imported_at: importedAt,
      audit_carried_rows: carried.rows.toString(),
      audit_carried_seq_max: carried.seqMax.toString(),
      audit_baseline_rows: baseline.rows.toString(),
      audit_baseline_seq_min: baseline.seqMin?.toString() ?? null,
      audit_baseline_seq_max: baseline.seqMax?.toString() ?? null,
      audit_baseline_digest: baseline.digest,
      seed_rows_replaced: seedTotal.toString(),
    })
    .execute();
  const users = await tx.selectFrom("app_user").select(["id", "organization_id"]).orderBy("id").execute();
  const holds: { id: string; userId: string; organizationId: string }[] = [];
  for (const u of users) {
    const id = uuidv7();
    holds.push({ id, userId: u.id, organizationId: u.organization_id });
    await tx.insertInto("identity_binding_hold").values({ id, user_id: u.id, migration_import_id: importId }).execute();
  }
  const org = await tx.selectFrom("organization").select("id").orderBy("id").executeTakeFirst();
  const organizationId = org?.id ?? null;
  const reconInput = { migrationImportId: importId, organizationId, runKind: "import" as const, report, operator };
  const runId = await recordReconciliation(tx, { ...reconInput, actor: ACTOR, skipAudit: true });
  await step("L11");
  // L12
  const counts = Object.fromEntries([...seedRowsReplaced].map(([t, n]) => [t, n.toString()]));
  await insertAuditEvent(
    tx,
    { ...ACTOR, requestId: `cli:${operator}` },
    {
      action: "migration.imported",
      recordType: "migration_import",
      recordId: importId,
      organizationId,
      newVersion: 1,
      reason: null,
      changes: {
        manifestSha256: { from: null, to: pkg.manifestSha256 },
        attachmentManifestSha256: { from: null, to: manifest.attachmentManifest.sha256 },
        sourceEnvironment: { from: null, to: manifest.sourceEnvironment },
        demoChecksum: { from: null, to: manifest.demoChecksum },
        tableCount: { from: null, to: String(manifest.totals.tables) },
        rowCount: { from: null, to: manifest.totals.rows },
        attachmentCount: { from: null, to: String(manifest.attachmentManifest.count) },
        auditCarried: { from: null, to: { rows: carried.rows.toString(), seqMax: carried.seqMax.toString() } },
        auditBaseline: {
          from: null,
          to: {
            rows: baseline.rows.toString(),
            seqMin: baseline.seqMin?.toString() ?? null,
            seqMax: baseline.seqMax?.toString() ?? null,
            digest: baseline.digest,
          },
        },
        seedRowsReplaced: { from: null, to: { total: seedTotal.toString(), tables: counts } },
      },
    },
  );
  await auditReconciliation(tx, runId, { ...reconInput, actor: ACTOR });
  for (const h of holds)
    await insertAuditEvent(tx, ACTOR, {
      action: "identity.binding_held",
      recordType: "identity_binding_hold",
      recordId: h.id,
      organizationId: h.organizationId,
      newVersion: 1,
      reason: `mth-db import-migration by operator ${operator}`,
      changes: {
        state: { from: null, to: "unbound" },
        user_id: { from: null, to: h.userId },
        migration_import_id: { from: null, to: importId },
      },
    });
  await step("L12");
  return {
    importId,
    rows: manifest.totals.rows,
    tables: manifest.totals.tables,
    attachments: manifest.attachmentManifest.count,
    holds: holds.length,
    carried,
    baseline,
    seedRowsReplaced,
  };
}

export interface ImportCliIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

export interface ImportCliOptions {
  readonly from: string | undefined;
  readonly operator: string | undefined;
  readonly manifestSha256?: string | undefined;
  /** A1.8: the `transfer-attachments verify` output; required when the package lists attachments. */
  readonly attachmentsReport?: string | undefined;
  /** Where the report is also written on a mismatch or a match. */
  readonly report?: string | undefined;
  /** Default: the @mth/db package version. */
  readonly appVersion?: string;
  /** Test hook (T-R4, T-R5); not reachable from the CLI. */
  readonly onStep?: (step: LoadStep, tx: Tx) => Promise<void>;
}

const OPERATOR = /^[\p{L}\p{N} ._@-]{1,100}$/u;

/** The audit history line printed after the C.5 success line (A1.4). */
export function auditHistoryLine(carried: PackageAuditRange, baseline: Baseline): string {
  const target =
    baseline.rows === 0n
      ? `${baseline.rows} target migration events`
      : `${baseline.rows} target migration events (seq ${baseline.seqMin}-${baseline.seqMax})`;
  return (
    `import-migration: audit history: ${carried.rows} carried events (seq ${carried.seqMin ?? 0}-${carried.seqMax}) ` +
    `and ${target} kept; nothing was renumbered`
  );
}

/** `mth-db import-migration`; returns the exit code. */
export async function runImportMigrationCommand(db: Db, opts: ImportCliOptions, io: ImportCliIo): Promise<number> {
  if (
    opts.from === undefined ||
    opts.from === "" ||
    opts.operator === undefined ||
    !OPERATOR.test(opts.operator) ||
    (opts.manifestSha256 !== undefined && !/^[0-9a-fA-F]{64}$/.test(opts.manifestSha256))
  ) {
    io.err(
      "BLOCKED: usage: mth-db import-migration --from <dir> --operator <name> [--manifest-sha256 <hex>] " +
        "[--attachments-report <file>] [--report <file>]",
    );
    return 2;
  }
  const from = opts.from;
  const operator = opts.operator;
  const writeReport = async (lines: readonly string[]) => {
    if (opts.report !== undefined) await writeFile(opts.report, `${lines.join("\n")}\n`, "utf8");
  };
  try {
    const pkg = await checkPackage(from, opts.manifestSha256);
    const { count, sha256 } = pkg.manifest.attachmentManifest;
    requireAttachmentReport(count, opts.attachmentsReport !== undefined, "import-migration");
    const attachments: ParsedAttachmentReport =
      opts.attachmentsReport === undefined
        ? { checked: 0, mismatches: [] }
        : parseAttachmentReport(
            new Uint8Array(await readFile(opts.attachmentsReport)),
            { attachmentManifestSha256: sha256, count },
            "import-migration",
          );
    const carried = await packageAuditRange(pkg);
    return await withMigrationImportLock(db, async (conn) => {
      await checkTarget(conn, pkg.manifest, opts.appVersion);
      let summary: ImportSummary;
      try {
        summary = await conn.transaction().execute((tx) =>
          loadInTransaction(tx, {
            pkg,
            carried,
            attachments,
            operator,
            ...(opts.onStep !== undefined ? { onStep: opts.onStep } : {}),
          }),
        );
      } catch (err) {
        if (!(err instanceof LoadMismatch)) throw err;
        const last =
          `import-migration: reconciliation mismatch: ${err.report.tablesMismatched} tables, ` +
          `${err.report.attachmentMismatches.length} attachments differ; nothing was imported`;
        for (const l of err.lines) io.out(l);
        io.err(last);
        await writeReport([...err.lines, last]);
        return 4;
      }
      const lines = [
        `import-migration: imported ${summary.rows} rows in ${summary.tables} tables and ${summary.attachments} ` +
          `attachments; reconciliation matched; ${summary.holds} users wait for an identity rebind`,
        auditHistoryLine(summary.carried, summary.baseline),
      ];
      for (const l of lines) io.out(l);
      await writeReport(lines);
      return 0;
    });
  } catch (err) {
    if (err instanceof ImportRefused) {
      io.err(err.message);
      for (const d of err.details) io.err(d);
      return err.exitCode;
    }
    if (err instanceof AttachmentReportRefused) {
      io.err(err.message);
      return 2;
    }
    throw err;
  }
}

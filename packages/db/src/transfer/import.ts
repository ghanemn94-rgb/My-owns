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
//           sequence reserved above the package's highest seq M, both audit triggers enabled); E5 (Amendment 2 §A2.2:
//           a carried audit row whose id exists on the target must be the identical migration baseline event, else
//           exit 1; such rows, P, are never inserted, and their source seq and time go into migration.imported's
//           auditAlreadyPresent); the baseline recorded;
//           user triggers off on every exported table EXCEPT audit_event; the migration seeds deleted (never from
//           audit_event, never TRUNCATE); every table loaded with its own ids (audit_event too, with its own id and
//           seq), except P, with the inserted count checked; the deferred columns set; sequences raised, never lowered; user triggers back on; the
//           reconciliation (audit_event as the reconstructed carried trail of A2.3, the baseline re-checked, the
//           attachment report); on a mismatch
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
import { confinedPath, encodeLine, encodeTable, transferSha256 } from "./export.ts";
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
  type AuditAlreadyPresent,
  type ReconciliationDelta,
  type ReconciliationReport,
} from "./reconcile.ts";
import { encodedRows } from "./table-digest.ts";

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

// ------------------------------------------------------------------------------------------------ A2.2: E5

/** The two audit_event columns the database assigns at insert time: recorded, never compared (ADR-0064 A2.1). */
export const AUDIT_DATABASE_ASSIGNED = ["seq", "occurred_at"] as const;

/** The E2 baseline predicate over one row's column texts (a package line or a live row encoded alike). */
function isBaselineRow(get: (column: string) => unknown): boolean {
  return (
    get("source") === "migration" &&
    get("actor_type") === "system" &&
    get("actor_user_id") === null &&
    get("on_behalf_of_user_id") === null &&
    get("organization_id") === null &&
    get("transformation_id") === null
  );
}

/**
 * E5 (ADR-0064 A2.2): inside the load transaction, after the audit_event lock. P is the set of carried rows whose id
 * exists on the target. Each must be the same event: both copies migration baseline rows (the E2 predicate), and the
 * 13 columns of A2.1 (every column but seq and occurred_at) identical by the exact JSON text of the §2.3 encoder.
 * Decided on the whole encoded line (the live row with the package's seq and occurred_at overlaid must equal the
 * package line byte for byte); the columns named in a refusal are found column by column. Any failure refuses the
 * import with exit 1 (the A2.7 lines); nothing is written. Returns P sorted by id with each source seq and time.
 */
export async function checkSharedAuditIds(
  tx: DbOrTx,
  pkg: CheckedPackage,
  carried: PackageAuditRange,
  plan: TransferPlan,
): Promise<AuditAlreadyPresent[]> {
  const audit = plan.tables.find((t) => t.name === "audit_event");
  if (audit === undefined || carried.ids.length === 0) return [];
  const shared = new Set<string>();
  for (let i = 0; i < carried.ids.length; i += 5000) {
    const r = await sql<{ id: string }>`
      SELECT id::text AS id FROM audit_event WHERE id = ANY(${carried.ids.slice(i, i + 5000)}::uuid[])`.execute(tx);
    for (const row of r.rows) shared.add(row.id);
  }
  if (shared.size === 0) return [];
  const file = pkg.manifest.tables.find((t) => t.name === "audit_event")!.file;
  const lines = new Map<string, { line: string; row: Record<string, unknown> }>();
  for (const line of await tableLines(pkg, file)) {
    const row = JSON.parse(line) as Record<string, unknown>;
    const id = row["id"];
    if (typeof id === "string" && shared.has(id)) lines.set(id, { line, row });
  }
  const live = await encodedRows(tx, audit, plan.rewrittenColumns, {
    where: `id = ANY('{${[...shared].join(",")}}'::uuid[])`,
  });
  const { kinds } = live;
  const assigned = AUDIT_DATABASE_ASSIGNED.map((c) => kinds.findIndex((k) => k.name === c));
  const failures: string[] = [];
  const present: AuditAlreadyPresent[] = [];
  for (const r of live.rows) {
    const id = r.values[0] ?? "";
    const pkgCopy = lines.get(id);
    if (pkgCopy === undefined) continue;
    const valueOf = (c: string) => r.values[kinds.findIndex((k) => k.name === c)] ?? null;
    if (!isBaselineRow((c) => pkgCopy.row[c] ?? null)) {
      failures.push(`import-migration: ${id}: not a migration baseline event on the source`);
      continue;
    }
    if (!isBaselineRow(valueOf)) {
      failures.push(`import-migration: ${id}: not a migration baseline event on the target`);
      continue;
    }
    const sourceSeq = pkgCopy.row["seq"];
    const sourceOccurredAt = pkgCopy.row["occurred_at"];
    const overlaid = [...r.values];
    overlaid[assigned[0]!] = typeof sourceSeq === "string" ? sourceSeq : null;
    overlaid[assigned[1]!] = typeof sourceOccurredAt === "string" ? sourceOccurredAt : null;
    if (encodeLine(kinds, overlaid) === pkgCopy.line && typeof sourceSeq === "string") {
      present.push({ id, sourceSeq, sourceOccurredAt: sourceOccurredAt as string });
      continue;
    }
    const differ = kinds
      .filter((k) => !(AUDIT_DATABASE_ASSIGNED as readonly string[]).includes(k.name))
      .filter((k) => {
        const mine = valueOf(k.name);
        const theirs = pkgCopy.row[k.name] ?? null;
        if (k.kind === "text" || k.kind === "bool") return mine !== theirs;
        return JSON.stringify(mine === null ? null : JSON.parse(mine)) !== JSON.stringify(theirs);
      })
      .map((k) => k.name);
    failures.push(
      `import-migration: ${id}: differs in ${differ.length > 0 ? differ.join(", ") : kinds.map((k) => k.name).join(", ")}`,
    );
  }
  if (failures.length > 0)
    throw new ImportRefused(
      1,
      `import-migration: failed: ${failures.length} carried audit events share their id with a target audit event ` +
        "but are not the same event; nothing was imported",
      failures.slice(0, 20),
    );
  return present.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
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

/** L5: one table, in batches, deferred columns as null; `skip` holds ids never inserted (A2.2: P, audit_event only). */
async function loadTable(
  ctx: LoadContext,
  table: TransferPlanTable,
  file: string,
  skip: ReadonlySet<string> = new Set(),
): Promise<void> {
  const { generated, identity } = await generatedAndIdentity(ctx.tx, table.name);
  const direct = await directDeferred(ctx.tx, table);
  const cols = table.columns.map((c) => c.name).filter((c) => !generated.has(c));
  const select = cols
    .map((c) => (table.deferredColumns.includes(c) && !direct.has(c) ? "NULL" : `r.${quoteIdent(c)}`))
    .join(", ");
  const all = await tableLines(ctx.pkg, file);
  const kept = skip.size === 0 ? all : all.filter((l) => !skip.has((JSON.parse(l) as { id?: string }).id ?? ""));
  const lines = orderedLines(table, kept);
  const head =
    `INSERT INTO ${quoteIdent(table.name)} (${cols.map(quoteIdent).join(", ")})` +
    `${identity ? " OVERRIDING SYSTEM VALUE" : ""} SELECT ${select} ` +
    `FROM jsonb_populate_recordset(NULL::${quoteIdent(table.name)}, `;
  for (let i = 0; i < lines.length; i += BATCH) {
    const json = `[${lines.slice(i, i + BATCH).join(",")}]`;
    await sql`${sql.raw(head)}${json}::jsonb${sql.raw(") AS r")}`.execute(ctx.tx);
  }
}

/** The tables a table's deferred columns reference through a foreign key that is NOT DEFERRABLE (never itself). */
async function nonDeferrableParents(tx: Tx, table: TransferPlanTable): Promise<string[]> {
  if (table.deferredColumns.length === 0) return [];
  const r = await sql<{ parent: string; cols: string[] }>`
    SELECT con.confrelid::regclass::text AS parent,
           array_agg(a.attname::text ORDER BY a.attname) AS cols
      FROM pg_constraint con
      CROSS JOIN LATERAL unnest(con.conkey) AS k(attnum)
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
     WHERE con.contype = 'f' AND NOT con.condeferrable AND con.conrelid = ${quoteIdent(table.name)}::regclass
       AND con.confrelid <> con.conrelid
     GROUP BY con.oid, con.confrelid`.execute(tx);
  return [
    ...new Set(r.rows.filter((x) => x.cols.some((c) => table.deferredColumns.includes(c))).map((x) => x.parent)),
  ].sort();
}

/** Per column of `table`: the tables its foreign keys reference (self included). */
async function referencedTables(tx: Tx, table: string): Promise<Map<string, string[]>> {
  const r = await sql<{ col: string; parent: string }>`
    SELECT a.attname::text AS col, con.confrelid::regclass::text AS parent
      FROM pg_constraint con
      CROSS JOIN LATERAL unnest(con.conkey) AS k(attnum)
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
     WHERE con.contype = 'f' AND con.conrelid = ${quoteIdent(table)}::regclass`.execute(tx);
  const out = new Map<string, string[]>();
  for (const x of r.rows) out.set(x.col, [...(out.get(x.col) ?? []), x.parent]);
  return out;
}

/**
 * L5 for a plan cycle whose deferred column a CHECK or NOT NULL rule refuses as null and whose foreign key is NOT
 * DEFERRABLE (measured by T-DG7-BE-R2: gate_instance.current_submission_id, CHECK gate_instance_draft_unsubmitted,
 * with gate_instance <-> gate_submission). The group (the plan tables from the refused one up to its last
 * non-deferrable parent, in plan order) loads in ONE statement of data-modifying CTEs, so the RESTRICT foreign keys are
 * checked at the statement's end, when every side exists (the counterpart of L4's single DELETE statement). A deferred
 * column loads with its value when every table its keys reference is loaded or in the group; otherwise as null, set by
 * L6. No row is changed or left out; no constraint or trigger beyond L3's is disabled.
 */
async function loadTogether(
  ctx: LoadContext,
  group: readonly { table: TransferPlanTable; file: string }[],
  loaded: ReadonlySet<string>,
): Promise<void> {
  const inGroup = new Set(group.map((g) => g.table.name));
  let query = sql``;
  for (let i = 0; i < group.length; i += 1) {
    const { table, file } = group[i]!;
    const { generated, identity } = await generatedAndIdentity(ctx.tx, table.name);
    const refs = await referencedTables(ctx.tx, table.name);
    const cols = table.columns.map((c) => c.name).filter((c) => !generated.has(c));
    const direct = (c: string) =>
      !table.deferredColumns.includes(c) || (refs.get(c) ?? []).every((t) => loaded.has(t) || inGroup.has(t));
    const json = `[${(await tableLines(ctx.pkg, file)).join(",")}]`;
    const insert =
      `INSERT INTO ${quoteIdent(table.name)} (${cols.map(quoteIdent).join(", ")})` +
      `${identity ? " OVERRIDING SYSTEM VALUE" : ""} SELECT ${cols
        .map((c) => (direct(c) ? `r.${quoteIdent(c)}` : "NULL"))
        .join(", ")} FROM jsonb_populate_recordset(NULL::${quoteIdent(table.name)}, `;
    const last = i === group.length - 1;
    const open = i === 0 && !last ? "WITH " : "";
    const prefix = last ? "" : `i${i} AS (`;
    const suffix = last ? ") AS r" : `) AS r RETURNING 1)${i === group.length - 2 ? " " : ", "}`;
    query = sql`${query}${sql.raw(`${open}${prefix}${insert}`)}${json}::jsonb${sql.raw(suffix)}`;
  }
  await query.execute(ctx.tx);
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
  /** P (A2.2), sorted by id. */
  readonly present: readonly AuditAlreadyPresent[];
  /** The lowest seq of the inserted carried rows, null when none was inserted. */
  readonly insertedSeqMin: bigint | null;
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
  // E5 (A2.2): P, after the lock, inside this transaction.
  const present = await checkSharedAuditIds(tx, pkg, carried, plan);
  const presentIds = new Set(present.map((e) => e.id));
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
  const loadedTables = new Set<string>();
  for (const t of plan.tables) {
    if (loadedTables.has(t.name)) continue;
    loadedTables.add(t.name);
    const parents = (await nonDeferrableParents(tx, t)).filter((p) => !loadedTables.has(p));
    if (parents.length === 0 || t.name === "audit_event") {
      await loadTable(ctx, t, fileOf.get(t.name)!.file, t.name === "audit_event" ? presentIds : new Set());
      continue;
    }
    // A deferred column with a NOT DEFERRABLE key: the null may be refused by a CHECK (measured: gate_instance).
    await sql`SAVEPOINT mth_l5_table`.execute(tx);
    try {
      await loadTable(ctx, t, fileOf.get(t.name)!.file);
      await sql`RELEASE SAVEPOINT mth_l5_table`.execute(tx);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== "23514" && code !== "23502") throw err;
      await sql`ROLLBACK TO SAVEPOINT mth_l5_table`.execute(tx);
      const from = plan.tables.indexOf(t);
      const to = Math.max(...parents.map((p) => plan.tables.findIndex((x) => x.name === p)));
      const group = plan.tables
        .slice(from, to + 1)
        .filter((x) => x.name === t.name || (!loadedTables.has(x.name) && x.name !== "audit_event"))
        .map((x) => ({ table: x, file: fileOf.get(x.name)!.file }));
      await loadTogether(ctx, group, loadedTables);
      for (const g of group) {
        loadedTables.add(g.table.name);
      }
    }
  }
  const loaded = (
    await sql<{ n: string; lo: string | null }>`
      SELECT count(*)::text AS n, min(seq)::text AS lo FROM audit_event WHERE seq <= ${carried.seqMax.toString()}::bigint`.execute(
      tx,
    )
  ).rows[0]!;
  const expectedLoaded = carried.rows - BigInt(present.length);
  if (BigInt(loaded.n) !== expectedLoaded)
    throw new ImportRefused(
      1,
      `import-migration: failed: audit_event loaded ${loaded.n} rows, expected ${expectedLoaded.toString()}`,
    );
  await step("L5");
  // L6
  for (const t of plan.tables) await secondPass(ctx, t, fileOf.get(t.name)!.file);
  await step("L6");
  // L7
  await raiseSequences(ctx);
  await step("L7");
  // L8. The DEFERRABLE foreign keys deferred at L0 are checked now, retroactively, over every loaded row (ALTER TABLE
  // refuses a table with pending trigger events); the mode then goes back to deferred for L11 and L12.
  await sql`SET CONSTRAINTS ALL IMMEDIATE`.execute(tx);
  await sql`SET CONSTRAINTS ALL DEFERRED`.execute(tx);
  for (const t of others) await sql`${sql.raw(`ALTER TABLE ${quoteIdent(t.name)} ENABLE TRIGGER USER`)}`.execute(tx);
  await assertAuditTriggersEnabled(tx);
  await step("L8");
  // L9
  const tables = await reconcileTables(tx, manifest.tables, {
    auditCarriedSeqMax: carried.seqMax,
    auditAlreadyPresent: present,
  });
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
    {
      tableName: "audit_event",
      basis: "audit_already_present",
      rowsAdded: "0",
      rowsChanged: String(present.length),
      rowsMissing: "0",
      allowed: true,
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
      audit_already_present_rows: String(present.length),
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
        auditAlreadyPresent: { from: null, to: { rows: String(present.length), entries: present } },
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
    present,
    insertedSeqMin: loaded.lo === null ? null : BigInt(loaded.lo),
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

/**
 * The audit history line printed after the C.5 success line (A1.4); `<c>` counts the carried rows inserted (A2.2),
 * from the lowest inserted seq to M.
 */
export function auditHistoryLine(
  carried: PackageAuditRange,
  baseline: Baseline,
  presentRows = 0,
  insertedSeqMin: bigint | null = carried.seqMin,
): string {
  const target =
    baseline.rows === 0n
      ? `${baseline.rows} target migration events`
      : `${baseline.rows} target migration events (seq ${baseline.seqMin}-${baseline.seqMax})`;
  return (
    `import-migration: audit history: ${carried.rows - BigInt(presentRows)} carried events ` +
    `(seq ${insertedSeqMin ?? 0}-${carried.seqMax}) and ${target} kept; nothing was renumbered`
  );
}

/** The A2.2 line printed after the audit-history line when |P| > 0. */
export const alreadyPresentLine = (p: number): string =>
  `import-migration: audit history: ${p} carried events were already present as identical target migration events ` +
  "(same id and content); their source seq and time are recorded in migration.imported, and none was inserted twice";

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
        auditHistoryLine(summary.carried, summary.baseline, summary.present.length, summary.insertedSeqMin),
        ...(summary.present.length > 0 ? [alreadyPresentLine(summary.present.length)] : []),
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

// Administration > Migration status: the service of the five read-only operations (P7 slice C; ADR-0064 §6, §8, §9;
// REQ-S19-014, REQ-S19-016; p7-work-split §C.2; T-DG7-BE-D).
//
// Authorization: `migration_import.read` (read; ADM_TECH, ADM_ACCESS, AUD; 0135) held at ORGANIZATION scope in some
// organization: the import, its reconciliation runs and the identity holds are installation-wide records, like the
// export's. Every other role gets 403, and so does a narrower grant.
//
// Nothing here writes: the import, the re-check and the rebind are CLI-only and IT-run (mth-db; ADR-0064 §6, §8), and no
// route, job or permission can start one (p7-work-split C.11). No response contains a row value of the imported data or
// evidence bytes: only the import's own record, the per-table counts and digests, the attachment mismatches (object
// names, sizes, SHA-256) and the identity holds. Reading them approves nothing (no G1-G6, Finance or IT approval) and
// nothing here reads or writes DG0-DG7.
import type { DbOrTx } from "@mth/db";
import type { Permission } from "@mth/shared";
import { z } from "zod";
import { authorize, organizationsWith, type Principal } from "../../access/index.ts";
import { iso, isoOrNull, problems } from "../../platform/index.ts";

export const MIGRATION_IMPORT_READ: Permission = "migration_import.read";

// ------------------------------------------------------------------------------------------------ contract mirror
// docs/api/openapi.yaml MigrationImport, MigrationReconciliation(Summary), IdentityRebind and their pages.
const sha = z.string().regex(/^[0-9a-f]{64}$/);
const count = z.string().regex(/^(0|[1-9][0-9]{0,18})$/);
const timestamp = z.iso.datetime({ offset: true });

export const reconciliationSummaryView = z.strictObject({
  id: z.uuid(),
  runKind: z.enum(["import", "recheck", "recheck_after_use"]),
  result: z.enum(["matched", "mismatched"]),
  tablesChecked: z.number().int().min(0),
  tablesMismatched: z.number().int().min(0),
  rowsExpected: count,
  rowsActual: count,
  attachmentsChecked: z.number().int().min(0),
  attachmentsMismatched: z.number().int().min(0),
  operatorName: z.string(),
  runAt: timestamp,
});
export type ReconciliationSummaryView = z.infer<typeof reconciliationSummaryView>;

export const DELTA_BASES = [
  "audit_baseline",
  "audit_additions",
  "audit_already_present",
  "rebind",
  "exact_ids",
  "audit_explained",
  "child_of",
  "counter",
  "operational",
  "unexplained",
] as const;

export const reconciliationView = z.strictObject({
  summary: reconciliationSummaryView,
  deltas: z.array(
    z.strictObject({
      tableName: z.string(),
      basis: z.enum(DELTA_BASES),
      rowsAdded: count,
      rowsChanged: count,
      rowsMissing: count,
      allowed: z.boolean(),
    }),
  ),
  tables: z.array(
    z.strictObject({
      tableName: z.string(),
      expectedRows: count,
      actualRows: count,
      expectedDigest: sha,
      actualDigest: sha,
      matched: z.boolean(),
    }),
  ),
  attachmentMismatches: z.array(
    z.strictObject({
      parentTable: z.string(),
      objectName: z.string(),
      problem: z.enum(["missing", "size_mismatch", "sha256_mismatch"]),
      expectedSize: count,
      actualSize: count.nullable(),
      expectedSha256: sha,
      actualSha256: sha.nullable(),
    }),
  ),
});
export type ReconciliationView = z.infer<typeof reconciliationView>;

export const reconciliationPage = z.strictObject({
  items: z.array(reconciliationSummaryView),
  nextCursor: z.string().nullable(),
});

export const migrationImportView = z.strictObject({
  id: z.uuid(),
  schemaVersion: z.literal("mth-migration/1"),
  sourceEnvironment: z.enum(["production", "demo", "unmarked"]),
  sourceExportReference: z.uuid(),
  migrationLevel: z.string(),
  manifestSha256: sha,
  attachmentManifestSha256: sha,
  demoChecksum: sha.nullable(),
  tableCount: z.number().int().min(0),
  rowCount: count,
  attachmentCount: z.number().int().min(0),
  attachmentBytes: count,
  operatorName: z.string(),
  startedAt: timestamp,
  importedAt: timestamp,
  auditCarriedRows: count.nullable(),
  auditCarriedSeqMax: count.nullable(),
  auditBaselineRows: count.nullable(),
  auditBaselineSeqMin: count.nullable(),
  auditBaselineSeqMax: count.nullable(),
  auditBaselineDigest: sha.nullable(),
  seedRowsReplaced: count.nullable(),
  auditAlreadyPresentRows: count.nullable(),
  latestReconciliation: reconciliationSummaryView,
  identities: z.strictObject({
    unbound: z.number().int().min(0),
    rebound: z.number().int().min(0),
    retained: z.number().int().min(0),
  }),
});
export type MigrationImportView = z.infer<typeof migrationImportView>;
export const migrationImportPage = z.strictObject({
  items: z.array(migrationImportView),
  nextCursor: z.string().nullable(),
});

export const identityRebindView = z.strictObject({
  id: z.uuid(),
  userId: z.uuid(),
  displayName: z.string(),
  migrationImportId: z.uuid(),
  state: z.enum(["unbound", "rebound", "retained"]),
  issuer: z.string(),
  subject: z.string(),
  newIssuer: z.string().nullable(),
  newSubject: z.string().nullable(),
  operatorName: z.string().nullable(),
  resolvedAt: timestamp.nullable(),
  version: z.number().int().min(1),
});
export type IdentityRebindView = z.infer<typeof identityRebindView>;
export const identityRebindPage = z.strictObject({
  items: z.array(identityRebindView),
  nextCursor: z.string().nullable(),
});

// ------------------------------------------------------------------------------------------------ authorization

/** The organization in which the principal holds migration_import.read at ORGANIZATION scope, or 403. */
export async function requireImportReadRight(db: DbOrTx, principal: Principal): Promise<string> {
  for (const organizationId of organizationsWith(principal, MIGRATION_IMPORT_READ))
    if ((await authorize(db, principal, MIGRATION_IMPORT_READ, { type: "organization", id: organizationId })).allowed)
      return organizationId;
  throw problems.forbidden();
}

// ------------------------------------------------------------------------------------------------ presenters

const text = (v: string | number | bigint): string => String(v);

interface ReconciliationRow {
  id: string;
  run_kind: string;
  result: string;
  tables_checked: number;
  tables_mismatched: number;
  rows_expected: string | number | bigint;
  rows_actual: string | number | bigint;
  attachments_checked: number;
  attachments_mismatched: number;
  operator_name: string;
  run_at: Date;
}

export function presentReconciliationSummary(r: ReconciliationRow): ReconciliationSummaryView {
  return reconciliationSummaryView.parse({
    id: r.id,
    runKind: r.run_kind,
    result: r.result,
    tablesChecked: r.tables_checked,
    tablesMismatched: r.tables_mismatched,
    rowsExpected: text(r.rows_expected),
    rowsActual: text(r.rows_actual),
    attachmentsChecked: r.attachments_checked,
    attachmentsMismatched: r.attachments_mismatched,
    operatorName: r.operator_name,
    runAt: iso(r.run_at),
  });
}

// ------------------------------------------------------------------------------------------------ reads

export async function latestReconciliation(db: DbOrTx, importId: string): Promise<ReconciliationRow | undefined> {
  return db
    .selectFrom("migration_reconciliation")
    .selectAll()
    .where("migration_import_id", "=", importId)
    .orderBy("run_at", "desc")
    .orderBy("id", "desc")
    .executeTakeFirst();
}

export async function identityCounts(
  db: DbOrTx,
  importId: string,
): Promise<{ unbound: number; rebound: number; retained: number }> {
  const rows = await db
    .selectFrom("identity_binding_hold")
    .select((eb) => ["state", eb.fn.countAll<string>().as("n")])
    .where("migration_import_id", "=", importId)
    .groupBy("state")
    .execute();
  const of = (s: string) => Number(rows.find((r) => r.state === s)?.n ?? "0");
  return { unbound: of("unbound"), rebound: of("rebound"), retained: of("retained") };
}

interface ImportRow {
  id: string;
  schema_version: string;
  source_environment: string;
  source_export_reference: string;
  migration_level: string;
  manifest_sha256: string;
  attachment_manifest_sha256: string;
  demo_checksum: string | null;
  table_count: number;
  row_count: string | number | bigint;
  attachment_count: number;
  attachment_bytes: string | number | bigint;
  operator_name: string;
  started_at: Date;
  imported_at: Date;
  audit_carried_rows: string | null;
  audit_carried_seq_max: string | null;
  audit_baseline_rows: string | null;
  audit_baseline_seq_min: string | null;
  audit_baseline_seq_max: string | null;
  audit_baseline_digest: string | null;
  seed_rows_replaced: string | null;
  audit_already_present_rows: string | null;
}

const textOrNull = (v: string | number | bigint | null): string | null => (v === null ? null : String(v));

/** One import with its latest reconciliation (every import has its own run, written in the import's transaction). */
export async function presentImport(db: DbOrTx, r: ImportRow): Promise<MigrationImportView> {
  const latest = await latestReconciliation(db, r.id);
  if (latest === undefined) throw new Error(`migration_import ${r.id} has no reconciliation run`);
  return migrationImportView.parse({
    id: r.id,
    schemaVersion: r.schema_version,
    sourceEnvironment: r.source_environment,
    sourceExportReference: r.source_export_reference,
    migrationLevel: r.migration_level,
    manifestSha256: r.manifest_sha256,
    attachmentManifestSha256: r.attachment_manifest_sha256,
    demoChecksum: r.demo_checksum,
    tableCount: r.table_count,
    rowCount: text(r.row_count),
    attachmentCount: r.attachment_count,
    attachmentBytes: text(r.attachment_bytes),
    operatorName: r.operator_name,
    startedAt: iso(r.started_at),
    importedAt: iso(r.imported_at),
    auditCarriedRows: textOrNull(r.audit_carried_rows),
    auditCarriedSeqMax: textOrNull(r.audit_carried_seq_max),
    auditBaselineRows: textOrNull(r.audit_baseline_rows),
    auditBaselineSeqMin: textOrNull(r.audit_baseline_seq_min),
    auditBaselineSeqMax: textOrNull(r.audit_baseline_seq_max),
    auditBaselineDigest: r.audit_baseline_digest,
    seedRowsReplaced: textOrNull(r.seed_rows_replaced),
    auditAlreadyPresentRows: textOrNull(r.audit_already_present_rows),
    latestReconciliation: presentReconciliationSummary(latest),
    identities: await identityCounts(db, r.id),
  });
}

export async function findImport(db: DbOrTx, id: string): Promise<ImportRow | undefined> {
  return db.selectFrom("migration_import").selectAll().where("id", "=", id).executeTakeFirst();
}

/** One reconciliation report of an import (404 when it belongs to another import). */
export async function findReconciliation(
  db: DbOrTx,
  importId: string,
  reconciliationId: string,
): Promise<ReconciliationView | undefined> {
  const run = await db
    .selectFrom("migration_reconciliation")
    .selectAll()
    .where("id", "=", reconciliationId)
    .where("migration_import_id", "=", importId)
    .executeTakeFirst();
  if (run === undefined) return undefined;
  const tables = await db
    .selectFrom("migration_reconciliation_table")
    .selectAll()
    .where("migration_reconciliation_id", "=", run.id)
    .orderBy("table_name")
    .execute();
  const attachments = await db
    .selectFrom("migration_reconciliation_attachment")
    .selectAll()
    .where("migration_reconciliation_id", "=", run.id)
    .orderBy("parent_table")
    .orderBy("object_name")
    .orderBy("id")
    .execute();
  const deltas = await db
    .selectFrom("migration_reconciliation_delta")
    .selectAll()
    .where("migration_reconciliation_id", "=", run.id)
    .orderBy("table_name")
    .orderBy("basis")
    .execute();
  return reconciliationView.parse({
    summary: presentReconciliationSummary(run),
    deltas: deltas.map((d) => ({
      tableName: d.table_name,
      basis: d.basis,
      rowsAdded: text(d.rows_added),
      rowsChanged: text(d.rows_changed),
      rowsMissing: text(d.rows_missing),
      allowed: d.allowed,
    })),
    tables: tables.map((t) => ({
      tableName: t.table_name,
      expectedRows: text(t.expected_rows),
      actualRows: text(t.actual_rows),
      expectedDigest: t.expected_digest,
      actualDigest: t.actual_digest,
      matched: t.matched,
    })),
    attachmentMismatches: attachments.map((a) => ({
      parentTable: a.parent_table,
      objectName: a.object_name,
      problem: a.problem,
      expectedSize: text(a.expected_size),
      actualSize: a.actual_size === null ? null : text(a.actual_size),
      expectedSha256: a.expected_sha256,
      actualSha256: a.actual_sha256,
    })),
  });
}

export interface HoldRow {
  id: string;
  user_id: string;
  display_name: string;
  migration_import_id: string;
  state: string;
  operator_name: string | null;
  resolved_at: Date | null;
  version: number;
  old_issuer: string | null;
  old_subject: string | null;
  new_issuer: string | null;
  new_subject: string | null;
}

/** The carried pair of an unbound user: their (only) identity; the first by creation when several exist. */
export async function presentHolds(db: DbOrTx, rows: readonly HoldRow[]): Promise<IdentityRebindView[]> {
  const unbound = rows.filter((r) => r.state === "unbound").map((r) => r.user_id);
  const identities =
    unbound.length === 0
      ? []
      : await db
          .selectFrom("user_identity")
          .select(["user_id", "issuer", "subject"])
          .where("user_id", "in", unbound)
          .orderBy("created_at")
          .orderBy("id")
          .execute();
  return rows.map((r) => {
    const carried = identities.find((i) => i.user_id === r.user_id);
    const resolved = r.state !== "unbound";
    return identityRebindView.parse({
      id: r.id,
      userId: r.user_id,
      displayName: r.display_name,
      migrationImportId: r.migration_import_id,
      state: r.state,
      issuer: resolved ? (r.old_issuer ?? "") : (carried?.issuer ?? ""),
      subject: resolved ? (r.old_subject ?? "") : (carried?.subject ?? ""),
      newIssuer: resolved ? r.new_issuer : null,
      newSubject: resolved ? r.new_subject : null,
      operatorName: r.operator_name,
      resolvedAt: isoOrNull(r.resolved_at),
      version: r.version,
    });
  });
}

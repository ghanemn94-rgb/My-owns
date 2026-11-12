// The reconciliation (ADR-0064 §6 step 8; p7-work-split §C.2, §C.5; T-DG7-BE-D): per exported table, the live row
// count against the expected `rowCount` and the live `contentDigest` (the export's own encoder, `encodeTable`, under the
// pinned settings) against the expected digest; per attachment, the verification result of the byte copy (BE-E's
// `transfer-attachments verify` output: one mismatch per missing object or differing size or SHA-256). A difference is
// always reported, never hidden: the result is `matched` only when every table and attachment matches.
//
// `mth-db reconcile-migration --operator <name>` re-runs the table half at any time against the expectations recorded
// by the import's own run (the `import` run's migration_reconciliation_table rows), under the session lock of class
// migrationImport (key "migration-import"), and appends a `recheck` run with its audit event migration.reconciled. It
// changes no business row. Exit 0 `reconcile-migration: matched`; 4 `reconcile-migration: mismatch: <n> tables, <m>
// attachments differ`; 2 a usage error or no recorded import.
//
// A reconciliation approves nothing (no G1-G6, Finance or IT approval) and never reads or writes DG0-DG7.
import { sql } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { insertAuditEvent, type AuditActor } from "../audit.ts";
import type { Db, DbOrTx, Tx } from "../pool.ts";
import { encodeTable, ENCODER_SETTINGS, transferSha256 } from "./export.ts";
import { buildPlan } from "./plan.ts";

/** ADR-0016 §6 `migrationImport` (apps/api platform/advisory-locks.ts); pinned to the registry by transfer-locks.test. */
export const MIGRATION_IMPORT_LOCK_CLASS = 730403;
/** The registry's one class-wide key of the class. */
export const MIGRATION_IMPORT_LOCK_KEY = "migration-import";

/** What one table must hold (from the manifest, or from the import's recorded run). */
export interface TableExpectation {
  readonly name: string;
  /** Decimal string. */
  readonly rowCount: string;
  readonly contentDigest: string;
}

export interface TableResult {
  readonly tableName: string;
  readonly expectedRows: string;
  readonly actualRows: string;
  readonly expectedDigest: string;
  readonly actualDigest: string;
  readonly matched: boolean;
}

export interface AttachmentMismatch {
  readonly parentTable: string;
  readonly objectName: string;
  readonly problem: "missing" | "size_mismatch" | "sha256_mismatch";
  readonly expectedSize: string;
  readonly actualSize: string | null;
  readonly expectedSha256: string;
  readonly actualSha256: string | null;
}

export interface ReconciliationReport {
  readonly result: "matched" | "mismatched";
  readonly tables: readonly TableResult[];
  readonly tablesMismatched: number;
  /** Decimal strings. */
  readonly rowsExpected: string;
  readonly rowsActual: string;
  readonly attachmentsChecked: number;
  readonly attachmentMismatches: readonly AttachmentMismatch[];
}

/** The digest of a table with no row (SHA-256 of nothing). */
export const EMPTY_DIGEST = transferSha256("");

/** Pins the encoder settings for the rest of the caller's transaction. */
export async function pinEncoderSettings(tx: Tx): Promise<void> {
  for (const [name, value] of ENCODER_SETTINGS) await sql`SELECT set_config(${name}, ${value}, true)`.execute(tx);
}

/**
 * Compares every expected table with the live rows (in the caller's transaction, whose encoder settings are pinned).
 * A table the target does not have counts as zero rows with the empty digest, so it mismatches unless it was empty.
 */
export async function reconcileTables(tx: DbOrTx, expected: readonly TableExpectation[]): Promise<TableResult[]> {
  const plan = await buildPlan(tx);
  const out: TableResult[] = [];
  for (const e of expected) {
    const table = plan.tables.find((t) => t.name === e.name);
    const live =
      table === undefined
        ? { rowCount: 0, contentDigest: EMPTY_DIGEST }
        : await encodeTable(tx, table, plan.rewrittenColumns);
    const actualRows = String(live.rowCount);
    out.push({
      tableName: e.name,
      expectedRows: e.rowCount,
      actualRows,
      expectedDigest: e.contentDigest,
      actualDigest: live.contentDigest,
      matched: actualRows === e.rowCount && live.contentDigest === e.contentDigest,
    });
  }
  return out;
}

/** Assembles the report (the result rule of 0133 `migration_reconciliation_result`). */
export function buildReport(
  tables: readonly TableResult[],
  attachmentsChecked: number,
  attachmentMismatches: readonly AttachmentMismatch[],
): ReconciliationReport {
  const sum = (f: (t: TableResult) => string) => tables.reduce((n, t) => n + BigInt(f(t)), 0n);
  const rowsExpected = sum((t) => t.expectedRows);
  const rowsActual = sum((t) => t.actualRows);
  const tablesMismatched = tables.filter((t) => !t.matched).length;
  const matched = tablesMismatched === 0 && attachmentMismatches.length === 0 && rowsExpected === rowsActual;
  return {
    result: matched ? "matched" : "mismatched",
    tables,
    tablesMismatched,
    rowsExpected: String(rowsExpected),
    rowsActual: String(rowsActual),
    attachmentsChecked,
    attachmentMismatches,
  };
}

/** Inserts the run, its table and attachment rows and the audit event migration.reconciled; returns the run id. */
export async function recordReconciliation(
  tx: Tx,
  input: {
    readonly migrationImportId: string;
    readonly organizationId: string | null;
    readonly runKind: "import" | "recheck";
    readonly report: ReconciliationReport;
    readonly operator: string;
    readonly actor: AuditActor;
  },
): Promise<string> {
  const { report } = input;
  const id = uuidv7();
  await tx
    .insertInto("migration_reconciliation")
    .values({
      id,
      migration_import_id: input.migrationImportId,
      run_kind: input.runKind,
      result: report.result,
      tables_checked: report.tables.length,
      tables_mismatched: report.tablesMismatched,
      rows_expected: report.rowsExpected,
      rows_actual: report.rowsActual,
      attachments_checked: report.attachmentsChecked,
      attachments_mismatched: report.attachmentMismatches.length,
      operator_name: input.operator,
      run_at: sql<Date>`now()`,
    })
    .execute();
  if (report.tables.length > 0)
    await tx
      .insertInto("migration_reconciliation_table")
      .values(
        report.tables.map((t) => ({
          migration_reconciliation_id: id,
          table_name: t.tableName,
          expected_rows: t.expectedRows,
          actual_rows: t.actualRows,
          expected_digest: t.expectedDigest,
          actual_digest: t.actualDigest,
          matched: t.matched,
        })),
      )
      .execute();
  if (report.attachmentMismatches.length > 0)
    await tx
      .insertInto("migration_reconciliation_attachment")
      .values(
        report.attachmentMismatches.map((a) => ({
          id: uuidv7(),
          migration_reconciliation_id: id,
          parent_table: a.parentTable,
          object_name: a.objectName,
          problem: a.problem,
          expected_size: a.expectedSize,
          actual_size: a.actualSize,
          expected_sha256: a.expectedSha256,
          actual_sha256: a.actualSha256,
        })),
      )
      .execute();
  await insertAuditEvent(tx, input.actor, {
    action: "migration.reconciled",
    recordType: "migration_reconciliation",
    recordId: id,
    organizationId: input.organizationId,
    reason: `mth-db ${input.runKind === "import" ? "import-migration" : "reconcile-migration"} by operator ${input.operator}`,
    changes: {
      migration_import_id: { from: null, to: input.migrationImportId },
      run_kind: { from: null, to: input.runKind },
      result: { from: null, to: report.result },
      tables_mismatched: { from: null, to: report.tablesMismatched },
      attachments_mismatched: { from: null, to: report.attachmentMismatches.length },
      rows_expected: { from: null, to: report.rowsExpected },
      rows_actual: { from: null, to: report.rowsActual },
    },
  });
  return id;
}

/** The C.5 line of a report for `command`. */
export function reconcileLine(report: ReconciliationReport): string {
  return report.result === "matched"
    ? "reconcile-migration: matched"
    : `reconcile-migration: mismatch: ${report.tablesMismatched} tables, ${report.attachmentMismatches.length} attachments differ`;
}

/** Runs `fn` on one pinned connection holding the session lock of class migrationImport. */
export async function withMigrationImportLock<T>(db: Db, fn: (conn: Db) => Promise<T>): Promise<T> {
  return db.connection().execute(async (conn) => {
    await sql`SELECT pg_advisory_lock(${MIGRATION_IMPORT_LOCK_CLASS}::int, hashtext(${MIGRATION_IMPORT_LOCK_KEY}))`.execute(
      conn,
    );
    try {
      return await fn(conn as unknown as Db);
    } finally {
      await sql`SELECT pg_advisory_unlock(${MIGRATION_IMPORT_LOCK_CLASS}::int, hashtext(${MIGRATION_IMPORT_LOCK_KEY}))`.execute(
        conn,
      );
    }
  });
}

export interface ReconcileCliIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

const OPERATOR = /^[\p{L}\p{N} ._@-]{1,100}$/u;

/** `mth-db reconcile-migration --operator <name>`; returns the exit code. */
export async function runReconcileMigrationCommand(
  db: Db,
  opts: { readonly operator: string | undefined },
  io: ReconcileCliIo,
): Promise<number> {
  if (opts.operator === undefined || !OPERATOR.test(opts.operator)) {
    io.err("BLOCKED: usage: mth-db reconcile-migration --operator <name>");
    return 2;
  }
  const operator = opts.operator;
  return withMigrationImportLock(db, async (conn) => {
    const outcome = await conn.transaction().execute(async (tx) => {
      const imported = await tx
        .selectFrom("migration_import")
        .select(["id"])
        .orderBy("imported_at", "desc")
        .orderBy("id", "desc")
        .executeTakeFirst();
      if (imported === undefined) return null;
      const run = await tx
        .selectFrom("migration_reconciliation")
        .select("id")
        .where("migration_import_id", "=", imported.id)
        .where("run_kind", "=", "import")
        .executeTakeFirst();
      if (run === undefined) return null;
      const expected = await tx
        .selectFrom("migration_reconciliation_table")
        .select(["table_name", "expected_rows", "expected_digest"])
        .where("migration_reconciliation_id", "=", run.id)
        .orderBy("table_name")
        .execute();
      await pinEncoderSettings(tx);
      const tables = await reconcileTables(
        tx,
        expected.map((e) => ({
          name: e.table_name,
          rowCount: String(e.expected_rows),
          contentDigest: e.expected_digest,
        })),
      );
      const report = buildReport(tables, 0, []);
      const org = await tx.selectFrom("organization").select("id").orderBy("id").executeTakeFirst();
      await recordReconciliation(tx, {
        migrationImportId: imported.id,
        organizationId: org?.id ?? null,
        runKind: "recheck",
        report,
        operator,
        actor: { actorType: "system", actorUserId: null, source: "cli" },
      });
      return report;
    });
    if (outcome === null) {
      io.err("BLOCKED: reconcile-migration: no migration import is recorded in this database");
      return 2;
    }
    for (const t of outcome.tables.filter((x) => !x.matched))
      io.out(
        `  ${t.tableName}: expected ${t.expectedRows} rows ${t.expectedDigest}, found ${t.actualRows} rows ${t.actualDigest}`,
      );
    io.out(reconcileLine(outcome));
    return outcome.result === "matched" ? 0 : 4;
  });
}

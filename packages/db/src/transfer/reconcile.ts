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
import { readFile, writeFile } from "node:fs/promises";
import { sql } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { insertAuditEvent, type AuditActor } from "../audit.ts";
import type { Db, DbOrTx, Tx } from "../pool.ts";
import { encodeLine, encodeTable, ENCODER_SETTINGS, transferSha256 } from "./export.ts";
import { buildPlan, type TransferPlan } from "./plan.ts";
import type { CheckedPackage } from "./import.ts";
import type { Allowance } from "./recheck.ts";
import { digestOfLines, encodedRows, type EncodedRow } from "./table-digest.ts";

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

/** Why a table may differ from the package (A1.6 `migration_reconciliation_delta`). */
export type DeltaBasis =
  | "audit_baseline"
  | "audit_additions"
  | "audit_already_present"
  | "rebind"
  | "exact_ids"
  | "audit_explained"
  | "child_of"
  | "operational"
  | "unexplained";

/**
 * One carried audit event the load found already present as an identical target migration event (ADR-0064 A2.2, A2.5):
 * its id, and the source's `seq` (decimal string) and `occurred_at` (the package line's exact §2.3 text).
 */
export interface AuditAlreadyPresent {
  readonly id: string;
  readonly sourceSeq: string;
  readonly sourceOccurredAt: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The reconstructed carried trail (ADR-0064 A2.3): the live audit_event rows with `seq <= M`, plus, for each entry of
 * `present`, the live row with that id whose `seq` and `occurred_at` are replaced by the entry's source values; encoded
 * with encodeTable's encoder, column order and line format, sorted by id. With `present = []` it equals
 * `encodeTable(…, { where: 'seq <= M' })` (a unit case pins it). A `present` id with no live row is simply absent, so
 * the count and the digest then differ from the manifest's.
 */
export async function encodeCarriedAudit(
  tx: DbOrTx,
  carriedSeqMax: bigint,
  present: readonly AuditAlreadyPresent[],
  plan?: TransferPlan,
): Promise<{ readonly rowCount: number; readonly contentDigest: string; readonly lines: readonly string[] }> {
  const p = plan ?? (await buildPlan(tx));
  const audit = p.tables.find((t) => t.name === "audit_event");
  if (audit === undefined) throw new Error("audit_event is not an exported table");
  const carried = await encodedRows(tx, audit, p.rewrittenColumns, { where: `seq <= ${carriedSeqMax.toString()}` });
  const rows: { id: string; line: string }[] = carried.rows.map((r) => ({ id: r.values[0] ?? "", line: r.line }));
  if (present.length > 0) {
    for (const e of present) if (!UUID.test(e.id)) throw new Error(`invalid audit id ${JSON.stringify(e.id)}`);
    const seqAt = carried.kinds.findIndex((k) => k.name === "seq");
    const occurredAt = carried.kinds.findIndex((k) => k.name === "occurred_at");
    const idAt = carried.kinds.findIndex((k) => k.name === "id");
    if (seqAt < 0 || occurredAt < 0 || idAt !== 0) throw new Error("audit_event lacks id, seq or occurred_at");
    const byId = new Map(present.map((e) => [e.id, e]));
    const live = await encodedRows(tx, audit, p.rewrittenColumns, {
      where: `id = ANY('{${present.map((e) => e.id).join(",")}}'::uuid[])`,
    });
    for (const r of live.rows) {
      const e = byId.get(r.values[idAt] ?? "");
      if (e === undefined) continue;
      const values = [...r.values];
      values[seqAt] = e.sourceSeq;
      values[occurredAt] = e.sourceOccurredAt;
      rows.push({ id: e.id, line: encodeLine(live.kinds, values) });
    }
    rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  const lines = rows.map((r) => r.line);
  return { rowCount: lines.length, contentDigest: digestOfLines(lines), lines };
}

export interface ReconciliationDelta {
  readonly tableName: string;
  readonly basis: DeltaBasis;
  /** Decimal strings. */
  readonly rowsAdded: string;
  readonly rowsChanged: string;
  readonly rowsMissing: string;
  readonly allowed: boolean;
}

export type RunKind = "import" | "recheck" | "recheck_after_use";

export interface ReconciliationReport {
  readonly result: "matched" | "mismatched";
  readonly deltas: readonly ReconciliationDelta[];
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
export async function reconcileTables(
  tx: DbOrTx,
  expected: readonly TableExpectation[],
  opts: { readonly auditCarriedSeqMax?: bigint; readonly auditAlreadyPresent?: readonly AuditAlreadyPresent[] } = {},
): Promise<TableResult[]> {
  const plan = await buildPlan(tx);
  const out: TableResult[] = [];
  for (const e of expected) {
    const table = plan.tables.find((t) => t.name === e.name);
    // ADR-0064 A1.5 with A2.3: on an imported target, audit_event is compared as the reconstructed carried trail (the
    // live rows with seq <= M plus the already-present events with their recorded source seq and time).
    const live =
      table === undefined
        ? { rowCount: 0, contentDigest: EMPTY_DIGEST }
        : e.name === "audit_event" && opts.auditCarriedSeqMax !== undefined
          ? await encodeCarriedAudit(tx, opts.auditCarriedSeqMax, opts.auditAlreadyPresent ?? [], plan)
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
  deltas: readonly ReconciliationDelta[] = [],
  runKind: RunKind = "import",
): ReconciliationReport {
  const sum = (f: (t: TableResult) => string) => tables.reduce((n, t) => n + BigInt(f(t)), 0n);
  const rowsExpected = sum((t) => t.expectedRows);
  const rowsActual = sum((t) => t.actualRows);
  // A1.6: a table counts as mismatched when its table row did not match and no allowed delta explains it, or when it
  // has a disallowed delta.
  const allowedFor = new Set(deltas.filter((d) => d.allowed).map((d) => d.tableName));
  const bad = new Set(tables.filter((t) => !t.matched && !allowedFor.has(t.tableName)).map((t) => t.tableName));
  for (const d of deltas) if (!d.allowed) bad.add(d.tableName);
  const tablesMismatched = bad.size;
  const matched =
    tablesMismatched === 0 &&
    attachmentMismatches.length === 0 &&
    (runKind === "recheck_after_use" || rowsExpected === rowsActual);
  return {
    result: matched ? "matched" : "mismatched",
    deltas,
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
    readonly runKind: RunKind;
    readonly report: ReconciliationReport;
    readonly operator: string;
    readonly actor: AuditActor;
    /** The import writes its migration.imported event first (A1.4 L12) and the reconciled event after it. */
    readonly skipAudit?: boolean;
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
      tables_checked: Math.max(report.tables.length, report.tablesMismatched),
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
  if (report.deltas.length > 0)
    await tx
      .insertInto("migration_reconciliation_delta")
      .values(
        report.deltas.map((d) => ({
          migration_reconciliation_id: id,
          table_name: d.tableName,
          basis: d.basis,
          rows_added: d.rowsAdded,
          rows_changed: d.rowsChanged,
          rows_missing: d.rowsMissing,
          allowed: d.allowed,
        })),
      )
      .execute();
  if (input.skipAudit !== true) await auditReconciliation(tx, id, input);
  return id;
}

/** The migration.reconciled event of run `id`. */
export async function auditReconciliation(
  tx: Tx,
  id: string,
  input: {
    readonly migrationImportId: string;
    readonly organizationId: string | null;
    readonly runKind: RunKind;
    readonly report: ReconciliationReport;
    readonly operator: string;
    readonly actor: AuditActor;
  },
): Promise<void> {
  const { report } = input;
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
      attachments_checked: { from: null, to: report.attachmentsChecked },
      attachments_mismatched: { from: null, to: report.attachmentMismatches.length },
      rows_expected: { from: null, to: report.rowsExpected },
      rows_actual: { from: null, to: report.rowsActual },
      deltas: {
        from: null,
        to: report.deltas.map((d) => ({
          table: d.tableName,
          basis: d.basis,
          added: d.rowsAdded,
          changed: d.rowsChanged,
          missing: d.rowsMissing,
          allowed: d.allowed,
        })),
      },
    },
  });
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

export interface ReconcileCliOptions {
  readonly operator: string | undefined;
  /** A1.8: the `transfer-attachments verify` output; required when the import recorded attachments. */
  readonly attachmentsReport?: string | undefined;
  /** Mode 2 (A1.9, A2.6). */
  readonly afterUse?: boolean;
  readonly from?: string | undefined;
  readonly allow?: string | undefined;
  /** Where the printed lines are also written. */
  readonly report?: string | undefined;
}

const REFUSE_AFTER_USE = "reconcile-migration: refused: --after-use needs --from <dir> and --allow <file>";

class RecheckRefused extends Error {}

/**
 * `mth-db reconcile-migration --operator <name> [--attachments-report <file>] [--after-use --from <dir> --allow
 * <file>] [--report <file>]`; returns the exit code (0 matched, 4 mismatch, 2 refused or no import).
 */
export async function runReconcileMigrationCommand(
  db: Db,
  opts: ReconcileCliOptions,
  io: ReconcileCliIo,
): Promise<number> {
  if (opts.operator === undefined || !OPERATOR.test(opts.operator)) {
    io.err(
      "BLOCKED: usage: mth-db reconcile-migration --operator <name> [--attachments-report <file>] " +
        "[--after-use --from <dir> --allow <file>] [--report <file>]",
    );
    return 2;
  }
  const operator = opts.operator;
  const afterUse = opts.afterUse === true;
  if (afterUse && (opts.from === undefined || opts.allow === undefined)) {
    io.err(REFUSE_AFTER_USE);
    return 2;
  }
  const printed: string[] = [];
  const say = (l: string) => {
    printed.push(l);
    io.out(l);
  };
  const finish = async (code: number, last?: string) => {
    if (last !== undefined) {
      printed.push(last);
      if (code === 0 || code === 4) io.out(last);
      else io.err(last);
    }
    if (opts.report !== undefined) await writeFile(opts.report, `${printed.join("\n")}\n`, "utf8");
    return code;
  };
  const R = await import("./recheck.ts");
  const I = await import("./import.ts");
  const A = await import("./attachment-report.ts");
  // The allowance is validated structurally before any database read (A1.9).
  let allowance: Allowance | null = null;
  let pkg: CheckedPackage | null = null;
  try {
    if (afterUse) {
      allowance = R.parseAllowance(new Uint8Array(await readFile(opts.allow!)));
      pkg = await I.checkPackage(opts.from!);
    }
  } catch (err) {
    if (err instanceof R.AllowanceRefused) return finish(2, err.message);
    if (err instanceof I.ImportRefused)
      return finish(2, err.message.replace(/^import-migration:/, "reconcile-migration:"));
    throw err;
  }
  try {
    return await withMigrationImportLock(db, async (conn) => {
      const outcome = await conn.transaction().execute(async (tx) => {
        const imported = await tx
          .selectFrom("migration_import")
          .selectAll()
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
        if (pkg !== null && pkg.manifestSha256 !== imported.manifest_sha256)
          throw new RecheckRefused(
            `reconcile-migration: refused: the package at ${opts.from} is not the one imported (${pkg.manifestSha256}, ` +
              `the import recorded ${imported.manifest_sha256})`,
          );
        // A1.8: never 0 checked for a package that lists attachments.
        A.requireAttachmentReport(
          imported.attachment_count,
          opts.attachmentsReport !== undefined,
          "reconcile-migration",
        );
        const attachments =
          opts.attachmentsReport === undefined
            ? { checked: 0, mismatches: [] as AttachmentMismatch[] }
            : A.parseAttachmentReport(
                new Uint8Array(await readFile(opts.attachmentsReport)),
                { attachmentManifestSha256: imported.attachment_manifest_sha256, count: imported.attachment_count },
                "reconcile-migration",
              );
        await pinEncoderSettings(tx);
        await I.assertAuditTriggersEnabled(tx).catch((e: unknown) => {
          if (e instanceof I.ImportRefused)
            throw new RecheckRefused(e.message.replace(/^import-migration:/, "reconcile-migration:"));
          throw e;
        });
        const plan = await buildPlan(tx);
        if (allowance !== null) await R.validateAllowance(tx, allowance, plan);
        const expected = await tx
          .selectFrom("migration_reconciliation_table")
          .select(["table_name", "expected_rows", "expected_digest"])
          .where("migration_reconciliation_id", "=", run.id)
          .orderBy("table_name")
          .execute();
        const big = (v: string | number | null) => (v === null ? null : BigInt(v));
        const imp = {
          id: imported.id,
          carriedRows: BigInt(imported.audit_carried_rows ?? "0"),
          carriedSeqMax: BigInt(imported.audit_carried_seq_max ?? "0"),
          baselineRows: BigInt(imported.audit_baseline_rows ?? "0"),
          baselineSeqMin: big(imported.audit_baseline_seq_min),
          baselineSeqMax: big(imported.audit_baseline_seq_max),
          baselineDigest: imported.audit_baseline_digest ?? EMPTY_DIGEST,
          alreadyPresentRows: BigInt(imported.audit_already_present_rows ?? "0"),
        };
        const lines: string[] = [];
        const tables: TableResult[] = [];
        const deltas: ReconciliationDelta[] = [];
        let unchanged = 0;
        let allowedDiff = 0;
        // audit_event (A1.5 with A2.3), both modes.
        const auditExp = expected.find((e) => e.table_name === "audit_event")!;
        const trail = await R.checkAuditTrail(
          tx,
          imp,
          { rowCount: String(auditExp.expected_rows), contentDigest: auditExp.expected_digest },
          plan,
          (t, m, max) => I.measureBaseline(t, m, max),
        );
        tables.push({
          tableName: "audit_event",
          expectedRows: String(auditExp.expected_rows),
          actualRows: String(trail.reconstructedRows),
          expectedDigest: auditExp.expected_digest,
          actualDigest: trail.reconstructedDigest,
          matched: trail.ok,
        });
        deltas.push(
          {
            tableName: "audit_event",
            basis: "audit_baseline",
            rowsAdded: String(imp.baselineRows),
            rowsChanged: "0",
            rowsMissing: "0",
            allowed: trail.baselineKept,
          },
          {
            tableName: "audit_event",
            basis: "audit_already_present",
            rowsAdded: "0",
            rowsChanged: String(trail.present.length),
            rowsMissing: "0",
            allowed: trail.presentOk,
          },
          {
            tableName: "audit_event",
            basis: "audit_additions",
            rowsAdded: trail.additionsTotal.toString(),
            rowsChanged: "0",
            rowsMissing: "0",
            allowed: true,
          },
        );
        lines.push(...trail.problems);
        // user_identity: the rebinds reversed first (both modes).
        const rev = await R.reverseRebinds(tx, plan);
        const uiExp = expected.find((e) => e.table_name === "user_identity");
        const others = expected.filter((e) => e.table_name !== "audit_event" && e.table_name !== "user_identity");
        if (allowance === null) {
          // Mode 1.
          if (uiExp !== undefined) {
            const digest = R.digestOfRows(rev.rows);
            const matched =
              String(rev.rows.length) === String(uiExp.expected_rows) &&
              digest === uiExp.expected_digest &&
              rev.unexplained.length === 0;
            tables.push({
              tableName: "user_identity",
              expectedRows: String(uiExp.expected_rows),
              actualRows: String(rev.rows.length),
              expectedDigest: uiExp.expected_digest,
              actualDigest: digest,
              matched,
            });
            if (rev.rebound > 0 || rev.unexplained.length > 0)
              deltas.push(
                rev.unexplained.length === 0 && matched
                  ? {
                      tableName: "user_identity",
                      basis: "rebind",
                      rowsAdded: "0",
                      rowsChanged: String(rev.rebound),
                      rowsMissing: "0",
                      allowed: true,
                    }
                  : {
                      tableName: "user_identity",
                      basis: "unexplained",
                      rowsAdded: "0",
                      rowsChanged: String(rev.rebound),
                      rowsMissing: "0",
                      allowed: false,
                    },
              );
          }
          const rest = await reconcileTables(
            tx,
            others.map((e) => ({
              name: e.table_name,
              rowCount: String(e.expected_rows),
              contentDigest: e.expected_digest,
            })),
          );
          tables.push(...rest);
        } else {
          // Mode 2: row by row against the package.
          const a = allowance;
          const listedTables = new Map(a.tables.map((t) => [t.name, t]));
          const audited = new Map(a.audited.map((t) => [t.name, t]));
          const operational = new Set(a.operational);
          const childrenOf = new Map(a.children.map((c) => [c.name, c]));
          const explainedRows = new Map<string, EncodedRow[]>();
          const fileOf = new Map(pkg!.manifest.tables.map((t) => [t.name, t.file]));
          const order = [
            ...pkg!.manifest.tables.map((t) => t.name).filter((n) => n !== "audit_event" && !childrenOf.has(n)),
            ...R.childrenOrder(a).map((c) => c.name),
          ];
          const keyText = (k: readonly string[]) => JSON.stringify(k);
          for (const name of order) {
            const table = plan.tables.find((t) => t.name === name)!;
            const pkgRows = await R.packageLines(pkg!.dir, fileOf.get(name)!, table);
            const liveRows = name === "user_identity" ? rev.rows : undefined;
            const cmp = await R.compareRows(tx, table, pkgRows, plan, liveRows);
            const counts = { a: cmp.added.length, c: cmp.changed.length, m: cmp.missing.length };
            const push = (basis: DeltaBasis, allowed: boolean) =>
              deltas.push({
                tableName: name,
                basis,
                rowsAdded: String(counts.a),
                rowsChanged: String(counts.c),
                rowsMissing: String(counts.m),
                allowed,
              });
            const perTable = (basis: DeltaBasis) =>
              `  ${name}: ${counts.a} added, ${counts.c} changed, ${counts.m} missing (${basis})`;
            const listKeys = (prefix: string, keys: readonly string[]) => {
              for (const k of keys.slice(0, 20)) lines.push(`    ${prefix} ${k}`);
            };
            if (name === "user_identity" && rev.unexplained.length > 0) {
              push("unexplained", false);
              lines.push(perTable("unexplained"));
              continue;
            }
            const diff = counts.a + counts.c + counts.m;
            if (listedTables.has(name)) {
              const t = listedTables.get(name)!;
              const want = { added: new Set(t.added.map(keyText)), changed: new Set(t.changed.map(keyText)) };
              const got = {
                added: new Set(cmp.added.map((r) => r.key)),
                changed: new Set(cmp.changed.map((r) => r.key)),
              };
              const extra = (k: "added" | "changed") => [...got[k]].filter((x) => !want[k].has(x));
              const absent = (k: "added" | "changed") => [...want[k]].filter((x) => !got[k].has(x));
              const ok =
                counts.m === 0 &&
                extra("added").length + extra("changed").length + absent("added").length + absent("changed").length ===
                  0;
              push("exact_ids", ok);
              if (ok) {
                allowedDiff += 1;
                explainedRows.set(name, [...cmp.added, ...cmp.changed]);
              } else {
                lines.push(perTable("exact_ids"));
                for (const k of ["added", "changed"] as const) listKeys(`unexpected ${k}`, extra(k));
                for (const k of ["added", "changed"] as const) listKeys(`expected but not ${k}`, absent(k));
              }
            } else if (operational.has(name)) {
              push("operational", true);
              if (diff > 0) allowedDiff += 1;
              else unchanged += 1;
            } else if (audited.has(name)) {
              const t = audited.get(name)!;
              const ex = await R.explainAudited(tx, table, cmp, a.actors, imp.baselineSeqMax ?? imp.carriedSeqMax);
              const unAdded = new Set(ex.unexplainedAdded.map((r) => r.key));
              const unChanged = new Set(ex.unexplainedChanged.map((r) => r.key));
              const okAdded = new Set(cmp.added.map((r) => r.key).filter((k) => !unAdded.has(k)));
              const okChanged = new Set(cmp.changed.map((r) => r.key).filter((k) => !unChanged.has(k)));
              const notIn = (k: "added" | "changed") =>
                t.mustInclude[k].map(keyText).filter((x) => !(k === "added" ? okAdded : okChanged).has(x));
              const ok =
                counts.m === 0 && unAdded.size + unChanged.size + notIn("added").length + notIn("changed").length === 0;
              push("audit_explained", ok);
              explainedRows.set(
                name,
                [...cmp.added, ...cmp.changed].filter((r) => okAdded.has(r.key) || okChanged.has(r.key)),
              );
              lines.push(`  ${name}: ${ex.events} explaining events`);
              if (ok) allowedDiff += diff > 0 ? 1 : 0;
              else {
                lines.push(perTable("audit_explained"));
                listKeys("unexplained added", [...unAdded]);
                listKeys("unexplained changed", [...unChanged]);
                listKeys("expected but not added", notIn("added"));
                listKeys("expected but not changed", notIn("changed"));
              }
              if (ok && diff === 0) unchanged += 1;
            } else if (childrenOf.has(name)) {
              const c = childrenOf.get(name)!;
              const parent = plan.tables.find((t) => t.name === c.parent)!;
              const ex = await R.explainChildren(tx, table, parent, c.fkey, cmp, explainedRows.get(c.parent) ?? []);
              const ok = counts.m === 0 && ex.unexplainedAdded.length + ex.unexplainedChanged.length === 0;
              push("child_of", ok);
              const bad = new Set([...ex.unexplainedAdded, ...ex.unexplainedChanged].map((r) => r.key));
              explainedRows.set(
                name,
                [...cmp.added, ...cmp.changed].filter((r) => !bad.has(r.key)),
              );
              if (ok) {
                if (diff > 0) allowedDiff += 1;
                else unchanged += 1;
              } else {
                lines.push(perTable("child_of"));
                listKeys(
                  "unexplained added",
                  ex.unexplainedAdded.map((r) => r.key),
                );
                listKeys(
                  "unexplained changed",
                  ex.unexplainedChanged.map((r) => r.key),
                );
              }
            } else if (name === "user_identity" && rev.rebound > 0 && diff === 0) {
              push("rebind", true);
              allowedDiff += 1;
            } else if (diff === 0) {
              unchanged += 1;
            } else {
              push("unexplained", false);
              lines.push(perTable("unexplained"));
            }
          }
          if (trail.ok) allowedDiff += 0;
        }
        const report = buildReport(
          tables,
          attachments.checked,
          attachments.mismatches,
          deltas,
          allowance === null ? "recheck" : "recheck_after_use",
        );
        for (const t of report.tables.filter((x) => !x.matched && x.tableName !== "audit_event"))
          lines.unshift(
            `  ${t.tableName}: expected ${t.expectedRows} rows ${t.expectedDigest}, found ${t.actualRows} rows ${t.actualDigest}`,
          );
        for (const m of report.attachmentMismatches) lines.push(`  attachment ${m.objectName}: ${m.problem}`);
        const org = await tx.selectFrom("organization").select("id").orderBy("id").executeTakeFirst();
        await recordReconciliation(tx, {
          migrationImportId: imported.id,
          organizationId: org?.id ?? null,
          runKind: allowance === null ? "recheck" : "recheck_after_use",
          report,
          operator,
          actor: { actorType: "system", actorUserId: null, source: "cli" },
        });
        return { report, lines, unchanged, allowedDiff, additions: trail.additionsTotal, byAction: trail.additions };
      });
      if (outcome === null)
        return finish(2, "BLOCKED: reconcile-migration: no migration import is recorded in this database");
      for (const l of outcome.lines) say(l);
      if (outcome.report.result !== "matched") return finish(4, reconcileLine(outcome.report));
      if (!afterUse) {
        for (const [action, n] of outcome.byAction) say(`  audit_event: ${n} ${action} added since the import`);
        return finish(0, reconcileLine(outcome.report));
      }
      return finish(
        0,
        `reconcile-migration: matched after use: ${outcome.unchanged} tables unchanged, ${outcome.allowedDiff} tables ` +
          `with allowed differences, ${outcome.additions} audit events added since the import`,
      );
    });
  } catch (err) {
    if (err instanceof RecheckRefused || err instanceof R.AllowanceRefused || err instanceof A.AttachmentReportRefused)
      return finish(2, err.message);
    throw err;
  }
}

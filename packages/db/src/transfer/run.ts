// The recorded export run (ADR-0064 §7; T-DG7-BE-C): the migration_export state machine around `exportPackage`,
// shared by the worker job `transfer.export` and `mth-db export-migration`, so both record the same transitions:
//   claim  (one transaction under the migrationExport lock 730402, key "migration-export"): queued -> running, or
//          running -> running for a retry after a crash; audit migration_export.started. A succeeded or failed export
//          or a missing row is skipped (a duplicate delivery changes nothing: exactly once).
//   run    `exportPackage` outside any transaction (its snapshot is one REPEATABLE READ READ ONLY transaction; every
//          write and evidence read happens after it ended).
//   finish (one transaction under the lock): running -> succeeded with the counts, both SHA-256 values, the marker,
//          the level and (demo only) the demo checksum, audit migration_export.succeeded; or running -> failed with
//          the reason, audit migration_export.failed.
// The CLI's request (`requestCliExport`) inserts the queued row (requested_via cli) with migration_export.requested
// under the same lock and refuses while another export is queued or running. The lock number is spelled here (this
// package cannot import the API's registry; the demoReset precedent) and pinned to the registry by a test.
// Nothing here approves anything (no G1-G6, Finance or IT approval) and nothing reads or writes DG0-DG7.
import { sql } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { insertAuditEvent, type AuditActor } from "../audit.ts";
import type { Db, Tx } from "../pool.ts";
import { ExportFailed, exportPackage, type ExportResult, type ObjectSource, type PackageSink } from "./export.ts";

/** ADR-0016 §6 `migrationExport` (apps/api platform/advisory-locks.ts). */
export const MIGRATION_EXPORT_LOCK_CLASS = 730402;
/** The registry's one class-wide key of the class. */
export const MIGRATION_EXPORT_LOCK_KEY = "migration-export";
/** C.5: the in-progress refusal text (the API's 422 migration.export_in_progress detail). */
export const EXPORT_IN_PROGRESS_TEXT = "A migration export is already queued or running. Wait for it to finish.";

export type RecordedExportOutcome =
  | { readonly outcome: "skipped"; readonly status: string | null }
  | { readonly outcome: "succeeded"; readonly result: ExportResult }
  | { readonly outcome: "failed"; readonly reason: string };

export const lockMigrationExport = (tx: Tx) =>
  sql`SELECT pg_advisory_xact_lock(${MIGRATION_EXPORT_LOCK_CLASS}::int, hashtext(${MIGRATION_EXPORT_LOCK_KEY}))`.execute(
    tx,
  );

async function lockedRow(tx: Tx, id: string) {
  await lockMigrationExport(tx);
  return tx.selectFrom("migration_export").selectAll().where("id", "=", id).forUpdate().executeTakeFirst();
}

/** The failure reason as stored (0133: 1-1000 characters, one line). */
export function failureReasonOf(err: unknown): string {
  const raw =
    err instanceof ExportFailed ? err.message : `unexpected error: ${err instanceof Error ? err.message : String(err)}`;
  const one = raw.replace(/\s+/g, " ").trim() || "unexpected error";
  return one.length > 1000 ? `${one.slice(0, 999)}…` : one;
}

/** The CLI's request: a queued row (requested_via cli) and its audit event; refuses while another is active. */
export async function requestCliExport(db: Db, operator: string): Promise<string> {
  return db.transaction().execute(async (tx) => {
    await lockMigrationExport(tx);
    const active = await tx
      .selectFrom("migration_export")
      .select("id")
      .where("status", "in", ["queued", "running"])
      .executeTakeFirst();
    if (active !== undefined) throw new ExportFailed(EXPORT_IN_PROGRESS_TEXT);
    const id = uuidv7();
    await tx
      .insertInto("migration_export")
      .values({ id, requested_via: "cli", created_by: null, updated_by: null })
      .execute();
    await insertAuditEvent(
      tx,
      { actorType: "system", actorUserId: null, source: "cli" },
      {
        action: "migration_export.requested",
        recordType: "migration_export",
        recordId: id,
        organizationId: null,
        newVersion: 1,
        reason: `mth-db export-migration by operator ${operator}`,
        changes: {
          status: { from: null, to: "queued" },
          requested_via: { from: null, to: "cli" },
          operator: { from: null, to: operator },
        },
      },
    );
    return id;
  });
}

export interface RecordedExportOptions {
  readonly actor: AuditActor;
  readonly sink: PackageSink;
  readonly objects: ObjectSource;
  readonly appVersion?: string;
  /** 1-based attempt of a retried job (recorded on a running -> running claim). */
  readonly attempt?: number;
}

/** claim -> run -> finish for one export id. */
export async function runRecordedExport(
  db: Db,
  exportId: string,
  opts: RecordedExportOptions,
): Promise<RecordedExportOutcome> {
  const claimed = await db.transaction().execute(async (tx) => {
    const row = await lockedRow(tx, exportId);
    if (row === undefined || (row.status !== "queued" && row.status !== "running"))
      return { claimed: false as const, status: row?.status ?? null };
    const version = row.version + 1;
    await tx
      .updateTable("migration_export")
      .set({
        status: "running",
        started_at: row.started_at ?? sql<Date>`now()`,
        version,
        updated_at: sql<Date>`now()`,
        updated_by: null,
      })
      .where("id", "=", exportId)
      .execute();
    await insertAuditEvent(tx, opts.actor, {
      action: "migration_export.started",
      recordType: "migration_export",
      recordId: exportId,
      organizationId: null,
      priorVersion: row.version,
      newVersion: version,
      changes: {
        status: { from: row.status, to: "running" },
        ...(row.status === "running" ? { attempt: { from: null, to: opts.attempt ?? null } } : {}),
      },
    });
    return { claimed: true as const };
  });
  if (!claimed.claimed) return { outcome: "skipped", status: claimed.status };

  let result: ExportResult | null = null;
  let reason: string | null = null;
  try {
    result = await exportPackage(db, opts.sink, {
      exportId,
      objects: opts.objects,
      ...(opts.appVersion !== undefined ? { appVersion: opts.appVersion } : {}),
    });
  } catch (err) {
    reason = failureReasonOf(err);
  }

  return db.transaction().execute(async (tx): Promise<RecordedExportOutcome> => {
    const row = await lockedRow(tx, exportId);
    if (row === undefined || row.status !== "running") return { outcome: "skipped", status: row?.status ?? null };
    const version = row.version + 1;
    if (result !== null) {
      await tx
        .updateTable("migration_export")
        .set({
          status: "succeeded",
          source_environment: result.sourceEnvironment,
          migration_level: result.migrationLevel,
          table_count: result.tableCount,
          row_count: result.rowCount,
          attachment_count: result.attachmentCount,
          attachment_bytes: result.attachmentBytes,
          manifest_sha256: result.manifestSha256,
          attachment_manifest_sha256: result.attachmentManifestSha256,
          demo_checksum: result.demoChecksum,
          finished_at: sql<Date>`now()`,
          version,
          updated_at: sql<Date>`now()`,
          updated_by: null,
        })
        .where("id", "=", exportId)
        .execute();
      await insertAuditEvent(tx, opts.actor, {
        action: "migration_export.succeeded",
        recordType: "migration_export",
        recordId: exportId,
        organizationId: null,
        priorVersion: row.version,
        newVersion: version,
        changes: {
          status: { from: "running", to: "succeeded" },
          source_environment: { from: null, to: result.sourceEnvironment },
          migration_level: { from: null, to: result.migrationLevel },
          table_count: { from: null, to: result.tableCount },
          row_count: { from: null, to: result.rowCount },
          attachment_count: { from: null, to: result.attachmentCount },
          manifest_sha: { from: null, to: result.manifestSha256 },
          attachment_manifest_sha: { from: null, to: result.attachmentManifestSha256 },
          demo_checksum: { from: null, to: result.demoChecksum },
        },
      });
      return { outcome: "succeeded", result };
    }
    const why = reason ?? "unexpected error";
    await tx
      .updateTable("migration_export")
      .set({
        status: "failed",
        failure_reason: why,
        finished_at: sql<Date>`now()`,
        version,
        updated_at: sql<Date>`now()`,
        updated_by: null,
      })
      .where("id", "=", exportId)
      .execute();
    await insertAuditEvent(tx, opts.actor, {
      action: "migration_export.failed",
      recordType: "migration_export",
      recordId: exportId,
      organizationId: null,
      priorVersion: row.version,
      newVersion: version,
      changes: { status: { from: "running", to: "failed" }, failure_reason: { from: null, to: why } },
    });
    return { outcome: "failed", reason: why };
  });
}

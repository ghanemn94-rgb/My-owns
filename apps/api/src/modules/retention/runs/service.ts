// Administration > Retention: the service of the run, dry-run, action-log and archived-record operations (P7 slice E;
// ADR-0067 §4-§6; REQ-S16-024; p7-work-split §E.1; T-DG7-BE-G).
//
// The request (createRetentionRun, createRetentionDryRun), in ONE transaction:
//   1. retention.run re-checked on grants reloaded in the transaction (commit-time authorization);
//   2. the transaction lock of class retentionRun (ADVISORY_LOCK_CLASSES, key "retention"), so a class update, a request and the job's
//      start never interleave;
//   3. 422 retention.run_in_progress while any run is queued or running (the 0144 index retention_run_one_active is
//      the backstop);
//   4. the retention_run row (queued, requested_via api, as_of = now(), created_by the caller);
//   5. the audit event retention_run.requested (with the reason) and the internal outbox event
//      retention_run.requested whose idempotency key is the run id: the relay sends it to the worker job
//      retention.archive with singleton key = the run id, after COMMIT (no remote I/O in the transaction).
// The same Idempotency-Key with the same body answers 200 with the run's current state.
//
// What leaves through the API: the run row, the per-record action log and the archived-record markers: table names,
// primary key values (never other row content), class, period, ages and times. A run archives and deletes operational
// records only; it approves nothing (no G1-G6, Finance or IT approval) and never reads or writes DG0-DG7.
import { sql, type DbOrTx, type RetentionRunRow, type Tx } from "@mth/db";
import { reason as reasonRule } from "@mth/shared/schemas";
import type { FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { auditContextOf, refreshPrincipal } from "../../access/index.ts";
import { record } from "../../audit/index.ts";
import { enqueueOutboxEvent } from "../../jobs/index.ts";
import { iso, isoOrNull, problems } from "../../platform/index.ts";
import { lockRetention, requireRetentionRight, retentionRefusals, runActive } from "../classes/service.ts";

export const RETENTION_RUN_REQUESTED_EVENT = "retention_run.requested";
export type RetentionRunMode = "run" | "dry_run";

// ------------------------------------------------------------------------------------------------ contract mirror
// docs/api/openapi.yaml RetentionRun / RetentionRunPage / RetentionRunAction(Page) / RetentionArchivedRecord(Page).
const sha = z.string().regex(/^[0-9a-f]{64}$/);
const count = z.string().regex(/^(0|[1-9][0-9]{0,18})$/);
const timestamp = z.iso.datetime({ offset: true });
const nonNegative = z.number().int().min(0).nullable();
const recordKey = z.record(z.string(), z.string());

export const retentionRunView = z.strictObject({
  id: z.uuid(),
  mode: z.enum(["dry_run", "run"]),
  status: z.enum(["queued", "running", "succeeded", "failed"]),
  requestedVia: z.enum(["api", "schedule"]),
  asOf: timestamp,
  candidateCount: nonNegative,
  archivedCount: nonNegative,
  purgedCount: nonNegative,
  skippedCount: nonNegative,
  archiveSetKey: z
    .string()
    .regex(/^retention\/[0-9a-f-]{36}\/manifest\.json$/)
    .nullable(),
  archiveSetSha256: sha.nullable(),
  archiveSetBytes: count.nullable(),
  failureReason: z.string().nullable(),
  startedAt: timestamp.nullable(),
  finishedAt: timestamp.nullable(),
  createdAt: timestamp,
  createdBy: z.uuid().nullable(),
  version: z.number().int().min(1),
});
export type RetentionRunView = z.infer<typeof retentionRunView>;
export const retentionRunPage = z.strictObject({ items: z.array(retentionRunView), nextCursor: z.string().nullable() });

export const retentionRunActionView = z.strictObject({
  id: z.uuid(),
  retentionRunId: z.uuid(),
  retentionClassCode: z.string(),
  tableName: z.string(),
  recordKey,
  action: z.enum(["would_archive", "would_purge", "archived", "purged", "skipped_referenced"]),
  periodDays: z.number().int().min(1),
  recordAgeAt: timestamp,
  occurredAt: timestamp,
});
export const retentionRunActionPage = z.strictObject({
  items: z.array(retentionRunActionView),
  nextCursor: z.string().nullable(),
});

export const retentionArchivedRecordView = z.strictObject({
  tableName: z.string(),
  recordKey,
  retentionClassCode: z.string(),
  retentionRunId: z.uuid(),
  archiveSetKey: z.string(),
  recordAgeAt: timestamp,
  archivedAt: timestamp,
  purgedAt: timestamp.nullable(),
  purgeRunId: z.uuid().nullable(),
});
export const retentionArchivedRecordPage = z.strictObject({
  items: z.array(retentionArchivedRecordView),
  nextCursor: z.string().nullable(),
});

export const retentionRunCreate = z.strictObject({ reason: reasonRule });

const text = (v: string | number | bigint | null): string | null => (v === null ? null : String(v));

export function presentRun(r: RetentionRunRow): RetentionRunView {
  return retentionRunView.parse({
    id: r.id,
    mode: r.mode,
    status: r.status,
    requestedVia: r.requested_via,
    asOf: iso(r.as_of),
    candidateCount: r.candidate_count,
    archivedCount: r.archived_count,
    purgedCount: r.purged_count,
    skippedCount: r.skipped_count,
    archiveSetKey: r.archive_set_key,
    archiveSetSha256: r.archive_set_sha256,
    archiveSetBytes: text(r.archive_set_bytes),
    failureReason: r.failure_reason,
    startedAt: isoOrNull(r.started_at),
    finishedAt: isoOrNull(r.finished_at),
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
    version: r.version,
  });
}

/** A jsonb record key as read by `pg` (an object) or as text. */
export const keyOf = (v: unknown): Record<string, string> =>
  recordKey.parse(typeof v === "string" ? (JSON.parse(v) as unknown) : v);

export async function findRun(db: DbOrTx, id: string): Promise<RetentionRunRow | undefined> {
  return db.selectFrom("retention_run").selectAll().where("id", "=", id).executeTakeFirst();
}

// ------------------------------------------------------------------------------------------------ the request

/** The request's transaction (steps 1-5 above). Returns the queued row. */
export async function requestRun(
  tx: Tx,
  request: FastifyRequest,
  mode: RetentionRunMode,
  reason: string,
): Promise<RetentionRunRow> {
  const principal = await refreshPrincipal(tx, request);
  const organizationId = await requireRetentionRight(tx, principal, "retention.run");
  const userId = principal.userId;
  if (userId === null) throw problems.forbidden();
  await lockRetention(tx);
  if (await runActive(tx)) throw retentionRefusals.runInProgress();
  const id = uuidv7();
  const row = await tx
    .insertInto("retention_run")
    .values({
      id,
      mode,
      requested_via: "api",
      as_of: sql<Date>`now()`, // the database clock at the request (ADR-0067 §4)
      created_by: userId,
      updated_by: userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow()
    .catch((e: unknown) => {
      // The 0144 index retention_run_one_active is the backstop of step 3.
      if ((e as { constraint?: string }).constraint === "retention_run_one_active")
        throw retentionRefusals.runInProgress();
      throw e;
    });
  await record(tx, auditContextOf(request), {
    action: "retention_run.requested",
    recordType: "retention_run",
    recordId: id,
    organizationId,
    newVersion: 1,
    reason,
    changes: {
      status: { from: null, to: "queued" },
      mode: { from: null, to: mode },
      requested_via: { from: null, to: "api" },
      as_of: { from: null, to: iso(row.as_of) },
    },
  });
  await enqueueOutboxEvent(tx, {
    organizationId,
    aggregateType: "retention_run",
    aggregateId: id,
    eventType: RETENTION_RUN_REQUESTED_EVENT,
    schemaVersion: 1,
    payload: { retentionRunId: id },
    idempotencyKey: id,
  });
  return row;
}

// The scheduled-job kit (ADR-0025 §3; REQ-S16-005, REQ-S12-005; p4-work-split §I+C.1, T-DG4-BE-A). Every P4 job
// handler uses it (S-13):
//  - runOnce(db, consumer, key, fn): the handler's effects and the processed_message (consumer, idempotency_key) ledger
//    row commit in ONE transaction. A redelivery, a retry or a restart after a crash finds the ledger row (or loses the
//    race on its primary key) and does nothing; a crash before COMMIT leaves neither the effects nor the ledger row,
//    so the next attempt redoes the work exactly once;
//  - createWorkItemOnce(tx, actor, input): the twin of the API's tasks/service.ts (the worker imports no API code,
//    ADR-0002 rule 5). Same SQL, same audit events; apps/api/test/integration/tasks/work-items.test.ts proves both write
//    the same rows. Every effect table carries its own unique key as the second line of defence
//    (work_item / inbox_notification (organization_id, dedupe_key)).
//  - rescheduleWorkItemsOfSubject / reassignWorkItemOfSubject: the twins of the API services that make an item follow
//    its source's due date and owner (T-DG4-BE-R1; D-102); same parity test.
// Rules: idempotency keys are deterministic, `<rule>:<subject id>:<slot>[:<recipient>]`; no remote I/O inside `fn`;
// audit actor `service` with source `worker` (JOB_ACTOR); a service actor holds no permission and never decides a
// business approval. Retries and the failure queue are ADR-0008 §4's (5 attempts, then ops.failed).
import { createHash } from "node:crypto";
import { insertAuditEvent, sql, type AuditActor, type Db, type Tx } from "@mth/db";
import { outboxPayloadSchema } from "@mth/shared/schemas";

/**
 * A UUIDv7 (ADR-0003) from the database's mth_uuid_v7() (0010; EXECUTE granted to mth_app). The API generates its ids
 * with the `uuid` package; the worker has no such dependency, so its twin asks the database (same version, same order).
 */
async function uuidv7(tx: Tx): Promise<string> {
  const r = await sql<{ id: string }>`SELECT mth_uuid_v7() AS id`.execute(tx);
  return r.rows[0]!.id;
}

/** The audit actor of a job: a service, on behalf of nobody unless given, from the worker (ADR-0025 §3 item 5). */
export function jobActor(jobId: string, onBehalfOfUserId: string | null = null): AuditActor {
  return { actorType: "service", actorUserId: null, onBehalfOfUserId, requestId: `job:${jobId}`, source: "worker" };
}

export type RunOnceResult<T> = { readonly outcome: "done"; readonly result: T } | { readonly outcome: "duplicate" };

/**
 * Runs `fn` and records (consumer, key) in processed_message in the same transaction, once. The ledger row is
 * inserted first (ON CONFLICT DO NOTHING): when it already exists the effects are skipped and `duplicate` is
 * returned; a concurrent duplicate waits on the primary key and then skips. If `fn` throws, nothing commits.
 */
export async function runOnce<T>(
  db: Db,
  consumer: string,
  key: string,
  fn: (tx: Tx) => Promise<T>,
  outcome: "done" | "skipped" = "done",
): Promise<RunOnceResult<T>> {
  if (consumer.length < 1 || consumer.length > 100) throw new Error("runOnce: consumer must have 1-100 characters");
  if (key.length < 1 || key.length > 200) throw new Error("runOnce: key must have 1-200 characters");
  return db.transaction().execute(async (tx) => {
    const ledger = await tx
      .insertInto("processed_message")
      .values({ consumer, idempotency_key: key, outcome })
      .onConflict((oc) => oc.doNothing())
      .returning("consumer")
      .executeTakeFirst();
    if (!ledger) return { outcome: "duplicate" } as const;
    return { outcome: "done", result: await fn(tx) } as const;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// createWorkItemOnce: the twin of apps/api/src/modules/tasks/service.ts (keep the two identical except the id source; the
// parity test fails on any difference in the rows they write).
export type MessageParamValue = string | number | boolean | null;

export interface WorkItemInput {
  readonly organizationId: string;
  readonly transformationId?: string | null;
  /** A `work_item_kind` code (later slices add theirs by migration). */
  readonly kind: string;
  readonly assigneeUserId: string;
  readonly subjectType: string;
  readonly subjectId: string;
  /** Relative in-app link, starting with one "/". */
  readonly linkPath: string;
  readonly messageKey: string;
  readonly messageParams?: Readonly<Record<string, MessageParamValue>>;
  /** Business date, or null for no due date (a due date that cannot be computed stays null; never guessed). */
  readonly dueDate?: string | null;
  readonly periodLabel?: string | null;
  /** `<rule>:<subject id>:<slot>[:<recipient>]` (ADR-0025 §3 item 1). */
  readonly dedupeKey: string;
}

export interface WorkItemOnceResult {
  readonly outcome: "created" | "existing";
  readonly workItemId: string;
}

/** Validates the parts the database would refuse less clearly; a programming error, never a user's. */
function assertInput(input: WorkItemInput): void {
  if (!/^\/[^/\\]/.test(input.linkPath))
    throw new Error(`createWorkItemOnce: linkPath must be relative: ${input.linkPath}`);
  if (input.dedupeKey.length < 1 || input.dedupeKey.length > 200)
    throw new Error("createWorkItemOnce: dedupeKey must have 1-200 characters");
}

/**
 * Inserts the work item and its notification once per (organization, dedupe key), with their audit events, in `tx`.
 * `actor` is the audit actor: the acting user from the API (source 'api'), or `service`/'worker' from a job handler.
 */
export async function createWorkItemOnce(tx: Tx, actor: AuditActor, input: WorkItemInput): Promise<WorkItemOnceResult> {
  assertInput(input);
  const id = await uuidv7(tx);
  const params = JSON.stringify(input.messageParams ?? {});
  const createdSource = actor.source === "worker" ? "worker" : actor.source === "migration" ? "migration" : "api";
  const by = actor.actorType === "user" ? actor.actorUserId : null;
  const inserted = await tx
    .insertInto("work_item")
    .values({
      id,
      organization_id: input.organizationId,
      transformation_id: input.transformationId ?? null,
      kind: input.kind,
      assignee_user_id: input.assigneeUserId,
      subject_type: input.subjectType,
      subject_id: input.subjectId,
      link_path: input.linkPath,
      message_key: input.messageKey,
      message_params: params,
      due_date: input.dueDate ?? null,
      period_label: input.periodLabel ?? null,
      dedupe_key: input.dedupeKey,
      created_source: createdSource,
      created_by: by,
      updated_by: by,
    })
    .onConflict((oc) => oc.columns(["organization_id", "dedupe_key"]).doNothing())
    .returning("id")
    .executeTakeFirst();
  if (!inserted) {
    const existing = await tx
      .selectFrom("work_item")
      .select("id")
      .where("organization_id", "=", input.organizationId)
      .where("dedupe_key", "=", input.dedupeKey)
      .executeTakeFirstOrThrow();
    return { outcome: "existing", workItemId: existing.id };
  }
  await insertAuditEvent(tx, actor, {
    action: "work_item.create",
    recordType: "work_item",
    recordId: id,
    organizationId: input.organizationId,
    transformationId: input.transformationId ?? null,
    newVersion: 1,
    changes: {
      kind: { from: null, to: input.kind },
      assignee_user_id: { from: null, to: input.assigneeUserId },
      subject_type: { from: null, to: input.subjectType },
      subject_id: { from: null, to: input.subjectId },
      due_date: { from: null, to: input.dueDate ?? null },
      dedupe_key: { from: null, to: input.dedupeKey },
    },
  });
  const notificationId = await uuidv7(tx);
  const notification = await tx
    .insertInto("inbox_notification")
    .values({
      id: notificationId,
      organization_id: input.organizationId,
      transformation_id: input.transformationId ?? null,
      recipient_user_id: input.assigneeUserId,
      work_item_id: id,
      link_path: input.linkPath,
      message_key: input.messageKey,
      message_params: params,
      dedupe_key: input.dedupeKey,
      created_by: by,
      updated_by: by,
    })
    .onConflict((oc) => oc.columns(["organization_id", "dedupe_key"]).doNothing())
    .returning("id")
    .executeTakeFirst();
  if (notification)
    await insertAuditEvent(tx, actor, {
      action: "inbox_notification.create",
      recordType: "inbox_notification",
      recordId: notificationId,
      organizationId: input.organizationId,
      transformationId: input.transformationId ?? null,
      newVersion: 1,
      changes: {
        recipient_user_id: { from: null, to: input.assigneeUserId },
        work_item_id: { from: null, to: id },
        dedupe_key: { from: null, to: input.dedupeKey },
      },
    });
  return { outcome: "created", workItemId: id };
}

// ---------------------------------------------------------------------------------------------------------------
// rescheduleWorkItemsOfSubject / reassignWorkItemOfSubject: the twins of apps/api/src/modules/tasks/service.ts
// (T-DG4-BE-R1; D-102: the worker imports no API code). A work item follows its source's due date and owner; an owner
// who gets the source back (A -> B -> A) gets a NEW item under the first free key of `<key>`, `<key>#2`, ... (the 0028
// guard keeps assignee and dedupe key immutable and never reopens a closed item). Keep the two identical; the parity
// test in apps/api/test/integration/tasks/work-items.test.ts fails on any difference in the rows they write.

/** The open items of one source that follow it: the subject and the kinds (other kinds of the subject are left alone). */
export interface WorkItemSourceRef {
  readonly organizationId: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly kinds: readonly string[];
}

export interface WorkItemReassignResult {
  /** `unchanged`: the new assignee already held the only open item; nothing was written. */
  readonly outcome: "unchanged" | "reassigned";
  /** The open item of the new assignee. */
  readonly workItemId: string;
  /** How many open items of other assignees were cancelled. */
  readonly cancelled: number;
}

/** The most `#n` suffixes tried for a returning assignee's new key; reaching it is a programming error. */
const MAX_REASSIGN_KEYS = 100;

/**
 * Moves the due date of the source's open items to `dueDate` (null: no due date, never guessed), each with a
 * `work_item.reschedule` audit event, in `tx`. Items already due on that date are not touched. Returns how many moved.
 */
export async function rescheduleWorkItemsOfSubject(
  tx: Tx,
  actor: AuditActor,
  source: WorkItemSourceRef,
  dueDate: string | null,
): Promise<number> {
  if (source.kinds.length === 0) throw new Error("rescheduleWorkItemsOfSubject: kinds must not be empty");
  const open = await tx
    .selectFrom("work_item")
    .selectAll()
    .where("organization_id", "=", source.organizationId)
    .where("subject_type", "=", source.subjectType)
    .where("subject_id", "=", source.subjectId)
    .where("kind", "in", [...source.kinds])
    .where("status", "=", "open")
    .orderBy("id")
    .forUpdate()
    .execute();
  const by = actor.actorType === "user" ? actor.actorUserId : null;
  let moved = 0;
  for (const item of open) {
    if (item.due_date === dueDate) continue;
    const updated = await tx
      .updateTable("work_item")
      .set((eb) => ({
        due_date: dueDate,
        version: eb("version", "+", 1),
        updated_at: eb.fn<Date>("now", []),
        updated_by: by,
      }))
      .where("id", "=", item.id)
      .where("version", "=", item.version)
      .returning("version")
      .executeTakeFirstOrThrow();
    await insertAuditEvent(tx, actor, {
      action: "work_item.reschedule",
      recordType: "work_item",
      recordId: item.id,
      organizationId: item.organization_id,
      transformationId: item.transformation_id,
      priorVersion: item.version,
      newVersion: updated.version,
      changes: { due_date: { from: item.due_date, to: dueDate } },
    });
    moved += 1;
  }
  return moved;
}

/**
 * Makes `input.assigneeUserId` the holder of the source's only open item of `input.kind`, in `tx`: every open item of
 * another assignee is cancelled (`work_item.cancel`, reason `reassigned`); when the new assignee holds none, one is
 * created through createWorkItemOnce under `input.dedupeKey`, or its first free `#n` variant when that key was used
 * before (A -> B -> A). The caller holds the source row's lock, so reassignments of one source are serialised.
 */
export async function reassignWorkItemOfSubject(
  tx: Tx,
  actor: AuditActor,
  input: WorkItemInput,
): Promise<WorkItemReassignResult> {
  const open = await tx
    .selectFrom("work_item")
    .selectAll()
    .where("organization_id", "=", input.organizationId)
    .where("subject_type", "=", input.subjectType)
    .where("subject_id", "=", input.subjectId)
    .where("kind", "=", input.kind)
    .where("status", "=", "open")
    .orderBy("id")
    .forUpdate()
    .execute();
  const keep = open.find((i) => i.assignee_user_id === input.assigneeUserId);
  const by = actor.actorType === "user" ? actor.actorUserId : null;
  let cancelled = 0;
  for (const item of open) {
    if (item === keep) continue;
    const updated = await tx
      .updateTable("work_item")
      .set((eb) => ({
        status: "cancelled",
        completed_at: null,
        completed_by: null,
        version: eb("version", "+", 1),
        updated_at: eb.fn<Date>("now", []),
        updated_by: by,
      }))
      .where("id", "=", item.id)
      .where("version", "=", item.version)
      .returning("version")
      .executeTakeFirstOrThrow();
    await insertAuditEvent(tx, actor, {
      action: "work_item.cancel",
      recordType: "work_item",
      recordId: item.id,
      organizationId: item.organization_id,
      transformationId: item.transformation_id,
      priorVersion: item.version,
      newVersion: updated.version,
      reason: "reassigned",
      changes: { status: { from: "open", to: "cancelled" } },
    });
    cancelled += 1;
  }
  if (keep) return { outcome: cancelled > 0 ? "reassigned" : "unchanged", workItemId: keep.id, cancelled };
  for (let n = 1; n <= MAX_REASSIGN_KEYS; n += 1) {
    const dedupeKey = n === 1 ? input.dedupeKey : `${input.dedupeKey}#${n}`;
    const r = await createWorkItemOnce(tx, actor, { ...input, dedupeKey });
    if (r.outcome === "created") return { outcome: "reassigned", workItemId: r.workItemId, cancelled };
  }
  throw new Error(`reassignWorkItemOfSubject: no free dedupe key after ${MAX_REASSIGN_KEYS} tries: ${input.dedupeKey}`);
}

// ---------------------------------------------------------------------------------------------------------------
// The failure queue (ADR-0043 §5; REQ-S12-002, REQ-S12-020; p5-work-split §D.3; T-DG5-BE-I). operational_failure holds
// the work an administrator must see and can repair:
//  - captureJobFailure: a job of ANY domain queue that failed on its LAST pg-boss attempt (worker.ts calls it before it
//    rethrows, so the job still reaches ops.failed as in DG4). Its idempotency key is the envelope's key for an outbox
//    job, `<schedule code>:<ISO minute of the slot>` for a scheduled job, else `job:<pg-boss job id>`. One open row per
//    (source, queue, key) (0074 operational_failure_one_open_key): a later failure of the same key adds its attempts.
//    With an organization (an outbox job), it also writes the internal `job.failed` outbox event (ADR-0043 §7).
//  - settleRetriedJob: a job that succeeded resolves the `retrying` row of its key (or of its retry job id).
//  - recordExecutionOutcome: a rule execution that finished `failed` (automation.action_forbidden at once, never
//    retried; automation.retries_exhausted; automation.action_failed) enters the queue in the SAME transaction as its
//    status; a retried execution that succeeds resolves its row, and one that fails again reopens it.
// Every row written has its audit event in the same transaction (actor `service`, source `worker`). Nothing here
// decides anything: a failure is shown and repaired by a person (retry or dismiss, apps/api automation/failures.ts).
export const FAILURE_RETRY_QUEUE = "automation.failure_retry";
export const JOB_FAILED_QUEUE = "automation.job_failed";
export const JOB_FAILED_EVENT = "job.failed";
export const RETRY_REQUESTED_EVENT = "automation_failure.retry_requested";
export const RETRIES_EXHAUSTED_CODE = "automation.retries_exhausted";
/** ADR-0016 §6 / apps/api platform/advisory-locks.ts `failureRepair` (the worker imports no API code). */
export const FAILURE_REPAIR_LOCK = 730259;

const OPEN_STATES = ["open", "retrying"] as const;

/** The deterministic pg-boss id of the job a failure's n-th retry sends (UUID layout over SHA-256; replay-safe). */
export function failureRetryJobId(failureId: string, retryCount: number): string {
  const h = createHash("sha256").update(`failure-retry\n${failureId}\n${retryCount}`, "utf8").digest();
  h[6] = (h[6]! & 0x0f) | 0x80;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

function messageOf(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  const s = m.trim().length > 0 ? m : "error";
  return s.length > 2000 ? s.slice(0, 2000) : s;
}

async function lockFailure(tx: Tx, key: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(${FAILURE_REPAIR_LOCK}::integer, hashtext(${key}::text))`.execute(tx);
}

export interface FailedJob {
  readonly queue: string;
  readonly jobId: string;
  readonly data: unknown;
  /** pg-boss `createdOn` of the job (the slot of a scheduled job). */
  readonly createdOn?: Date | null;
  /** How many attempts the job made (retryCount + 1). */
  readonly attempts: number;
  readonly error: unknown;
}

interface JobIdentity {
  readonly organizationId: string | null;
  readonly idempotencyKey: string;
  readonly jobScheduleCode: string | null;
}

const ENVELOPE_KEYS = ["outboxEventId", "eventType", "schemaVersion", "idempotencyKey", "organizationId", "payload"];

/** The failure-queue identity of a job: its envelope key, its schedule slot, or its own id. */
async function jobIdentity(db: Db | Tx, job: Pick<FailedJob, "queue" | "jobId" | "data" | "createdOn">) {
  const d = job.data;
  if (d !== null && typeof d === "object" && !Array.isArray(d)) {
    const m = new Map(Object.entries(d as Record<string, unknown>));
    const key = m.get("idempotencyKey");
    const org = m.get("organizationId");
    if (ENVELOPE_KEYS.every((k) => m.has(k)) && typeof key === "string" && key.length >= 1 && key.length <= 200)
      return {
        organizationId: typeof org === "string" && /^[0-9a-f-]{36}$/i.test(org) ? org : null,
        idempotencyKey: key,
        jobScheduleCode: null,
      } satisfies JobIdentity;
  }
  const schedule = await db
    .selectFrom("job_schedule")
    .select("code")
    .where("queue_name", "=", job.queue)
    .orderBy("code")
    .executeTakeFirst();
  if (schedule !== undefined) {
    const slot = (job.createdOn ?? new Date()).toISOString().slice(0, 16);
    return { organizationId: null, idempotencyKey: `${schedule.code}:${slot}`, jobScheduleCode: schedule.code };
  }
  return { organizationId: null, idempotencyKey: `job:${job.jobId}`, jobScheduleCode: null } satisfies JobIdentity;
}

async function nextFailureId(tx: Tx): Promise<string> {
  return uuidv7(tx);
}

export interface CaptureResult {
  readonly failureId: string;
  readonly outcome: "opened" | "updated" | "reopened";
}

/**
 * The LAST attempt of a job failed: open (or update, or reopen) its failure-queue row, with its audit event, and the
 * `job.failed` event when the job names an organization. Never throws for a duplicate (one open row per key).
 */
export async function captureJobFailure(db: Db, job: FailedJob): Promise<CaptureResult> {
  const id = await jobIdentity(db, job);
  const retryIds = <R extends { id: string; retry_count: number }>(rows: readonly R[]): R | undefined =>
    rows.find((r) => r.retry_count > 0 && failureRetryJobId(r.id, r.retry_count) === job.jobId);
  return db.transaction().execute(async (tx) => {
    await lockFailure(tx, `job:${job.queue}:${id.idempotencyKey}`);
    const actor = jobActor(job.jobId);
    const open = await tx
      .selectFrom("operational_failure")
      .selectAll()
      .where("source", "=", "job")
      .where("queue_name", "=", job.queue)
      .where("status", "in", [...OPEN_STATES])
      .forUpdate()
      .execute();
    const current = open.find((r) => r.idempotency_key === id.idempotencyKey) ?? retryIds(open);
    const message = messageOf(job.error);
    const attempts = Math.max(1, Math.min(100, job.attempts));
    let result: CaptureResult;
    if (current === undefined) {
      const failureId = await nextFailureId(tx);
      await tx
        .insertInto("operational_failure")
        .values({
          id: failureId,
          source: "job",
          organization_id: id.organizationId,
          automation_execution_id: null,
          job_schedule_code: id.jobScheduleCode,
          queue_name: job.queue,
          job_id: job.jobId,
          idempotency_key: id.idempotencyKey,
          job_data: JSON.stringify(
            job.data !== null && typeof job.data === "object" && !Array.isArray(job.data) ? job.data : {},
          ),
          error_code: RETRIES_EXHAUSTED_CODE,
          error_message: message,
          attempts,
          first_failed_at: sql<Date>`now()`,
          last_failed_at: sql<Date>`now()`,
        })
        .execute();
      await insertAuditEvent(tx, actor, {
        action: "operational_failure.create",
        recordType: "operational_failure",
        recordId: failureId,
        organizationId: id.organizationId,
        newVersion: 1,
        changes: {
          source: { from: null, to: "job" },
          queue_name: { from: null, to: job.queue },
          idempotency_key: { from: null, to: id.idempotencyKey },
          status: { from: null, to: "open" },
        },
      });
      result = { failureId, outcome: "opened" };
    } else {
      const reopen = current.status === "retrying";
      const updated = await tx
        .updateTable("operational_failure")
        .set({
          status: "open",
          attempts: Math.min(100, current.attempts + attempts),
          last_failed_at: sql<Date>`now()`,
          error_message: message,
          job_id: job.jobId,
          version: current.version + 1,
          updated_at: sql<Date>`now()`,
        })
        .where("id", "=", current.id)
        .where("version", "=", current.version)
        .returning("version")
        .executeTakeFirstOrThrow();
      await insertAuditEvent(tx, actor, {
        action: reopen ? "operational_failure.reopen" : "operational_failure.fail_again",
        recordType: "operational_failure",
        recordId: current.id,
        organizationId: current.organization_id,
        priorVersion: current.version,
        newVersion: updated.version,
        changes: {
          status: { from: current.status, to: "open" },
          attempts: { from: current.attempts, to: Math.min(100, current.attempts + attempts) },
        },
      });
      result = { failureId: current.id, outcome: reopen ? "reopened" : "updated" };
    }
    // ADR-0043 §7: the internal job.failed event (starter 16, M0239), only when the job names an organization (an
    // outbox row needs one) and never for the consumer of job.failed itself (no failure loop).
    if (id.organizationId !== null && job.queue !== JOB_FAILED_QUEUE)
      await insertOutboxRow(tx, {
        organizationId: id.organizationId,
        aggregateType: "operational_failure",
        aggregateId: result.failureId,
        eventType: JOB_FAILED_EVENT,
        payload: { queueName: job.queue, jobScheduleCode: id.jobScheduleCode, failureId: result.failureId },
        idempotencyKey: `${JOB_FAILED_EVENT}:${result.failureId}:${job.jobId}`,
      });
    return result;
  });
}

/** A job succeeded: the `retrying` failure of its key (or whose retry sent this job id) is resolved. */
export async function settleRetriedJob(
  db: Db,
  job: Pick<FailedJob, "queue" | "jobId" | "data" | "createdOn">,
): Promise<string | null> {
  const retrying = await db
    .selectFrom("operational_failure")
    .select(["id", "idempotency_key", "retry_count"])
    .where("source", "=", "job")
    .where("queue_name", "=", job.queue)
    .where("status", "=", "retrying")
    .execute();
  if (retrying.length === 0) return null;
  const id = await jobIdentity(db, job);
  const match = retrying.find(
    (r) => r.idempotency_key === id.idempotencyKey || failureRetryJobId(r.id, r.retry_count) === job.jobId,
  );
  if (match === undefined) return null;
  return db.transaction().execute(async (tx) => {
    await lockFailure(tx, match.id);
    const cur = await tx
      .selectFrom("operational_failure")
      .selectAll()
      .where("id", "=", match.id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (cur.status !== "retrying") return null;
    await resolveRow(tx, jobActor(job.jobId), cur);
    return cur.id;
  });
}

async function resolveRow(
  tx: Tx,
  actor: AuditActor,
  cur: { id: string; version: number; organization_id: string | null },
): Promise<void> {
  const updated = await tx
    .updateTable("operational_failure")
    .set({ status: "resolved", resolved_at: sql<Date>`now()`, version: cur.version + 1, updated_at: sql<Date>`now()` })
    .where("id", "=", cur.id)
    .where("version", "=", cur.version)
    .returning("version")
    .executeTakeFirstOrThrow();
  await insertAuditEvent(tx, actor, {
    action: "operational_failure.resolve",
    recordType: "operational_failure",
    recordId: cur.id,
    organizationId: cur.organization_id,
    priorVersion: cur.version,
    newVersion: updated.version,
    changes: { status: { from: "retrying", to: "resolved" } },
  });
}

export interface ExecutionOutcome {
  readonly executionId: string;
  readonly organizationId: string;
  /** The queue that ran the execution (automation.evaluate, a tick queue, or a starter's own queue). */
  readonly queueName: string;
  readonly status: "succeeded" | "skipped" | "failed";
  readonly errorCode: string | null;
  readonly errorDetail: string | null;
}

/** ADR-0043 §9: the English texts of the execution error codes (the queue shows them translated by code). */
const EXECUTION_ERROR_TEXT: ReadonlyMap<string, string> = new Map([
  [
    "automation.action_forbidden",
    "The acting identity lacks the permission for this action, or its target is outside the rule's scope.",
  ],
  ["automation.action_failed", "The action failed; see the error message."],
  [RETRIES_EXHAUSTED_CODE, "The retries ran out; the work is in the failure queue."],
]);

/** The failure-queue key of a rule execution (unique per (rule version, trigger key), so per execution). */
export const executionFailureKey = (executionId: string) => `execution:${executionId}`;

/**
 * Called in the transaction that finishes an execution (engine.ts finishExecution): `failed` opens (or reopens) its
 * failure-queue row at once; a success of a retried execution resolves its row. Same transaction, so the queue and the
 * execution's status never disagree.
 */
export async function recordExecutionOutcome(tx: Tx, actor: AuditActor, o: ExecutionOutcome): Promise<void> {
  const key = executionFailureKey(o.executionId);
  await lockFailure(tx, `rule_execution:${key}`);
  const current = await tx
    .selectFrom("operational_failure")
    .selectAll()
    .where("source", "=", "rule_execution")
    .where("automation_execution_id", "=", o.executionId)
    .where("status", "in", [...OPEN_STATES])
    .forUpdate()
    .executeTakeFirst();
  if (o.status !== "failed") {
    if (current !== undefined && current.status === "retrying") await resolveRow(tx, actor, current);
    return;
  }
  const errorCode = o.errorCode ?? "automation.action_failed";
  const message = messageOf(o.errorDetail ?? EXECUTION_ERROR_TEXT.get(errorCode) ?? errorCode);
  if (current === undefined) {
    const failureId = await nextFailureId(tx);
    await tx
      .insertInto("operational_failure")
      .values({
        id: failureId,
        source: "rule_execution",
        organization_id: o.organizationId,
        automation_execution_id: o.executionId,
        job_schedule_code: null,
        queue_name: o.queueName,
        job_id: actor.requestId?.startsWith("job:") ? actor.requestId.slice(4).slice(0, 100) : null,
        idempotency_key: key,
        job_data: "{}",
        error_code: errorCode,
        error_message: message,
        attempts: 1,
        first_failed_at: sql<Date>`now()`,
        last_failed_at: sql<Date>`now()`,
      })
      .execute();
    await insertAuditEvent(tx, actor, {
      action: "operational_failure.create",
      recordType: "operational_failure",
      recordId: failureId,
      organizationId: o.organizationId,
      newVersion: 1,
      changes: {
        source: { from: null, to: "rule_execution" },
        automation_execution_id: { from: null, to: o.executionId },
        error_code: { from: null, to: errorCode },
        status: { from: null, to: "open" },
      },
    });
    return;
  }
  const updated = await tx
    .updateTable("operational_failure")
    .set({
      status: "open",
      attempts: Math.min(100, current.attempts + 1),
      error_code: errorCode,
      error_message: message,
      last_failed_at: sql<Date>`now()`,
      version: current.version + 1,
      updated_at: sql<Date>`now()`,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returning("version")
    .executeTakeFirstOrThrow();
  await insertAuditEvent(tx, actor, {
    action: current.status === "retrying" ? "operational_failure.reopen" : "operational_failure.fail_again",
    recordType: "operational_failure",
    recordId: current.id,
    organizationId: current.organization_id,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: {
      status: { from: current.status, to: "open" },
      error_code: { from: current.error_code, to: errorCode },
    },
  });
}

/** An outbox row written by the worker (the twin of the API's enqueueOutboxEvent; the payload is validated). */
async function insertOutboxRow(
  tx: Tx,
  e: {
    organizationId: string;
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    payload: Record<string, unknown>;
    idempotencyKey: string;
  },
): Promise<void> {
  const schema = outboxPayloadSchema(e.eventType, 1);
  if (!schema) throw new Error(`outbox: no schema for ${e.eventType} v1`);
  const payload = schema.parse(e.payload) as Record<string, unknown>;
  await tx
    .insertInto("outbox_event")
    .values({
      id: await uuidv7(tx),
      organization_id: e.organizationId,
      aggregate_type: e.aggregateType,
      aggregate_id: e.aggregateId,
      event_type: e.eventType,
      schema_version: 1,
      payload: JSON.stringify(payload),
      idempotency_key: e.idempotencyKey,
    })
    .execute();
}

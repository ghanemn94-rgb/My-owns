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
import { insertAuditEvent, sql, type AuditActor, type Db, type DbOrTx, type Tx } from "@mth/db";
import { DEFAULTS, type Permission } from "@mth/shared";
import {
  decideDelivery,
  hhmm,
  NO_DELIVERY_SETTINGS,
  outboxPayloadSchema,
  type DeliveryInput,
  type DeliverySettings,
  type DigestMode,
} from "@mth/shared/schemas";
// T-DG6-BE-J (ADR-0053 §1): the job identity declarations and the service principal.
import type { JobAttempt, JobHandler } from "./handlers/spec.ts";
import {
  isServiceIdentityError,
  ServiceIdentityMissing,
  ServiceScopeViolation,
  type SensitiveAccess,
  type ServicePrincipal,
} from "./service-scope.ts";

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
  // T-DG5-BE-L (ADR-0044 §5; REQ-S12-025): the twin of the API's delivery lines (tasks/service.ts).
  const delivery = decideDelivery(
    new Date(),
    await loadDeliveryInput(tx, {
      organizationId: input.organizationId,
      userId: input.assigneeUserId,
      kind: input.kind,
    }),
  );
  const urgency = delivery.reason === "urgent" ? "urgent" : "normal";
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
      urgency, // T-DG5-BE-L
      delivery_state: delivery.state, // T-DG5-BE-L
      deliver_after: delivery.deliverAfter, // T-DG5-BE-L
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
        delivery_state: { from: null, to: delivery.state }, // T-DG5-BE-L
        deliver_after: { from: null, to: delivery.deliverAfter?.toISOString() ?? null }, // T-DG5-BE-L
      },
    });
  return { outcome: "created", workItemId: id };
}

// ---------------------------------------------------------------------------------------------------------------
// T-DG5-BE-L (ADR-0044 §5; REQ-S12-025): the twin of apps/api tasks/notification-policy.ts `effectiveSettingsOf` and
// `loadDeliveryInput` (the worker imports no API code). Own preference row, else the organization defaults (in the
// user's time zone: profile, else organization default, else Asia/Riyadh), else none; the organization's business-day
// rule with its active default calendar. Reads only. The parity test in
// apps/api/test/integration/tasks/notification-delivery.test.ts proves both write the same rows.
const DEFAULT_DIGEST_TIME = "08:00";

export interface EffectiveDeliverySettings {
  readonly own: DeliverySettings | null;
  readonly effective: DeliverySettings;
  readonly workingDaysOnly: boolean;
}

export async function effectiveDeliverySettings(db: DbOrTx, userId: string): Promise<EffectiveDeliverySettings> {
  const u = await db
    .selectFrom("app_user as u")
    .innerJoin("organization as o", "o.id", "u.organization_id")
    .select(["u.organization_id", "u.timezone", "o.default_timezone"])
    .where("u.id", "=", userId)
    .executeTakeFirstOrThrow();
  const timezone = u.timezone ?? u.default_timezone ?? DEFAULTS.timezone;
  const own = await db
    .selectFrom("notification_preference")
    .selectAll()
    .where("user_id", "=", userId)
    .executeTakeFirst();
  const policy = await db
    .selectFrom("notification_policy")
    .selectAll()
    .where("organization_id", "=", u.organization_id)
    .executeTakeFirst();
  const ownSettings: DeliverySettings | null = own
    ? {
        quietHoursStart: own.quiet_hours_start === null ? null : hhmm(own.quiet_hours_start),
        quietHoursEnd: own.quiet_hours_end === null ? null : hhmm(own.quiet_hours_end),
        timezone: own.timezone,
        digestMode: own.digest_mode as DigestMode,
        digestTime: hhmm(own.digest_time),
      }
    : null;
  const effective: DeliverySettings =
    ownSettings ??
    (policy
      ? {
          quietHoursStart: policy.default_quiet_hours_start === null ? null : hhmm(policy.default_quiet_hours_start),
          quietHoursEnd: policy.default_quiet_hours_end === null ? null : hhmm(policy.default_quiet_hours_end),
          timezone,
          digestMode: policy.default_digest_mode as DigestMode,
          digestTime: DEFAULT_DIGEST_TIME,
        }
      : NO_DELIVERY_SETTINGS(timezone));
  return { own: ownSettings, effective, workingDaysOnly: policy?.non_urgent_working_days_only ?? false };
}

export async function loadDeliveryInput(
  db: DbOrTx,
  input: { readonly organizationId: string; readonly userId: string; readonly kind: string },
): Promise<DeliveryInput> {
  const kind = await db
    .selectFrom("work_item_kind")
    .select("urgency")
    .where("code", "=", input.kind)
    .executeTakeFirst();
  const urgency = kind?.urgency === "urgent" ? "urgent" : "normal";
  const { effective, workingDaysOnly: enabled } = await effectiveDeliverySettings(db, input.userId);
  const calendar = enabled
    ? await db
        .selectFrom("business_calendar")
        .select(["id", "workweek", "timezone"])
        .where("organization_id", "=", input.organizationId)
        .where("is_default", "=", true)
        .where("status", "=", "active")
        .executeTakeFirst()
    : undefined;
  const holidays = calendar
    ? await db
        .selectFrom("business_calendar_holiday")
        .select([sql<string>`date_from::text`.as("date_from"), sql<string>`date_to::text`.as("date_to")])
        .where("calendar_id", "=", calendar.id)
        .where("status", "=", "active")
        .orderBy("date_from")
        .execute()
    : [];
  return {
    urgency,
    settings: effective,
    workingDays: {
      enabled,
      calendar: calendar
        ? {
            workweek: calendar.workweek.map(Number),
            holidays: holidays.map((h) => ({ dateFrom: h.date_from, dateTo: h.date_to })),
          }
        : null,
      timezone: calendar?.timezone ?? effective.timezone,
    },
  };
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
  const m = redactErrorText(err instanceof Error ? err.message : String(err)); // T-DG6-BE-K (ADR-0053 §4 item 4)
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
          error_code: failureCodeOf(job.error), // T-DG6-BE-J: service_identity.* (ADR-0053 §1), else retries exhausted
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
          error_code: failureCodeOf(job.error), // T-DG6-BE-J (ADR-0053 §1)
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
    // T-DG6-BE-K (ADR-0053 §2): the job's operational exception, in the same transaction, once per failed job (a replay
    // of the same pg-boss job id finds its ledger row and recurs nothing).
    await raiseJobException(tx, actor, job, id.organizationId, result.failureId, message);
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

/**
 * A job succeeded: the `retrying` failure of its key (or whose retry sent this job id) is resolved, and (T-DG6-BE-K,
 * ADR-0053 §2) the active `job_failed` exception of its queue and organization is resolved `recovered`.
 */
export async function settleRetriedJob(
  db: Db,
  job: Pick<FailedJob, "queue" | "jobId" | "data" | "createdOn">,
): Promise<string | null> {
  const settled = await settleRetriedFailure(db, job);
  await recoverJobException(db, job);
  return settled;
}

async function settleRetriedFailure(
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

// ---------------------------------------------------------------------------------------------------------------
// Operational exceptions (ADR-0053 §2, §4, §8; REQ-S12-019; p6-work-split §J/C.3; T-DG6-BE-K). The worker twin of
// apps/api/src/modules/operations/exceptions.ts `raiseOperationalException` / `recoverOperationalException` (ADR-0002
// rule 5: the worker imports no API code; apps/api/test/integration/operations/exceptions.test.ts compares the rows the
// two write). One ACTIVE exception per (organization, source kind, source code, failure class): lock 730305 on
// "<organizationId or 'platform'>:<dedupKey>", then recur the active row or insert a new one, with one audit event, in
// the transaction of the failure it reports. A resolved exception is final; a new failure opens a new one.
//  - raiseJobException: called by captureJobFailure after the operational_failure write (the LAST attempt failed).
//    The processed_message ledger (consumer `operations.job_failed`, key `<queue>:<pg-boss job id>`) makes a replay of
//    the same failed job a no-op.
//  - recoverJobException: called on every success (settleRetriedJob): the queue's active exception for the job's
//    organization (NULL for a scheduled job) is resolved `recovered`, with no user.
// The in-app alert on opening (ADR-0053 §6) is BE-K2's; `raiseOperationalExceptionTwin` returns `opened` for it.
/** ADR-0016 §6 / apps/api platform/advisory-locks.ts `operationalExceptionUpsert` (the worker imports no API code). */
export const OPERATIONAL_EXCEPTION_LOCK = 730305;
export const JOB_EXCEPTION_LEDGER = "operations.job_failed";

export interface ExceptionKey {
  readonly organizationId: string | null;
  readonly sourceKind: "job" | "connector" | "data_freshness" | "worker";
  readonly sourceCode: string;
  readonly failureClass:
    | "job_failed"
    | "connector_run_failed"
    | "connector_unreachable"
    | "connector_credentials_rejected"
    | "data_stale"
    | "heartbeat_missed";
}

export interface RaiseExceptionTwinInput extends ExceptionKey {
  readonly errorCode: string;
  /** Redacted here before it is stored (ADR-0053 §4 item 4). */
  readonly errorMessage: string;
  readonly serviceIdentityId?: string | null;
  readonly operationalFailureId?: string | null;
  readonly kpiLinks?: readonly { readonly kpiDefinitionId: string; readonly transformationId: string }[];
}

export interface RaiseTwinResult {
  readonly exceptionId: string;
  readonly outcome: "opened" | "recurred";
}

/**
 * ADR-0053 §4: the redaction applied to an error text before it is stored in operational_exception.last_error_message
 * and operational_failure.error_message. It removes private keys, access-key ids, AWS signature parameters, bearer
 * tokens, JWTs, the deep-link token segment, URL credentials and the OIDC code/state/token parameters. The process-wide
 * set of SecretProvider values is DO-D's (packages/config, ADR-0053 §4 item 1) and applies to log lines.
 */
export function redactErrorText(text: string): string {
  return text
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, "[secret]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[secret]")
    .replace(/(X-Amz-(?:Signature|Credential|Security-Token))=[^&\s"']*/gi, "$1=[secret]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/g, "Bearer [secret]")
    .replace(/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]*)?/g, "[secret]")
    .replace(/\/links\/[A-Za-z0-9_-]{20,}/g, "/links/[token]")
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[secret]@")
    .replace(/([?&](?:code|state|id_token|access_token|refresh_token|password|secret)=)[^&\s"']*/gi, "$1[secret]");
}

const exceptionDedupKey = (k: ExceptionKey): string => `${k.sourceKind}:${k.sourceCode}:${k.failureClass}`;

async function lockException(tx: Tx, k: ExceptionKey): Promise<string> {
  const dedupKey = exceptionDedupKey(k);
  await sql`SELECT pg_advisory_xact_lock(${OPERATIONAL_EXCEPTION_LOCK}::integer, hashtext(${`${k.organizationId ?? "platform"}:${dedupKey}`}::text))`.execute(
    tx,
  );
  return dedupKey;
}

async function activeExceptionOf(tx: Tx, organizationId: string | null, dedupKey: string) {
  return tx
    .selectFrom("operational_exception")
    .selectAll()
    .where(sql<boolean>`organization_id IS NOT DISTINCT FROM ${organizationId}::uuid`)
    .where("dedup_key", "=", dedupKey)
    .where("status", "in", ["open", "acknowledged"])
    .forUpdate()
    .executeTakeFirst();
}

/** The twin of the API's raiseOperationalException (same rows, same audit actions; actor `actor`). */
export async function raiseOperationalExceptionTwin(
  tx: Tx,
  actor: AuditActor,
  input: RaiseExceptionTwinInput,
): Promise<RaiseTwinResult> {
  const dedupKey = await lockException(tx, input);
  const redacted = redactErrorText(input.errorMessage);
  const message = (redacted.trim().length > 0 ? redacted : "error").slice(0, 2000);
  const current = await activeExceptionOf(tx, input.organizationId, dedupKey);
  let result: RaiseTwinResult;
  if (current === undefined) {
    const id = await uuidv7(tx);
    const row = await tx
      .insertInto("operational_exception")
      .values({
        id,
        organization_id: input.organizationId,
        source_kind: input.sourceKind,
        source_code: input.sourceCode,
        failure_class: input.failureClass,
        dedup_key: dedupKey,
        service_identity_id: input.serviceIdentityId ?? null,
        operational_failure_id: input.operationalFailureId ?? null,
        first_occurred_at: sql<Date>`now()`,
        last_occurred_at: sql<Date>`now()`,
        last_error_code: input.errorCode,
        last_error_message: message,
        created_by: actor.actorUserId,
        updated_by: actor.actorUserId,
      })
      .returning(["id", "version"])
      .executeTakeFirstOrThrow();
    await insertAuditEvent(tx, actor, {
      action: "operational_exception.opened",
      recordType: "operational_exception",
      recordId: row.id,
      organizationId: input.organizationId,
      newVersion: row.version,
      changes: {
        dedup_key: { from: null, to: dedupKey },
        status: { from: null, to: "open" },
        last_error_code: { from: null, to: input.errorCode },
        ...(input.kpiLinks && input.kpiLinks.length > 0
          ? { kpi_definition_ids: { from: null, to: input.kpiLinks.map((k) => k.kpiDefinitionId) } }
          : {}),
      },
    });
    result = { exceptionId: row.id, outcome: "opened" };
  } else {
    const updated = await tx
      .updateTable("operational_exception")
      .set({
        occurrence_count: current.occurrence_count + 1,
        last_occurred_at: sql<Date>`greatest(now(), ${current.last_occurred_at}::timestamptz)`,
        last_error_code: input.errorCode,
        last_error_message: message,
        ...(input.operationalFailureId ? { operational_failure_id: input.operationalFailureId } : {}),
        version: current.version + 1,
        updated_at: sql<Date>`now()`,
        updated_by: actor.actorUserId,
      })
      .where("id", "=", current.id)
      .where("version", "=", current.version)
      .returning("version")
      .executeTakeFirstOrThrow();
    await insertAuditEvent(tx, actor, {
      action: "operational_exception.recurred",
      recordType: "operational_exception",
      recordId: current.id,
      organizationId: current.organization_id,
      priorVersion: current.version,
      newVersion: updated.version,
      changes: {
        occurrence_count: { from: current.occurrence_count, to: current.occurrence_count + 1 },
        last_error_code: { from: current.last_error_code, to: input.errorCode },
      },
    });
    result = { exceptionId: current.id, outcome: "recurred" };
  }
  if (input.organizationId !== null)
    for (const k of input.kpiLinks ?? [])
      await tx
        .insertInto("operational_exception_kpi")
        .values({
          id: await uuidv7(tx),
          operational_exception_id: result.exceptionId,
          organization_id: input.organizationId,
          transformation_id: k.transformationId,
          kpi_definition_id: k.kpiDefinitionId,
        })
        .onConflict((oc) => oc.columns(["operational_exception_id", "kpi_definition_id"]).doNothing())
        .execute();
  return result;
}

/** The twin of the API's recoverOperationalException: the active exception, if any, resolved `recovered`. */
export async function recoverOperationalExceptionTwin(
  tx: Tx,
  actor: AuditActor,
  key: ExceptionKey,
): Promise<string | null> {
  const dedupKey = await lockException(tx, key);
  const current = await activeExceptionOf(tx, key.organizationId, dedupKey);
  if (current === undefined) return null;
  const updated = await tx
    .updateTable("operational_exception")
    .set({
      status: "resolved",
      resolved_at: sql<Date>`now()`,
      resolution: "recovered",
      version: current.version + 1,
      updated_at: sql<Date>`now()`,
      updated_by: null,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returning("version")
    .executeTakeFirstOrThrow();
  await insertAuditEvent(tx, actor, {
    action: "operational_exception.resolved",
    recordType: "operational_exception",
    recordId: current.id,
    organizationId: current.organization_id,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: { status: { from: current.status, to: "resolved" }, resolution: { from: null, to: "recovered" } },
  });
  return current.id;
}

const jobExceptionKey = (queue: string, organizationId: string | null): ExceptionKey => ({
  organizationId,
  sourceKind: "job",
  sourceCode: queue,
  failureClass: "job_failed",
});

/** The failure hook: open or recur the queue's `job_failed` exception, once per failed pg-boss job. */
async function raiseJobException(
  tx: Tx,
  actor: AuditActor,
  job: FailedJob,
  organizationId: string | null,
  failureId: string,
  message: string,
): Promise<RaiseTwinResult | null> {
  const ledger = await tx
    .insertInto("processed_message")
    .values({
      consumer: JOB_EXCEPTION_LEDGER,
      idempotency_key: `${job.queue}:${job.jobId}`.slice(0, 200),
      outcome: "done",
    })
    .onConflict((oc) => oc.doNothing())
    .returning("consumer")
    .executeTakeFirst();
  if (!ledger) return null;
  const identity = await tx
    .selectFrom("service_identity")
    .select("id")
    .where("code", "=", jobIdentityCode(job.queue))
    .executeTakeFirst();
  return raiseOperationalExceptionTwin(tx, actor, {
    ...jobExceptionKey(job.queue, organizationId),
    errorCode: failureCodeOf(job.error),
    errorMessage: message,
    serviceIdentityId: identity?.id ?? null,
    operationalFailureId: failureId,
  });
}

/** Recovery on success: only when the queue has an active `job_failed` exception (one indexed read otherwise). */
async function recoverJobException(db: Db, job: Pick<FailedJob, "queue" | "jobId" | "data" | "createdOn">) {
  const active = await db
    .selectFrom("operational_exception")
    .select("id")
    .where("dedup_key", "=", `job:${job.queue}:job_failed`)
    .where("status", "in", ["open", "acknowledged"])
    .limit(1)
    .executeTakeFirst();
  if (active === undefined) return null;
  const id = await jobIdentity(db, job);
  return db
    .transaction()
    .execute((tx) =>
      recoverOperationalExceptionTwin(tx, jobActor(job.jobId), jobExceptionKey(job.queue, id.organizationId)),
    );
}

// ---------------------------------------------------------------------------------------------------------------
// Service identities of the job queues (ADR-0053 §1; REQ-S16-029; D-195 Q13; T-DG6-BE-J). Every queue of
// apps/worker/src/queues/** declares ONE identity here: the read codes its DG4/DG5 handler already needs (the narrowest
// set; never a configure, business-approval or Finance-validation code, which the 0101 guard refuses anyway), platform
// scope (the job iterates organizations and builds one principal per organization), and whether sensitive records may
// enter its aggregates (`aggregate_only`) or not at all (`none`). Migration 0114 seeds the same rows (one per queue,
// audited, actor system, source migration); service-identities.test.ts requires the two to be equal. A queue added
// later declares its identity in the same change and seeds it in a new migration (0115 the search jobs, 0116 the
// operations jobs). Administrators can only narrow or restore the GRANT (putServiceIdentity); the declaration changes
// only through a migration.
// At run time a job loads its row (`servicePrincipal`, or the context `defineJob` passes): a missing row fails the run
// with `service_identity.missing`; a read outside the grant or the organization fails it with
// `service_identity.out_of_scope` (`requireServiceRead`, service-scope.ts). The failure-queue row carries that code.
export {
  isServiceIdentityError,
  requireServiceRead,
  serviceReadScopeFor,
  ServiceIdentityError,
  ServiceIdentityMissing,
  ServiceScopeViolation,
  SERVICE_IDENTITY_MISSING,
  SERVICE_IDENTITY_OUT_OF_SCOPE,
  type ServicePrincipal,
  type ServiceReadRow,
  type ServiceReadScope,
  type ServiceReadScopeColumns,
  type ServiceReadUse,
} from "./service-scope.ts";

/** The failure-queue error code of a job error: the service-identity code, else retries exhausted. */
function failureCodeOf(err: unknown): string {
  return isServiceIdentityError(err) ? err.code : RETRIES_EXHAUSTED_CODE;
}

/** What a job identity declares (ADR-0053 §1 `defineJob({ queue, identity: { permissions, scope, sensitiveAccess } })`). */
export interface JobIdentitySpec {
  readonly permissions: readonly Permission[];
  readonly scope: "platform";
  readonly sensitiveAccess: SensitiveAccess;
}

export interface JobIdentityDeclaration extends JobIdentitySpec {
  readonly queue: string;
  readonly labelEn: string;
  /** Arabic label (provisional wording, like every P6 Arabic text until reviewed). */
  readonly labelAr: string;
}

const TR = "transformation.read" as const;
const declare = (
  queue: string,
  permissions: readonly Permission[],
  labelEn: string,
  labelAr: string,
  sensitiveAccess: SensitiveAccess = "none",
): JobIdentityDeclaration =>
  Object.freeze({
    queue,
    permissions: Object.freeze([...permissions]),
    scope: "platform",
    sensitiveAccess,
    labelEn,
    labelAr,
  });

/** One declaration per queue of apps/worker/src/queues/**, by queue name (40 at T-DG6-BE-J's revision; 42 with T-DG6-BE-P's; 45 with T-DG6-BE-K2's). */
export const JOB_SERVICE_IDENTITIES: readonly JobIdentityDeclaration[] = Object.freeze([
  declare(
    "adoption.indicator_evaluated",
    [TR, "user.read"],
    "Job: adoption indicator evaluation",
    "مهمة: تقييم مؤشرات التبني",
  ),
  declare(
    "approval.escalation_scan",
    [TR, "access.read"],
    "Job: approval escalation scan",
    "مهمة: فحص تصعيد الاعتمادات",
  ),
  declare(
    "automation.evaluate",
    [TR, "automation.read"],
    "Job: automation rule evaluation",
    "مهمة: تقييم قواعد الأتمتة",
  ),
  declare(
    "automation.failure_retry",
    ["automation.read", "job.read"],
    "Job: failure-queue retry",
    "مهمة: إعادة محاولة قائمة الإخفاقات",
  ),
  declare("automation.job_failed", ["job.read"], "Job: job failure recording", "مهمة: تسجيل إخفاق المهام"),
  declare("automation.tick_daily", [TR, "automation.read"], "Job: daily automation tick", "مهمة: دورة الأتمتة اليومية"),
  declare(
    "automation.tick_hourly",
    [TR, "automation.read"],
    "Job: hourly automation tick",
    "مهمة: دورة الأتمتة كل ساعة",
  ),
  declare(
    "benefits.finance_queue",
    [TR, "access.read"],
    "Job: Finance validation queue routing",
    "مهمة: توجيه قائمة التحقق المالي",
  ),
  declare(
    "benefits.recalculate_pending",
    [TR],
    "Job: benefit recalculation",
    "مهمة: إعادة حساب المنافع",
    "aggregate_only",
  ),
  declare(
    "benefits.value_decided",
    [TR],
    "Job: benefit value decision follow-up",
    "مهمة: متابعة قرار قيمة المنفعة",
    "aggregate_only",
  ),
  declare("branding.published", ["organization.read"], "Job: branding publication", "مهمة: نشر الهوية البصرية"),
  declare("delegation.expiry_sweep", ["access.read"], "Job: delegation expiry sweep", "مهمة: إنهاء التفويضات المنتهية"),
  declare("demo.reset", ["organization.read", TR], "Job: demo environment reset", "مهمة: إعادة ضبط بيئة العرض"),
  declare(
    "gate.condition_escalation_scan",
    [TR, "access.read"],
    "Job: gate condition escalation scan",
    "مهمة: فحص تصعيد شروط البوابات",
  ),
  declare("gate.exception_expiry_scan", [TR], "Job: gate exception expiry scan", "مهمة: فحص انتهاء استثناءات البوابات"),
  declare("gates.decided", [TR], "Job: gate decision follow-up", "مهمة: متابعة قرار البوابة"),
  declare("gates.submitted", [TR, "access.read"], "Job: gate submission routing", "مهمة: توجيه تقديم البوابة"),
  declare("governance.blocker_escalation", [TR, "access.read"], "Job: blocker escalation", "مهمة: تصعيد العوائق"),
  declare(
    "governance.blocker_escalation_scan",
    [TR, "access.read"],
    "Job: blocker escalation scan",
    "مهمة: فحص تصعيد العوائق",
  ),
  declare("governance.decision_sla_scan", [TR, "access.read"], "Job: decision SLA scan", "مهمة: فحص مهل القرارات"),
  declare(
    "governance.meeting_cutoff_scan",
    [TR, "access.read"],
    "Job: meeting cut-off scan",
    "مهمة: فحص مواعيد إقفال الاجتماعات",
  ),
  declare("governance.meeting_series_generate", [TR], "Job: meeting series generation", "مهمة: إنشاء سلاسل الاجتماعات"),
  declare("job_schedule.updated", ["job.read"], "Job: schedule re-registration", "مهمة: إعادة تسجيل الجداول"),
  declare("jobs.run_now", ["job.read"], "Job: run-now dispatch", "مهمة: تشغيل المهمة الآن"),
  // T-DG6-BE-K2 (ADR-0053 §2, §6; 0116): the freshness scan, the data.stale consumer and the alert sweep.
  declare(
    "kpi.freshness_scan",
    [TR, "operations.read"],
    "Job: KPI data freshness scan",
    "مهمة: فحص حداثة بيانات مؤشرات الأداء",
  ),
  declare("kpi.recalculate", [TR], "Job: KPI recalculation", "مهمة: إعادة حساب مؤشرات الأداء"),
  declare("kpi.reporting_period_open", [TR], "Job: reporting period opening", "مهمة: فتح فترة التقارير"),
  declare("launch.day_ninety_tests", [TR], "Job: day-90 tests", "مهمة: اختبارات اليوم التسعين"),
  declare("maintenance.purge_expired", [], "Job: expired session purge", "مهمة: حذف الجلسات المنتهية"),
  declare("notification.digest", ["user.read"], "Job: notification digest", "مهمة: ملخص الإشعارات"),
  declare(
    "operations.exception_alerts",
    ["operations.read", "access.read"],
    "Job: operational exception alerts",
    "مهمة: تنبيهات الاستثناءات التشغيلية",
  ),
  declare(
    "operations.exception_raise",
    [TR, "operations.read"],
    "Job: operational exception from stale data",
    "مهمة: استثناء تشغيلي من بيانات متقادمة",
  ),
  declare("ops.failed", [], "Queue: failed jobs (dead letter)", "قائمة: المهام المخفقة"),
  declare("portfolio.dependency_slip", [TR], "Job: dependency slip follow-up", "مهمة: متابعة تأخر الاعتماديات"),
  declare(
    "raid.corrective_adoption",
    [TR, "user.read"],
    "Job: corrective action for adoption",
    "مهمة: إجراء تصحيحي للتبني",
  ),
  declare(
    "raid.corrective_benefit",
    [TR, "user.read"],
    "Job: corrective action for a benefit",
    "مهمة: إجراء تصحيحي لمنفعة",
  ),
  declare(
    "raid.corrective_control",
    [TR, "user.read"],
    "Job: corrective action for a control",
    "مهمة: إجراء تصحيحي لضابط",
  ),
  declare(
    "raid.corrective_kpi",
    [TR, "user.read"],
    "Job: corrective action for a KPI",
    "مهمة: إجراء تصحيحي لمؤشر أداء",
  ),
  declare("reports.export", [TR], "Job: report export", "مهمة: تصدير التقارير"),
  declare("reports.owner_update_tasks", [TR], "Job: owner update tasks", "مهمة: مهام تحديث المالكين"),
  // T-DG6-BE-P (ADR-0057 §2; 0115): the search index jobs. `none` here; their one declared exception (they read the
  // ADR-0057 §1 indexed columns of sensitive records, never a value column) is enforced in search/documents.ts.
  declare("search.index_feed", [TR], "Job: search index feed", "مهمة: تحديث فهرس البحث"),
  declare("search.reindex", [TR], "Job: search reindex", "مهمة: إعادة بناء فهرس البحث"),
  declare("sustainment.control_check_scan", [TR], "Job: control check scan", "مهمة: فحص فحوص الضوابط"),
  declare("sustainment.review_scan", [TR], "Job: performance review scan", "مهمة: فحص مراجعات الأداء"),
  declare(
    "transformation.created",
    [TR, "access.read", "methodology.read"],
    "Job: new transformation set-up",
    "مهمة: إعداد تحول جديد",
  ),
]);

const JOB_IDENTITY_BY_QUEUE: ReadonlyMap<string, JobIdentityDeclaration> = new Map(
  JOB_SERVICE_IDENTITIES.map((d) => [d.queue, d]),
);

/** The declaration of a queue's identity, or undefined when the queue declares none. */
export function jobIdentityDeclaration(queue: string): JobIdentityDeclaration | undefined {
  return JOB_IDENTITY_BY_QUEUE.get(queue);
}

/** The `service_identity.code` of a job queue. */
export const jobIdentityCode = (queue: string): string => `job:${queue}`;

/** A loaded `service_identity` row (what a run needs). */
export interface LoadedServiceIdentity {
  readonly id: string;
  readonly code: string;
  readonly scopeLevel: "platform" | "organization";
  readonly organizationId: string | null;
  readonly grantedPermissionCodes: readonly string[];
  readonly sensitiveAccess: SensitiveAccess;
}

/** Loads a service identity by code; a missing row throws ServiceIdentityMissing (`service_identity.missing`). */
export async function loadServiceIdentity(db: DbOrTx, code: string): Promise<LoadedServiceIdentity> {
  const row = await db
    .selectFrom("service_identity")
    .select(["id", "code", "scope_level", "organization_id", "granted_permission_codes", "sensitive_access"])
    .where("code", "=", code)
    .executeTakeFirst();
  if (row === undefined) throw new ServiceIdentityMissing();
  return {
    id: row.id,
    code: row.code,
    scopeLevel: row.scope_level as "platform" | "organization",
    organizationId: row.organization_id,
    grantedPermissionCodes: Object.freeze([...row.granted_permission_codes]),
    sensitiveAccess: row.sensitive_access as SensitiveAccess,
  };
}

/**
 * The principal of a loaded identity for one organization. A platform identity acts in any organization (one principal
 * per organization); an organization identity (a connector) only in its own, otherwise `service_identity.out_of_scope`.
 */
export function principalOfIdentity(identity: LoadedServiceIdentity, organizationId: string): ServicePrincipal {
  if (identity.scopeLevel === "organization" && identity.organizationId !== organizationId)
    throw new ServiceScopeViolation();
  return Object.freeze({
    kind: "service",
    identityId: identity.id,
    code: identity.code,
    organizationId,
    permissions: new Set(identity.grantedPermissionCodes),
    sensitiveAccess: identity.sensitiveAccess,
  });
}

/** ADR-0053 §1 `servicePrincipal`: loads the queue's identity row and builds its principal for `organizationId`. */
export async function servicePrincipal(db: DbOrTx, queue: string, organizationId: string): Promise<ServicePrincipal> {
  return principalOfIdentity(await loadServiceIdentity(db, jobIdentityCode(queue)), organizationId);
}

/** What `defineJob` passes to a handler: its loaded identity and a principal per organization. */
export interface JobRunContext {
  readonly identity: LoadedServiceIdentity;
  principal(organizationId: string): ServicePrincipal;
}

export interface JobDefinition {
  readonly queue: string;
  /** Optional restatement of the queue's declaration at the definition site; it must equal JOB_SERVICE_IDENTITIES. */
  readonly identity?: JobIdentitySpec;
  readonly handle: (
    db: Db,
    data: unknown,
    jobId: string,
    attempt: JobAttempt | undefined,
    run: JobRunContext,
  ) => Promise<unknown>;
}

const sameSpec = (a: JobIdentitySpec, b: JobIdentitySpec): boolean =>
  a.scope === b.scope &&
  a.sensitiveAccess === b.sensitiveAccess &&
  a.permissions.length === b.permissions.length &&
  [...a.permissions].sort().every((p, i) => p === [...b.permissions].sort()[i]);

/**
 * ADR-0053 §1 `defineJob`: a job handler whose run starts by loading its service identity. A queue without a
 * declaration is a programming error at definition time; a declaration restated here that differs from the registry is
 * one too. At run time a missing identity row fails the run with `service_identity.missing` before the handler runs.
 */
export function defineJob(def: JobDefinition): JobHandler {
  const declared = jobIdentityDeclaration(def.queue);
  if (declared === undefined) throw new Error(`defineJob: queue ${def.queue} declares no service identity`);
  if (def.identity !== undefined && !sameSpec(def.identity, declared))
    throw new Error(`defineJob: the identity of ${def.queue} differs from its declaration in JOB_SERVICE_IDENTITIES`);
  return Object.freeze({
    queue: def.queue,
    handle: async (db: Db, data: unknown, jobId: string, attempt?: JobAttempt) => {
      const identity = await loadServiceIdentity(db, jobIdentityCode(def.queue));
      return def.handle(db, data, jobId, attempt, {
        identity,
        principal: (organizationId) => principalOfIdentity(identity, organizationId),
      });
    },
  });
}

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
// Rules: idempotency keys are deterministic, `<rule>:<subject id>:<slot>[:<recipient>]`; no remote I/O inside `fn`;
// audit actor `service` with source `worker` (JOB_ACTOR); a service actor holds no permission and never decides a
// business approval. Retries and the failure queue are ADR-0008 §4's (5 attempts, then ops.failed).
import { insertAuditEvent, sql, type AuditActor, type Db, type Tx } from "@mth/db";

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

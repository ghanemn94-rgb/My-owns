// createWorkItemOnce (ADR-0025 §4; REQ-S12-005, REQ-S16-005; T-DG4-BE-A): the ONLY way a domain module creates a My Work
// item. In the caller's transaction it inserts the work item and one in-app notification with the same dedupe key,
// plus their audit events, using INSERT ... ON CONFLICT (organization_id, dedupe_key) DO NOTHING. A second call with
// the same dedupe key (a retry, a redelivered message, a worker restart) creates nothing and returns `existing`.
//
// Text is never stored: an item carries an i18n `messageKey` and `messageParams`, translated at render time (S-6).
// Links are relative in-app paths (the 0028 CHECK refuses anything else). No remote I/O happens here, and a job's
// audit actor is `service` with source `worker` (S-13); a service actor never decides an approval.
//
// The worker cannot import API code (ADR-0002 rule 5), so apps/worker/src/kit.ts carries a twin of this function over
// the same `@mth/db` calls; apps/api/test/integration/tasks/work-items.test.ts checks that both write the same rows.
import { insertAuditEvent, type AuditActor, type Tx } from "@mth/db";
import { v7 as uuidv7 } from "uuid";

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
  const id = uuidv7();
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
  const notificationId = uuidv7();
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

/**
 * Closes the open work items of a subject (e.g. the approval tasks when the approval is decided; ADR-0025 §4
 * "system managed"), in `tx`, each with its audit event. Returns how many were closed.
 */
export async function closeWorkItemsOfSubject(
  tx: Tx,
  actor: AuditActor,
  subject: { organizationId: string; subjectType: string; subjectId: string; kinds?: readonly string[] },
  status: "done" | "cancelled",
): Promise<number> {
  let q = tx
    .selectFrom("work_item")
    .selectAll()
    .where("organization_id", "=", subject.organizationId)
    .where("subject_type", "=", subject.subjectType)
    .where("subject_id", "=", subject.subjectId)
    .where("status", "=", "open");
  if (subject.kinds !== undefined && subject.kinds.length > 0) q = q.where("kind", "in", [...subject.kinds]);
  const open = await q.forUpdate().execute();
  const by = actor.actorType === "user" ? actor.actorUserId : null;
  for (const item of open) {
    const updated = await tx
      .updateTable("work_item")
      .set((eb) => ({
        status,
        completed_at: status === "done" ? eb.fn<Date>("now", []) : null,
        completed_by: status === "done" ? by : null,
        version: eb("version", "+", 1),
        updated_at: eb.fn<Date>("now", []),
        updated_by: by,
      }))
      .where("id", "=", item.id)
      .where("version", "=", item.version)
      .returning("version")
      .executeTakeFirstOrThrow();
    await insertAuditEvent(tx, actor, {
      action: status === "done" ? "work_item.complete" : "work_item.cancel",
      recordType: "work_item",
      recordId: item.id,
      organizationId: item.organization_id,
      transformationId: item.transformation_id,
      priorVersion: item.version,
      newVersion: updated.version,
      changes: { status: { from: "open", to: status } },
    });
  }
  return open.length;
}

// ---------------------------------------------------------------------------------------------------------------
// Work items follow their source (T-DG4-BE-R1; D-102, D-105; ADR-0025 §4). A source record (a RAID action, a
// corrective case, an adoption intervention, an executive ask) owns one open item of a kind for its owner, due on the
// source's date. When the source's date changes, rescheduleWorkItemsOfSubject moves the open item's due date; when
// its owner changes, reassignWorkItemOfSubject cancels the previous owner's open item and opens one for the new owner.
// An item's assignee and dedupe key are immutable and a closed item never reopens (0028 work_item_guard), so an owner
// who gets the source back (A -> B -> A) gets a NEW item, under the first free key of `<key>`, `<key>#2`, `<key>#3` ...
// Both services are idempotent (a repeat finds nothing to change and writes nothing), audited per item in the caller's
// transaction, and do no remote I/O. apps/worker/src/kit.ts carries their twins (ADR-0002 rule 5); the parity test in
// apps/api/test/integration/tasks/work-items.test.ts proves both write the same rows.

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

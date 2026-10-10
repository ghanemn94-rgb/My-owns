// A meeting action's My Work item follows later edits of its action (T-DG4-BE-R3; BE-F2 handback §8 item 1; ADR-0032
// amendment G1 item 5; ADR-0025 amendment D2).
//
// A meeting action is a canonical `action_item` created by governance (meeting-actions.ts) with one `meeting_action_due`
// item for its owner. The action is then edited through BE-D's action register (raid/actions.ts) or the DG2 `/actions`
// path (the workflows register). Both depend on `tasks`, so the rule lives here, and neither `raid` nor `workflows`
// imports `governance` (ADR-0032 G1: `raid` must never import `governance`):
//  - the owner changes  → reassignWorkItemOfSubject (the previous owner's open item is cancelled, reason `reassigned`;
//    the new owner's item is created under `meeting.action:<actionItemId>:<newOwner>`, or its `#n` variant);
//  - the due date changes → rescheduleWorkItemsOfSubject (`work_item.reschedule`, `changes.due_date`);
//  - the action becomes done or cancelled → closeWorkItemsOfSubject with that status.
// An action is a meeting action when a `meeting_action_due` item of it exists (any status): the item is the fact this
// rule follows, so an action that never had one (a RAID-linked, corrective or DG2 action) reads one row and is left
// alone. Nothing here approves anything or touches the engineering delivery gates DG0-DG7.
import type { AuditActor, Tx } from "@mth/db";
import {
  closeWorkItemsOfSubject,
  reassignWorkItemOfSubject,
  rescheduleWorkItemsOfSubject,
  type MessageParamValue,
} from "./service.ts";

/** The meeting action's work item (ADR-0032 §5.4, G2): kind, message key and dedupe key. */
export const MEETING_ACTION_TASK = Object.freeze({
  kind: "meeting_action_due",
  messageKey: "governance.task.meeting_action_due",
  dedupeKey: (actionItemId: string, ownerUserId: string) => `meeting.action:${actionItemId}:${ownerUserId}`,
});

/** The action fields the rule reads, before and after one edit. */
export interface FollowedAction {
  readonly id: string;
  readonly organization_id: string;
  readonly title: string;
  readonly owner_user_id: string;
  readonly due_date: string | null;
  readonly status: string;
}

const OPEN = new Set(["open", "in_progress"]);
const dateOf = (d: unknown): string | null => (d === null || d === undefined ? null : String(d).slice(0, 10));

/**
 * Makes the meeting action's work item follow one edit of the action, in `tx` (the caller holds the action's row lock
 * and has written the action's own update and audit event). Returns what it did, for tests and logs.
 */
export async function followMeetingActionWorkItem(
  tx: Tx,
  actor: AuditActor,
  before: FollowedAction,
  after: FollowedAction,
): Promise<"none" | "closed" | "followed"> {
  // The newest meeting item of the action: its link path, transformation and parameters are carried to a new owner.
  const item = await tx
    .selectFrom("work_item")
    .select(["transformation_id", "link_path", "message_params"])
    .where("organization_id", "=", after.organization_id)
    .where("subject_type", "=", "action_item")
    .where("subject_id", "=", after.id)
    .where("kind", "=", MEETING_ACTION_TASK.kind)
    .orderBy("id", "desc")
    .executeTakeFirst();
  if (!item) return "none";
  const source = {
    organizationId: after.organization_id,
    subjectType: "action_item",
    subjectId: after.id,
    kinds: [MEETING_ACTION_TASK.kind],
  };
  if (after.status === "done" || after.status === "cancelled") {
    if (after.status === before.status) return "none";
    await closeWorkItemsOfSubject(tx, actor, source, after.status);
    return "closed";
  }
  if (!OPEN.has(after.status)) return "none";
  let followed = false;
  if (after.owner_user_id !== before.owner_user_id) {
    const params = (item.message_params ?? {}) as Record<string, MessageParamValue>;
    await reassignWorkItemOfSubject(tx, actor, {
      organizationId: after.organization_id,
      transformationId: item.transformation_id,
      kind: MEETING_ACTION_TASK.kind,
      assigneeUserId: after.owner_user_id,
      subjectType: "action_item",
      subjectId: after.id,
      linkPath: item.link_path,
      messageKey: MEETING_ACTION_TASK.messageKey,
      // The meeting date is the meeting's; the title is the action's current one.
      messageParams: { ...params, title: after.title },
      dueDate: dateOf(after.due_date),
      dedupeKey: MEETING_ACTION_TASK.dedupeKey(after.id, after.owner_user_id),
    });
    followed = true;
  }
  if (dateOf(after.due_date) !== dateOf(before.due_date)) {
    await rescheduleWorkItemsOfSubject(tx, actor, source, dateOf(after.due_date));
    followed = true;
  }
  return followed ? "followed" : "none";
}

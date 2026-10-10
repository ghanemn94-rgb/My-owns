// Meeting actions and My Work (OpenAPI tag "meetings"; ADR-0032 §5.4, §9, §11; REQ-S10-011 "actions appear in owners'
// My Work", REQ-S16-019 "MeetingActionLink"; T-DG4-BE-F2):
//   GET  /transformations/{id}/meetings/{meetingId}/actions   the actions assigned in the meeting, each with its current
//                                                             status and overdue flag ("monitor closure"; transformation.read)
//   POST /transformations/{id}/meetings/{meetingId}/actions   assign an owned action (meeting.prepare)
//
// createMeetingAction creates the canonical `action_item` (person-authored by the caller, DG2 statuses, no RAID source;
// ADR-0031 §4) and the append-only `assigned` link in one transaction, and the owner's My Work item through
// createWorkItemOnce (kind meeting_action_due, subject action_item, due date = the action's due date, dedupe key
// `meeting.action:<actionItemId>:<ownerUserId>`). T-DG4-BE-R3 (ADR-0032 amendment G1): the action and its
// `action_item.create` event are written by raid's insertActionItem, the one insert BE-D's createLinkedAction also uses
// (governance depends on raid; raid never imports governance). The action is then edited through the action register
// or the DG2 /actions path, and its meeting_action_due item follows those edits (tasks' followMeetingActionWorkItem).
// `overdue`: a due date before today's business date while open or in progress. Nothing here approves anything.
import type { ActionItemTable, DbOrTx, MeetingActionLinkRow, Tx } from "@mth/db";
import { sql } from "@mth/db";
import { meetingActionCreate, type MeetingAction, type RaidAction } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import type { Selectable } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { auditContextOf, principalOf, requireTransformationRead } from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  iso,
  limitSchema,
  paginate,
  parse,
  parseBody,
  parseQuery,
  type ModuleDeps,
} from "../platform/index.ts";
import { insertActionItem } from "../raid/index.ts";
import { createWorkItemOnce, MEETING_ACTION_TASK } from "../tasks/index.ts";
import {
  assertMeetingEditable,
  lockMeeting,
  meetingParams,
  PREPARE,
  readMeeting,
  requireCommitteeAction,
  sendCreated,
} from "./agenda.ts";
import { isActiveUserOf, unknownTarget } from "./forums.ts";
import { checkAgendaItemOf } from "./meeting-outputs.ts";

type ActionRow = Selectable<ActionItemTable>;

const JSON_BODY = ["application/json"] as const;
const listQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });
const OPEN_STATUSES: readonly string[] = ["open", "in_progress"];

export const MEETING_ACTION_TASK_KIND = MEETING_ACTION_TASK.kind;
/** New message key (this task; handback §6): "Meeting action assigned to you: {title} (meeting of {meetingDate})." */
export const MEETING_ACTION_TASK_MESSAGE = MEETING_ACTION_TASK.messageKey;

/** Today's business date in the organization's default calendar timezone, else its default timezone (ADR-0025 §2). */
async function todayOf(db: DbOrTx, organizationId: string): Promise<string> {
  const r = await sql<{ d: string }>`
    SELECT p4_business_date(now(), coalesce(
      (SELECT c.timezone FROM business_calendar c
        WHERE c.organization_id = ${organizationId}::uuid AND c.is_default AND c.status = 'active' LIMIT 1),
      (SELECT o.default_timezone FROM organization o WHERE o.id = ${organizationId}::uuid)))::text AS d`.execute(db);
  return r.rows[0]!.d;
}

const dateOrNull = (d: unknown): string | null => (d === null || d === undefined ? null : String(d).slice(0, 10));

function sourceKindOf(r: ActionRow): RaidAction["sourceKind"] {
  if (r.source_workshop_item_id !== null) return "workshop";
  if (r.raid_entry_id !== null) return "raid_entry";
  if (r.dependency_id !== null) return "dependency";
  if (r.corrective_case_id !== null) return "corrective_case";
  return "none";
}

const isOverdue = (r: ActionRow, today: string): boolean => {
  const due = dateOrNull(r.due_date);
  return due !== null && due < today && OPEN_STATUSES.includes(r.status);
};

/** The action register's `RaidAction` representation (the same mapping as raid's toRaidAction; ADR-0031 §4). */
export function toActionRepresentation(r: ActionRow, today: string): RaidAction {
  return {
    id: r.id,
    transformationId: r.transformation_id,
    title: r.title,
    description: r.description,
    ownerUserId: r.owner_user_id,
    dueDate: dateOrNull(r.due_date),
    followUpDate: dateOrNull(r.follow_up_date),
    status: r.status as RaidAction["status"],
    sourceKind: sourceKindOf(r),
    sourceWorkshopItemId: r.source_workshop_item_id,
    raidEntryId: r.raid_entry_id,
    dependencyId: r.dependency_id,
    correctiveCaseId: r.corrective_case_id,
    overdue: isOverdue(r, today),
    version: r.version,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
    updatedAt: iso(r.updated_at),
    updatedBy: r.updated_by,
  };
}

export const toMeetingAction = (l: MeetingActionLinkRow, a: ActionRow, today: string): MeetingAction => ({
  id: l.id,
  meetingId: l.meeting_id,
  agendaItemId: l.agenda_item_id,
  actionItemId: l.action_item_id,
  linkKind: l.link_kind as MeetingAction["linkKind"],
  overdue: isOverdue(a, today),
  action: toActionRepresentation(a, today),
  createdAt: iso(l.created_at),
  createdBy: l.created_by,
});

export function registerMeetingActionRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const ACTIONS = "/api/v1/transformations/:transformationId/meetings/:meetingId/actions";
  const read = { access: { permission: "transformation.read" as const } };

  app.get(ACTIONS, { config: read }, async (request) => {
    const { transformationId, meetingId } = parse(meetingParams, request.params, "params");
    const query = parseQuery(listQuery, request.query);
    const target = await requireTransformationRead(db, principalOf(request), transformationId);
    await readMeeting(db, transformationId, meetingId);
    const hash = filterHash({ meetingId });
    // Creation order by the time-ordered UUIDv7 id (a timestamp cursor would lose PostgreSQL's microseconds).
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("meeting_action_link").selectAll().where("meeting_id", "=", meetingId);
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    const ids = page.items.map((l) => l.action_item_id);
    const actions =
      ids.length === 0 ? [] : await db.selectFrom("action_item").selectAll().where("id", "in", ids).execute();
    const byId = new Map(actions.map((a) => [a.id, a] as const));
    const today = await todayOf(db, target.organizationId);
    return {
      items: page.items.map((l) => toMeetingAction(l, byId.get(l.action_item_id)!, today)),
      nextCursor: page.nextCursor,
    };
  });

  app.post(ACTIONS, { config: { access: { permission: PREPARE }, consumes: JSON_BODY } }, async (request, reply) => {
    const { transformationId, meetingId } = parse(meetingParams, request.params, "params");
    const body = parseBody(meetingActionCreate, request.body);
    const out = await db.transaction().execute(async (tx: Tx) => {
      const { userId, target } = await requireCommitteeAction(tx, request, transformationId, PREPARE);
      const meeting = await lockMeeting(tx, transformationId, meetingId);
      assertMeetingEditable(meeting);
      if (!(await isActiveUserOf(tx, target.organizationId, body.ownerUserId)))
        throw unknownTarget("/ownerUserId", "user");
      await checkAgendaItemOf(tx, meetingId, body.agendaItemId);
      const audit = auditContextOf(request);
      // ADR-0032 amendment G1: the one action insert (and its action_item.create event), with no source link.
      const action = await insertActionItem(
        { tx, userId, audit, organizationId: meeting.organization_id, transformationId },
        null,
        { title: body.title, description: body.description, ownerUserId: body.ownerUserId, dueDate: body.dueDate },
      );
      const actionId = action.id;
      const linkId = uuidv7();
      const link = await tx
        .insertInto("meeting_action_link")
        .values({
          id: linkId,
          organization_id: meeting.organization_id,
          transformation_id: transformationId,
          meeting_id: meetingId,
          agenda_item_id: body.agendaItemId ?? null,
          action_item_id: actionId,
          link_kind: "assigned",
          created_by: userId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await record(tx, audit, {
        action: "meeting_action_link.create",
        recordType: "meeting_action_link",
        recordId: linkId,
        organizationId: meeting.organization_id,
        transformationId,
        newVersion: 1,
        changes: {
          meeting_id: { from: null, to: meetingId },
          agenda_item_id: { from: null, to: link.agenda_item_id },
          action_item_id: { from: null, to: actionId },
          link_kind: { from: null, to: "assigned" },
        },
      });
      // REQ-S10-011: the action appears in its owner's My Work (S-13: createWorkItemOnce; S-6: a key, never a sentence).
      await createWorkItemOnce(
        tx,
        { actorType: "user", actorUserId: userId, requestId: audit.requestId, source: "api" },
        {
          organizationId: meeting.organization_id,
          transformationId,
          kind: MEETING_ACTION_TASK_KIND,
          assigneeUserId: body.ownerUserId,
          subjectType: "action_item",
          subjectId: actionId,
          linkPath: `/transformations/${transformationId}/meetings/${meetingId}`,
          messageKey: MEETING_ACTION_TASK_MESSAGE,
          messageParams: { title: body.title, meetingDate: String(meeting.scheduled_date).slice(0, 10) },
          dueDate: body.dueDate ?? null,
          dedupeKey: MEETING_ACTION_TASK.dedupeKey(actionId, body.ownerUserId),
        },
      );
      return toMeetingAction(link, action, await todayOf(tx, target.organizationId));
    });
    return sendCreated(reply, out, `/api/v1/transformations/${transformationId}/action-register/${out.actionItemId}`);
  });

  return [`GET ${ACTIONS}`, `POST ${ACTIONS}`];
}

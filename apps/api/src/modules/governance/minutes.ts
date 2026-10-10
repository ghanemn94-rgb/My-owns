// Meeting minutes (OpenAPI tag "minutes"; ADR-0032 §5, §9, §11; REQ-S10-011 "published minutes are immutable",
// REQ-PB-061 "a Value Review meeting cannot be published without a benefit evidence or forecast entry", REQ-S16-019
// "Minutes"; T-DG4-BE-F2):
//   GET   /transformations/{id}/meetings/{meetingId}/minutes           the minutes; 404 when none (transformation.read)
//   POST  /transformations/{id}/meetings/{meetingId}/minutes           draft them (meeting.prepare)
//   PATCH /transformations/{id}/meetings/{meetingId}/minutes           edit a draft (meeting.prepare) or return approved
//                                                                      minutes to draft (meeting.chair; the chair)
//   POST  /transformations/{id}/meetings/{meetingId}/minutes/approve   draft -> approved (meeting.chair; the chair)
//   POST  /transformations/{id}/meetings/{meetingId}/minutes/publish   approved -> published, and the meeting ->
//                                                                      minutes_published, in one transaction (the chair)
//
// Draft -> approved -> published; approved -> draft. Approved minutes are not edited in place; published minutes are
// immutable and their meeting and its records are frozen. Publication needs a held meeting and, when the forum names
// required outputs, at least one of them (422 meeting_minutes.required_output_missing) - all checked before any write.
// The chair holds one open `minutes_to_approve` My Work item while the minutes wait for approval (created when they are
// drafted or returned; it follows the meeting's current chair through reassignWorkItemOfSubject; closed on approval).
// Approving minutes is a meeting record step, not a G1-G6 business approval, and nothing here touches DG0-DG7.
//
// registerMinutesRoutes also registers the attendance, output and action routes (their files are new; the module's
// index.ts, which BE-F2 does not own, already calls this function).
import type { MeetingMinutesRow, MeetingRow, Tx } from "@mth/db";
import { sql } from "@mth/db";
import { meetingMinutesCreate, meetingMinutesUpdate, type MeetingMinutes } from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { auditContextOf, principalOf, requireTransformationRead } from "../access/index.ts";
import { record, type AuditContext } from "../audit/index.ts";
import {
  iso,
  isoOrNull,
  parse,
  parseBody,
  problems,
  requireIfMatch,
  sendVersioned,
  type ModuleDeps,
} from "../platform/index.ts";
import { closeWorkItemsOfSubject, reassignWorkItemOfSubject } from "../tasks/index.ts";
import {
  assertChair,
  assertMeetingEditable,
  CHAIR,
  lockMeeting,
  meetingParams,
  PREPARE,
  readMeeting,
  requireCommitteeAction,
  type CommitteeActor,
} from "./agenda.ts";
import { registerAttendanceRoutes } from "./attendance.ts";
import { diffFields } from "./forums.ts";
import { registerMeetingActionRoutes } from "./meeting-actions.ts";
import { outputNameOf, registerMeetingOutputRoutes } from "./meeting-outputs.ts";

const JSON_BODY = ["application/json"] as const;
export const MINUTES_TASK_KIND = "minutes_to_approve";
/** New message key (this task; handback §6): "Approve the minutes of the {forum} meeting of {meetingDate}." */
export const MINUTES_TASK_MESSAGE = "governance.task.minutes_to_approve";

/** ADR-0032 §11, minutes lines: exact codes and English texts. */
export const minutesRefusals = {
  exists: () => problems.duplicate("meeting_minutes.exists", "This meeting already has minutes; update them instead."),
  statusTransition: (from: string, to: string) =>
    problems.businessRule("meeting_minutes.status_transition", `These minutes cannot move from ${from} to ${to}.`),
  published: () => problems.businessRule("meeting_minutes.published", "Published minutes are immutable."),
  approvedFrozen: () =>
    problems.businessRule(
      "meeting_minutes.approved_frozen",
      "Approved minutes are edited only after they are returned to draft.",
    ),
  meetingNotHeld: () =>
    problems.businessRule("meeting_minutes.meeting_not_held", "Minutes are published after the meeting is held."),
  requiredOutputMissing: (forum: string, outputs: readonly string[]) =>
    problems.businessRule(
      "meeting_minutes.required_output_missing",
      `A ${forum} meeting cannot be published without at least one of: ${outputs.join(", ")}.`,
    ),
} as const;

export const toMeetingMinutes = (r: MeetingMinutesRow): MeetingMinutes => ({
  id: r.id,
  meetingId: r.meeting_id,
  body: r.body,
  status: r.status as MeetingMinutes["status"],
  approvedAt: isoOrNull(r.approved_at),
  approvedBy: r.approved_by,
  publishedAt: isoOrNull(r.published_at),
  publishedBy: r.published_by,
  version: r.version,
  createdAt: iso(r.created_at),
  createdBy: r.created_by,
  updatedAt: iso(r.updated_at),
  updatedBy: r.updated_by,
});

const minutesFields = (r: MeetingMinutesRow): ReadonlyMap<string, unknown> =>
  new Map<string, unknown>([
    ["body", r.body],
    ["status", r.status],
  ]);

/** The minutes of a write, locked at the expected version (428 / 409 / 404). */
async function lockMinutes(tx: Tx, request: FastifyRequest, meetingId: string): Promise<MeetingMinutesRow> {
  const expected = requireIfMatch(request);
  const current = await tx
    .selectFrom("meeting_minutes")
    .selectAll()
    .where("meeting_id", "=", meetingId)
    .forUpdate()
    .executeTakeFirst();
  if (!current) throw problems.notFound();
  if (current.version !== expected) throw problems.versionConflict(current.version);
  return current;
}

const userActor = (userId: string, audit: AuditContext) =>
  ({ actorType: "user", actorUserId: userId, requestId: audit.requestId, source: "api" }) as const;

/** The chair's one open minutes_to_approve item (none while the meeting has no chair: a visible chair_unassigned). */
async function minutesTask(tx: Tx, actor: CommitteeActor, audit: AuditContext, meeting: MeetingRow, minutesId: string) {
  if (meeting.chair_user_id === null) return;
  const forum = await tx
    .selectFrom("forum")
    .select("name_en")
    .where("id", "=", meeting.forum_id)
    .executeTakeFirstOrThrow();
  await reassignWorkItemOfSubject(tx, userActor(actor.userId, audit), {
    organizationId: meeting.organization_id,
    transformationId: meeting.transformation_id,
    kind: MINUTES_TASK_KIND,
    assigneeUserId: meeting.chair_user_id,
    subjectType: "meeting_minutes",
    subjectId: minutesId,
    linkPath: `/transformations/${meeting.transformation_id}/meetings/${meeting.id}`,
    messageKey: MINUTES_TASK_MESSAGE,
    messageParams: { forum: forum.name_en, meetingDate: String(meeting.scheduled_date).slice(0, 10) },
    dueDate: null,
    dedupeKey: `meeting.minutes:${minutesId}:${meeting.chair_user_id}`,
  });
}

async function updateMinutes(
  tx: Tx,
  audit: AuditContext,
  current: MeetingMinutesRow,
  userId: string,
  action: string,
  set: Partial<{
    body: string;
    status: string;
    approved_at: ReturnType<typeof sql<Date>> | null;
    approved_by: string | null;
    published_at: ReturnType<typeof sql<Date>>;
    published_by: string;
  }>,
): Promise<MeetingMinutesRow> {
  const updated = await tx
    .updateTable("meeting_minutes")
    .set({
      ...set,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirst();
  if (!updated) throw problems.versionConflict(current.version + 1);
  await record(tx, audit, {
    action,
    recordType: "meeting_minutes",
    recordId: current.id,
    organizationId: current.organization_id,
    transformationId: current.transformation_id,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diffFields(minutesFields(current), minutesFields(updated)),
  });
  return updated;
}

export function registerMinutesRoutes(app: FastifyInstance, deps: ModuleDeps): string[] {
  const { db } = deps;
  const MINUTES = "/api/v1/transformations/:transformationId/meetings/:meetingId/minutes";
  const APPROVE = `${MINUTES}/approve`;
  const PUBLISH = `${MINUTES}/publish`;
  const read = { access: { permission: "transformation.read" as const } };

  app.get(MINUTES, { config: read }, async (request, reply) => {
    const { transformationId, meetingId } = parse(meetingParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    await readMeeting(db, transformationId, meetingId);
    const row = await db
      .selectFrom("meeting_minutes")
      .selectAll()
      .where("meeting_id", "=", meetingId)
      .executeTakeFirst();
    if (!row) throw problems.notFound();
    return sendVersioned(reply, 200, toMeetingMinutes(row));
  });

  app.post(MINUTES, { config: { access: { permission: PREPARE }, consumes: JSON_BODY } }, async (request, reply) => {
    const { transformationId, meetingId } = parse(meetingParams, request.params, "params");
    const body = parseBody(meetingMinutesCreate, request.body);
    const row = await db.transaction().execute(async (tx) => {
      const actor = await requireCommitteeAction(tx, request, transformationId, PREPARE);
      const meeting = await lockMeeting(tx, transformationId, meetingId);
      assertMeetingEditable(meeting);
      const existing = await tx
        .selectFrom("meeting_minutes")
        .select("id")
        .where("meeting_id", "=", meetingId)
        .executeTakeFirst();
      if (existing) throw minutesRefusals.exists();
      const audit = auditContextOf(request);
      const id = uuidv7();
      const inserted = await tx
        .insertInto("meeting_minutes")
        .values({
          id,
          organization_id: meeting.organization_id,
          transformation_id: transformationId,
          meeting_id: meetingId,
          body: body.body,
          created_by: actor.userId,
          updated_by: actor.userId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await record(tx, audit, {
        action: "meeting_minutes.create",
        recordType: "meeting_minutes",
        recordId: id,
        organizationId: meeting.organization_id,
        transformationId,
        newVersion: 1,
        changes: { meeting_id: { from: null, to: meetingId }, ...diffFields(new Map(), minutesFields(inserted)) },
      });
      await minutesTask(tx, actor, audit, meeting, id);
      return inserted;
    });
    return sendVersioned(
      reply,
      201,
      toMeetingMinutes(row),
      `/api/v1/transformations/${transformationId}/meetings/${meetingId}/minutes`,
    );
  });

  app.patch(MINUTES, { config: { access: { permission: PREPARE }, consumes: JSON_BODY } }, async (request, reply) => {
    const { transformationId, meetingId } = parse(meetingParams, request.params, "params");
    const body = parseBody(meetingMinutesUpdate, request.body);
    const row = await db.transaction().execute(async (tx) => {
      // Editing the text is meeting.prepare; returning approved minutes to draft is the chair's (ADR-0032 §5.2, §9).
      let actor: CommitteeActor | null = null;
      if (body.body !== undefined) actor = await requireCommitteeAction(tx, request, transformationId, PREPARE);
      if (body.status !== undefined) actor = await requireCommitteeAction(tx, request, transformationId, CHAIR);
      const { userId } = actor!;
      const meeting = await lockMeeting(tx, transformationId, meetingId);
      const current = await lockMinutes(tx, request, meetingId);
      if (current.status === "published") throw minutesRefusals.published();
      assertMeetingEditable(meeting);
      const audit = auditContextOf(request);
      if (body.status !== undefined) {
        assertChair(meeting, userId);
        if (current.status !== "approved") throw minutesRefusals.statusTransition(current.status, "draft");
        const updated = await updateMinutes(tx, audit, current, userId, "meeting_minutes.return", {
          status: "draft",
          approved_at: null,
          approved_by: null,
          ...(body.body !== undefined ? { body: body.body } : {}),
        });
        await minutesTask(tx, actor!, audit, meeting, current.id);
        return updated;
      }
      if (current.status === "approved") throw minutesRefusals.approvedFrozen();
      return updateMinutes(tx, audit, current, userId, "meeting_minutes.update", { body: body.body! });
    });
    return sendVersioned(reply, 200, toMeetingMinutes(row));
  });

  // Bodiless actions (no config.consumes; the completeWorkItem precedent, S-3).
  app.post(APPROVE, { config: { access: { permission: CHAIR } } }, async (request, reply) => {
    const { transformationId, meetingId } = parse(meetingParams, request.params, "params");
    const row = await db.transaction().execute(async (tx) => {
      const { userId } = await requireCommitteeAction(tx, request, transformationId, CHAIR);
      const meeting = await lockMeeting(tx, transformationId, meetingId);
      const current = await lockMinutes(tx, request, meetingId);
      if (current.status === "published") throw minutesRefusals.published();
      assertMeetingEditable(meeting);
      assertChair(meeting, userId);
      if (current.status !== "draft") throw minutesRefusals.statusTransition(current.status, "approved");
      const audit = auditContextOf(request);
      const updated = await updateMinutes(tx, audit, current, userId, "meeting_minutes.approve", {
        status: "approved",
        approved_at: sql<Date>`now()`,
        approved_by: userId,
      });
      await closeWorkItemsOfSubject(
        tx,
        userActor(userId, audit),
        {
          organizationId: current.organization_id,
          subjectType: "meeting_minutes",
          subjectId: current.id,
          kinds: [MINUTES_TASK_KIND],
        },
        "done",
      );
      return updated;
    });
    return sendVersioned(reply, 200, toMeetingMinutes(row));
  });

  app.post(PUBLISH, { config: { access: { permission: CHAIR } } }, async (request, reply) => {
    const { transformationId, meetingId } = parse(meetingParams, request.params, "params");
    const row = await db.transaction().execute(async (tx) => {
      const { userId } = await requireCommitteeAction(tx, request, transformationId, CHAIR);
      const meeting = await lockMeeting(tx, transformationId, meetingId);
      const current = await lockMinutes(tx, request, meetingId);
      if (current.status === "published") throw minutesRefusals.published();
      assertMeetingEditable(meeting);
      assertChair(meeting, userId);
      if (current.status !== "approved") throw minutesRefusals.statusTransition(current.status, "published");
      if (meeting.status !== "held") throw minutesRefusals.meetingNotHeld();
      // REQ-PB-061: the forum's required outputs, checked before any write.
      const forum = await tx
        .selectFrom("forum")
        .select(["name_en", "publish_requires_any_output"])
        .where("id", "=", meeting.forum_id)
        .executeTakeFirstOrThrow();
      const required = forum.publish_requires_any_output;
      if (required.length > 0) {
        const found = await tx
          .selectFrom("meeting_output")
          .select("id")
          .where("meeting_id", "=", meetingId)
          .where("output_kind", "in", required)
          .executeTakeFirst();
        if (!found) throw minutesRefusals.requiredOutputMissing(forum.name_en, required.map(outputNameOf));
      }
      const audit = auditContextOf(request);
      const updated = await updateMinutes(tx, audit, current, userId, "meeting_minutes.publish", {
        status: "published",
        published_at: sql<Date>`now()`,
        published_by: userId,
      });
      // "Publishing the meeting record" (ADR-0032 §5.3): the meeting moves to minutes_published in the same transaction.
      const m = await tx
        .updateTable("meeting")
        .set({
          status: "minutes_published",
          version: sql<number>`version + 1`,
          updated_at: sql<Date>`now()`,
          updated_by: userId,
        })
        .where("id", "=", meetingId)
        .where("version", "=", meeting.version)
        .returning("version")
        .executeTakeFirst();
      if (!m) throw problems.versionConflict(meeting.version + 1);
      await record(tx, audit, {
        action: "meeting.publish_minutes",
        recordType: "meeting",
        recordId: meetingId,
        organizationId: meeting.organization_id,
        transformationId,
        priorVersion: meeting.version,
        newVersion: m.version,
        changes: { status: { from: meeting.status, to: "minutes_published" } },
      });
      return updated;
    });
    return sendVersioned(reply, 200, toMeetingMinutes(row));
  });

  return [
    `GET ${MINUTES}`,
    `POST ${MINUTES}`,
    `PATCH ${MINUTES}`,
    `POST ${APPROVE}`,
    `POST ${PUBLISH}`,
    ...registerAttendanceRoutes(app, deps),
    ...registerMeetingOutputRoutes(app, deps),
    ...registerMeetingActionRoutes(app, deps),
  ];
}

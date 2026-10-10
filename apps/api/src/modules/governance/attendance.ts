// Meeting attendance and quorum (OpenAPI tag "attendance"; ADR-0032 §3.3, §9, §11; REQ-S10-011 "record attendance /
// quorum where configured", REQ-S16-019 "Attendance"; T-DG4-BE-F2):
//   GET   /transformations/{id}/meetings/{meetingId}/attendance                         attendance (transformation.read)
//   POST  /transformations/{id}/meetings/{meetingId}/attendance                         one person's row (meeting.prepare)
//   PATCH /transformations/{id}/meetings/{meetingId}/attendance/{meetingAttendanceId}   correct it (meeting.prepare)
//
// One row per person and meeting (409 meeting_attendance.exists). `countsForQuorum` is set by the server from the
// person's active forum participation (a person participant row, else an active membership of a participant group);
// a non-participant does not count. A representative (`onBehalfOfUserId`) is recorded only for a present person, never
// for themselves. The meeting's present count (present AND counting) drives the quorum of recordAgendaItemOutcome.
// Rows of a minutes_published or cancelled meeting are frozen (422 meeting.frozen). Nothing here approves anything.
import type { DbOrTx, MeetingAttendanceRow, Tx } from "@mth/db";
import { sql } from "@mth/db";
import { meetingAttendanceCreate, meetingAttendanceUpdate, uuid, type MeetingAttendance } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
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
  problems,
  requireIfMatch,
  sendVersioned,
  type ModuleDeps,
} from "../platform/index.ts";
import {
  assertMeetingEditable,
  lockMeeting,
  meetingParams,
  PREPARE,
  readMeeting,
  requireCommitteeAction,
} from "./agenda.ts";
import { diffFields, isActiveUserOf, unknownTarget } from "./forums.ts";

const JSON_BODY = ["application/json"] as const;
const rowParams = z.strictObject({ transformationId: uuid, meetingId: uuid, meetingAttendanceId: uuid });
const listQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });

export const attendanceRefusals = {
  exists: () =>
    problems.duplicate(
      "meeting_attendance.exists",
      "Attendance for this person is already recorded; update it instead.",
    ),
  /** New 400 field code (this task; handback §6): meeting_attendance_proxy_present / _not_self_proxy, before the database. */
  proxy: () =>
    problems.validation([
      {
        pointer: "/onBehalfOfUserId",
        code: "validation.attendance_proxy",
        message: "A representative is recorded only for a present person, and never for themselves.",
      },
    ]),
} as const;

export const toMeetingAttendance = (r: MeetingAttendanceRow): MeetingAttendance => ({
  id: r.id,
  meetingId: r.meeting_id,
  userId: r.user_id,
  attendance: r.attendance as MeetingAttendance["attendance"],
  countsForQuorum: r.counts_for_quorum,
  onBehalfOfUserId: r.on_behalf_of_user_id,
  note: r.note,
  version: r.version,
  createdAt: iso(r.created_at),
  createdBy: r.created_by,
  updatedAt: iso(r.updated_at),
  updatedBy: r.updated_by,
});

/** True when the person participates in the forum (an active person row, or an active member of an active group row). */
export async function countsForQuorum(db: DbOrTx, forumId: string, userId: string): Promise<boolean> {
  const direct = await db
    .selectFrom("forum_participant")
    .select("counts_for_quorum")
    .where("forum_id", "=", forumId)
    .where("user_id", "=", userId)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (direct) return direct.counts_for_quorum;
  const viaGroup = await db
    .selectFrom("forum_participant as p")
    .innerJoin("access_group_member as g", "g.group_id", "p.group_id")
    .select("p.counts_for_quorum")
    .where("p.forum_id", "=", forumId)
    .where("p.status", "=", "active")
    .where("g.user_id", "=", userId)
    .where("g.removed_at", "is", null)
    .where("g.effective_from", "<=", sql<Date>`now()`)
    .where((eb) => eb.or([eb("g.effective_to", "is", null), eb("g.effective_to", ">", sql<Date>`now()`)]))
    .orderBy("p.counts_for_quorum", "desc")
    .executeTakeFirst();
  return viaGroup?.counts_for_quorum ?? false;
}

const attendanceFields = (r: MeetingAttendanceRow): ReadonlyMap<string, unknown> =>
  new Map<string, unknown>([
    ["user_id", r.user_id],
    ["attendance", r.attendance],
    ["counts_for_quorum", r.counts_for_quorum],
    ["on_behalf_of_user_id", r.on_behalf_of_user_id],
    ["note", r.note],
  ]);

function checkProxy(userId: string, attendance: string, onBehalfOf: string | null): void {
  if (onBehalfOf !== null && (onBehalfOf === userId || attendance !== "present")) throw attendanceRefusals.proxy();
}

async function checkPerson(tx: Tx, organizationId: string, pointer: string, id: string | null | undefined) {
  if (id !== undefined && id !== null && !(await isActiveUserOf(tx, organizationId, id)))
    throw unknownTarget(pointer, "user");
}

export function registerAttendanceRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const ROWS = "/api/v1/transformations/:transformationId/meetings/:meetingId/attendance";
  const ONE = `${ROWS}/:meetingAttendanceId`;
  const read = { access: { permission: "transformation.read" as const } };

  app.get(ROWS, { config: read }, async (request) => {
    const { transformationId, meetingId } = parse(meetingParams, request.params, "params");
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    await readMeeting(db, transformationId, meetingId);
    const hash = filterHash({ meetingId });
    // Creation order by the time-ordered UUIDv7 id (a timestamp cursor would lose PostgreSQL's microseconds).
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("meeting_attendance").selectAll().where("meeting_id", "=", meetingId);
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: page.items.map(toMeetingAttendance), nextCursor: page.nextCursor };
  });

  app.post(ROWS, { config: { access: { permission: PREPARE }, consumes: JSON_BODY } }, async (request, reply) => {
    const { transformationId, meetingId } = parse(meetingParams, request.params, "params");
    const body = parseBody(meetingAttendanceCreate, request.body);
    const onBehalfOf = body.onBehalfOfUserId ?? null;
    checkProxy(body.userId, body.attendance, onBehalfOf);
    const row = await db.transaction().execute(async (tx) => {
      const { userId, target } = await requireCommitteeAction(tx, request, transformationId, PREPARE);
      const meeting = await lockMeeting(tx, transformationId, meetingId);
      assertMeetingEditable(meeting);
      await checkPerson(tx, target.organizationId, "/userId", body.userId);
      await checkPerson(tx, target.organizationId, "/onBehalfOfUserId", onBehalfOf);
      const existing = await tx
        .selectFrom("meeting_attendance")
        .select("id")
        .where("meeting_id", "=", meetingId)
        .where("user_id", "=", body.userId)
        .executeTakeFirst();
      if (existing) throw attendanceRefusals.exists();
      const id = uuidv7();
      const inserted = await tx
        .insertInto("meeting_attendance")
        .values({
          id,
          organization_id: meeting.organization_id,
          transformation_id: transformationId,
          meeting_id: meetingId,
          user_id: body.userId,
          attendance: body.attendance,
          counts_for_quorum: await countsForQuorum(tx, meeting.forum_id, body.userId),
          on_behalf_of_user_id: onBehalfOf,
          note: body.note ?? null,
          created_by: userId,
          updated_by: userId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await record(tx, auditContextOf(request), {
        action: "meeting_attendance.create",
        recordType: "meeting_attendance",
        recordId: id,
        organizationId: meeting.organization_id,
        transformationId,
        newVersion: 1,
        changes: { meeting_id: { from: null, to: meetingId }, ...diffFields(new Map(), attendanceFields(inserted)) },
      });
      return inserted;
    });
    return sendVersioned(
      reply,
      201,
      toMeetingAttendance(row),
      `/api/v1/transformations/${transformationId}/meetings/${meetingId}/attendance/${row.id}`,
    );
  });

  app.patch(ONE, { config: { access: { permission: PREPARE }, consumes: JSON_BODY } }, async (request, reply) => {
    const { transformationId, meetingId, meetingAttendanceId } = parse(rowParams, request.params, "params");
    const body = parseBody(meetingAttendanceUpdate, request.body);
    const row = await db.transaction().execute(async (tx) => {
      const { userId, target } = await requireCommitteeAction(tx, request, transformationId, PREPARE);
      const meeting = await lockMeeting(tx, transformationId, meetingId);
      assertMeetingEditable(meeting);
      const expected = requireIfMatch(request);
      const current = await tx
        .selectFrom("meeting_attendance")
        .selectAll()
        .where("id", "=", meetingAttendanceId)
        .where("meeting_id", "=", meetingId)
        .forUpdate()
        .executeTakeFirst();
      if (!current) throw problems.notFound();
      if (current.version !== expected) throw problems.versionConflict(current.version);
      const attendance = body.attendance ?? current.attendance;
      const onBehalfOf = body.onBehalfOfUserId !== undefined ? body.onBehalfOfUserId : current.on_behalf_of_user_id;
      checkProxy(current.user_id, attendance, onBehalfOf);
      await checkPerson(tx, target.organizationId, "/onBehalfOfUserId", body.onBehalfOfUserId);
      const updated = await tx
        .updateTable("meeting_attendance")
        .set({
          attendance,
          on_behalf_of_user_id: onBehalfOf,
          ...(body.note !== undefined ? { note: body.note } : {}),
          version: sql<number>`version + 1`,
          updated_at: sql<Date>`now()`,
          updated_by: userId,
        })
        .where("id", "=", meetingAttendanceId)
        .where("version", "=", current.version)
        .returningAll()
        .executeTakeFirst();
      if (!updated) throw problems.versionConflict(current.version + 1);
      await record(tx, auditContextOf(request), {
        action: "meeting_attendance.update",
        recordType: "meeting_attendance",
        recordId: meetingAttendanceId,
        organizationId: current.organization_id,
        transformationId,
        priorVersion: current.version,
        newVersion: updated.version,
        changes: diffFields(attendanceFields(current), attendanceFields(updated)),
      });
      return updated;
    });
    return sendVersioned(reply, 200, toMeetingAttendance(row));
  });

  return [`GET ${ROWS}`, `POST ${ROWS}`, `PATCH ${ONE}`];
}

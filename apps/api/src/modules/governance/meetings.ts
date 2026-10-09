// Forum meetings (OpenAPI tag "meetings"; ADR-0032 §3.1, §9-§11; REQ-S10-011, REQ-S16-019 "Meeting"; T-DG4-BE-F):
//   GET   /transformations/{id}/meetings                              by forum, status and date range (transformation.read)
//   POST  /transformations/{id}/meetings                              an ad-hoc meeting of a forum (meeting.prepare)
//   GET   /transformations/{id}/meetings/{meetingId}                  one meeting with presentCount and quorumState
//   PATCH /transformations/{id}/meetings/{meetingId}                  reschedule, location, chair, secretary, quorum
//   POST  /transformations/{id}/meetings/{meetingId}/publish-agenda   scheduled -> agenda_published (the chair only)
//   POST  /transformations/{id}/meetings/{meetingId}/start            scheduled | agenda_published -> in_session
//   POST  /transformations/{id}/meetings/{meetingId}/close            in_session -> held
//   POST  /transformations/{id}/meetings/{meetingId}/cancel           scheduled | agenda_published -> cancelled (note)
//
// Chair: `resolveParty(forum.chair_party_code)` when it maps to a person (ADR-0026 §2; a group or an unmapped party leaves
// it NULL and a chair-only action is refused with 422 meeting.chair_unassigned). Cut-off: the scheduled date minus the
// forum's cut-off working days on the organization's default business calendar (ADR-0025 §1); without a calendar it is
// Unknown (`calendar_not_configured`), never a guessed date. Quorum "not configured" is never shown as "met".
//
// `nextForumDateProvider` implements ADR-0026 §5's NextForumDateProvider for BE-C's T11 SLA type
// `next_steerco_or_urgent` (D-089 Q6): the earliest scheduled (or agenda-published) Executive SteerCo meeting on or
// after the business date, or null = Unknown (`no_steerco_scheduled`). It is wired at registration (intra-module).
// A meeting approves nothing; nothing here touches DG0-DG7.
import type { DbOrTx, ForumRow, MeetingRow, Tx } from "@mth/db";
import { sql } from "@mth/db";
import { cutoffDateOf, type WorkingDayPredicate } from "@mth/shared/calc";
import { meetingCreate, meetingListQuery, meetingUpdate, reasonRequest, uuid, type Meeting } from "@mth/shared/schemas";
import { isWorkingDay } from "@mth/shared/time";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { auditContextOf, principalOf, requireTransformationRead, resolveParty } from "../access/index.ts";
import { record, type AuditContext } from "../audit/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  HttpProblem,
  iso,
  isoOrNull,
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
import { setNextForumDateProvider, type NextForumDateProvider } from "./decision-rights.ts";
import {
  diffFields,
  forumRefusals,
  isActiveUserOf,
  loadForum,
  requireGovernanceAction,
  unknownTarget,
} from "./forums.ts";

const JSON_BODY = ["application/json"] as const;
const PREPARE = "meeting.prepare" as const;
const CHAIR = "meeting.chair" as const;
/** How far before the earliest date the calendar's holidays are loaded (20 cut-off working days fit easily). */
const CALENDAR_LOOKBACK_DAYS = 120;

const transformationParams = z.strictObject({ transformationId: uuid });
const meetingParams = z.strictObject({ transformationId: uuid, meetingId: uuid });

// ------------------------------------------------------------------------------------------------ refusals (S-11)

/** ADR-0032 §11, meeting lines: exact codes and English texts. */
export const meetingRefusals = {
  statusTransition: (from: string, to: string) =>
    problems.businessRule("meeting.status_transition", `This meeting cannot move from ${from} to ${to}.`),
  final: (status: string) =>
    problems.businessRule("meeting.final", `This meeting is ${status} and can no longer be changed.`),
  agendaEmpty: () => problems.businessRule("meeting.agenda_empty", "The agenda has no published item."),
  agendaHasDrafts: () =>
    problems.businessRule(
      "meeting.agenda_has_drafts",
      "Publish or withdraw every draft agenda item before publishing the agenda.",
    ),
  chairUnassigned: () =>
    problems.businessRule(
      "meeting.chair_unassigned",
      "This meeting has no chair. Map the forum's chair role or name a chair first.",
    ),
  notChair: () =>
    new HttpProblem({
      status: 403,
      type: "urn:mth:problem:forbidden",
      code: "meeting.not_chair",
      title: "Forbidden",
      detail: "Only the meeting's chair can do this.",
    }),
  /**
   * Not in ADR-0032 §11 (BE-F handback, contract need): the quorum is "editable until the session starts" (§3.1), and
   * the ADR names no code for a later change.
   */
  quorumLocked: (status: string) =>
    problems.businessRule(
      "meeting.quorum_locked",
      `The quorum is set before the session starts; this meeting is ${status}.`,
    ),
} as const;

const FINAL_STATUSES: ReadonlySet<string> = new Set(["minutes_published", "cancelled"]);

// ------------------------------------------------------------------------------------------------ calendar and chair

export interface LoadedCalendar {
  /** Working-day predicate over the default calendar, or null when none is configured (Unknown). */
  readonly isWorkingDay: WorkingDayPredicate;
  readonly calendarId: string | null;
}

/**
 * The organization's active default business calendar (ADR-0025 §1) as a working-day predicate valid for dates in
 * [from - CALENDAR_LOOKBACK_DAYS, to]. Null predicate when no calendar is configured.
 */
export async function loadWorkingCalendar(
  db: DbOrTx,
  organizationId: string,
  from: string,
  to: string,
): Promise<LoadedCalendar> {
  const calendar = await db
    .selectFrom("business_calendar")
    .select(["id", "workweek"])
    .where("organization_id", "=", organizationId)
    .where("is_default", "=", true)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (!calendar) return { isWorkingDay: null, calendarId: null };
  const holidays = await db
    .selectFrom("business_calendar_holiday")
    .select(["id", "date_from", "date_to"])
    .where("calendar_id", "=", calendar.id)
    .where("status", "=", "active")
    .where("date_to", ">=", sql<string>`(${from}::date - ${CALENDAR_LOOKBACK_DAYS}::integer)`)
    .where("date_from", "<=", to)
    .execute();
  const cal = {
    workweek: calendar.workweek.map(Number),
    holidays: holidays.map((h) => ({ id: h.id, dateFrom: h.date_from, dateTo: h.date_to })),
  };
  return { isWorkingDay: (d: string) => isWorkingDay(d, cal), calendarId: calendar.id };
}

/** The forum's chair party resolved to a person (ADR-0026 §2); a group or an unmapped party gives null. */
export async function resolveChairUser(db: DbOrTx, forum: Pick<ForumRow, "transformation_id" | "chair_party_code">) {
  if (forum.chair_party_code === null) return null;
  const target = await resolveParty(db, forum.transformation_id, forum.chair_party_code);
  return target.status === "mapped" && target.kind === "user" ? target.userId : null;
}

/** The business date "today" in a timezone, from the database clock (the same `p4_business_date` the guards use). */
export async function businessToday(db: DbOrTx, timezone: string): Promise<string> {
  const r = await sql<{ d: string }>`SELECT p4_business_date(now(), ${timezone})::text AS d`.execute(db);
  return r.rows[0]!.d;
}

/** Instant of a local date and wall-clock time in a timezone, computed by PostgreSQL. */
const zoned = (date: string, time: string, timezone: string) =>
  sql<Date>`((${date}::date + ${time}::time) AT TIME ZONE ${timezone})`;
const zonedEnd = (date: string, time: string, minutes: number, timezone: string) =>
  sql<Date>`((${date}::date + ${time}::time + make_interval(mins => ${minutes}::integer)) AT TIME ZONE ${timezone})`;

export interface NewMeeting {
  readonly forum: ForumRow;
  readonly scheduledDate: string;
  readonly startTime: string;
  readonly durationMinutes: number;
  readonly timezone: string;
  readonly location: string | null;
  readonly chairUserId: string | null;
  readonly secretaryUserId: string | null;
  readonly calendar: LoadedCalendar;
  readonly series: { readonly id: string; readonly ruleVersion: number; readonly occurrenceDate: string } | null;
  /** The person creating it (API); every meeting the API creates has a person as author. */
  readonly authorUserId: string;
}

/**
 * Inserts one meeting (status scheduled, created_source api) with its audit event; quorum copied from the forum, cut-off
 * computed on the business calendar (Unknown without one). Returns its id. The caller has authorized the write.
 */
export async function insertMeeting(tx: Tx, audit: AuditContext, m: NewMeeting): Promise<string> {
  const id = uuidv7();
  const cutoff = cutoffDateOf(m.scheduledDate, m.forum.cutoff_working_days, m.calendar.isWorkingDay);
  await tx
    .insertInto("meeting")
    .values({
      id,
      organization_id: m.forum.organization_id,
      transformation_id: m.forum.transformation_id,
      forum_id: m.forum.id,
      series_id: m.series?.id ?? null,
      series_rule_version: m.series?.ruleVersion ?? null,
      occurrence_date: m.series?.occurrenceDate ?? null,
      scheduled_date: m.scheduledDate,
      starts_at: zoned(m.scheduledDate, m.startTime, m.timezone),
      ends_at: zonedEnd(m.scheduledDate, m.startTime, m.durationMinutes, m.timezone),
      timezone: m.timezone,
      location: m.location,
      chair_user_id: m.chairUserId,
      secretary_user_id: m.secretaryUserId,
      quorum_min: m.forum.quorum_min,
      cutoff_date: cutoff,
      cutoff_unknown_reason: cutoff === null ? "calendar_not_configured" : null,
      created_source: "api",
      created_by: m.authorUserId,
      updated_by: m.authorUserId,
    })
    .execute();
  await record(tx, audit, {
    action: "meeting.create",
    recordType: "meeting",
    recordId: id,
    organizationId: m.forum.organization_id,
    transformationId: m.forum.transformation_id,
    newVersion: 1,
    changes: {
      forum_id: { from: null, to: m.forum.id },
      series_id: { from: null, to: m.series?.id ?? null },
      occurrence_date: { from: null, to: m.series?.occurrenceDate ?? null },
      scheduled_date: { from: null, to: m.scheduledDate },
      chair_user_id: { from: null, to: m.chairUserId },
      quorum_min: { from: null, to: m.forum.quorum_min },
      cutoff_date: { from: null, to: cutoff },
    },
  });
  return id;
}

// ------------------------------------------------------------------------------------------------ mapping

/** Present and counting-for-quorum attendance per meeting (ADR-0032 §3.3). */
async function presentCounts(db: DbOrTx, meetingIds: readonly string[]): Promise<Map<string, number>> {
  if (meetingIds.length === 0) return new Map();
  const rows = await db
    .selectFrom("meeting_attendance")
    .select(["meeting_id", sql<number>`count(*)::integer`.as("n")])
    .where("meeting_id", "in", meetingIds)
    .where("attendance", "=", "present")
    .where("counts_for_quorum", "=", true)
    .groupBy("meeting_id")
    .execute();
  return new Map(rows.map((r) => [r.meeting_id, r.n] as const));
}

export const toMeeting = (r: MeetingRow, presentCount: number): Meeting => ({
  id: r.id,
  transformationId: r.transformation_id,
  forumId: r.forum_id,
  seriesId: r.series_id,
  seriesRuleVersion: r.series_rule_version,
  occurrenceDate: r.occurrence_date,
  scheduledDate: r.scheduled_date,
  startsAt: iso(r.starts_at),
  endsAt: iso(r.ends_at),
  timezone: r.timezone,
  location: r.location,
  chairUserId: r.chair_user_id,
  secretaryUserId: r.secretary_user_id,
  quorumMin: r.quorum_min,
  presentCount,
  quorumState: r.quorum_min === null ? "not_configured" : presentCount >= r.quorum_min ? "met" : "not_met",
  cutoffDate: r.cutoff_date,
  cutoffUnknownReason: r.cutoff_unknown_reason as Meeting["cutoffUnknownReason"],
  status: r.status as Meeting["status"],
  cancelReason: r.cancel_reason as Meeting["cancelReason"],
  cancelNote: r.cancel_note,
  cancelledAt: isoOrNull(r.cancelled_at),
  cancelledBy: r.cancelled_by,
  startedAt: isoOrNull(r.started_at),
  heldAt: isoOrNull(r.held_at),
  createdSource: r.created_source as Meeting["createdSource"],
  version: r.version,
  createdAt: iso(r.created_at),
  createdBy: r.created_by,
  updatedAt: iso(r.updated_at),
  updatedBy: r.updated_by,
});

export async function toMeetings(db: DbOrTx, rows: readonly MeetingRow[]): Promise<Meeting[]> {
  const counts = await presentCounts(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => toMeeting(r, counts.get(r.id) ?? 0));
}

export async function loadMeeting(db: DbOrTx, transformationId: string, meetingId: string): Promise<MeetingRow> {
  const row = await db
    .selectFrom("meeting")
    .selectAll()
    .where("id", "=", meetingId)
    .where("transformation_id", "=", transformationId)
    .executeTakeFirst();
  if (!row) throw problems.notFound();
  return row;
}

// ------------------------------------------------------------------------------------------------ next SteerCo

/** ADR-0026 §5 / ADR-0032 §10: the next scheduled Executive SteerCo meeting date, or null (Unknown). */
export const nextForumDateProvider: NextForumDateProvider = Object.freeze({
  async nextSteerCoDate(db: DbOrTx, transformationId: string, onOrAfter: string): Promise<string | null> {
    const m = await db
      .selectFrom("meeting as m")
      .innerJoin("forum as f", "f.id", "m.forum_id")
      .select("m.scheduled_date")
      .where("m.transformation_id", "=", transformationId)
      .where("f.template_key", "=", "executive_steerco")
      .where("m.status", "in", ["scheduled", "agenda_published"])
      .where("m.scheduled_date", ">=", onOrAfter)
      .orderBy("m.scheduled_date")
      .limit(1)
      .executeTakeFirst();
    return m?.scheduled_date ?? null;
  },
});

// ------------------------------------------------------------------------------------------------ transitions

interface Transition {
  readonly from: readonly string[];
  readonly to: "agenda_published" | "in_session" | "held" | "cancelled";
}

/** Locks the meeting row at the expected version and checks the edge (final statuses are 422 meeting.final). */
async function loadForTransition(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
  meetingId: string,
  t: Transition,
): Promise<MeetingRow> {
  const expected = requireIfMatch(request);
  const current = await tx
    .selectFrom("meeting")
    .selectAll()
    .where("id", "=", meetingId)
    .where("transformation_id", "=", transformationId)
    .forUpdate()
    .executeTakeFirst();
  if (!current) throw problems.notFound();
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (FINAL_STATUSES.has(current.status)) throw meetingRefusals.final(current.status);
  if (!t.from.includes(current.status)) throw meetingRefusals.statusTransition(current.status, t.to);
  return current;
}

async function applyTransition(
  tx: Tx,
  audit: AuditContext,
  current: MeetingRow,
  userId: string,
  to: Transition["to"],
  extra: Partial<{
    started_at: ReturnType<typeof sql<Date>>;
    held_at: ReturnType<typeof sql<Date>>;
    cancelled_at: ReturnType<typeof sql<Date>>;
    cancelled_by: string;
    cancel_reason: string;
    cancel_note: string;
  }>,
): Promise<MeetingRow> {
  const updated = await tx
    .updateTable("meeting")
    .set({
      ...extra,
      status: to,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirst();
  if (!updated) throw problems.versionConflict(current.version + 1);
  const action =
    to === "agenda_published"
      ? "meeting.publish_agenda"
      : to === "in_session"
        ? "meeting.start"
        : to === "held"
          ? "meeting.close"
          : "meeting.cancel";
  await record(tx, audit, {
    action,
    recordType: "meeting",
    recordId: current.id,
    organizationId: current.organization_id,
    transformationId: current.transformation_id,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: {
      status: { from: current.status, to },
      ...(extra.cancel_note !== undefined ? { cancel_note: { from: null, to: extra.cancel_note } } : {}),
    },
  });
  return updated;
}

/** The meeting fields audited on update (literal accesses only; F-DG1-124). */
const meetingFields = (r: MeetingRow): ReadonlyMap<string, unknown> =>
  new Map<string, unknown>([
    ["scheduled_date", r.scheduled_date],
    ["starts_at", iso(r.starts_at)],
    ["ends_at", iso(r.ends_at)],
    ["location", r.location],
    ["chair_user_id", r.chair_user_id],
    ["secretary_user_id", r.secretary_user_id],
    ["quorum_min", r.quorum_min],
    ["cutoff_date", r.cutoff_date],
    ["cutoff_unknown_reason", r.cutoff_unknown_reason],
  ]);

// ------------------------------------------------------------------------------------------------ routes

export function registerMeetingRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const MEETINGS = "/api/v1/transformations/:transformationId/meetings";
  const ONE = `${MEETINGS}/:meetingId`;
  const PUBLISH = `${ONE}/publish-agenda`;
  const START = `${ONE}/start`;
  const CLOSE = `${ONE}/close`;
  const CANCEL = `${ONE}/cancel`;
  const read = { access: { permission: "transformation.read" as const } };
  // BE-C's T11 SLA type next_steerco_or_urgent reads the next scheduled Executive SteerCo here (ADR-0026 §5).
  setNextForumDateProvider(nextForumDateProvider);

  app.get(MEETINGS, { config: read }, async (request) => {
    const { transformationId } = parse(transformationParams, request.params, "params");
    const query = parseQuery(meetingListQuery.extend({ cursor: cursorSchema, limit: limitSchema }), request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({
      transformationId,
      forumId: query.forumId ?? null,
      status: query.status ?? null,
      from: query.from ?? null,
      to: query.to ?? null,
    });
    const after = decodeCursor(query.cursor, hash, 2);
    let q = db.selectFrom("meeting").selectAll().where("transformation_id", "=", transformationId);
    if (query.forumId !== undefined) q = q.where("forum_id", "=", query.forumId);
    if (query.status !== undefined) q = q.where("status", "=", query.status);
    if (query.from !== undefined) q = q.where("scheduled_date", ">=", query.from);
    if (query.to !== undefined) q = q.where("scheduled_date", "<=", query.to);
    if (after)
      q = q.where((eb) =>
        eb.or([
          eb("scheduled_date", ">", String(after[0])),
          eb.and([eb("scheduled_date", "=", String(after[0])), eb("id", ">", String(after[1]))]),
        ]),
      );
    const rows = await q
      .orderBy("scheduled_date")
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.scheduled_date, r.id], hash);
    return { items: await toMeetings(db, page.items), nextCursor: page.nextCursor };
  });

  app.post(MEETINGS, { config: { access: { permission: PREPARE }, consumes: JSON_BODY } }, async (request, reply) => {
    const { transformationId } = parse(transformationParams, request.params, "params");
    const body = parseBody(meetingCreate, request.body);
    const row = await db.transaction().execute(async (tx) => {
      const { userId, target } = await requireGovernanceAction(tx, request, transformationId, PREPARE);
      const forum = await forumOfBody(tx, transformationId, body.forumId);
      if (forum.status === "archived") throw forumRefusals.archived();
      for (const [pointer, id] of [
        ["/chairUserId", body.chairUserId],
        ["/secretaryUserId", body.secretaryUserId],
      ] as const)
        if (id !== undefined && id !== null && !(await isActiveUserOf(tx, target.organizationId, id)))
          throw unknownTarget(pointer, "user");
      const tz = await transformationTimezone(tx, transformationId);
      const id = await insertMeeting(tx, auditContextOf(request), {
        forum,
        scheduledDate: body.scheduledDate,
        startTime: body.startTime,
        durationMinutes: body.durationMinutes,
        timezone: tz,
        location: body.location ?? null,
        chairUserId: body.chairUserId !== undefined ? body.chairUserId : await resolveChairUser(tx, forum),
        secretaryUserId: body.secretaryUserId !== undefined ? body.secretaryUserId : forum.secretary_user_id,
        calendar: await loadWorkingCalendar(tx, target.organizationId, body.scheduledDate, body.scheduledDate),
        series: null,
        authorUserId: userId,
      });
      return loadMeeting(tx, transformationId, id);
    });
    const [out] = await toMeetings(db, [row]);
    return sendVersioned(reply, 201, out!, `/api/v1/transformations/${transformationId}/meetings/${row.id}`);
  });

  app.get(ONE, { config: read }, async (request, reply) => {
    const { transformationId, meetingId } = parse(meetingParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    const row = await loadMeeting(db, transformationId, meetingId);
    const [out] = await toMeetings(db, [row]);
    return sendVersioned(reply, 200, out!);
  });

  app.patch(ONE, { config: { access: { permission: PREPARE }, consumes: JSON_BODY } }, async (request, reply) => {
    const { transformationId, meetingId } = parse(meetingParams, request.params, "params");
    const body = parseBody(meetingUpdate, request.body);
    const row = await db.transaction().execute(async (tx) => {
      const { userId, target } = await requireGovernanceAction(tx, request, transformationId, PREPARE);
      const expected = requireIfMatch(request);
      const current = await tx
        .selectFrom("meeting")
        .selectAll()
        .where("id", "=", meetingId)
        .where("transformation_id", "=", transformationId)
        .forUpdate()
        .executeTakeFirst();
      if (!current) throw problems.notFound();
      if (current.version !== expected) throw problems.versionConflict(current.version);
      if (FINAL_STATUSES.has(current.status)) throw meetingRefusals.final(current.status);
      if (body.quorumMin !== undefined && (current.status === "in_session" || current.status === "held"))
        throw meetingRefusals.quorumLocked(current.status);
      for (const [pointer, id] of [
        ["/chairUserId", body.chairUserId],
        ["/secretaryUserId", body.secretaryUserId],
      ] as const)
        if (id !== undefined && id !== null && !(await isActiveUserOf(tx, target.organizationId, id)))
          throw unknownTarget(pointer, "user");
      // The current local start time and duration, so a partial reschedule keeps the other parts.
      const local = (
        await sql<{
          t: string;
          mins: number;
        }>`SELECT to_char(${current.starts_at}::timestamptz AT TIME ZONE ${current.timezone}, 'HH24:MI') AS t,
               (extract(epoch FROM (${current.ends_at}::timestamptz - ${current.starts_at}::timestamptz)) / 60)::integer AS mins`.execute(
          tx,
        )
      ).rows[0]!;
      const date = body.scheduledDate ?? current.scheduled_date;
      const time = body.startTime ?? local.t;
      const minutes = body.durationMinutes ?? local.mins;
      const timesChanged =
        body.scheduledDate !== undefined || body.startTime !== undefined || body.durationMinutes !== undefined;
      let cutoff: { cutoff_date: string | null; cutoff_unknown_reason: string | null } | null = null;
      if (body.scheduledDate !== undefined && body.scheduledDate !== current.scheduled_date) {
        const forum = await loadForum(tx, transformationId, current.forum_id);
        const cal = await loadWorkingCalendar(tx, current.organization_id, date, date);
        const d = cutoffDateOf(date, forum.cutoff_working_days, cal.isWorkingDay);
        cutoff = { cutoff_date: d, cutoff_unknown_reason: d === null ? "calendar_not_configured" : null };
      }
      const updated = await tx
        .updateTable("meeting")
        .set({
          ...(body.scheduledDate !== undefined ? { scheduled_date: body.scheduledDate } : {}),
          ...(timesChanged
            ? {
                starts_at: zoned(date, time, current.timezone),
                ends_at: zonedEnd(date, time, minutes, current.timezone),
              }
            : {}),
          ...(cutoff ?? {}),
          ...(body.location !== undefined ? { location: body.location } : {}),
          ...(body.chairUserId !== undefined ? { chair_user_id: body.chairUserId } : {}),
          ...(body.secretaryUserId !== undefined ? { secretary_user_id: body.secretaryUserId } : {}),
          ...(body.quorumMin !== undefined ? { quorum_min: body.quorumMin } : {}),
          version: sql<number>`version + 1`,
          updated_at: sql<Date>`now()`,
          updated_by: userId,
        })
        .where("id", "=", meetingId)
        .where("version", "=", current.version)
        .returningAll()
        .executeTakeFirst();
      if (!updated) throw problems.versionConflict(current.version + 1);
      await record(tx, auditContextOf(request), {
        action: "meeting.update",
        recordType: "meeting",
        recordId: meetingId,
        organizationId: current.organization_id,
        transformationId,
        priorVersion: current.version,
        newVersion: updated.version,
        changes: diffFields(meetingFields(current), meetingFields(updated)),
      });
      return updated;
    });
    const [out] = await toMeetings(db, [row]);
    return sendVersioned(reply, 200, out!);
  });

  // Bodiless actions (no config.consumes; the completeWorkItem precedent, S-3).
  app.post(PUBLISH, { config: { access: { permission: CHAIR } } }, async (request, reply) => {
    const { transformationId, meetingId } = parse(meetingParams, request.params, "params");
    const row = await db.transaction().execute(async (tx) => {
      const { userId } = await requireGovernanceAction(tx, request, transformationId, CHAIR);
      const current = await loadForTransition(tx, request, transformationId, meetingId, {
        from: ["scheduled"],
        to: "agenda_published",
      });
      // Chair is a record-level rule (ADR-0032 §9; work split D.8 item 9): holding meeting.chair is not sufficient.
      if (current.chair_user_id === null) throw meetingRefusals.chairUnassigned();
      if (current.chair_user_id !== userId) throw meetingRefusals.notChair();
      const items = await tx
        .selectFrom("agenda_item")
        .select(["status", sql<number>`count(*)::integer`.as("n")])
        .where("meeting_id", "=", meetingId)
        .groupBy("status")
        .execute();
      const count = (s: string) => items.find((i) => i.status === s)?.n ?? 0;
      if (count("draft") > 0) throw meetingRefusals.agendaHasDrafts();
      if (count("published") === 0) throw meetingRefusals.agendaEmpty();
      return applyTransition(tx, auditContextOf(request), current, userId, "agenda_published", {});
    });
    const [out] = await toMeetings(db, [row]);
    return sendVersioned(reply, 200, out!);
  });

  app.post(START, { config: { access: { permission: PREPARE } } }, async (request, reply) => {
    const { transformationId, meetingId } = parse(meetingParams, request.params, "params");
    const row = await db.transaction().execute(async (tx) => {
      const { userId } = await requireGovernanceAction(tx, request, transformationId, PREPARE);
      const current = await loadForTransition(tx, request, transformationId, meetingId, {
        from: ["scheduled", "agenda_published"],
        to: "in_session",
      });
      return applyTransition(tx, auditContextOf(request), current, userId, "in_session", {
        started_at: sql<Date>`now()`,
      });
    });
    const [out] = await toMeetings(db, [row]);
    return sendVersioned(reply, 200, out!);
  });

  app.post(CLOSE, { config: { access: { permission: PREPARE } } }, async (request, reply) => {
    const { transformationId, meetingId } = parse(meetingParams, request.params, "params");
    const row = await db.transaction().execute(async (tx) => {
      const { userId } = await requireGovernanceAction(tx, request, transformationId, PREPARE);
      const current = await loadForTransition(tx, request, transformationId, meetingId, {
        from: ["in_session"],
        to: "held",
      });
      return applyTransition(tx, auditContextOf(request), current, userId, "held", { held_at: sql<Date>`now()` });
    });
    const [out] = await toMeetings(db, [row]);
    return sendVersioned(reply, 200, out!);
  });

  app.post(CANCEL, { config: { access: { permission: PREPARE }, consumes: JSON_BODY } }, async (request, reply) => {
    const { transformationId, meetingId } = parse(meetingParams, request.params, "params");
    const body = parseBody(reasonRequest, request.body);
    const row = await db.transaction().execute(async (tx) => {
      const { userId } = await requireGovernanceAction(tx, request, transformationId, PREPARE);
      const current = await loadForTransition(tx, request, transformationId, meetingId, {
        from: ["scheduled", "agenda_published"],
        to: "cancelled",
      });
      return applyTransition(tx, auditContextOf(request), current, userId, "cancelled", {
        cancelled_at: sql<Date>`now()`,
        cancelled_by: userId,
        cancel_reason: "manual",
        cancel_note: body.reason,
      });
    });
    const [out] = await toMeetings(db, [row]);
    return sendVersioned(reply, 200, out!);
  });

  return [
    `GET ${MEETINGS}`,
    `POST ${MEETINGS}`,
    `GET ${ONE}`,
    `PATCH ${ONE}`,
    `POST ${PUBLISH}`,
    `POST ${START}`,
    `POST ${CLOSE}`,
    `POST ${CANCEL}`,
  ];
}

/** A forum named in a request body: 400 at /forumId when it is not a forum of this transformation. */
export async function forumOfBody(db: DbOrTx, transformationId: string, forumId: string): Promise<ForumRow> {
  const forum = await db
    .selectFrom("forum")
    .selectAll()
    .where("id", "=", forumId)
    .where("transformation_id", "=", transformationId)
    .executeTakeFirst();
  if (!forum)
    throw problems.validation([
      { pointer: "/forumId", code: "validation.forum_unknown", message: "Choose a forum of this transformation." },
    ]);
  return forum;
}

/** The transformation's timezone (default Asia/Riyadh); meetings are held in it unless their series names another. */
export async function transformationTimezone(db: DbOrTx, transformationId: string): Promise<string> {
  const t = await db
    .selectFrom("transformation")
    .select("timezone")
    .where("id", "=", transformationId)
    .executeTakeFirst();
  return t?.timezone ?? "Asia/Riyadh";
}

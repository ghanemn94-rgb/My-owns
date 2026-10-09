// Meeting series (OpenAPI tag "meeting-series"; ADR-0032 §2, §9-§11; REQ-PB-060 "a forum meeting series generates
// meetings on the configured recurrence", REQ-S10-005 "changing Workstream Review from weekly to fortnightly regenerates
// future meetings only"; T-DG4-BE-F):
//   GET   /transformations/{id}/meeting-series                         the series of the transformation's forums
//   POST  /transformations/{id}/meeting-series                         start a series; its meetings up to the horizon
//                                                                      are generated in the same transaction
//   GET   /transformations/{id}/meeting-series/{seriesId}              one series
//   PATCH /transformations/{id}/meeting-series/{seriesId}              change it; a recurrence change steps rule_version and
//                                                                      regenerates FUTURE meetings only (If-Match)
//   POST  /transformations/{id}/meeting-series/{seriesId}/end          end it; future empty meetings are cancelled (final)
//
// Every generation and regeneration runs under pg_advisory_xact_lock(ADVISORY_LOCK_CLASSES.meetingSeriesGeneration,
// hashtext('<seriesId>')); the worker job governance.meeting_series_generate (apps/worker/src/handlers/meetings.ts, the
// twin of `generateSeriesMeetings`, because the worker imports no API code) takes the same lock, and the partial unique
// index meeting_series_occurrence_key makes a duplicate occurrence impossible. Working days come from the organization's
// default business calendar; without one a rule that needs working days generates nothing and reports
// `calendar_not_configured` (Unknown, never a guessed date). Nothing here approves anything or touches DG0-DG7.
import type { DbOrTx, MeetingSeriesRow, Tx } from "@mth/db";
import { sql } from "@mth/db";
import {
  addCalendarDays,
  seriesOccurrences,
  type NonWorkingDayRule,
  type Occurrence,
  type RecurrenceFrequency,
} from "@mth/shared/calc";
import {
  meetingSeriesCreate,
  meetingSeriesListQuery,
  meetingSeriesUpdate,
  uuid,
  type MeetingSeries,
  type MeetingSeriesResult,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyReply } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { auditContextOf, principalOf, requireTransformationRead } from "../access/index.ts";
import { record, type AuditContext } from "../audit/index.ts";
import { defaultCalendarTimezone } from "../organization/index.ts";
import {
  ADVISORY_LOCK_CLASSES,
  cursorSchema,
  decodeCursor,
  etag,
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
import { diffFields, forumRefusals, requireGovernanceAction } from "./forums.ts";
import {
  businessToday,
  forumOfBody,
  insertMeeting,
  loadWorkingCalendar,
  resolveChairUser,
  transformationTimezone,
} from "./meetings.ts";

const JSON_BODY = ["application/json"] as const;
const CONFIGURE = "forum.configure" as const;

const transformationParams = z.strictObject({ transformationId: uuid });
const seriesParams = z.strictObject({ transformationId: uuid, meetingSeriesId: uuid });

// ------------------------------------------------------------------------------------------------ refusals (S-11)

/** ADR-0032 §11, series lines: exact codes and English texts. */
export const meetingSeriesRefusals = {
  ruleInvalid: (pointer: "/weekdays" | "/monthDay") =>
    new HttpProblem({
      status: 400,
      type: "urn:mth:problem:validation",
      code: "meeting_series.rule_invalid",
      title: "Invalid request",
      detail:
        "A weekly series needs its weekdays, a monthly series a day of the month (1–28), and a daily series neither.",
      errors: [
        {
          pointer,
          code: "meeting_series.rule_invalid",
          message:
            "A weekly series needs its weekdays, a monthly series a day of the month (1–28), and a daily series neither.",
        },
      ],
    }),
  exists: () =>
    problems.duplicate("meeting_series.exists", "This forum already has an active meeting series; change it instead."),
  ended: () =>
    problems.businessRule("meeting_series.ended", "This meeting series has ended and can no longer be changed."),
  /** An end date before the start date (a 400 on the request's own fields). */
  dates: () =>
    problems.validation([
      {
        pointer: "/endDate",
        code: "validation.end_before_start",
        message: "The end date cannot be before the start date.",
      },
    ]),
} as const;

// ------------------------------------------------------------------------------------------------ the rule

interface Rule {
  frequency: RecurrenceFrequency;
  interval_count: number;
  weekdays: number[] | null;
  month_day: number | null;
  start_date: string;
  end_date: string | null;
  start_time: string;
  duration_minutes: number;
  timezone: string;
  non_working_day_rule: NonWorkingDayRule;
  horizon_days: number;
}

/** The rule shape of `meeting_series_rule_shape`, checked before the database (400 meeting_series.rule_invalid). */
function validateRule(r: Rule): void {
  if (r.frequency === "weekly") {
    if (r.weekdays === null) throw meetingSeriesRefusals.ruleInvalid("/weekdays");
    if (r.month_day !== null) throw meetingSeriesRefusals.ruleInvalid("/monthDay");
  } else if (r.frequency === "monthly") {
    if (r.month_day === null) throw meetingSeriesRefusals.ruleInvalid("/monthDay");
    if (r.weekdays !== null) throw meetingSeriesRefusals.ruleInvalid("/weekdays");
  } else {
    if (r.weekdays !== null) throw meetingSeriesRefusals.ruleInvalid("/weekdays");
    if (r.month_day !== null) throw meetingSeriesRefusals.ruleInvalid("/monthDay");
  }
  if (r.end_date !== null && r.end_date < r.start_date) throw meetingSeriesRefusals.dates();
}

const hhmm = (t: string) => t.slice(0, 5);

/** True when a recurrence field differs (the fields of the 0044 rule_version trigger). */
function ruleChanged(a: Rule, b: Rule): boolean {
  return (
    a.frequency !== b.frequency ||
    a.interval_count !== b.interval_count ||
    JSON.stringify(a.weekdays) !== JSON.stringify(b.weekdays) ||
    a.month_day !== b.month_day ||
    a.start_date !== b.start_date ||
    a.end_date !== b.end_date ||
    hhmm(a.start_time) !== hhmm(b.start_time) ||
    a.duration_minutes !== b.duration_minutes ||
    a.timezone !== b.timezone ||
    a.non_working_day_rule !== b.non_working_day_rule
  );
}

const ruleOf = (s: MeetingSeriesRow): Rule => ({
  frequency: s.frequency as RecurrenceFrequency,
  interval_count: s.interval_count,
  weekdays: s.weekdays === null ? null : s.weekdays.map(Number),
  month_day: s.month_day,
  start_date: s.start_date,
  end_date: s.end_date,
  start_time: hhmm(s.start_time),
  duration_minutes: s.duration_minutes,
  timezone: s.timezone,
  non_working_day_rule: s.non_working_day_rule as NonWorkingDayRule,
  horizon_days: s.horizon_days,
});

export interface SeriesPlan {
  readonly occurrences: readonly Occurrence[];
  /** The last date the plan covers (null when Unknown). */
  readonly through: string | null;
  readonly unknownReason: "calendar_not_configured" | null;
  readonly calendar: Awaited<ReturnType<typeof loadWorkingCalendar>>;
}

/**
 * The occurrences of `rule` from max(start, today + 1, fromDate) to min(end, today + horizon) in the series timezone,
 * minus the nominal dates in `held` (meetings of the series that are not cancelled).
 */
async function planOccurrences(
  db: DbOrTx,
  organizationId: string,
  rule: Rule,
  fromDate: string | null,
  held: ReadonlySet<string>,
): Promise<SeriesPlan> {
  const today = await businessToday(db, rule.timezone);
  const tomorrow = addCalendarDays(today, 1);
  const from = [rule.start_date, tomorrow, fromDate ?? tomorrow].reduce((a, b) => (a > b ? a : b));
  const horizonEnd = addCalendarDays(today, rule.horizon_days);
  const through = rule.end_date !== null && rule.end_date < horizonEnd ? rule.end_date : horizonEnd;
  // next_working_day can move the last occurrence a little past `through`; the calendar covers that too.
  const calendar = await loadWorkingCalendar(db, organizationId, from, addCalendarDays(through, 366));
  const result = seriesOccurrences(
    {
      frequency: rule.frequency,
      intervalCount: rule.interval_count,
      weekdays: rule.weekdays,
      monthDay: rule.month_day,
      startDate: rule.start_date,
      endDate: rule.end_date,
      nonWorkingDayRule: rule.non_working_day_rule,
    },
    from,
    through,
    calendar.isWorkingDay,
  );
  if (result.status === "unknown") return { occurrences: [], through: null, unknownReason: result.reason, calendar };
  return {
    occurrences: result.occurrences.filter((o) => !held.has(o.occurrenceDate)),
    through,
    unknownReason: null,
    calendar,
  };
}

/** Nominal dates held by the series' meetings that are not cancelled (the unique key's domain). */
async function heldOccurrences(db: DbOrTx, seriesId: string): Promise<Set<string>> {
  const rows = await db
    .selectFrom("meeting")
    .select("occurrence_date")
    .where("series_id", "=", seriesId)
    .where("status", "<>", "cancelled")
    .execute();
  return new Set(rows.map((r) => r.occurrence_date!));
}

async function lockSeries(tx: Tx, seriesId: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.meetingSeriesGeneration}::integer, hashtext(${seriesId}::text))`.execute(
    tx,
  );
}

/** Inserts the planned meetings of a series (chair, secretary, quorum and cut-off from its forum). */
async function insertPlanned(
  tx: Tx,
  audit: AuditContext,
  series: MeetingSeriesRow,
  plan: SeriesPlan,
  authorUserId: string,
): Promise<string[]> {
  if (plan.occurrences.length === 0) return [];
  const forum = await tx.selectFrom("forum").selectAll().where("id", "=", series.forum_id).executeTakeFirstOrThrow();
  const chair = await resolveChairUser(tx, forum);
  const ids: string[] = [];
  for (const o of plan.occurrences)
    ids.push(
      await insertMeeting(tx, audit, {
        forum,
        scheduledDate: o.scheduledDate,
        startTime: hhmm(series.start_time),
        durationMinutes: series.duration_minutes,
        timezone: series.timezone,
        location: series.location,
        chairUserId: chair,
        secretaryUserId: forum.secretary_user_id,
        calendar: plan.calendar,
        series: { id: series.id, ruleVersion: series.rule_version, occurrenceDate: o.occurrenceDate },
        authorUserId,
      }),
    );
  return ids;
}

/**
 * Generates the missing meetings of an active series from `fromDate` (or tomorrow) to its horizon, under the meetingSeriesGeneration lock,
 * as the person `authorUserId` (API callers; the worker has its own twin). Advances `generated_through` (version + 1,
 * audited) when the plan reaches further. Returns the created meeting ids and the Unknown reason, if any.
 */
export async function generateSeriesMeetings(
  tx: Tx,
  seriesId: string,
  fromDate: string | null,
  actor: { readonly audit: AuditContext; readonly userId: string },
): Promise<{ createdMeetingIds: string[]; unknownReason: "calendar_not_configured" | null }> {
  await lockSeries(tx, seriesId);
  const series = await tx.selectFrom("meeting_series").selectAll().where("id", "=", seriesId).executeTakeFirst();
  if (!series || series.status !== "active") return { createdMeetingIds: [], unknownReason: null };
  const plan = await planOccurrences(
    tx,
    series.organization_id,
    ruleOf(series),
    fromDate,
    await heldOccurrences(tx, seriesId),
  );
  const ids = await insertPlanned(tx, actor.audit, series, plan, actor.userId);
  if (plan.through !== null && (series.generated_through === null || plan.through > series.generated_through)) {
    await tx
      .updateTable("meeting_series")
      .set({ generated_through: plan.through, version: sql<number>`version + 1`, updated_at: sql<Date>`now()` })
      .where("id", "=", seriesId)
      .execute();
    await record(tx, actor.audit, {
      action: "meeting_series.generate",
      recordType: "meeting_series",
      recordId: seriesId,
      organizationId: series.organization_id,
      transformationId: series.transformation_id,
      priorVersion: series.version,
      newVersion: series.version + 1,
      changes: { generated_through: { from: series.generated_through, to: plan.through } },
    });
  }
  return { createdMeetingIds: ids, unknownReason: plan.unknownReason };
}

/**
 * Cancels every future (after today's business date in the series timezone), still `scheduled` meeting of the series
 * without content (agenda item, attendance, output, action link, blocker status or minutes), with `reason`; audited as
 * the person. Returns the cancelled ids. The database refuses anything else (meeting_regenerate_future_only).
 */
async function cancelFutureEmpty(
  tx: Tx,
  audit: AuditContext,
  series: MeetingSeriesRow,
  reason: "series_regenerated" | "series_ended",
  userId: string,
): Promise<string[]> {
  const today = await businessToday(tx, series.timezone);
  const targets = await tx
    .selectFrom("meeting as m")
    .select(["m.id", "m.version", "m.organization_id", "m.transformation_id"])
    .where("m.series_id", "=", series.id)
    .where("m.status", "=", "scheduled")
    .where("m.scheduled_date", ">", today)
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom("agenda_item")
            .select(sql`1`.as("x"))
            .whereRef("agenda_item.meeting_id", "=", "m.id")
            .unionAll(
              selectFrom("meeting_attendance")
                .select(sql`1`.as("x"))
                .whereRef("meeting_attendance.meeting_id", "=", "m.id"),
            )
            .unionAll(
              selectFrom("meeting_output")
                .select(sql`1`.as("x"))
                .whereRef("meeting_output.meeting_id", "=", "m.id"),
            )
            .unionAll(
              selectFrom("meeting_action_link")
                .select(sql`1`.as("x"))
                .whereRef("meeting_action_link.meeting_id", "=", "m.id"),
            )
            .unionAll(
              selectFrom("blocker_status")
                .select(sql`1`.as("x"))
                .whereRef("blocker_status.meeting_id", "=", "m.id"),
            )
            .unionAll(
              selectFrom("meeting_minutes")
                .select(sql`1`.as("x"))
                .whereRef("meeting_minutes.meeting_id", "=", "m.id"),
            ),
        ),
      ),
    )
    .orderBy("m.scheduled_date")
    .forUpdate()
    .execute();
  for (const m of targets) {
    await tx
      .updateTable("meeting")
      .set({
        status: "cancelled",
        cancel_reason: reason,
        cancelled_at: sql<Date>`now()`,
        cancelled_by: userId,
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`,
        updated_by: userId,
      })
      .where("id", "=", m.id)
      .execute();
    await record(tx, audit, {
      action: "meeting.cancel",
      recordType: "meeting",
      recordId: m.id,
      organizationId: m.organization_id,
      transformationId: m.transformation_id,
      priorVersion: m.version,
      newVersion: m.version + 1,
      changes: { status: { from: "scheduled", to: "cancelled" }, cancel_reason: { from: null, to: reason } },
    });
  }
  return targets.map((m) => m.id);
}

/** Meetings of the series that are not cancelled (kept by a regeneration or an end). */
async function keptMeetings(db: DbOrTx, seriesId: string): Promise<string[]> {
  const rows = await db
    .selectFrom("meeting")
    .select("id")
    .where("series_id", "=", seriesId)
    .where("status", "<>", "cancelled")
    .orderBy("scheduled_date")
    .orderBy("id")
    .execute();
  return rows.map((r) => r.id);
}

// ------------------------------------------------------------------------------------------------ mapping

export const toMeetingSeries = (r: MeetingSeriesRow): MeetingSeries => ({
  id: r.id,
  transformationId: r.transformation_id,
  forumId: r.forum_id,
  frequency: r.frequency as MeetingSeries["frequency"],
  intervalCount: r.interval_count,
  weekdays: r.weekdays === null ? null : r.weekdays.map(Number),
  monthDay: r.month_day,
  startDate: r.start_date,
  endDate: r.end_date,
  startTime: hhmm(r.start_time),
  durationMinutes: r.duration_minutes,
  timezone: r.timezone,
  nonWorkingDayRule: r.non_working_day_rule as MeetingSeries["nonWorkingDayRule"],
  horizonDays: r.horizon_days,
  location: r.location,
  ruleVersion: r.rule_version,
  generatedThrough: r.generated_through,
  status: r.status as MeetingSeries["status"],
  endedAt: isoOrNull(r.ended_at),
  endedBy: r.ended_by,
  version: r.version,
  createdAt: iso(r.created_at),
  createdBy: r.created_by,
  updatedAt: iso(r.updated_at),
  updatedBy: r.updated_by,
});

const seriesFields = (r: Partial<MeetingSeriesRow>): ReadonlyMap<string, unknown> =>
  new Map<string, unknown>([
    ["forum_id", r.forum_id],
    ["frequency", r.frequency],
    ["interval_count", r.interval_count],
    ["weekdays", r.weekdays],
    ["month_day", r.month_day],
    ["start_date", r.start_date],
    ["end_date", r.end_date],
    ["start_time", r.start_time === undefined ? undefined : hhmm(r.start_time)],
    ["duration_minutes", r.duration_minutes],
    ["timezone", r.timezone],
    ["non_working_day_rule", r.non_working_day_rule],
    ["horizon_days", r.horizon_days],
    ["location", r.location],
    ["rule_version", r.rule_version],
    ["generated_through", r.generated_through],
    ["status", r.status],
  ]);

async function loadSeries(db: DbOrTx, transformationId: string, seriesId: string): Promise<MeetingSeriesRow> {
  const row = await db
    .selectFrom("meeting_series")
    .selectAll()
    .where("id", "=", seriesId)
    .where("transformation_id", "=", transformationId)
    .executeTakeFirst();
  if (!row) throw problems.notFound();
  return row;
}

/** A MeetingSeriesResult with the series' version as its ETag (and a Location on create). */
function sendResult(reply: FastifyReply, status: number, result: MeetingSeriesResult, location?: string): FastifyReply {
  reply.header("ETag", etag(result.series.version));
  if (location) reply.header("Location", location);
  return reply.code(status).send(result);
}

// ------------------------------------------------------------------------------------------------ routes

export function registerMeetingSeriesRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const SERIES = "/api/v1/transformations/:transformationId/meeting-series";
  const ONE = `${SERIES}/:meetingSeriesId`;
  const END = `${ONE}/end`;
  const read = { access: { permission: "transformation.read" as const } };

  app.get(SERIES, { config: read }, async (request) => {
    const { transformationId } = parse(transformationParams, request.params, "params");
    const query = parseQuery(
      meetingSeriesListQuery.extend({ cursor: cursorSchema, limit: limitSchema }),
      request.query,
    );
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({ transformationId, forumId: query.forumId ?? null, status: query.status ?? null });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("meeting_series").selectAll().where("transformation_id", "=", transformationId);
    if (query.forumId !== undefined) q = q.where("forum_id", "=", query.forumId);
    if (query.status !== undefined) q = q.where("status", "=", query.status);
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: page.items.map(toMeetingSeries), nextCursor: page.nextCursor };
  });

  app.post(SERIES, { config: { access: { permission: CONFIGURE }, consumes: JSON_BODY } }, async (request, reply) => {
    const { transformationId } = parse(transformationParams, request.params, "params");
    const body = parseBody(meetingSeriesCreate, request.body);
    const result = await db.transaction().execute(async (tx): Promise<MeetingSeriesResult> => {
      const { userId, target } = await requireGovernanceAction(tx, request, transformationId, CONFIGURE);
      const audit = auditContextOf(request);
      const forum = await forumOfBody(tx, transformationId, body.forumId);
      if (forum.status === "archived") throw forumRefusals.archived();
      const rule: Rule = {
        frequency: body.frequency,
        interval_count: body.intervalCount,
        weekdays: body.weekdays ?? null,
        month_day: body.monthDay ?? null,
        start_date: body.startDate,
        end_date: body.endDate ?? null,
        start_time: body.startTime,
        duration_minutes: body.durationMinutes,
        timezone:
          body.timezone ??
          (await defaultCalendarTimezone(tx, target.organizationId)) ??
          (await transformationTimezone(tx, transformationId)),
        non_working_day_rule: body.nonWorkingDayRule ?? "next_working_day",
        horizon_days: body.horizonDays ?? 90,
      };
      validateRule(rule);
      // One active series per forum: decided on the forum row, the unique index is the backstop.
      await sql`SELECT 1 FROM forum WHERE id = ${forum.id}::uuid FOR UPDATE`.execute(tx);
      const active = await tx
        .selectFrom("meeting_series")
        .select("id")
        .where("forum_id", "=", forum.id)
        .where("status", "=", "active")
        .executeTakeFirst();
      if (active) throw meetingSeriesRefusals.exists();
      const id = uuidv7();
      await lockSeries(tx, id);
      const plan = await planOccurrences(tx, target.organizationId, rule, null, new Set());
      const created = await tx
        .insertInto("meeting_series")
        .values({
          id,
          organization_id: target.organizationId,
          transformation_id: transformationId,
          forum_id: forum.id,
          frequency: rule.frequency,
          interval_count: rule.interval_count,
          weekdays: rule.weekdays,
          month_day: rule.month_day,
          start_date: rule.start_date,
          end_date: rule.end_date,
          start_time: rule.start_time,
          duration_minutes: rule.duration_minutes,
          timezone: rule.timezone,
          non_working_day_rule: rule.non_working_day_rule,
          horizon_days: rule.horizon_days,
          location: body.location ?? null,
          generated_through: plan.through,
          created_by: userId,
          updated_by: userId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await record(tx, audit, {
        action: "meeting_series.create",
        recordType: "meeting_series",
        recordId: id,
        organizationId: target.organizationId,
        transformationId,
        newVersion: 1,
        changes: diffFields(new Map(), seriesFields(created)),
      });
      const createdMeetingIds = await insertPlanned(tx, audit, created, plan, userId);
      return {
        series: toMeetingSeries(created),
        createdMeetingIds,
        cancelledMeetingIds: [],
        keptMeetingIds: [],
        generationUnknownReason: plan.unknownReason,
      };
    });
    return sendResult(
      reply,
      201,
      result,
      `/api/v1/transformations/${transformationId}/meeting-series/${result.series.id}`,
    );
  });

  app.get(ONE, { config: read }, async (request, reply) => {
    const { transformationId, meetingSeriesId } = parse(seriesParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    return sendVersioned(reply, 200, toMeetingSeries(await loadSeries(db, transformationId, meetingSeriesId)));
  });

  app.patch(ONE, { config: { access: { permission: CONFIGURE }, consumes: JSON_BODY } }, async (request, reply) => {
    const { transformationId, meetingSeriesId } = parse(seriesParams, request.params, "params");
    const body = parseBody(meetingSeriesUpdate, request.body);
    const result = await db.transaction().execute(async (tx): Promise<MeetingSeriesResult> => {
      const { userId } = await requireGovernanceAction(tx, request, transformationId, CONFIGURE);
      const expected = requireIfMatch(request);
      const audit = auditContextOf(request);
      await lockSeries(tx, meetingSeriesId);
      const current = await loadSeries(tx, transformationId, meetingSeriesId);
      if (current.version !== expected) throw problems.versionConflict(current.version);
      if (current.status === "ended") throw meetingSeriesRefusals.ended();
      const before = ruleOf(current);
      const frequency = body.frequency ?? before.frequency;
      // A field the new frequency does not take is cleared when the request changes the frequency without naming it.
      const next: Rule = {
        frequency,
        interval_count: body.intervalCount ?? before.interval_count,
        weekdays: body.weekdays !== undefined ? body.weekdays : frequency !== "weekly" ? null : before.weekdays,
        month_day: body.monthDay !== undefined ? body.monthDay : frequency !== "monthly" ? null : before.month_day,
        start_date: body.startDate ?? before.start_date,
        end_date: body.endDate !== undefined ? body.endDate : before.end_date,
        start_time: body.startTime ?? before.start_time,
        duration_minutes: body.durationMinutes ?? before.duration_minutes,
        timezone: body.timezone ?? before.timezone,
        non_working_day_rule: body.nonWorkingDayRule ?? before.non_working_day_rule,
        horizon_days: body.horizonDays ?? before.horizon_days,
      };
      validateRule(next);
      const regenerate = ruleChanged(before, next);
      // 1-2: future scheduled meetings without content are cancelled (FUTURE ONLY, ADR-0032 §2).
      const cancelledMeetingIds = regenerate
        ? await cancelFutureEmpty(tx, audit, current, "series_regenerated", userId)
        : [];
      // 3: the new rule's occurrences from tomorrow, skipping nominal dates still held by a kept meeting.
      const plan = await planOccurrences(
        tx,
        current.organization_id,
        next,
        null,
        await heldOccurrences(tx, meetingSeriesId),
      );
      const updated = await tx
        .updateTable("meeting_series")
        .set({
          frequency: next.frequency,
          interval_count: next.interval_count,
          weekdays: next.weekdays,
          month_day: next.month_day,
          start_date: next.start_date,
          end_date: next.end_date,
          start_time: next.start_time,
          duration_minutes: next.duration_minutes,
          timezone: next.timezone,
          non_working_day_rule: next.non_working_day_rule,
          horizon_days: next.horizon_days,
          ...(body.location !== undefined ? { location: body.location } : {}),
          ...(regenerate ? { rule_version: sql<number>`rule_version + 1` } : {}),
          generated_through: plan.through ?? (regenerate ? null : current.generated_through),
          version: sql<number>`version + 1`,
          updated_at: sql<Date>`now()`,
          updated_by: userId,
        })
        .where("id", "=", meetingSeriesId)
        .where("version", "=", current.version)
        .returningAll()
        .executeTakeFirst();
      if (!updated) throw problems.versionConflict(current.version + 1);
      await record(tx, audit, {
        action: "meeting_series.update",
        recordType: "meeting_series",
        recordId: meetingSeriesId,
        organizationId: current.organization_id,
        transformationId,
        priorVersion: current.version,
        newVersion: updated.version,
        changes: diffFields(seriesFields(current), seriesFields(updated)),
      });
      const createdMeetingIds = await insertPlanned(tx, audit, updated, plan, userId);
      const created = new Set(createdMeetingIds);
      return {
        series: toMeetingSeries(updated),
        createdMeetingIds,
        cancelledMeetingIds,
        keptMeetingIds: regenerate ? (await keptMeetings(tx, meetingSeriesId)).filter((id) => !created.has(id)) : [],
        generationUnknownReason: plan.unknownReason,
      };
    });
    return sendResult(reply, 200, result);
  });

  // Bodiless action (no config.consumes; the completeWorkItem precedent, S-3).
  app.post(END, { config: { access: { permission: CONFIGURE } } }, async (request, reply) => {
    const { transformationId, meetingSeriesId } = parse(seriesParams, request.params, "params");
    const result = await db.transaction().execute(async (tx): Promise<MeetingSeriesResult> => {
      const { userId } = await requireGovernanceAction(tx, request, transformationId, CONFIGURE);
      const expected = requireIfMatch(request);
      const audit = auditContextOf(request);
      await lockSeries(tx, meetingSeriesId);
      const current = await loadSeries(tx, transformationId, meetingSeriesId);
      if (current.version !== expected) throw problems.versionConflict(current.version);
      if (current.status === "ended") throw meetingSeriesRefusals.ended();
      const cancelledMeetingIds = await cancelFutureEmpty(tx, audit, current, "series_ended", userId);
      const updated = await tx
        .updateTable("meeting_series")
        .set({
          status: "ended",
          ended_at: sql<Date>`now()`,
          ended_by: userId,
          version: sql<number>`version + 1`,
          updated_at: sql<Date>`now()`,
          updated_by: userId,
        })
        .where("id", "=", meetingSeriesId)
        .where("version", "=", current.version)
        .returningAll()
        .executeTakeFirst();
      if (!updated) throw problems.versionConflict(current.version + 1);
      await record(tx, audit, {
        action: "meeting_series.end",
        recordType: "meeting_series",
        recordId: meetingSeriesId,
        organizationId: current.organization_id,
        transformationId,
        priorVersion: current.version,
        newVersion: updated.version,
        changes: { status: { from: "active", to: "ended" } },
      });
      return {
        series: toMeetingSeries(updated),
        createdMeetingIds: [],
        cancelledMeetingIds,
        keptMeetingIds: await keptMeetings(tx, meetingSeriesId),
        generationUnknownReason: null,
      };
    });
    return sendResult(reply, 200, result);
  });

  return [`GET ${SERIES}`, `POST ${SERIES}`, `GET ${ONE}`, `PATCH ${ONE}`, `POST ${END}`];
}

// meetings job handlers (T-DG4-BE-F; p4-work-split §D.1; stub by T-DG4-BE-A): the meeting-series generation job of
// slice D (ADR-0032 §2, §10; REQ-PB-060 "a forum meeting series generates meetings on the configured recurrence").
//
//   queue / consumer                     trigger                               idempotency key
//   governance.meeting_series_generate   daily schedule (Asia/Riyadh default)   meeting_series_generate:<seriesId>:<businessDate>:<ruleVersion>
//
// For every active series, one runOnce(consumer, key, fn) transaction (S-13):
//   1. takes pg_advisory_xact_lock(730238 meetingSeriesGeneration, hashtext('<seriesId>')), the lock the API's
//      createMeetingSeries / updateMeetingSeries / endMeetingSeries take, then re-reads the series (an ended series or a
//      new rule version since the scan is skipped: the next run picks the new rule up);
//   2. plans the occurrences from tomorrow (the business date in the series timezone, p4_business_date) to the
//      horizon with @mth/shared/calc seriesOccurrences over the organization's default business calendar, minus the
//      nominal dates held by meetings that are not cancelled; inserts them as `meeting` rows with created_source
//      'worker', created_by NULL and the audit actor `service` (jobActor). The partial unique index
//      meeting_series_occurrence_key is the second line of defence, so a retried or re-run job never duplicates;
//   3. advances generated_through (version + 1, audited; updated_by NULL: the job never changes the recurrence);
//   4. without an active default calendar a rule that needs working days creates nothing (Unknown, never a guessed
//      date) and the series author gets ONE inbox notification `governance.notice.series_calendar_not_configured`
//      per series and rule version.
// This file is the twin of apps/api/src/modules/governance/meeting-series.ts `generateSeriesMeetings` (the worker imports
// no API code, ADR-0002 rule 5; the BE-D2 precedent, D-101): the recurrence itself is the shared pure library, and the
// SQL here mirrors the API's insert. A meeting approves nothing; no job decides a business approval or touches DG0-DG7.
import { insertAuditEvent, sql, type AuditActor, type Db, type Tx } from "@mth/db";
import {
  addCalendarDays,
  cutoffDateOf,
  seriesOccurrences,
  type NonWorkingDayRule,
  type RecurrenceFrequency,
  type WorkingDayPredicate,
} from "@mth/shared/calc";
import { isWorkingDay } from "@mth/shared/time";
import { jobActor, runOnce } from "../kit.ts";
import type { JobHandler } from "./spec.ts";

/** ADR-0016 §6 / apps/api platform/advisory-locks.ts `meetingSeriesGeneration` (the worker imports no API code). */
export const MEETING_SERIES_LOCK_CLASS = 730238;
export const MEETING_SERIES_GENERATE_QUEUE = "governance.meeting_series_generate";
export const MEETING_SERIES_GENERATE_CONSUMER = "governance.meeting_series_generate";
export const SERIES_CALENDAR_NOTICE = "governance.notice.series_calendar_not_configured";
/** How far before the earliest date the calendar's holidays are loaded (the API's CALENDAR_LOOKBACK_DAYS). */
const CALENDAR_LOOKBACK_DAYS = 120;

export interface SeriesGenerationOutcome {
  readonly seriesId: string;
  readonly outcome: "generated" | "duplicate" | "skipped";
  readonly createdMeetingIds: readonly string[];
  readonly unknownReason: "calendar_not_configured" | null;
}

async function workingCalendarOf(
  db: Tx,
  organizationId: string,
  from: string,
  to: string,
): Promise<WorkingDayPredicate> {
  const calendar = await db
    .selectFrom("business_calendar")
    .select(["id", "workweek"])
    .where("organization_id", "=", organizationId)
    .where("is_default", "=", true)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (!calendar) return null;
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
  return (d: string) => isWorkingDay(d, cal);
}

/** The forum's chair party mapped to a person (the API's resolveParty rule: a group or no mapping gives null). */
async function chairOf(tx: Tx, transformationId: string, chairPartyCode: string | null): Promise<string | null> {
  if (chairPartyCode === null) return null;
  const m = await tx
    .selectFrom("role_mapping")
    .select(["target_kind", "user_id"])
    .where("transformation_id", "=", transformationId)
    .where("party_code", "=", chairPartyCode)
    .where("status", "=", "active")
    .executeTakeFirst();
  return m?.target_kind === "user" ? m.user_id : null;
}

async function uuidv7(tx: Tx): Promise<string> {
  const r = await sql<{ id: string }>`SELECT mth_uuid_v7() AS id`.execute(tx);
  return r.rows[0]!.id;
}

/** Generates one series' missing meetings inside `tx` (the caller holds the ledger row). */
export async function generateSeriesInTx(
  tx: Tx,
  actor: AuditActor,
  seriesId: string,
  expectedRuleVersion: number | null,
): Promise<Omit<SeriesGenerationOutcome, "outcome"> & { skipped: boolean }> {
  await sql`SELECT pg_advisory_xact_lock(${MEETING_SERIES_LOCK_CLASS}::integer, hashtext(${seriesId}::text))`.execute(
    tx,
  );
  const s = await tx.selectFrom("meeting_series").selectAll().where("id", "=", seriesId).executeTakeFirst();
  const none = { seriesId, createdMeetingIds: [], unknownReason: null };
  if (!s || s.status !== "active" || (expectedRuleVersion !== null && s.rule_version !== expectedRuleVersion))
    return { ...none, skipped: true };
  const forum = await tx.selectFrom("forum").selectAll().where("id", "=", s.forum_id).executeTakeFirstOrThrow();
  const today = (await sql<{ d: string }>`SELECT p4_business_date(now(), ${s.timezone})::text AS d`.execute(tx))
    .rows[0]!.d;
  const tomorrow = addCalendarDays(today, 1);
  const from = s.start_date > tomorrow ? s.start_date : tomorrow;
  const horizonEnd = addCalendarDays(today, s.horizon_days);
  const through = s.end_date !== null && s.end_date < horizonEnd ? s.end_date : horizonEnd;
  const predicate = await workingCalendarOf(tx, s.organization_id, from, addCalendarDays(through, 366));
  const plan = seriesOccurrences(
    {
      frequency: s.frequency as RecurrenceFrequency,
      intervalCount: s.interval_count,
      weekdays: s.weekdays === null ? null : s.weekdays.map(Number),
      monthDay: s.month_day,
      startDate: s.start_date,
      endDate: s.end_date,
      nonWorkingDayRule: s.non_working_day_rule as NonWorkingDayRule,
    },
    from,
    through,
    predicate,
  );
  if (plan.status === "unknown") {
    await notifyCalendarMissing(tx, actor, s);
    return { seriesId, createdMeetingIds: [], unknownReason: plan.reason, skipped: false };
  }
  const held = new Set(
    (
      await tx
        .selectFrom("meeting")
        .select("occurrence_date")
        .where("series_id", "=", seriesId)
        .where("status", "<>", "cancelled")
        .execute()
    ).map((r) => r.occurrence_date!),
  );
  const chair = await chairOf(tx, s.transformation_id, forum.chair_party_code);
  const startTime = s.start_time.slice(0, 5);
  const created: string[] = [];
  for (const o of plan.occurrences) {
    if (held.has(o.occurrenceDate)) continue;
    const id = await uuidv7(tx);
    const cutoff = cutoffDateOf(o.scheduledDate, forum.cutoff_working_days, predicate);
    await tx
      .insertInto("meeting")
      .values({
        id,
        organization_id: s.organization_id,
        transformation_id: s.transformation_id,
        forum_id: s.forum_id,
        series_id: s.id,
        series_rule_version: s.rule_version,
        occurrence_date: o.occurrenceDate,
        scheduled_date: o.scheduledDate,
        starts_at: sql<Date>`((${o.scheduledDate}::date + ${startTime}::time) AT TIME ZONE ${s.timezone})`,
        ends_at: sql<Date>`((${o.scheduledDate}::date + ${startTime}::time + make_interval(mins => ${s.duration_minutes}::integer)) AT TIME ZONE ${s.timezone})`,
        timezone: s.timezone,
        location: s.location,
        chair_user_id: chair,
        secretary_user_id: forum.secretary_user_id,
        quorum_min: forum.quorum_min,
        cutoff_date: cutoff,
        cutoff_unknown_reason: cutoff === null ? "calendar_not_configured" : null,
        created_source: "worker",
        created_by: null,
        updated_by: null,
      })
      .execute();
    await insertAuditEvent(tx, actor, {
      action: "meeting.create",
      recordType: "meeting",
      recordId: id,
      organizationId: s.organization_id,
      transformationId: s.transformation_id,
      newVersion: 1,
      changes: {
        forum_id: { from: null, to: s.forum_id },
        series_id: { from: null, to: s.id },
        occurrence_date: { from: null, to: o.occurrenceDate },
        scheduled_date: { from: null, to: o.scheduledDate },
        chair_user_id: { from: null, to: chair },
        quorum_min: { from: null, to: forum.quorum_min },
        cutoff_date: { from: null, to: cutoff },
      },
    });
    created.push(id);
  }
  if (s.generated_through === null || through > s.generated_through) {
    await tx
      .updateTable("meeting_series")
      .set({
        generated_through: through,
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`,
        updated_by: null,
      })
      .where("id", "=", s.id)
      .execute();
    await insertAuditEvent(tx, actor, {
      action: "meeting_series.generate",
      recordType: "meeting_series",
      recordId: s.id,
      organizationId: s.organization_id,
      transformationId: s.transformation_id,
      priorVersion: s.version,
      newVersion: s.version + 1,
      changes: { generated_through: { from: s.generated_through, to: through } },
    });
  }
  return { seriesId, createdMeetingIds: created, unknownReason: null, skipped: false };
}

/** One inbox notification per series and rule version to its author: no calendar, so no meeting was generated. */
async function notifyCalendarMissing(
  tx: Tx,
  actor: AuditActor,
  s: {
    id: string;
    organization_id: string;
    transformation_id: string;
    forum_id: string;
    created_by: string;
    rule_version: number;
  },
): Promise<void> {
  const id = await uuidv7(tx);
  const dedupeKey = `meeting_series.calendar_not_configured:${s.id}:${s.rule_version}`;
  const inserted = await tx
    .insertInto("inbox_notification")
    .values({
      id,
      organization_id: s.organization_id,
      transformation_id: s.transformation_id,
      recipient_user_id: s.created_by,
      work_item_id: null,
      link_path: `/transformations/${s.transformation_id}/forums/${s.forum_id}`,
      message_key: SERIES_CALENDAR_NOTICE,
      message_params: JSON.stringify({ seriesId: s.id, ruleVersion: s.rule_version }),
      dedupe_key: dedupeKey,
      created_by: null,
      updated_by: null,
    })
    .onConflict((oc) => oc.columns(["organization_id", "dedupe_key"]).doNothing())
    .returning("id")
    .executeTakeFirst();
  if (inserted)
    await insertAuditEvent(tx, actor, {
      action: "inbox_notification.create",
      recordType: "inbox_notification",
      recordId: id,
      organizationId: s.organization_id,
      transformationId: s.transformation_id,
      newVersion: 1,
      changes: {
        recipient_user_id: { from: null, to: s.created_by },
        dedupe_key: { from: null, to: dedupeKey },
      },
    });
}

/**
 * The scheduled job: every active series, each in its own runOnce transaction keyed by series, business date and rule
 * version (a second run on the same business day, a retry or a redelivery creates nothing).
 */
export async function handleMeetingSeriesGenerate(
  db: Db,
  _data: unknown,
  jobId: string,
): Promise<SeriesGenerationOutcome[]> {
  const series = await db
    .selectFrom("meeting_series")
    .select(["id", "rule_version", sql<string>`p4_business_date(now(), timezone)::text`.as("today")])
    .where("status", "=", "active")
    .orderBy("id")
    .execute();
  const out: SeriesGenerationOutcome[] = [];
  for (const s of series) {
    const key = `meeting_series_generate:${s.id}:${s.today}:${s.rule_version}`;
    const r = await runOnce(db, MEETING_SERIES_GENERATE_CONSUMER, key, (tx) =>
      generateSeriesInTx(tx, jobActor(jobId), s.id, s.rule_version),
    );
    if (r.outcome === "duplicate") {
      out.push({ seriesId: s.id, outcome: "duplicate", createdMeetingIds: [], unknownReason: null });
      continue;
    }
    out.push({
      seriesId: s.id,
      outcome: r.result.skipped ? "skipped" : "generated",
      createdMeetingIds: r.result.createdMeetingIds,
      unknownReason: r.result.unknownReason,
    });
  }
  return out;
}

export const MEETINGS_HANDLERS: readonly JobHandler[] = [
  { queue: MEETING_SERIES_GENERATE_QUEUE, handle: handleMeetingSeriesGenerate },
];

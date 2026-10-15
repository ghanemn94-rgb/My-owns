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
import { truncateText } from "@mth/shared/schemas"; // T-DG5-BE-L2
import { createWorkItemOnce, jobActor, runOnce } from "../kit.ts"; // createWorkItemOnce: T-DG5-BE-L2
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

// ---------------------------------------------------------------------------------------------------------------
// T-DG5-BE-L2 (ADR-0044 §6; REQ-S12-015, M0235 "Meeting cut-off reached | Generate a draft agenda and pack from current
// data with a review step before publication"; p5-work-split §E.4). New function only; the series job above is
// unchanged. Starter 12 (`starter.meeting_cutoff`): automation/starters.ts wraps this handler, so each run is recorded
// as an execution of the starter's effective rule version.
//
//   queue / consumer                   trigger                                   idempotency key
//   governance.meeting_cutoff_scan     daily schedule 00:30 Asia/Riyadh (0075)   meeting_cutoff:<meetingId>
//
// For every meeting in status `scheduled` whose cut-off date is today or earlier and whose scheduled date is today or
// later (business dates in the meeting's time zone) and that has no pack, one runOnce transaction (lock-free; the
// UNIQUE meeting_cutoff_pack_once_key is the second line, MP03):
//   1. re-reads the meeting FOR UPDATE; if it is no longer eligible the transaction rolls back WITHOUT its ledger row,
//      so a later scan still sees it;
//   2. reads the meeting transformation's CURRENT open asks: the predicate of the DG4 agenda's linkable-ask check
//      (apps/api governance/agenda.ts `checkLinkable`: an executive decision of the transformation with an ask origin,
//      status open or deferred), minus the asks already on this meeting's agenda (any item not withdrawn);
//   3. creates one `draft` executive-ask agenda item linked to each (next free ordinals; at most the forum's agenda
//      limit, else 200), audited; the item's created_by is the meeting's owner of record (its creator, else its series'
//      author: agenda_item.created_by is NOT NULL, 0044) and the audit actor is this service on that person's behalf;
//   4. inserts the `draft` pack (the open-asks snapshot, the created item ids; content never changes, MP05), audited;
//   5. gives the chair (else the secretary) one `meeting_pack_review` work item; with neither, none, and the pack
//      reads reviewerAssigned = false ("No reviewer assigned").
// The twin of apps/api governance/cut-off.ts `generateCutoffPackInTx` (the worker imports no API code; parity test in
// apps/api/test/integration/governance/cutoff-pack.test.ts). Reviewing the pack is a human action of the chair or the
// secretary; nothing here reviews, publishes or decides anything, and nothing touches DG0-DG7.
export const MEETING_CUTOFF_SCAN_QUEUE = "governance.meeting_cutoff_scan";
export const MEETING_CUTOFF_SCAN_CONSUMER = "governance.meeting_cutoff_scan";
export const MEETING_PACK_REVIEW_KIND = "meeting_pack_review";
export const MEETING_PACK_REVIEW_MESSAGE = "governance.task.meeting_pack_review";
/** The most asks a pack holds (meeting_cutoff_pack open_asks / agenda_item_ids CHECKs). */
export const CUTOFF_PACK_MAX_ASKS = 200;
const AGENDA_MAX_ORDINAL = 999;

export interface CutoffPackOutcome {
  readonly meetingId: string;
  readonly outcome: "generated" | "duplicate" | "skipped";
  readonly packId: string | null;
  readonly agendaItemIds: readonly string[];
}

/** Thrown inside the runOnce transaction to roll it back (with its ledger row) when the meeting is no longer due. */
class CutoffNotDue extends Error {}

interface CutoffAsk {
  readonly decisionId: string;
  readonly code: string;
  readonly title: string;
  readonly status: "open" | "deferred";
  readonly ownerUserId: string | null;
  readonly dueDate: string | null;
  readonly agendaItemId: string | null;
}

/** Generates one meeting's pack inside `tx` (the caller holds the ledger row); throws CutoffNotDue when not due. */
export async function generateCutoffPackInTx(
  tx: Tx,
  jobId: string,
  meetingId: string,
): Promise<{ packId: string; agendaItemIds: string[] }> {
  const m = await tx.selectFrom("meeting").selectAll().where("id", "=", meetingId).forUpdate().executeTakeFirst();
  if (!m) throw new CutoffNotDue();
  const today = (await sql<{ d: string }>`SELECT p4_business_date(now(), ${m.timezone})::text AS d`.execute(tx))
    .rows[0]!.d;
  const cutoff = m.cutoff_date === null ? null : String(m.cutoff_date).slice(0, 10);
  const scheduled = String(m.scheduled_date).slice(0, 10);
  const existing = await tx
    .selectFrom("meeting_cutoff_pack")
    .select("id")
    .where("meeting_id", "=", m.id)
    .executeTakeFirst();
  if (m.status !== "scheduled" || cutoff === null || cutoff > today || scheduled < today || existing)
    throw new CutoffNotDue();
  const forum = await tx
    .selectFrom("forum")
    .select(["name_en", "name_ar", "agenda_max_items"])
    .where("id", "=", m.forum_id)
    .executeTakeFirstOrThrow();
  const series =
    m.series_id === null
      ? null
      : await tx.selectFrom("meeting_series").select("created_by").where("id", "=", m.series_id).executeTakeFirst();
  const owner = m.created_by ?? series?.created_by ?? null;
  if (owner === null) throw new Error(`meeting_cutoff_scan: meeting ${m.id} has no owner of record`);
  const asks = await tx
    .selectFrom("decision as d")
    .select([
      "d.id",
      "d.code",
      "d.title",
      "d.status",
      "d.owner_user_id",
      sql<string | null>`d.due_date::text`.as("due"),
    ])
    .where("d.transformation_id", "=", m.transformation_id)
    .where("d.kind", "=", "executive")
    .where("d.ask_origin", "is not", null)
    .where("d.status", "in", ["open", "deferred"])
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom("agenda_item as a")
            .select("a.id")
            .whereRef("a.decision_id", "=", "d.id")
            .where("a.meeting_id", "=", m.id)
            .where("a.status", "<>", "withdrawn"),
        ),
      ),
    )
    .orderBy(sql`d.due_date NULLS LAST`)
    .orderBy("d.code")
    .orderBy("d.id")
    .limit(CUTOFF_PACK_MAX_ASKS)
    .execute();
  const counts = await tx
    .selectFrom("agenda_item")
    .select([
      sql<number>`count(*) FILTER (WHERE status <> 'withdrawn')::integer`.as("n"),
      sql<number>`coalesce(max(ordinal), 0)::integer`.as("maxOrdinal"),
    ])
    .where("meeting_id", "=", m.id)
    .executeTakeFirstOrThrow();
  const room = Math.max(
    0,
    Math.min(
      forum.agenda_max_items === null ? CUTOFF_PACK_MAX_ASKS : forum.agenda_max_items - counts.n,
      AGENDA_MAX_ORDINAL - counts.maxOrdinal,
    ),
  );
  const ownerActor = jobActor(jobId, owner);
  const late = today > cutoff;
  const scope = { organizationId: m.organization_id, transformationId: m.transformation_id };
  const snapshot: CutoffAsk[] = [];
  const itemIds: string[] = [];
  for (const a of asks) {
    let itemId: string | null = null;
    if (itemIds.length < room) {
      itemId = await uuidv7(tx);
      const ordinal = counts.maxOrdinal + itemIds.length + 1;
      const title = truncateText(a.title, 500);
      await tx
        .insertInto("agenda_item")
        .values({
          id: itemId,
          organization_id: m.organization_id,
          transformation_id: m.transformation_id,
          meeting_id: m.id,
          ordinal,
          item_kind: "executive_ask",
          title,
          decision_id: a.id,
          late,
          created_by: owner,
          updated_by: owner,
        })
        .execute();
      await insertAuditEvent(tx, ownerActor, {
        action: "agenda_item.create",
        recordType: "agenda_item",
        recordId: itemId,
        ...scope,
        newVersion: 1,
        changes: {
          meeting_id: { from: null, to: m.id },
          ordinal: { from: null, to: ordinal },
          item_kind: { from: null, to: "executive_ask" },
          title: { from: null, to: title },
          decision_id: { from: null, to: a.id },
          late: { from: null, to: late },
          status: { from: null, to: "draft" },
        },
      });
      itemIds.push(itemId);
    }
    snapshot.push({
      decisionId: a.id,
      code: a.code,
      title: a.title,
      status: a.status as CutoffAsk["status"],
      ownerUserId: a.owner_user_id,
      dueDate: a.due,
      agendaItemId: itemId,
    });
  }
  const packId = await uuidv7(tx);
  const actor = jobActor(jobId);
  await tx
    .insertInto("meeting_cutoff_pack")
    .values({
      id: packId,
      organization_id: m.organization_id,
      transformation_id: m.transformation_id,
      meeting_id: m.id,
      cutoff_date: cutoff,
      as_of: sql<Date>`now()`,
      open_asks: JSON.stringify(snapshot),
      agenda_item_ids: itemIds,
      created_by: null,
      updated_by: null,
    })
    .execute();
  await insertAuditEvent(tx, actor, {
    action: "meeting_cutoff_pack.create",
    recordType: "meeting_cutoff_pack",
    recordId: packId,
    ...scope,
    newVersion: 1,
    changes: {
      meeting_id: { from: null, to: m.id },
      cutoff_date: { from: null, to: cutoff },
      open_asks: { from: null, to: snapshot.map((a) => a.decisionId) },
      agenda_item_ids: { from: null, to: itemIds },
      status: { from: null, to: "draft" },
    },
  });
  const reviewer = m.chair_user_id ?? m.secretary_user_id;
  if (reviewer !== null)
    await createWorkItemOnce(tx, actor, {
      organizationId: m.organization_id,
      transformationId: m.transformation_id,
      kind: MEETING_PACK_REVIEW_KIND,
      assigneeUserId: reviewer,
      subjectType: "meeting_cutoff_pack",
      subjectId: packId,
      linkPath: `/transformations/${m.transformation_id}/meetings/${m.id}`,
      messageKey: MEETING_PACK_REVIEW_MESSAGE,
      messageParams: {
        forum: forum.name_en,
        forumAr: forum.name_ar,
        meetingDate: scheduled,
        askCount: snapshot.length,
      },
      dueDate: scheduled,
      dedupeKey: `meeting_cutoff_pack:${packId}:${reviewer}`,
    });
  return { packId, agendaItemIds: itemIds };
}

/** Options of the scan: `meetingIds` restricts it to those meetings (tests share one database). */
export interface CutoffScanOptions {
  readonly meetingIds?: readonly string[];
}

/**
 * The scheduled job `governance.meeting_cutoff_scan`: one runOnce transaction per due meeting, keyed
 * `meeting_cutoff:<meetingId>` (a second scan, a retry or a redelivery creates nothing).
 */
export async function handleMeetingCutoffScan(
  db: Db,
  _data: unknown,
  jobId: string,
  options: CutoffScanOptions = {},
): Promise<CutoffPackOutcome[]> {
  let q = db
    .selectFrom("meeting as m")
    .select("m.id")
    .where("m.status", "=", "scheduled")
    .where("m.cutoff_date", "is not", null)
    .where(sql<boolean>`m.cutoff_date <= p4_business_date(now(), m.timezone)`)
    .where(sql<boolean>`m.scheduled_date >= p4_business_date(now(), m.timezone)`)
    .where(({ not, exists, selectFrom }) =>
      not(exists(selectFrom("meeting_cutoff_pack as p").select("p.id").whereRef("p.meeting_id", "=", "m.id"))),
    );
  if (options.meetingIds !== undefined) {
    if (options.meetingIds.length === 0) return [];
    q = q.where("m.id", "in", [...options.meetingIds]);
  }
  const due = await q.orderBy("m.id").execute();
  const out: CutoffPackOutcome[] = [];
  for (const { id } of due) {
    try {
      const r = await runOnce(db, MEETING_CUTOFF_SCAN_CONSUMER, `meeting_cutoff:${id}`, (tx) =>
        generateCutoffPackInTx(tx, jobId, id),
      );
      out.push(
        r.outcome === "duplicate"
          ? { meetingId: id, outcome: "duplicate", packId: null, agendaItemIds: [] }
          : { meetingId: id, outcome: "generated", packId: r.result.packId, agendaItemIds: r.result.agendaItemIds },
      );
    } catch (err) {
      if (!(err instanceof CutoffNotDue)) throw err;
      out.push({ meetingId: id, outcome: "skipped", packId: null, agendaItemIds: [] });
    }
  }
  return out;
}

export const MEETINGS_HANDLERS: readonly JobHandler[] = [
  { queue: MEETING_SERIES_GENERATE_QUEUE, handle: handleMeetingSeriesGenerate },
  { queue: MEETING_CUTOFF_SCAN_QUEUE, handle: (db, data, jobId) => handleMeetingCutoffScan(db, data, jobId) }, // T-DG5-BE-L2
];

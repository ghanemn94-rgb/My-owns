// The meeting-series generation job against a real PostgreSQL with pg-boss (T-DG4-BE-F; p4-work-split §D.1; ADR-0032
// §2, §10; REQ-PB-060 A01 "a forum meeting series generates meetings on the configured recurrence"). Proves:
//  - a weekly series generates one meeting per week to the horizon as worker meetings (created_source 'worker',
//    created_by NULL, audit actor `service`), advances generated_through, and never changes the recurrence;
//  - running the job twice (the same business day: the runOnce ledger) and running the generation again outside the
//    ledger (the held-occurrence rule and the unique index) create no duplicate;
//  - a daily series skips the weekend and an administered holiday of the organization's default business calendar;
//  - without a default calendar nothing is generated (Unknown) and the series author gets ONE inbox notification;
//  - an ended series is skipped;
//  - through the production worker (startWorker + a sent job) the same job runs end to end.
// All data and holidays are SYNTHETIC; no job decides a business approval or touches the engineering gates DG0-DG7.
import { insertAuditEvent, sql, type Db } from "@mth/db";
import type PgBoss from "pg-boss";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  generateSeriesInTx,
  handleMeetingSeriesGenerate,
  MEETING_SERIES_GENERATE_CONSUMER,
  MEETING_SERIES_GENERATE_QUEUE,
  MEETINGS_HANDLERS,
  SERIES_CALENDAR_NOTICE,
} from "../../src/handlers/meetings.ts";
import { jobActor } from "../../src/kit.ts";
import { ensureQueues } from "../../src/queues/index.ts";
import { startWorker } from "../../src/worker.ts";
import { bossFor, seedTransformationWithOutbox, waitFor, workerEnv, type WorkerEnv } from "../support.ts";

let env: WorkerEnv;
let boss: PgBoss;

beforeAll(async () => {
  env = await workerEnv();
  boss = bossFor(env.appUrl);
  boss.on("error", () => undefined);
  await boss.start();
  await ensureQueues(boss);
}, 60_000);

afterAll(async () => {
  await boss.stop({ graceful: false, wait: true, timeout: 5000 });
  await env.close();
});

const quiet = { info: () => undefined, error: () => undefined };
const actor = (userId: string) =>
  ({ actorType: "user", actorUserId: userId, requestId: `test-${randomUUID()}`, source: "api" }) as const;

interface World {
  readonly organizationId: string;
  readonly transformationId: string;
  readonly userId: string;
  readonly calendarId: string | null;
  /** Forum ids by template key (p4_instantiate_forums). */
  readonly forums: Record<string, string>;
}

async function seedWorld(db: Db, withCalendar: boolean): Promise<World> {
  const { transformationId, userId } = await seedTransformationWithOutbox(db);
  const t = await db
    .selectFrom("transformation")
    .select("organization_id")
    .where("id", "=", transformationId)
    .executeTakeFirstOrThrow();
  await sql`SELECT p4_instantiate_forums(${transformationId}::uuid, ${userId}::uuid, 'test:worker-forums', 'api')`.execute(
    db,
  );
  let calendarId: string | null = null;
  if (withCalendar) {
    calendarId = randomUUID();
    const id = calendarId;
    await db.transaction().execute(async (tx) => {
      await tx
        .insertInto("business_calendar")
        .values({
          id,
          organization_id: t.organization_id,
          code: "DEFAULT",
          name_en: "Synthetic default calendar",
          name_ar: "تقويم",
          timezone: "Asia/Riyadh",
          is_default: true,
          created_by: userId,
          updated_by: userId,
        })
        .execute();
      await insertAuditEvent(tx, actor(userId), {
        action: "business_calendar.create",
        recordType: "business_calendar",
        recordId: id,
        organizationId: t.organization_id,
        newVersion: 1,
      });
    });
  }
  const rows = await db
    .selectFrom("forum")
    .select(["id", "template_key"])
    .where("transformation_id", "=", transformationId)
    .execute();
  return {
    organizationId: t.organization_id,
    transformationId,
    userId,
    calendarId,
    forums: Object.fromEntries(rows.map((r) => [r.template_key!, r.id])),
  };
}

async function addHoliday(db: Db, w: World, date: string): Promise<void> {
  const id = randomUUID();
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto("business_calendar_holiday")
      .values({
        id,
        calendar_id: w.calendarId!,
        organization_id: w.organizationId,
        date_from: date,
        date_to: date,
        name_en: "Synthetic holiday",
        name_ar: "عطلة اصطناعية",
        created_by: w.userId,
        updated_by: w.userId,
      })
      .execute();
    await insertAuditEvent(tx, actor(w.userId), {
      action: "business_calendar_holiday.create",
      recordType: "business_calendar_holiday",
      recordId: id,
      organizationId: w.organizationId,
      newVersion: 1,
    });
  });
}

async function today(db: Db): Promise<string> {
  return (await sql<{ d: string }>`SELECT p4_business_date(now(), 'Asia/Riyadh')::text AS d`.execute(db)).rows[0]!.d;
}
const plusDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const isoWeekday = (date: string) => {
  const js = new Date(`${date}T00:00:00Z`).getUTCDay();
  return js === 0 ? 7 : js;
};

/** A series created by the world's person (as the API would), with its audit event. */
async function addSeries(
  db: Db,
  w: World,
  forumKey: string,
  rule: { frequency: "daily" | "weekly"; weekdays: number[] | null; horizonDays: number; startDate: string },
): Promise<string> {
  const id = randomUUID();
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto("meeting_series")
      .values({
        id,
        organization_id: w.organizationId,
        transformation_id: w.transformationId,
        forum_id: w.forums[forumKey]!,
        frequency: rule.frequency,
        interval_count: 1,
        weekdays: rule.weekdays,
        month_day: null,
        start_date: rule.startDate,
        end_date: null,
        start_time: "10:00",
        duration_minutes: 60,
        horizon_days: rule.horizonDays,
        created_by: w.userId,
        updated_by: w.userId,
      })
      .execute();
    await insertAuditEvent(tx, actor(w.userId), {
      action: "meeting_series.create",
      recordType: "meeting_series",
      recordId: id,
      organizationId: w.organizationId,
      transformationId: w.transformationId,
      newVersion: 1,
    });
  });
  return id;
}

const meetingsOf = (db: Db, seriesId: string) =>
  db.selectFrom("meeting").selectAll().where("series_id", "=", seriesId).orderBy("scheduled_date").execute();

describe("governance.meeting_series_generate (REQ-PB-060 A01)", () => {
  it("a weekly series: one worker meeting per week to the horizon; a second run the same day and a re-generation create none", async () => {
    const w = await seedWorld(env.db, true);
    const d0 = await today(env.db);
    let first = plusDays(d0, 1);
    while ([5, 6].includes(isoWeekday(first))) first = plusDays(first, 1);
    const seriesId = await addSeries(env.db, w, "workstream_review", {
      frequency: "weekly",
      weekdays: [isoWeekday(first)],
      horizonDays: 28,
      startDate: d0,
    });
    const run1 = await handleMeetingSeriesGenerate(env.db, {}, "job-weekly-1");
    const mine = run1.find((r) => r.seriesId === seriesId)!;
    expect([mine.outcome, mine.createdMeetingIds.length, mine.unknownReason]).toEqual(["generated", 4, null]);
    const rows = await meetingsOf(env.db, seriesId);
    expect(rows.map((r) => r.scheduled_date)).toEqual([0, 7, 14, 21].map((n) => plusDays(first, n)));
    expect(
      rows.every(
        (r) =>
          r.created_source === "worker" &&
          r.created_by === null &&
          r.status === "scheduled" &&
          r.series_rule_version === 1 &&
          r.cutoff_date !== null &&
          r.chair_user_id === null, // the WL party is not mapped in this world: no guessed chair
      ),
    ).toBe(true);
    const audit = await env.db.selectFrom("audit_event").selectAll().where("record_id", "=", rows[0]!.id).execute();
    expect(audit.map((a) => [a.action, a.actor_type, a.actor_user_id, a.source, a.request_id])).toEqual([
      ["meeting.create", "service", null, "worker", "job:job-weekly-1"],
    ]);
    const series = await env.db
      .selectFrom("meeting_series")
      .selectAll()
      .where("id", "=", seriesId)
      .executeTakeFirstOrThrow();
    expect([series.generated_through, series.version, series.rule_version, series.updated_by]).toEqual([
      plusDays(d0, 28),
      2,
      1,
      null,
    ]);
    const ledger = await env.db
      .selectFrom("processed_message")
      .select("idempotency_key")
      .where("consumer", "=", MEETING_SERIES_GENERATE_CONSUMER)
      .where("idempotency_key", "like", `meeting_series_generate:${seriesId}:%`)
      .execute();
    expect(ledger.map((l) => l.idempotency_key)).toEqual([`meeting_series_generate:${seriesId}:${d0}:1`]);

    const run2 = await handleMeetingSeriesGenerate(env.db, {}, "job-weekly-2");
    expect(run2.find((r) => r.seriesId === seriesId)!.outcome).toBe("duplicate");
    // Outside the ledger (a re-run with a new key): the held-occurrence rule creates nothing either.
    const again = await env.db
      .transaction()
      .execute((tx) => generateSeriesInTx(tx, jobActor("job-weekly-3"), seriesId, null));
    expect([again.createdMeetingIds, again.skipped]).toEqual([[], false]);
    expect((await meetingsOf(env.db, seriesId)).length).toBe(4);
  });

  it("a daily series skips Friday, Saturday and an administered holiday", async () => {
    const w = await seedWorld(env.db, true);
    const d0 = await today(env.db);
    let holiday = plusDays(d0, 1);
    while ([5, 6].includes(isoWeekday(holiday))) holiday = plusDays(holiday, 1);
    await addHoliday(env.db, w, holiday);
    const seriesId = await addSeries(env.db, w, "rapid_response", {
      frequency: "daily",
      weekdays: null,
      horizonDays: 10,
      startDate: d0,
    });
    await handleMeetingSeriesGenerate(env.db, {}, "job-daily-1");
    const expected: string[] = [];
    for (let d = plusDays(d0, 1); d <= plusDays(d0, 10); d = plusDays(d, 1))
      if (![5, 6].includes(isoWeekday(d)) && d !== holiday) expected.push(d);
    expect((await meetingsOf(env.db, seriesId)).map((r) => r.scheduled_date)).toEqual(expected);
  });

  it("without a default calendar: nothing generated (Unknown) and ONE inbox notification to the series author", async () => {
    const w = await seedWorld(env.db, false);
    const d0 = await today(env.db);
    const seriesId = await addSeries(env.db, w, "rapid_response", {
      frequency: "daily",
      weekdays: null,
      horizonDays: 14,
      startDate: d0,
    });
    const r = (await handleMeetingSeriesGenerate(env.db, {}, "job-nocal-1")).find((o) => o.seriesId === seriesId)!;
    expect([r.outcome, r.createdMeetingIds, r.unknownReason]).toEqual(["generated", [], "calendar_not_configured"]);
    await env.db.transaction().execute((tx) => generateSeriesInTx(tx, jobActor("job-nocal-2"), seriesId, null));
    expect((await meetingsOf(env.db, seriesId)).length).toBe(0);
    const notes = await env.db
      .selectFrom("inbox_notification")
      .selectAll()
      .where("recipient_user_id", "=", w.userId)
      .where("message_key", "=", SERIES_CALENDAR_NOTICE)
      .execute();
    expect(notes.length).toBe(1);
    expect([notes[0]!.dedupe_key, notes[0]!.link_path]).toEqual([
      `meeting_series.calendar_not_configured:${seriesId}:1`,
      `/transformations/${w.transformationId}/forums/${w.forums["rapid_response"]}`,
    ]);
    const series = await env.db
      .selectFrom("meeting_series")
      .selectAll()
      .where("id", "=", seriesId)
      .executeTakeFirstOrThrow();
    expect([series.generated_through, series.version]).toEqual([null, 1]);
  });

  it("an ended series is skipped", async () => {
    const w = await seedWorld(env.db, true);
    const d0 = await today(env.db);
    const seriesId = await addSeries(env.db, w, "value_review", {
      frequency: "weekly",
      weekdays: [1, 2, 3, 4, 7],
      horizonDays: 7,
      startDate: d0,
    });
    await env.db.transaction().execute(async (tx) => {
      await tx
        .updateTable("meeting_series")
        .set({ status: "ended", ended_at: new Date(), ended_by: w.userId, version: 2, updated_by: w.userId })
        .where("id", "=", seriesId)
        .execute();
      await insertAuditEvent(tx, actor(w.userId), {
        action: "meeting_series.end",
        recordType: "meeting_series",
        recordId: seriesId,
        organizationId: w.organizationId,
        transformationId: w.transformationId,
        priorVersion: 1,
        newVersion: 2,
      });
    });
    const r = await env.db.transaction().execute((tx) => generateSeriesInTx(tx, jobActor("job-ended"), seriesId, null));
    expect([r.skipped, r.createdMeetingIds]).toEqual([true, []]);
    expect((await handleMeetingSeriesGenerate(env.db, {}, "job-ended-2")).some((o) => o.seriesId === seriesId)).toBe(
      false,
    );
  });

  it("through the production worker: a sent job generates the meetings once", async () => {
    const w = await seedWorld(env.db, true);
    const d0 = await today(env.db);
    const seriesId = await addSeries(env.db, w, "transformation_review", {
      frequency: "weekly",
      weekdays: [1, 3],
      horizonDays: 14,
      startDate: d0,
    });
    await boss.send(MEETING_SERIES_GENERATE_QUEUE, {});
    const worker = await startWorker({
      db: env.db,
      boss,
      timeZone: "Asia/Riyadh",
      log: quiet,
      pollIntervalMs: 200,
      jobPollingIntervalSeconds: 0.5,
      handlers: MEETINGS_HANDLERS,
    });
    try {
      const rows = await waitFor(async () => {
        const r = await meetingsOf(env.db, seriesId);
        return r.length > 0 ? r : null;
      });
      const expected: string[] = [];
      for (let d = plusDays(d0, 1); d <= plusDays(d0, 14); d = plusDays(d, 1))
        if ([1, 3].includes(isoWeekday(d))) expected.push(d);
      expect(rows.map((r) => r.scheduled_date)).toEqual(expected);
      await boss.send(MEETING_SERIES_GENERATE_QUEUE, {});
      await new Promise((r) => setTimeout(r, 1500));
      expect((await meetingsOf(env.db, seriesId)).length).toBe(expected.length);
    } finally {
      await worker.stop();
    }
  });
});

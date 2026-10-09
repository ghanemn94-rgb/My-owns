// Meeting series, generation and future-only regeneration (ADR-0032 §2, §9-§11; T-DG4-BE-F) against a real PostgreSQL:
//  - REQ-PB-060 A01 "a forum meeting series generates meetings on the configured recurrence": a weekly Workstream Review
//    series generates one meeting per week to the horizon, in the same transaction; running the generation again
//    creates no duplicate; a daily Rapid Response series skips the weekend and an administered holiday of the
//    organization's business calendar; without a calendar nothing is guessed (calendar_not_configured);
//  - REQ-S10-005 A06 "changing Workstream Review from weekly to fortnightly regenerates future meetings only":
//    intervalCount 2 cancels only future scheduled meetings without content (reason series_regenerated), keeps today's
//    and past meetings and a future meeting with an agenda item, and generates the fortnightly dates;
//  - every mutation: authorization (TO positive; TL, AUD 403; ADM-only and another organization 404; re-checked at
//    commit time), validation (400 meeting_series.rule_invalid), If-Match 428/409, 409 meeting_series.exists, 422
//    meeting_series.ended, its audit event.
// All data and holidays are SYNTHETIC; nothing here approves anything or touches the engineering gates DG0-DG7.
import { insertAuditEvent, sql } from "@mth/db";
import { nominalOccurrences } from "@mth/shared/calc";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateSeriesMeetings } from "../../../src/modules/governance/meeting-series.ts";
import { auditOf, call, seedWorld, signIn, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { person } from "../approvals/approval-world.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { addHoliday, ensureDefaultCalendar } from "../portfolio/execution-fixtures.ts";
import {
  addAgendaItem,
  businessToday,
  calendarlessWorld,
  isoWeekday,
  plusDays,
  setupMeetingWorld,
  type MeetingWorld,
} from "./meeting-fixtures.ts";

let api: TestApi;
let w: World;
let x: MeetingWorld;
let today: string;
/** A Sunday-Thursday weekday (the default workweek) for the weekly series. */
let W: number;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  x = await setupMeetingWorld(api, w);
  today = await businessToday(api);
  let d = plusDays(today, 2);
  while ([5, 6].includes(isoWeekday(d))) d = plusDays(d, 1);
  W = isoWeekday(d);
}, 120_000);
afterAll(() => api.close());

const S = () => `/api/v1/transformations/${x.transformationId}/meeting-series`;
const weekly = (extra: Record<string, unknown> = {}) => ({
  forumId: x.forums.workstream_review,
  frequency: "weekly",
  intervalCount: 1,
  weekdays: [W],
  startDate: today,
  startTime: "10:00",
  durationMinutes: 60,
  horizonDays: 56,
  ...extra,
});

async function seriesMeetings(seriesId: string) {
  return api.db
    .selectFrom("meeting")
    .selectAll()
    .where("series_id", "=", seriesId)
    .orderBy("scheduled_date")
    .orderBy("id")
    .execute();
}

/** A meeting of the series on a given (today or past) occurrence date, as created before today (synthetic). */
async function insertSeriesMeeting(seriesId: string, date: string): Promise<string> {
  const id = uuidv7();
  await api.db.transaction().execute(async (tx) => {
    const s = await tx.selectFrom("meeting_series").selectAll().where("id", "=", seriesId).executeTakeFirstOrThrow();
    await tx
      .insertInto("meeting")
      .values({
        id,
        organization_id: s.organization_id,
        transformation_id: s.transformation_id,
        forum_id: s.forum_id,
        series_id: s.id,
        series_rule_version: s.rule_version,
        occurrence_date: date,
        scheduled_date: date,
        starts_at: sql<Date>`((${date}::date + time '10:00') AT TIME ZONE 'Asia/Riyadh')`,
        ends_at: sql<Date>`((${date}::date + time '11:00') AT TIME ZONE 'Asia/Riyadh')`,
        cutoff_date: date,
        created_source: "api",
        created_by: x.office.id,
        updated_by: x.office.id,
      })
      .execute();
    await insertAuditEvent(
      tx,
      { actorType: "user", actorUserId: x.office.id, requestId: "test:series-meeting", source: "api" },
      {
        action: "meeting.create",
        recordType: "meeting",
        recordId: id,
        organizationId: s.organization_id,
        transformationId: s.transformation_id,
        newVersion: 1,
      },
    );
  });
  return id;
}

describe("REQ-PB-060 A01: a series generates meetings on the configured recurrence", () => {
  let seriesId: string;

  it("a weekly Workstream Review series creates one meeting per week to the horizon in the same call", async () => {
    const res = await send("POST", S(), { session: x.office.session, body: weekly() });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    seriesId = res.body.series.id;
    expect([res.headers.etag, res.body.series.version, res.body.series.ruleVersion, res.body.series.timezone]).toEqual([
      '"1"',
      1,
      1,
      "Asia/Riyadh",
    ]);
    expect([res.body.series.generatedThrough, res.body.generationUnknownReason]).toEqual([plusDays(today, 56), null]);
    const rows = await seriesMeetings(seriesId);
    expect(rows.length).toBe(8);
    expect(res.body.createdMeetingIds.sort()).toEqual(rows.map((r) => r.id).sort());
    const dates = rows.map((r) => r.scheduled_date);
    for (const [i, d] of dates.entries()) {
      expect(isoWeekday(d)).toBe(W);
      expect(d > today).toBe(true);
      if (i > 0) expect(d).toBe(plusDays(dates[i - 1]!, 7));
    }
    // Each meeting: the WL chair (Workstream Review chair party WL is mapped to the contributor), the forum's cut-off
    // two working days before on the business calendar, rule version 1, local start 10:00 Asia/Riyadh (07:00Z).
    expect(rows.every((r) => r.chair_user_id === x.contributor.id && r.series_rule_version === 1)).toBe(true);
    expect(rows.every((r) => r.cutoff_date !== null && r.cutoff_date < r.scheduled_date)).toBe(true);
    expect(rows[0]!.starts_at.toISOString().slice(11, 16)).toBe("07:00");
    expect((await auditOf(api.db, seriesId)).map((a) => a.action)).toEqual(["meeting_series.create"]);
    expect((await auditOf(api.db, rows[0]!.id)).map((a) => [a.action, a.actor_user_id])).toEqual([
      ["meeting.create", x.office.id],
    ]);
    const forum = await send(
      "GET",
      `/api/v1/transformations/${x.transformationId}/forums/${x.forums.workstream_review}`,
      {
        session: x.auditor.session,
      },
    );
    expect(forum.body.activeSeriesId).toBe(seriesId);
  });

  it("running the generation again creates no duplicate meeting", async () => {
    const audit = { actorUserId: x.office.id, requestId: "test:regenerate-twice" };
    for (let i = 0; i < 2; i++) {
      const r = await api.db
        .transaction()
        .execute((tx) => generateSeriesMeetings(tx, seriesId, null, { audit, userId: x.office.id }));
      expect(r).toEqual({ createdMeetingIds: [], unknownReason: null });
    }
    expect((await seriesMeetings(seriesId)).length).toBe(8);
  });

  it("a second active series on the forum is 409; reads are scoped; ADM-only and another organization 404", async () => {
    const dup = await send("POST", S(), { session: x.office.session, body: weekly() });
    expect([dup.status, dup.body.code, dup.body.detail]).toEqual([
      409,
      "meeting_series.exists",
      "This forum already has an active meeting series; change it instead.",
    ]);
    const list = await send("GET", `${S()}?forumId=${x.forums.workstream_review}&status=active`, {
      session: x.auditor.session,
    });
    expect(list.body.items.map((s: Body) => s.id)).toEqual([seriesId]);
    const one = await send("GET", `${S()}/${seriesId}`, { session: x.contributor.session });
    expect([one.status, one.body.weekdays, one.body.startTime]).toEqual([200, [W], "10:00"]);
    const outsider = await signIn(api.app, w.officeB.subject);
    for (const session of [x.admin, outsider]) {
      expect((await send("GET", S(), { session })).status).toBe(404);
      expect((await send("GET", `${S()}/${seriesId}`, { session })).status).toBe(404);
    }
  });

  describe("REQ-S10-005 A06: weekly -> fortnightly regenerates FUTURE meetings only", () => {
    it("cancels future empty meetings, keeps today's, past and content meetings, and generates the fortnightly dates", async () => {
      const before = await seriesMeetings(seriesId);
      const pastId = await insertSeriesMeeting(seriesId, plusDays(today, -7));
      const todayId = await insertSeriesMeeting(seriesId, today);
      // A future meeting with content (an agenda item) is kept.
      const withContent = before[1]!;
      await addAgendaItem(api, withContent.id, x.lead.id, "draft");

      const stale = await send("PATCH", `${S()}/${seriesId}`, {
        session: x.office.session,
        headers: ifm(9),
        body: { intervalCount: 2 },
      });
      expect([stale.status, stale.body.currentVersion]).toEqual([409, 1]);
      expect(
        (await send("PATCH", `${S()}/${seriesId}`, { session: x.office.session, body: { intervalCount: 2 } })).status,
      ).toBe(428);
      const res = await send("PATCH", `${S()}/${seriesId}`, {
        session: x.office.session,
        headers: ifm(1),
        body: { intervalCount: 2 },
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect([
        res.body.series.version,
        res.body.series.ruleVersion,
        res.body.series.intervalCount,
        res.headers.etag,
      ]).toEqual([2, 2, 2, '"2"']);

      const expectedCancelled = before.filter((m) => m.id !== withContent.id).map((m) => m.id);
      expect([...res.body.cancelledMeetingIds].sort()).toEqual(expectedCancelled.sort());
      expect(res.body.keptMeetingIds).toEqual(expect.arrayContaining([pastId, todayId, withContent.id]));

      const after = await seriesMeetings(seriesId);
      const byId = new Map(after.map((m) => [m.id, m]));
      for (const id of expectedCancelled) {
        const m = byId.get(id)!;
        expect([m.status, m.cancel_reason, m.cancelled_by]).toEqual(["cancelled", "series_regenerated", x.office.id]);
        expect((await auditOf(api.db, id)).map((a) => a.action)).toEqual(["meeting.create", "meeting.cancel"]);
      }
      for (const id of [pastId, todayId, withContent.id]) {
        const m = byId.get(id)!;
        expect([m.status, m.version, m.series_rule_version]).toEqual(["scheduled", 1, 1]);
      }

      // The new meetings follow the fortnightly rule from tomorrow (weeks counted from the start date's ISO week),
      // except a nominal date still held by the kept meeting.
      const expected = nominalOccurrences(
        {
          frequency: "weekly",
          intervalCount: 2,
          weekdays: [W],
          monthDay: null,
          startDate: today,
          endDate: null,
          nonWorkingDayRule: "next_working_day",
        },
        plusDays(today, 1),
        plusDays(today, 56),
      ).filter((d) => d !== withContent.occurrence_date);
      const fresh = after.filter((m) => m.series_rule_version === 2);
      expect(fresh.map((m) => m.occurrence_date)).toEqual(expected);
      expect([...res.body.createdMeetingIds].sort()).toEqual(fresh.map((m) => m.id).sort());
      for (let i = 1; i < fresh.length; i++)
        expect(fresh[i]!.scheduled_date).toBe(plusDays(fresh[i - 1]!.scheduled_date, 14));
      expect(fresh.every((m) => m.status === "scheduled" && m.scheduled_date > today)).toBe(true);
      const audit = (await auditOf(api.db, seriesId)).at(-1)!;
      expect([audit.action, audit.prior_version, audit.new_version]).toEqual(["meeting_series.update", 1, 2]);
      expect(audit.changes).toMatchObject({ interval_count: { from: 1, to: 2 }, rule_version: { from: 1, to: 2 } });
    });

    it("a non-recurrence change (horizon) steps the version but not the rule, and cancels nothing", async () => {
      const res = await send("PATCH", `${S()}/${seriesId}`, {
        session: x.office.session,
        headers: ifm(2),
        body: { horizonDays: 70 },
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect([
        res.body.series.version,
        res.body.series.ruleVersion,
        res.body.cancelledMeetingIds,
        res.body.keptMeetingIds,
      ]).toEqual([3, 2, [], []]);
      expect(res.body.series.generatedThrough).toBe(plusDays(today, 70));
    });

    it("negative: AUD and TL 403, ADM-only 404; invalid rule shapes are 400", async () => {
      const U = `${S()}/${seriesId}`;
      expect(
        (await send("PATCH", U, { session: x.auditor.session, headers: ifm(3), body: { intervalCount: 1 } })).status,
      ).toBe(403);
      expect(
        (await send("PATCH", U, { session: x.lead.session, headers: ifm(3), body: { intervalCount: 1 } })).status,
      ).toBe(403);
      expect((await send("PATCH", U, { session: x.admin, headers: ifm(3), body: { intervalCount: 1 } })).status).toBe(
        404,
      );
      const monthlyNoDay = await send("PATCH", U, {
        session: x.office.session,
        headers: ifm(3),
        body: { frequency: "monthly" },
      });
      expect([
        monthlyNoDay.status,
        monthlyNoDay.body.code,
        monthlyNoDay.body.errors[0].pointer,
        monthlyNoDay.body.detail,
      ]).toEqual([
        400,
        "meeting_series.rule_invalid",
        "/monthDay",
        "A weekly series needs its weekdays, a monthly series a day of the month (1–28), and a daily series neither.",
      ]);
      const dailyWithDays = await send("PATCH", U, {
        session: x.office.session,
        headers: ifm(3),
        body: { frequency: "daily", weekdays: [1] },
      });
      expect([dailyWithDays.status, dailyWithDays.body.errors[0].pointer]).toEqual([400, "/weekdays"]);
      const day29 = await send("PATCH", U, {
        session: x.office.session,
        headers: ifm(3),
        body: { frequency: "monthly", monthDay: 29 },
      });
      expect(day29.status).toBe(400);
      expect(
        (await send("PATCH", U, { session: x.office.session, headers: ifm(3), body: { timezone: "Mars/Base" } }))
          .status,
      ).toBe(400);
    });

    it("ending the series cancels future empty meetings (series_ended), keeps content; ended is final", async () => {
      const U = `${S()}/${seriesId}`;
      expect((await send("POST", `${U}/end`, { session: x.office.session })).status).toBe(428);
      expect((await send("POST", `${U}/end`, { session: x.auditor.session, headers: ifm(3) })).status).toBe(403);
      const res = await send("POST", `${U}/end`, { session: x.office.session, headers: ifm(3) });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect([res.body.series.status, res.body.series.endedBy, res.body.createdMeetingIds]).toEqual([
        "ended",
        x.office.id,
        [],
      ]);
      const after = await seriesMeetings(seriesId);
      const scheduledFuture = after.filter((m) => m.status === "scheduled" && m.scheduled_date > today);
      expect(scheduledFuture.map((m) => m.id)).toEqual([
        after.find((m) => m.series_rule_version === 1 && m.scheduled_date > today && m.status === "scheduled")!.id,
      ]);
      expect(
        after
          .filter((m) => m.cancel_reason === "series_ended")
          .map((m) => m.id)
          .sort(),
      ).toEqual([...res.body.cancelledMeetingIds].sort());
      const again = await send("PATCH", U, { session: x.office.session, headers: ifm(4), body: { intervalCount: 1 } });
      expect([again.status, again.body.code, again.body.detail]).toEqual([
        422,
        "meeting_series.ended",
        "This meeting series has ended and can no longer be changed.",
      ]);
      // A new series can start once the old one ended.
      expect((await send("POST", S(), { session: x.office.session, body: weekly({ horizonDays: 7 }) })).status).toBe(
        201,
      );
    });
  });
});

describe("working days come from the business calendar (ADR-0025 §1)", () => {
  it("a daily Rapid Response series skips Friday, Saturday and an administered holiday", async () => {
    const calendarId = await ensureDefaultCalendar(api, w);
    // A synthetic holiday on the third working day from tomorrow.
    let holiday = plusDays(today, 1);
    for (let n = 0; n < 3; holiday = plusDays(holiday, 1)) if (![5, 6].includes(isoWeekday(holiday))) n++;
    holiday = plusDays(holiday, -1);
    await addHoliday(api, w, calendarId, holiday);
    const res = await send("POST", S(), {
      session: x.office.session,
      body: {
        forumId: x.forums.rapid_response,
        frequency: "daily",
        intervalCount: 1,
        startDate: today,
        startTime: "08:00",
        durationMinutes: 15,
        horizonDays: 14,
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const rows = await seriesMeetings(res.body.series.id);
    const dates = rows.map((r) => r.scheduled_date);
    const expected: string[] = [];
    for (let d = plusDays(today, 1); d <= plusDays(today, 14); d = plusDays(d, 1))
      if (![5, 6].includes(isoWeekday(d)) && d !== holiday) expected.push(d);
    expect(dates).toEqual(expected);
    expect(dates).not.toContain(holiday);
    expect(rows.every((r) => r.occurrence_date === r.scheduled_date)).toBe(true);
  });

  it("without a business calendar a daily series generates nothing (calendar_not_configured); a 'keep' weekly series generates with an Unknown cut-off", async () => {
    const c = await calendarlessWorld(api);
    const U = `/api/v1/transformations/${c.transformationId}/meeting-series`;
    const daily = await send("POST", U, {
      session: c.to.session,
      body: {
        forumId: c.forums.rapid_response,
        frequency: "daily",
        intervalCount: 1,
        startDate: today,
        startTime: "08:00",
        durationMinutes: 15,
      },
    });
    expect(daily.status, JSON.stringify(daily.body)).toBe(201);
    expect([
      daily.body.createdMeetingIds,
      daily.body.generationUnknownReason,
      daily.body.series.generatedThrough,
    ]).toEqual([[], "calendar_not_configured", null]);
    const keep = await send("POST", U, {
      session: c.to.session,
      body: { ...weekly({ forumId: c.forums.workstream_review, horizonDays: 14 }), nonWorkingDayRule: "keep" },
    });
    expect([keep.status, keep.body.generationUnknownReason, keep.body.createdMeetingIds.length]).toEqual([
      201,
      null,
      2,
    ]);
    const rows = await seriesMeetings(keep.body.series.id);
    expect(rows.map((r) => [r.cutoff_date, r.cutoff_unknown_reason])).toEqual([
      [null, "calendar_not_configured"],
      [null, "calendar_not_configured"],
    ]);
    // No chair party is mapped in this transformation: the chair is null, never guessed.
    expect(rows.every((r) => r.chair_user_id === null)).toBe(true);
  });
});

describe("createMeetingSeries authorization and validation", () => {
  it("negative: AUD, TL 403; ADM-only, another organization 404; a forum of another transformation is 400", async () => {
    const outsider = await signIn(api.app, w.officeB.subject);
    const body = weekly({ forumId: x.forums.value_review });
    for (const [session, status] of [
      [x.auditor.session, 403],
      [x.lead.session, 403],
      [x.admin, 404],
      [outsider, 404],
    ] as const)
      expect((await send("POST", S(), { session, body })).status).toBe(status);
    const c = await calendarlessWorld(api);
    const foreign = await send("POST", S(), {
      session: x.office.session,
      body: weekly({ forumId: c.forums.value_review }),
    });
    expect([foreign.status, foreign.body.errors[0].pointer]).toEqual([400, "/forumId"]);
    const dates = await send("POST", S(), {
      session: x.office.session,
      body: weekly({ forumId: x.forums.value_review, endDate: plusDays(today, -1) }),
    });
    expect([dates.status, dates.body.errors[0].pointer]).toEqual([400, "/endDate"]);
    expect(
      (await api.db.selectFrom("meeting_series").select("id").where("forum_id", "=", x.forums.value_review).execute())
        .length,
    ).toBe(0);
  });

  it("commit-time: a TO whose grant is revoked while the request waits gets 403 and no series or meeting is written", async () => {
    const to = await person(api, w, x.transformationId, "TO");
    const res = await afterIdentity(
      api,
      to.id,
      () =>
        call(api.app, "POST", S(), {
          session: to.session,
          body: weekly({ forumId: x.forums.value_review }),
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, to.id),
    );
    expect(res.status).toBe(403);
    expect(
      (await api.db.selectFrom("meeting").select("id").where("forum_id", "=", x.forums.value_review).execute()).length,
    ).toBe(0);
  });
});

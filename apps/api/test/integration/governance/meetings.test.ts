// Meetings (ADR-0032 §3.1, §9-§11; T-DG4-BE-F) against a real PostgreSQL:
//  - REQ-S16-019 "Meeting": created and read through the API with authorization enforced (meeting.prepare: TL, TO;
//    SP and AUD 403; ADM-only and another organization 404; re-checked at commit time);
//  - the chair is a record-level rule: a forum without a mapped chair gives chairUserId null and publishMeetingAgenda is
//    422 meeting.chair_unassigned; a meeting.chair holder who is not the meeting's chair gets 403 meeting.not_chair;
//  - the cut-off is the scheduled date minus the forum's cut-off working days on the business calendar, Unknown
//    (calendar_not_configured) without one; presentCount and quorumState on read ("not configured" is never "met");
//  - the state machine (start, close, cancel with a note; final statuses), If-Match 428/409, audit events;
//  - `nextForumDateProvider` (ADR-0026 §5, D-089 Q6): the next scheduled Executive SteerCo date, or Unknown, also
//    through BE-C's due-date preview of the T11 row "Funding reallocation" (next_steerco_or_urgent).
// All data is SYNTHETIC; nothing here approves anything or touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { nextForumDateProvider } from "../../../src/modules/governance/meetings.ts";
import { auditOf, call, seedWorld, signIn, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { person } from "../approvals/approval-world.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import {
  addAgendaItem,
  addAttendance,
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  x = await setupMeetingWorld(api, w);
  today = await businessToday(api);
}, 120_000);
afterAll(() => api.close());

const M = () => `/api/v1/transformations/${x.transformationId}/meetings`;
const meetingBody = (forumId: string, days = 10, extra: Record<string, unknown> = {}) => ({
  forumId,
  scheduledDate: plusDays(today, days),
  startTime: "09:00",
  durationMinutes: 60,
  ...extra,
});

/** The n-th working day (Sunday-Thursday, no holiday in this organization) before `date`. */
function workingDaysBefore(date: string, n: number): string {
  let d = date;
  for (let found = 0; found < n; ) {
    d = plusDays(d, -1);
    if (![5, 6].includes(isoWeekday(d))) found++;
  }
  return d;
}

describe("createMeeting and getMeeting (REQ-S16-019 Meeting)", () => {
  it("TL creates an ad-hoc meeting: chair from the forum's chair party, quorum copied, cut-off on the business calendar", async () => {
    await send("PATCH", `/api/v1/transformations/${x.transformationId}/forums/${x.forums.transformation_review}`, {
      session: x.office.session,
      headers: ifm(1),
      body: { quorumMin: 2, cutoffWorkingDays: 3 },
    });
    const res = await send("POST", M(), {
      session: x.lead.session,
      body: meetingBody(x.forums.transformation_review, 12),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect([res.headers.etag, res.body.status, res.body.createdSource, res.body.createdBy, res.body.seriesId]).toEqual([
      '"1"',
      "scheduled",
      "api",
      x.lead.id,
      null,
    ]);
    expect([res.body.chairUserId, res.body.quorumMin, res.body.timezone]).toEqual([x.lead.id, 2, "Asia/Riyadh"]);
    expect([res.body.cutoffDate, res.body.cutoffUnknownReason]).toEqual([
      workingDaysBefore(plusDays(today, 12), 3),
      null,
    ]);
    expect([res.body.presentCount, res.body.quorumState]).toEqual([0, "not_met"]);
    expect(res.body.startsAt).toBe(`${plusDays(today, 12)}T06:00:00.000Z`);
    expect(res.body.endsAt).toBe(`${plusDays(today, 12)}T07:00:00.000Z`);
    expect(res.headers.location).toBe(`${M()}/${res.body.id}`);
    expect((await auditOf(api.db, res.body.id)).map((a) => [a.action, a.actor_user_id, a.new_version])).toEqual([
      ["meeting.create", x.lead.id, 1],
    ]);
    const read = await send("GET", `${M()}/${res.body.id}`, { session: x.auditor.session });
    expect([read.status, read.headers.etag, read.body.id]).toEqual([200, '"1"', res.body.id]);
  });

  it("presentCount and quorumState are computed on read; quorum not configured is never 'met'", async () => {
    const res = await send("POST", M(), {
      session: x.office.session,
      body: meetingBody(x.forums.transformation_review, 13),
    });
    const id = res.body.id;
    await addAttendance(api, id, x.lead.id);
    let read = await send("GET", `${M()}/${id}`, { session: x.auditor.session });
    expect([read.body.presentCount, read.body.quorumState]).toEqual([1, "not_met"]);
    await addAttendance(api, id, x.contributor.id);
    read = await send("GET", `${M()}/${id}`, { session: x.auditor.session });
    expect([read.body.presentCount, read.body.quorumState]).toEqual([2, "met"]);
    const none = await send("POST", M(), {
      session: x.office.session,
      body: meetingBody(x.forums.workstream_review, 13),
    });
    await addAttendance(api, none.body.id, x.lead.id);
    const r2 = await send("GET", `${M()}/${none.body.id}`, { session: x.auditor.session });
    expect([r2.body.quorumMin, r2.body.presentCount, r2.body.quorumState]).toEqual([null, 1, "not_configured"]);
    const list = await send("GET", `${M()}?forumId=${x.forums.transformation_review}`, { session: x.auditor.session });
    expect(list.body.items.find((m: Body) => m.id === id).quorumState).toBe("met");
  });

  it("without a business calendar the cut-off is Unknown (calendar_not_configured), never guessed", async () => {
    const c = await calendarlessWorld(api);
    const res = await send("POST", `/api/v1/transformations/${c.transformationId}/meetings`, {
      session: c.to.session,
      body: meetingBody(c.forums.value_review, 9),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect([res.body.cutoffDate, res.body.cutoffUnknownReason, res.body.chairUserId]).toEqual([
      null,
      "calendar_not_configured",
      null,
    ]);
  });

  it("negative: SP and AUD 403, ADM-only and another organization 404; validation 400; archived forum 422", async () => {
    const outsider = await signIn(api.app, w.officeB.subject);
    for (const [session, status] of [
      [x.sponsor.session, 403],
      [x.auditor.session, 403],
      [x.admin, 404],
      [outsider, 404],
    ] as const)
      expect((await send("POST", M(), { session, body: meetingBody(x.forums.workstream_review) })).status).toBe(status);
    expect((await send("GET", `${M()}`, { session: x.admin })).status).toBe(404);
    const badTime = await send("POST", M(), {
      session: x.lead.session,
      body: meetingBody(x.forums.workstream_review, 3, { startTime: "25:00" }),
    });
    expect(badTime.status).toBe(400);
    const badDate = await send("POST", M(), {
      session: x.lead.session,
      body: meetingBody(x.forums.workstream_review, 3, { scheduledDate: "2026-02-30" }),
    });
    expect(badDate.status).toBe(400);
    const foreignChair = await send("POST", M(), {
      session: x.lead.session,
      body: meetingBody(x.forums.workstream_review, 3, { chairUserId: w.officeB.id }),
    });
    expect([foreignChair.status, foreignChair.body.errors[0].pointer]).toEqual([400, "/chairUserId"]);
    const forum = await send("POST", `/api/v1/transformations/${x.transformationId}/forums`, {
      session: x.office.session,
      body: {
        nameEn: "Synthetic",
        nameAr: "اصطناعي",
        cadenceLabel: "Ad hoc",
        purpose: "Synthetic",
        participantsLabel: "Any",
        outputsLabel: "Actions",
        outputKinds: ["action"],
      },
    });
    await send("PATCH", `/api/v1/transformations/${x.transformationId}/forums/${forum.body.id}`, {
      session: x.office.session,
      headers: ifm(1),
      body: { status: "archived" },
    });
    const archived = await send("POST", M(), { session: x.lead.session, body: meetingBody(forum.body.id) });
    expect([archived.status, archived.body.code]).toEqual([422, "forum.archived"]);
  });

  it("commit-time: a TL whose grant is revoked while the request waits gets 403 and nothing is written", async () => {
    const tl = await person(api, w, x.transformationId, "TL");
    const before = await api.db
      .selectFrom("meeting")
      .select("id")
      .where("transformation_id", "=", x.transformationId)
      .execute();
    const res = await afterIdentity(
      api,
      tl.id,
      () =>
        call(api.app, "POST", M(), {
          session: tl.session,
          body: meetingBody(x.forums.workstream_review),
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, tl.id),
    );
    expect(res.status).toBe(403);
    const after = await api.db
      .selectFrom("meeting")
      .select("id")
      .where("transformation_id", "=", x.transformationId)
      .execute();
    expect(after.length).toBe(before.length);
  });
});

describe("the chair is a record-level rule (ADR-0032 §9)", () => {
  it("a forum without a mapped chair: chairUserId null, publishMeetingAgenda 422 meeting.chair_unassigned", async () => {
    // Value Review's chair party is FIN, which is not mapped in this transformation.
    const res = await send("POST", M(), { session: x.office.session, body: meetingBody(x.forums.value_review, 8) });
    expect([res.status, res.body.chairUserId]).toEqual([201, null]);
    await addAgendaItem(api, res.body.id, x.office.id, "published");
    const refused = await send("POST", `${M()}/${res.body.id}/publish-agenda`, {
      session: x.fin.session,
      headers: ifm(1),
    });
    expect([refused.status, refused.body.code, refused.body.detail]).toEqual([
      422,
      "meeting.chair_unassigned",
      "This meeting has no chair. Map the forum's chair role or name a chair first.",
    ]);
    // Naming a chair through updateMeeting lets that person publish.
    const named = await send("PATCH", `${M()}/${res.body.id}`, {
      session: x.office.session,
      headers: ifm(1),
      body: { chairUserId: x.fin.id },
    });
    expect([named.status, named.body.chairUserId]).toEqual([200, x.fin.id]);
    const ok = await send("POST", `${M()}/${res.body.id}/publish-agenda`, { session: x.fin.session, headers: ifm(2) });
    expect([ok.status, ok.body.status]).toEqual([200, "agenda_published"]);
    expect((await auditOf(api.db, res.body.id)).map((a) => a.action)).toEqual([
      "meeting.create",
      "meeting.update",
      "meeting.publish_agenda",
    ]);
  });

  it("a meeting.chair holder who is not the meeting's chair gets 403 meeting.not_chair; AUD 403; drafts and an empty agenda are refused", async () => {
    const res = await send("POST", M(), {
      session: x.lead.session,
      body: meetingBody(x.forums.transformation_review, 9),
    });
    const P = `${M()}/${res.body.id}/publish-agenda`;
    const empty = await send("POST", P, { session: x.lead.session, headers: ifm(1) });
    expect([empty.status, empty.body.code, empty.body.detail]).toEqual([
      422,
      "meeting.agenda_empty",
      "The agenda has no published item.",
    ]);
    await addAgendaItem(api, res.body.id, x.lead.id, "published", 1);
    await addAgendaItem(api, res.body.id, x.lead.id, "draft", 2);
    for (const session of [x.office.session, x.sponsor.session, x.contributor.session]) {
      const notChair = await send("POST", P, { session, headers: ifm(1) });
      expect([notChair.status, notChair.body.code, notChair.body.detail]).toEqual([
        403,
        "meeting.not_chair",
        "Only the meeting's chair can do this.",
      ]);
    }
    expect((await send("POST", P, { session: x.auditor.session, headers: ifm(1) })).status).toBe(403);
    expect((await send("POST", P, { session: x.admin, headers: ifm(1) })).status).toBe(404);
    const drafts = await send("POST", P, { session: x.lead.session, headers: ifm(1) });
    expect([drafts.status, drafts.body.code, drafts.body.detail]).toEqual([
      422,
      "meeting.agenda_has_drafts",
      "Publish or withdraw every draft agenda item before publishing the agenda.",
    ]);
    expect((await send("POST", P, { session: x.lead.session })).status).toBe(428);
    expect((await send("POST", P, { session: x.lead.session, headers: ifm(3) })).status).toBe(409);
    const read = await send("GET", `${M()}/${res.body.id}`, { session: x.auditor.session });
    expect([read.body.status, read.body.version]).toEqual(["scheduled", 1]);
  });
});

describe("updateMeeting and the state machine (ADR-0032 §3.1)", () => {
  it("rescheduling recomputes the times and the cut-off; If-Match 428/409; audited with its changes", async () => {
    const res = await send("POST", M(), { session: x.lead.session, body: meetingBody(x.forums.workstream_review, 6) });
    const U = `${M()}/${res.body.id}`;
    expect((await send("PATCH", U, { session: x.lead.session, body: { location: "Room" } })).status).toBe(428);
    expect(
      (await send("PATCH", U, { session: x.lead.session, headers: ifm(2), body: { location: "Room" } })).status,
    ).toBe(409);
    expect(
      (await send("PATCH", U, { session: x.auditor.session, headers: ifm(1), body: { location: "Room" } })).status,
    ).toBe(403);
    const moved = await send("PATCH", U, {
      session: x.lead.session,
      headers: ifm(1),
      body: { scheduledDate: plusDays(today, 20), startTime: "13:30", location: "Synthetic room" },
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect([
      moved.body.scheduledDate,
      moved.body.startsAt,
      moved.body.endsAt,
      moved.body.cutoffDate,
      moved.body.version,
    ]).toEqual([
      plusDays(today, 20),
      `${plusDays(today, 20)}T10:30:00.000Z`,
      `${plusDays(today, 20)}T11:30:00.000Z`,
      workingDaysBefore(plusDays(today, 20), 2),
      2,
    ]);
    const audit = (await auditOf(api.db, res.body.id)).at(-1)!;
    expect([audit.action, audit.prior_version, audit.new_version]).toEqual(["meeting.update", 1, 2]);
    expect(audit.changes).toMatchObject({ scheduled_date: { from: plusDays(today, 6), to: plusDays(today, 20) } });
    const dur = await send("PATCH", U, { session: x.lead.session, headers: ifm(2), body: { durationMinutes: 90 } });
    expect([dur.body.startsAt, dur.body.endsAt]).toEqual([
      `${plusDays(today, 20)}T10:30:00.000Z`,
      `${plusDays(today, 20)}T12:00:00.000Z`,
    ]);
  });

  it("start -> close; illegal edges are 422 meeting.status_transition; quorum locks once the session starts", async () => {
    const res = await send("POST", M(), {
      session: x.office.session,
      body: meetingBody(x.forums.workstream_review, 4),
    });
    const U = `${M()}/${res.body.id}`;
    const early = await send("POST", `${U}/close`, { session: x.office.session, headers: ifm(1) });
    expect([early.status, early.body.code, early.body.detail]).toEqual([
      422,
      "meeting.status_transition",
      "This meeting cannot move from scheduled to held.",
    ]);
    expect((await send("POST", `${U}/start`, { session: x.auditor.session, headers: ifm(1) })).status).toBe(403);
    expect((await send("POST", `${U}/start`, { session: x.sponsor.session, headers: ifm(1) })).status).toBe(403);
    const started = await send("POST", `${U}/start`, { session: x.office.session, headers: ifm(1) });
    expect([started.status, started.body.status, typeof started.body.startedAt]).toEqual([200, "in_session", "string"]);
    const locked = await send("PATCH", U, { session: x.office.session, headers: ifm(2), body: { quorumMin: 3 } });
    expect([locked.status, locked.body.code]).toEqual([422, "meeting.quorum_locked"]);
    const twice = await send("POST", `${U}/start`, { session: x.office.session, headers: ifm(2) });
    expect([twice.status, twice.body.detail]).toEqual([422, "This meeting cannot move from in_session to in_session."]);
    const cancel = await send("POST", `${U}/cancel`, {
      session: x.office.session,
      headers: ifm(2),
      body: { reason: "Synthetic" },
    });
    expect([cancel.status, cancel.body.detail]).toEqual([
      422,
      "This meeting cannot move from in_session to cancelled.",
    ]);
    const held = await send("POST", `${U}/close`, { session: x.office.session, headers: ifm(2) });
    expect([held.status, held.body.status, typeof held.body.heldAt]).toEqual([200, "held", "string"]);
    expect((await auditOf(api.db, res.body.id)).map((a) => a.action)).toEqual([
      "meeting.create",
      "meeting.start",
      "meeting.close",
    ]);
  });

  it("cancel needs a note (400 without); a cancelled meeting is final (422 meeting.final)", async () => {
    const res = await send("POST", M(), {
      session: x.office.session,
      body: meetingBody(x.forums.workstream_review, 5),
    });
    const U = `${M()}/${res.body.id}`;
    expect((await send("POST", `${U}/cancel`, { session: x.office.session, headers: ifm(1), body: {} })).status).toBe(
      400,
    );
    expect(
      (await send("POST", `${U}/cancel`, { session: x.office.session, headers: ifm(1), body: { reason: "  " } }))
        .status,
    ).toBe(400);
    expect(
      (
        await send("POST", `${U}/cancel`, {
          session: x.auditor.session,
          headers: ifm(1),
          body: { reason: "Synthetic" },
        })
      ).status,
    ).toBe(403);
    const ok = await send("POST", `${U}/cancel`, {
      session: x.office.session,
      headers: ifm(1),
      body: { reason: "Synthetic: moved" },
    });
    expect([ok.status, ok.body.status, ok.body.cancelReason, ok.body.cancelNote, ok.body.cancelledBy]).toEqual([
      200,
      "cancelled",
      "manual",
      "Synthetic: moved",
      x.office.id,
    ]);
    const final = await send("PATCH", U, { session: x.office.session, headers: ifm(2), body: { location: "Room" } });
    expect([final.status, final.body.code, final.body.detail]).toEqual([
      422,
      "meeting.final",
      "This meeting is cancelled and can no longer be changed.",
    ]);
    const start = await send("POST", `${U}/start`, { session: x.office.session, headers: ifm(2) });
    expect([start.status, start.body.code]).toEqual([422, "meeting.final"]);
  });

  it("listMeetings filters by forum, status and date range, and pages", async () => {
    const all = await send("GET", `${M()}?forumId=${x.forums.workstream_review}`, { session: x.auditor.session });
    expect(all.body.items.length).toBeGreaterThanOrEqual(3);
    const held = await send("GET", `${M()}?status=held`, { session: x.auditor.session });
    expect(held.body.items.every((m: Body) => m.status === "held")).toBe(true);
    const range = await send("GET", `${M()}?from=${plusDays(today, 5)}&to=${plusDays(today, 6)}`, {
      session: x.auditor.session,
    });
    expect(
      range.body.items.every(
        (m: Body) => m.scheduledDate >= plusDays(today, 5) && m.scheduledDate <= plusDays(today, 6),
      ),
    ).toBe(true);
    const page = await send("GET", `${M()}?limit=1`, { session: x.auditor.session });
    const next = await send("GET", `${M()}?limit=1&cursor=${encodeURIComponent(page.body.nextCursor)}`, {
      session: x.auditor.session,
    });
    expect(next.body.items[0].id).not.toBe(page.body.items[0].id);
    expect((await send("GET", `${M()}?status=done`, { session: x.auditor.session })).status).toBe(400);
  });
});

describe("nextForumDateProvider (ADR-0026 §5; D-089 Q6)", () => {
  it("the next scheduled Executive SteerCo date, or Unknown; BE-C's T11 preview uses it", async () => {
    const preview = () =>
      send(
        "GET",
        `/api/v1/transformations/${x.transformationId}/decision-rights/${x.rights["funding_reallocation"]}/due-date?raisedOn=${today}`,
        {
          session: x.auditor.session,
        },
      );
    const none = await preview();
    expect([none.status, none.body.dueDate, none.body.unknownReason]).toEqual([200, null, "no_steerco_scheduled"]);
    expect(await nextForumDateProvider.nextSteerCoDate(api.db, x.transformationId, today)).toBeNull();

    // A SteerCo meeting before the raised date and a cancelled one do not count.
    const past = await send("POST", M(), {
      session: x.office.session,
      body: meetingBody(x.forums.executive_steerco, -3),
    });
    expect([past.status, past.body.chairUserId]).toEqual([201, x.sponsor.id]);
    const cancelled = await send("POST", M(), {
      session: x.office.session,
      body: meetingBody(x.forums.executive_steerco, 15),
    });
    await send("POST", `${M()}/${cancelled.body.id}/cancel`, {
      session: x.office.session,
      headers: ifm(1),
      body: { reason: "Synthetic" },
    });
    expect(await nextForumDateProvider.nextSteerCoDate(api.db, x.transformationId, today)).toBeNull();

    const later = await send("POST", M(), {
      session: x.office.session,
      body: meetingBody(x.forums.executive_steerco, 21),
    });
    const sooner = await send("POST", M(), {
      session: x.office.session,
      body: meetingBody(x.forums.executive_steerco, 17),
    });
    expect([later.status, sooner.status]).toEqual([201, 201]);
    expect(await nextForumDateProvider.nextSteerCoDate(api.db, x.transformationId, today)).toBe(plusDays(today, 17));
    const known = await preview();
    expect([known.body.dueDate, known.body.unknownReason]).toEqual([plusDays(today, 17), null]);
    // Another forum's meeting is never a SteerCo date.
    expect(await nextForumDateProvider.nextSteerCoDate(api.db, x.transformationId, plusDays(today, 22))).toBeNull();
  });
});

// Meeting minutes (ADR-0032 §5, §9, §11; T-DG4-BE-F2) against a real PostgreSQL:
//  - REQ-S10-011 A09 "published minutes are immutable": after publication updateMeetingMinutes is 422
//    meeting_minutes.published and the meeting's records are frozen (422 meeting.frozen on agenda, outputs, actions);
//  - REQ-PB-061 A01: a Value Review meeting's minutes cannot be published without a benefit evidence or forecast output
//    (422 meeting_minutes.required_output_missing, nothing written) and can with a forecast output linked to a benefit;
//    publication moves the meeting to minutes_published in the same transaction;
//  - the state machine: draft -> approved -> published, approved -> draft by the chair; approved minutes are not edited
//    in place; a draft is not published; minutes are published for a held meeting only; the chair rule;
//  - the chair's minutes_to_approve My Work item (opened on draft and on return, closed on approval);
//  - If-Match 428/409, audit events, AUD 403, ADM-only and another organization 404, commit-time 403.
// All data is SYNTHETIC; approving minutes is a meeting record step, not a G1-G6 business approval, and nothing here
// touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, seedWorld, signIn, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { person } from "../approvals/approval-world.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { businessToday, plusDays, setupMeetingWorld, type ForumKey, type MeetingWorld } from "./meeting-fixtures.ts";

let api: TestApi;
let w: World;
let x: MeetingWorld;
let today: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
const T = () => `/api/v1/transformations/${x.transformationId}`;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  x = await setupMeetingWorld(api, w);
  today = await businessToday(api);
}, 120_000);
afterAll(() => api.close());

interface M {
  url: string;
  id: string;
  version: number;
}

/** A meeting of `forum` moved to `held` (or left scheduled), with `chair` as its chair. */
async function heldMeeting(forum: ForumKey, chair: string, hold = true): Promise<M> {
  const c = await send("POST", `${T()}/meetings`, {
    session: x.lead.session,
    body: {
      forumId: x.forums[forum],
      scheduledDate: plusDays(today, 7),
      startTime: "11:00",
      durationMinutes: 60,
      chairUserId: chair,
    },
  });
  expect(c.status, JSON.stringify(c.body)).toBe(201);
  const url = `${T()}/meetings/${c.body.id}`;
  let version = 1;
  if (hold) {
    version = (await send("POST", `${url}/start`, { session: x.lead.session, headers: ifm(1) })).body.version;
    version = (await send("POST", `${url}/close`, { session: x.lead.session, headers: ifm(version) })).body.version;
  }
  return { url, id: c.body.id, version };
}

async function approvedMinutes(m: M, chair = x.lead.session): Promise<void> {
  const d = await send("POST", `${m.url}/minutes`, { session: x.lead.session, body: { body: "Synthetic minutes" } });
  expect(d.status, JSON.stringify(d.body)).toBe(201);
  const a = await send("POST", `${m.url}/minutes/approve`, { session: chair, headers: ifm(1) });
  expect(a.status, JSON.stringify(a.body)).toBe(200);
}

async function minutesTasks(userId: string, minutesId: string) {
  return api.db
    .selectFrom("work_item")
    .select(["status", "dedupe_key", "message_key"])
    .where("assignee_user_id", "=", userId)
    .where("subject_type", "=", "meeting_minutes")
    .where("subject_id", "=", minutesId)
    .orderBy("created_at")
    .execute();
}

describe("REQ-S10-011: published minutes are immutable", () => {
  it("draft -> approved -> published; then 422 meeting_minutes.published and the meeting's records are frozen", async () => {
    const m = await heldMeeting("transformation_review", x.lead.id);
    const MN = `${m.url}/minutes`;
    expect((await send("GET", MN, { session: x.auditor.session })).status).toBe(404);
    const d = await send("POST", MN, { session: x.lead.session, body: { body: "Synthetic minutes" } });
    expect([d.status, d.headers.etag, d.headers.location, d.body.status]).toEqual([201, '"1"', MN, "draft"]);
    const edited = await send("PATCH", MN, {
      session: x.lead.session,
      headers: ifm(1),
      body: { body: "Synthetic v2" },
    });
    expect([edited.status, edited.body.body]).toEqual([200, "Synthetic v2"]);
    const approved = await send("POST", `${MN}/approve`, { session: x.lead.session, headers: ifm(2) });
    expect([approved.status, approved.body.status, approved.body.approvedBy]).toEqual([200, "approved", x.lead.id]);
    const pub = await send("POST", `${MN}/publish`, { session: x.lead.session, headers: ifm(3) });
    expect([pub.status, pub.body.status, pub.body.publishedBy]).toEqual([200, "published", x.lead.id]);
    expect((await send("GET", m.url, { session: x.auditor.session })).body.status).toBe("minutes_published");
    expect((await auditOf(api.db, d.body.id)).map((e) => e.action)).toEqual([
      "meeting_minutes.create",
      "meeting_minutes.update",
      "meeting_minutes.approve",
      "meeting_minutes.publish",
    ]);
    expect((await auditOf(api.db, m.id)).map((e) => e.action)).toContain("meeting.publish_minutes");

    const immutable = await send("PATCH", MN, { session: x.lead.session, headers: ifm(4), body: { body: "Changed" } });
    expect([immutable.status, immutable.body.code, immutable.body.detail]).toEqual([
      422,
      "meeting_minutes.published",
      "Published minutes are immutable.",
    ]);
    const back = await send("PATCH", MN, { session: x.lead.session, headers: ifm(4), body: { status: "draft" } });
    expect([back.status, back.body.code]).toEqual([422, "meeting_minutes.published"]);
    const row = await api.db
      .selectFrom("meeting_minutes")
      .selectAll()
      .where("id", "=", d.body.id)
      .executeTakeFirstOrThrow();
    expect([row.body, row.status, row.version]).toEqual(["Synthetic v2", "published", 4]);
    for (const [url, body] of [
      [`${m.url}/agenda-items`, { itemKind: "discussion", title: "Late" }],
      [`${m.url}/outputs`, { outputKind: "integrated_status", note: "Late" }],
      [`${m.url}/actions`, { title: "Late", ownerUserId: x.lead.id }],
      [`${m.url}/attendance`, { userId: x.lead.id, attendance: "present" }],
    ] as const) {
      const res = await send("POST", url, { session: x.lead.session, body });
      expect([res.status, res.body.code, res.body.detail], url).toEqual([
        422,
        "meeting.frozen",
        "This meeting is minutes_published; its records can no longer be changed.",
      ]);
    }
  });
});

describe("REQ-PB-061: a Value Review meeting needs a benefit evidence or forecast output", () => {
  it("422 meeting_minutes.required_output_missing without one (nothing written); published with a forecast output", async () => {
    const m = await heldMeeting("value_review", x.fin.id);
    await approvedMinutes(m, x.fin.session);
    const MN = `${m.url}/minutes`;
    const missing = await send("POST", `${MN}/publish`, { session: x.fin.session, headers: ifm(2) });
    expect([missing.status, missing.body.code, missing.body.detail]).toEqual([
      422,
      "meeting_minutes.required_output_missing",
      "A Value Review meeting cannot be published without at least one of: benefit evidence, forecast.",
    ]);
    const row = await api.db
      .selectFrom("meeting_minutes")
      .select(["status", "version"])
      .where("meeting_id", "=", m.id)
      .executeTakeFirstOrThrow();
    expect([row.status, row.version]).toEqual(["approved", 2]);
    expect((await send("GET", m.url, { session: x.auditor.session })).body.status).toBe("held");
    // A corrective-action output does not satisfy the rule; a forecast output linked to a benefit does.
    const benefit = await send("POST", `${T()}/benefits`, {
      session: x.lead.session,
      body: {
        title: "Synthetic churn reduction",
        description: "Lower churn on the synthetic prepaid base.",
        benefitType: "revenue",
        valueClass: "revenue_uplift",
        ownerUserId: x.bo.id,
        currency: "SAR",
        financialStatementLine: "Revenue - prepaid",
      },
    });
    expect(benefit.status, JSON.stringify(benefit.body)).toBe(201);
    const forecast = await send("POST", `${m.url}/outputs`, {
      session: x.lead.session,
      body: { outputKind: "forecast", recordType: "benefit", recordId: benefit.body.id, note: "Synthetic: on plan" },
    });
    expect([forecast.status, forecast.body.recordId]).toEqual([201, benefit.body.id]);
    const ok = await send("POST", `${MN}/publish`, { session: x.fin.session, headers: ifm(2) });
    expect([ok.status, ok.body.status]).toEqual([200, "published"]);
    expect((await send("GET", m.url, { session: x.auditor.session })).body.status).toBe("minutes_published");
  });
});

describe("the minutes state machine, the chair rule and the chair's work item", () => {
  it("approved minutes are not edited in place; the chair returns them to draft; the work item follows", async () => {
    const m = await heldMeeting("transformation_review", x.lead.id);
    const MN = `${m.url}/minutes`;
    const d = await send("POST", MN, { session: x.office.session, body: { body: "Synthetic" } });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    expect(await minutesTasks(x.lead.id, d.body.id)).toEqual([
      {
        status: "open",
        dedupe_key: `meeting.minutes:${d.body.id}:${x.lead.id}`,
        message_key: "governance.task.minutes_to_approve",
      },
    ]);
    const mine = await send("GET", "/api/v1/me/work-items?kind=minutes_to_approve", { session: x.lead.session });
    expect(mine.body.items.map((i: Body) => i.subjectId)).toContain(d.body.id);
    const again = await send("POST", MN, { session: x.lead.session, body: { body: "Synthetic" } });
    expect([again.status, again.body.code]).toEqual([409, "meeting_minutes.exists"]);
    const draftPublish = await send("POST", `${MN}/publish`, { session: x.lead.session, headers: ifm(1) });
    expect([draftPublish.status, draftPublish.body.code, draftPublish.body.detail]).toEqual([
      422,
      "meeting_minutes.status_transition",
      "These minutes cannot move from draft to published.",
    ]);
    const notChair = await send("POST", `${MN}/approve`, { session: x.sponsor.session, headers: ifm(1) });
    expect([notChair.status, notChair.body.code]).toEqual([403, "meeting.not_chair"]);
    const aud = await send("POST", `${MN}/approve`, { session: x.auditor.session, headers: ifm(1) });
    expect(aud.status).toBe(403);
    expect((await send("POST", `${MN}/approve`, { session: x.lead.session })).status).toBe(428);
    expect((await send("POST", `${MN}/approve`, { session: x.lead.session, headers: ifm(5) })).status).toBe(409);
    expect((await send("POST", `${MN}/approve`, { session: x.lead.session, headers: ifm(1) })).status).toBe(200);
    expect((await minutesTasks(x.lead.id, d.body.id)).map((t) => t.status)).toEqual(["done"]);
    const inPlace = await send("PATCH", MN, { session: x.lead.session, headers: ifm(2), body: { body: "Edited" } });
    expect([inPlace.status, inPlace.body.code]).toEqual([422, "meeting_minutes.approved_frozen"]);
    const returnedByOther = await send("PATCH", MN, {
      session: x.office.session,
      headers: ifm(2),
      body: { status: "draft" },
    });
    expect([returnedByOther.status, returnedByOther.body.code]).toEqual([403, "meeting.not_chair"]);
    const returned = await send("PATCH", MN, {
      session: x.lead.session,
      headers: ifm(2),
      body: { status: "draft", body: "Synthetic, corrected" },
    });
    expect([returned.status, returned.body.status, returned.body.approvedAt, returned.body.body]).toEqual([
      200,
      "draft",
      null,
      "Synthetic, corrected",
    ]);
    expect((await minutesTasks(x.lead.id, d.body.id)).map((t) => [t.status, t.dedupe_key])).toEqual([
      ["done", `meeting.minutes:${d.body.id}:${x.lead.id}`],
      ["open", `meeting.minutes:${d.body.id}:${x.lead.id}#2`],
    ]);
    const backAgain = await send("PATCH", MN, { session: x.lead.session, headers: ifm(3), body: { status: "draft" } });
    expect([backAgain.status, backAgain.body.code]).toEqual([422, "meeting_minutes.status_transition"]);
  });

  it("minutes are published for a held meeting only (422 meeting_minutes.meeting_not_held)", async () => {
    const m = await heldMeeting("transformation_review", x.lead.id, false);
    await approvedMinutes(m);
    const res = await send("POST", `${m.url}/minutes/publish`, { session: x.lead.session, headers: ifm(2) });
    expect([res.status, res.body.code, res.body.detail]).toEqual([
      422,
      "meeting_minutes.meeting_not_held",
      "Minutes are published after the meeting is held.",
    ]);
  });

  it("authorization: AUD 403 on writes; ADM-only and another organization 404; commit-time 403", async () => {
    const m = await heldMeeting("transformation_review", x.lead.id);
    const MN = `${m.url}/minutes`;
    const outsider = await signIn(api.app, w.officeB.subject);
    for (const [session, status] of [
      [x.auditor.session, 403],
      [x.admin, 404],
      [outsider, 404],
    ] as const) {
      expect((await send("POST", MN, { session, body: { body: "X" } })).status).toBe(status);
    }
    await send("POST", MN, { session: x.lead.session, body: { body: "Synthetic" } });
    for (const [session, status] of [
      [x.auditor.session, 403],
      [x.admin, 404],
      [outsider, 404],
    ] as const) {
      expect((await send("PATCH", MN, { session, headers: ifm(1), body: { body: "X" } })).status).toBe(status);
      expect((await send("POST", `${MN}/approve`, { session, headers: ifm(1) })).status).toBe(status);
      expect((await send("POST", `${MN}/publish`, { session, headers: ifm(1) })).status).toBe(status);
    }
    expect((await send("GET", MN, { session: x.auditor.session })).status).toBe(200);
    expect((await send("GET", MN, { session: x.admin })).status).toBe(404);
    const tl = await person(api, w, x.transformationId, "TL");
    const res = await afterIdentity(
      api,
      tl.id,
      () =>
        call(api.app, "PATCH", MN, {
          session: tl.session,
          headers: ifm(1),
          body: { body: "Revoked" },
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, tl.id),
    );
    expect(res.status).toBe(403);
    const row = await api.db
      .selectFrom("meeting_minutes")
      .select(["body", "version"])
      .where("meeting_id", "=", m.id)
      .executeTakeFirstOrThrow();
    expect([row.body, row.version]).toEqual(["Synthetic", 1]);
  });
});

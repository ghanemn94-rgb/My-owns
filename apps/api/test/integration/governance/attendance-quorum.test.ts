// Attendance and quorum (ADR-0032 §3.3, §6, §9, §11; T-DG4-BE-F2) against a real PostgreSQL:
//  - REQ-S10-011 A09 "with quorum configured, decisions cannot be recorded below quorum": quorum 2 with one person
//    present -> recordAgendaItemOutcome 'decided' is 422 meeting.quorum_not_met (both numbers) and nothing is written;
//    with two present it succeeds; "quorum not configured" never blocks and is never shown as "met";
//  - countsForQuorum comes from the forum's participants (a non-participant present does not count);
//  - recordMeetingAttendance / updateMeetingAttendance: one row per person (409), the representative rule (400), unknown
//    people (400), If-Match 428/409, audit events, frozen once the meeting is cancelled (422 meeting.frozen);
//  - the Outcome rules: only the decision owner (403 executive_decision.not_owner), never AUD, never ADM-only (403);
//    only while in session or held; only an executive ask, only a published item; decisionVersion stale -> 409;
//    'deferred' and 'noted' are meeting.prepare and leave the T16 decision unchanged;
//  - authorization: AUD 403 on writes, ADM-only and another organization 404; commit-time 403.
// All data is SYNTHETIC; nothing here grants a real business approval or touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, seedWorld, signIn, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { person } from "../approvals/approval-world.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { businessToday, plusDays, setupMeetingWorld, type MeetingWorld } from "./meeting-fixtures.ts";

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
  // The Transformation Review's participants: TL, SP and a BO count for quorum.
  for (const userId of [x.lead.id, x.sponsor.id, x.bo.id]) {
    const p = await send("POST", `${T()}/forums/${x.forums.transformation_review}/participants`, {
      session: x.office.session,
      body: { userId },
    });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
  }
}, 120_000);
afterAll(() => api.close());

interface Session {
  url: string;
  id: string;
  version: number;
  item: string;
  decisionId: string;
}

/** A Transformation Review meeting (chair TL) with `quorum`, one published executive ask owned by SP, in session. */
async function sessionWithAsk(quorum: number | null, start = true): Promise<Session> {
  const c = await send("POST", `${T()}/meetings`, {
    session: x.lead.session,
    body: {
      forumId: x.forums.transformation_review,
      scheduledDate: plusDays(today, 8),
      startTime: "10:00",
      durationMinutes: 60,
    },
  });
  expect(c.status, JSON.stringify(c.body)).toBe(201);
  const url = `${T()}/meetings/${c.body.id}`;
  let version = 1;
  if (quorum !== null)
    version = (await send("PATCH", url, { session: x.lead.session, headers: ifm(1), body: { quorumMin: quorum } })).body
      .version;
  const item = await send("POST", `${url}/agenda-items`, {
    session: x.lead.session,
    body: {
      itemKind: "executive_ask",
      title: "Synthetic: data-centre move",
      brief: {
        decisionRequired: "Synthetic: approve the data-centre move",
        whyNow: "Synthetic: the lease ends",
        options: ["Move", "Extend the lease"],
        recommendation: "A",
        impactOfDelay: "Synthetic: a penalty rent",
        ownerUserId: x.sponsor.id,
        requiredDate: plusDays(today, 30),
      },
    },
  });
  const pub = await send("POST", `${url}/agenda-items/${item.body.id}/publish`, {
    session: x.lead.session,
    headers: ifm(1),
  });
  expect(pub.status, JSON.stringify(pub.body)).toBe(200);
  if (start)
    version = (await send("POST", `${url}/start`, { session: x.lead.session, headers: ifm(version) })).body.version;
  return { url, id: c.body.id, version, item: item.body.id, decisionId: pub.body.decisionId };
}

const present = (s: Session, userId: string, attendance = "present") =>
  send("POST", `${s.url}/attendance`, { session: x.lead.session, body: { userId, attendance } });

const decide = (s: Session, session = x.sponsor.session, extra: Record<string, unknown> = {}) =>
  send("POST", `${s.url}/agenda-items/${s.item}/outcome`, {
    session,
    headers: ifm(2),
    body: { outcome: "decided", chosenOptionLabel: "A", outcomeText: "Synthetic: move", decisionVersion: 1, ...extra },
  });

describe("REQ-S10-011: decisions cannot be recorded below quorum", () => {
  it("quorum 2, one present: 422 meeting.quorum_not_met with both numbers, nothing written; two present: decided", async () => {
    const s = await sessionWithAsk(2);
    expect((await present(s, x.lead.id)).status).toBe(201);
    const meeting = await send("GET", s.url, { session: x.auditor.session });
    expect([meeting.body.presentCount, meeting.body.quorumState]).toEqual([1, "not_met"]);
    const below = await decide(s);
    expect([below.status, below.body.code, below.body.detail]).toEqual([
      422,
      "meeting.quorum_not_met",
      "This meeting has not reached its quorum: 1 of 2 counted present. Decisions cannot be recorded below quorum.",
    ]);
    const d = await api.db.selectFrom("decision").selectAll().where("id", "=", s.decisionId).executeTakeFirstOrThrow();
    expect([d.status, d.version, d.outcome_text]).toEqual(["open", 1, null]);
    const i = await api.db.selectFrom("agenda_item").selectAll().where("id", "=", s.item).executeTakeFirstOrThrow();
    expect([i.status, i.version, i.outcome]).toEqual(["published", 2, null]);
    expect(await api.db.selectFrom("meeting_output").select("id").where("meeting_id", "=", s.id).execute()).toEqual([]);

    expect((await present(s, x.sponsor.id)).status).toBe(201);
    const ok = await decide(s);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect([ok.body.status, ok.body.outcome, ok.body.outcomeQuorumPresent, ok.headers.etag]).toEqual([
      "closed",
      "decided",
      2,
      '"3"',
    ]);
    const after = await api.db
      .selectFrom("decision")
      .selectAll()
      .where("id", "=", s.decisionId)
      .executeTakeFirstOrThrow();
    expect([after.status, after.decided_by]).toEqual(["decided", x.sponsor.id]);
    expect((await auditOf(api.db, s.item)).map((e) => e.action)).toEqual([
      "agenda_item.create",
      "agenda_item.publish",
      "agenda_item.outcome",
    ]);
  });

  it("a present non-participant does not count; quorum not configured never blocks and is shown as such", async () => {
    const s = await sessionWithAsk(2);
    const outsiderOfForum = await present(s, x.contributor.id);
    expect([outsiderOfForum.status, outsiderOfForum.body.countsForQuorum]).toEqual([201, false]);
    await present(s, x.lead.id);
    expect((await decide(s)).body.code).toBe("meeting.quorum_not_met");
    const open = await sessionWithAsk(null);
    expect((await send("GET", open.url, { session: x.auditor.session })).body.quorumState).toBe("not_configured");
    const ok = await decide(open);
    expect([ok.status, ok.body.outcomeQuorumPresent]).toEqual([200, 0]);
  });
});

describe("the Outcome rules (ADR-0032 §3.3, §6, §9)", () => {
  it("not the owner 403 executive_decision.not_owner; AUD 403; ADM-only 403; outside the session 422 not_in_session", async () => {
    const s = await sessionWithAsk(null, false);
    const early = await decide(s);
    expect([early.status, early.body.code]).toEqual([422, "meeting.not_in_session"]);
    await send("POST", `${s.url}/start`, { session: x.lead.session, headers: ifm(s.version) });
    const bo = await decide(s, x.bo.session);
    expect([bo.status, bo.body.code]).toEqual([403, "executive_decision.not_owner"]);
    expect((await decide(s, x.auditor.session)).status).toBe(403);
    expect((await decide(s, x.admin)).status).toBe(403);
    expect((await decide(s, x.lead.session)).status).toBe(403);
    const d = await api.db
      .selectFrom("decision")
      .select("status")
      .where("id", "=", s.decisionId)
      .executeTakeFirstOrThrow();
    expect(d.status).toBe("open");
    const stale = await decide(s, x.sponsor.session, { decisionVersion: 7 });
    expect([stale.status, stale.body.currentVersion]).toEqual([409, 1]);
    const noVersion = await send("POST", `${s.url}/agenda-items/${s.item}/outcome`, {
      session: x.sponsor.session,
      headers: ifm(2),
      body: { outcome: "decided", outcomeText: "Synthetic" },
    });
    expect([noVersion.status, noVersion.body.errors[0].pointer]).toEqual([400, "/decisionVersion"]);
    expect((await decide(s)).status).toBe(200);
    const final = await decide(s);
    expect([final.status]).toEqual([409]);
    const closed = await send("POST", `${s.url}/agenda-items/${s.item}/outcome`, {
      session: x.lead.session,
      headers: ifm(3),
      body: { outcome: "noted" },
    });
    expect([closed.status, closed.body.code]).toEqual([422, "agenda_item.final"]);
  });

  it("'noted' and 'deferred' are meeting.prepare and leave T16 unchanged; 'decided' needs an executive ask that is published", async () => {
    const s = await sessionWithAsk(null);
    const deferred = await send("POST", `${s.url}/agenda-items/${s.item}/outcome`, {
      session: x.lead.session,
      headers: ifm(2),
      body: { outcome: "deferred" },
    });
    expect([deferred.status, deferred.body.outcome, deferred.body.status]).toEqual([200, "deferred", "closed"]);
    const d = await api.db
      .selectFrom("decision")
      .select(["status", "version"])
      .where("id", "=", s.decisionId)
      .executeTakeFirstOrThrow();
    expect([d.status, d.version]).toEqual(["open", 1]);
    const disc = await send("POST", `${s.url}/agenda-items`, {
      session: x.lead.session,
      body: { itemKind: "discussion", title: "Synthetic" },
    });
    const draft = await send("POST", `${s.url}/agenda-items/${disc.body.id}/outcome`, {
      session: x.lead.session,
      headers: ifm(1),
      body: { outcome: "noted" },
    });
    expect([draft.status, draft.body.code]).toEqual([422, "agenda_item.not_published"]);
    await send("POST", `${s.url}/agenda-items/${disc.body.id}/publish`, { session: x.lead.session, headers: ifm(1) });
    const notAsk = await send("POST", `${s.url}/agenda-items/${disc.body.id}/outcome`, {
      session: x.sponsor.session,
      headers: ifm(2),
      body: { outcome: "decided", outcomeText: "X", decisionVersion: 1 },
    });
    expect([notAsk.status, notAsk.body.code]).toEqual([422, "agenda_item.outcome_not_ask"]);
    const noted = await send("POST", `${s.url}/agenda-items/${disc.body.id}/outcome`, {
      session: x.lead.session,
      headers: ifm(2),
      body: { outcome: "noted" },
    });
    expect([noted.status, noted.body.outcome]).toEqual([200, "noted"]);
  });
});

describe("recordMeetingAttendance and updateMeetingAttendance", () => {
  it("one row per person (409), representative rule (400), unknown person (400), If-Match, audit, frozen", async () => {
    const s = await sessionWithAsk(null, false);
    const AT = `${s.url}/attendance`;
    const a = await present(s, x.bo.id, "apologies");
    expect([a.status, a.headers.etag, a.body.countsForQuorum, a.headers.location]).toEqual([
      201,
      '"1"',
      true,
      `${AT}/${a.body.id}`,
    ]);
    const dup = await present(s, x.bo.id);
    expect([dup.status, dup.body.code]).toEqual([409, "meeting_attendance.exists"]);
    const self = await send("POST", AT, {
      session: x.lead.session,
      body: { userId: x.lead.id, attendance: "present", onBehalfOfUserId: x.lead.id },
    });
    expect([self.status, self.body.errors[0].code]).toEqual([400, "validation.attendance_proxy"]);
    const absentProxy = await send("POST", AT, {
      session: x.lead.session,
      body: { userId: x.lead.id, attendance: "absent", onBehalfOfUserId: x.sponsor.id },
    });
    expect(absentProxy.status).toBe(400);
    const foreign = await send("POST", AT, {
      session: x.lead.session,
      body: { userId: w.officeB.id, attendance: "present" },
    });
    expect([foreign.status, foreign.body.errors[0].pointer]).toEqual([400, "/userId"]);
    const I = `${AT}/${a.body.id}`;
    expect((await send("PATCH", I, { session: x.lead.session, body: { attendance: "present" } })).status).toBe(428);
    expect(
      (await send("PATCH", I, { session: x.lead.session, headers: ifm(4), body: { attendance: "present" } })).status,
    ).toBe(409);
    const proxy = await send("PATCH", I, {
      session: x.lead.session,
      headers: ifm(1),
      body: { attendance: "present", onBehalfOfUserId: x.bo2.id, note: "Synthetic: represented" },
    });
    expect([proxy.status, proxy.body.attendance, proxy.body.onBehalfOfUserId, proxy.body.version]).toEqual([
      200,
      "present",
      x.bo2.id,
      2,
    ]);
    const audit = await auditOf(api.db, a.body.id);
    expect(audit.map((e) => e.action)).toEqual(["meeting_attendance.create", "meeting_attendance.update"]);
    expect(audit[1]!.changes).toMatchObject({ attendance: { from: "apologies", to: "present" } });
    for (const [session, status] of [
      [x.auditor.session, 403],
      [x.admin, 404],
      [await signIn(api.app, w.officeB.subject), 404],
    ] as const) {
      expect((await send("POST", AT, { session, body: { userId: x.fin.id, attendance: "present" } })).status).toBe(
        status,
      );
      expect((await send("PATCH", I, { session, headers: ifm(2), body: { note: "X" } })).status).toBe(status);
    }
    expect((await send("GET", AT, { session: x.auditor.session })).body.items).toHaveLength(1);
    expect((await send("GET", AT, { session: x.admin })).status).toBe(404);
    await send("POST", `${s.url}/cancel`, {
      session: x.lead.session,
      headers: ifm(s.version),
      body: { reason: "Synthetic: postponed" },
    });
    const frozen = await present(s, x.fin.id);
    expect([frozen.status, frozen.body.code, frozen.body.detail]).toEqual([
      422,
      "meeting.frozen",
      "This meeting is cancelled; its records can no longer be changed.",
    ]);
    const frozenEdit = await send("PATCH", I, { session: x.lead.session, headers: ifm(2), body: { note: "X" } });
    expect([frozenEdit.status, frozenEdit.body.code]).toEqual([422, "meeting.frozen"]);
  });

  it("commit-time: a TL whose grant is revoked while the request waits gets 403 and nothing is written", async () => {
    const s = await sessionWithAsk(null, false);
    const tl = await person(api, w, x.transformationId, "TL");
    const res = await afterIdentity(
      api,
      tl.id,
      () =>
        call(api.app, "POST", `${s.url}/attendance`, {
          session: tl.session,
          body: { userId: x.lead.id, attendance: "present" },
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, tl.id),
    );
    expect(res.status).toBe(403);
    expect(await api.db.selectFrom("meeting_attendance").select("id").where("meeting_id", "=", s.id).execute()).toEqual(
      [],
    );
  });
});

// Agenda items and executive-ask briefs (ADR-0032 §3.2, §4, §6, §9, §11; T-DG4-BE-F2) against a real PostgreSQL:
//  - REQ-PB-068 A09: publishing an executive ask without "Impact of delay" is 422 agenda_item.executive_ask_incomplete
//    with the error at /brief/impactOfDelay, and nothing is written (no T16 row, the item unchanged, no audit event);
//  - REQ-PB-061 "decisions recorded appear in T16": a complete brief publishes into a T16 ask (ask_origin 'agenda'; the
//    brief cleared, one copy), the T16 log lists it, and the Outcome recorded in the meeting appears in T16 with the
//    meeting's decision output;
//  - "Escalate decisions, not status": an information item on the Executive SteerCo agenda is 422 executive_asks_only;
//  - linking an open T16 ask; the ask shape; the chair rule (403 meeting.not_chair, 422 meeting.chair_unassigned);
//    late items (flag / refuse) and the item limit; If-Match 428/409; final and draft-only rules; audit events;
//  - authorization: AUD 403 on every write, ADM-only and another organization 404, reads in scope; commit-time 403.
// All data is SYNTHETIC; recording an Outcome here is a synthetic business decision inside the product, not a G1-G6
// gate decision, and nothing touches the engineering gates DG0-DG7.
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

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  x = await setupMeetingWorld(api, w);
  today = await businessToday(api);
}, 120_000);
afterAll(() => api.close());

const T = () => `/api/v1/transformations/${x.transformationId}`;

/** An ad-hoc meeting of a forum (TL creates it; the chair comes from the forum's chair party). */
async function meeting(forum: ForumKey, days = 10): Promise<{ id: string; url: string; chair: string | null }> {
  const res = await send("POST", `${T()}/meetings`, {
    session: x.lead.session,
    body: { forumId: x.forums[forum], scheduledDate: plusDays(today, days), startTime: "09:00", durationMinutes: 60 },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { id: res.body.id, url: `${T()}/meetings/${res.body.id}`, chair: res.body.chairUserId };
}

const brief = (extra: Record<string, unknown> = {}) => ({
  decisionRequired: "Synthetic: choose the billing platform",
  whyNow: "Synthetic: the vendor's offer expires this month",
  options: ["Migrate now", "Wait for the next release"],
  recommendation: "A",
  ownerUserId: x.sponsor.id,
  requiredDate: plusDays(today, 15),
  ...extra,
});

async function askItem(url: string, b: Record<string, unknown>): Promise<Body> {
  const res = await send("POST", `${url}/agenda-items`, {
    session: x.lead.session,
    body: { itemKind: "executive_ask", title: "Synthetic: billing platform", brief: b },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

async function decisionsOf(): Promise<number> {
  const r = await api.db
    .selectFrom("decision")
    .select("id")
    .where("transformation_id", "=", x.transformationId)
    .where("kind", "=", "executive")
    .execute();
  return r.length;
}

describe("publishAgendaItem: the seven elements (REQ-PB-068, REQ-S10-012)", () => {
  it("REQ-PB-068 A09: an executive ask without Impact of delay is 422 at /brief/impactOfDelay, and nothing is written", async () => {
    const m = await meeting("executive_steerco");
    expect(m.chair).toBe(x.sponsor.id);
    const item = await askItem(m.url, brief());
    expect([item.status, item.version, item.missingElements, item.brief.impactOfDelay]).toEqual([
      "draft",
      1,
      ["impact_of_delay"],
      null,
    ]);
    const before = await decisionsOf();
    const res = await send("POST", `${m.url}/agenda-items/${item.id}/publish`, {
      session: x.sponsor.session,
      headers: ifm(1),
    });
    expect([res.status, res.body.code, res.body.errors]).toEqual([
      422,
      "agenda_item.executive_ask_incomplete",
      [
        {
          pointer: "/brief/impactOfDelay",
          code: "agenda_item.executive_ask_incomplete",
          message: "Impact of delay is required.",
        },
      ],
    ]);
    expect(res.body.detail).toBe(
      "An executive agenda item must state the decision required, why now, options, recommendation, impact of delay, decision owner and required date before it is published. Missing: impact of delay.",
    );
    expect(await decisionsOf()).toBe(before);
    const row = await api.db.selectFrom("agenda_item").selectAll().where("id", "=", item.id).executeTakeFirstOrThrow();
    expect([row.status, row.version, row.decision_id]).toEqual(["draft", 1, null]);
    expect((await auditOf(api.db, item.id)).map((e) => e.action)).toEqual(["agenda_item.create"]);
  });

  it("every missing element is listed, each at its own pointer; one option counts as missing options", async () => {
    const m = await meeting("executive_steerco");
    const res = await send("POST", `${m.url}/agenda-items`, {
      session: x.lead.session,
      body: { itemKind: "executive_ask", title: "Synthetic", brief: { options: ["Only one"] } },
    });
    expect(res.body.missingElements).toEqual([
      "decision_required",
      "why_now",
      "options",
      "recommendation",
      "impact_of_delay",
      "decision_owner",
      "required_date",
    ]);
    const pub = await send("POST", `${m.url}/agenda-items/${res.body.id}/publish`, {
      session: x.sponsor.session,
      headers: ifm(1),
    });
    expect(pub.body.errors.map((e: { pointer: string }) => e.pointer)).toEqual([
      "/brief/decisionRequired",
      "/brief/whyNow",
      "/brief/options",
      "/brief/recommendation",
      "/brief/impactOfDelay",
      "/brief/ownerUserId",
      "/brief/requiredDate",
    ]);
  });

  it("REQ-PB-061: a complete brief publishes into T16 (brief cleared), and the Outcome recorded in the meeting appears in T16", async () => {
    const m = await meeting("executive_steerco");
    const item = await askItem(m.url, brief({ impactOfDelay: "Synthetic: the discount is lost" }));
    const pub = await send("POST", `${m.url}/agenda-items/${item.id}/publish`, {
      session: x.sponsor.session,
      headers: ifm(1),
    });
    expect(pub.status, JSON.stringify(pub.body)).toBe(200);
    expect([pub.headers.etag, pub.body.status, pub.body.brief, pub.body.missingElements, pub.body.publishedBy]).toEqual(
      ['"2"', "published", null, [], x.sponsor.id],
    );
    const decisionId = pub.body.decisionId as string;
    const row = await api.db.selectFrom("agenda_item").selectAll().where("id", "=", item.id).executeTakeFirstOrThrow();
    expect([row.ask_decision_required, row.ask_why_now, row.ask_options, row.ask_impact_of_delay]).toEqual([
      null,
      null,
      null,
      null,
    ]);
    const log = await send("GET", `${T()}/executive-decisions?origin=agenda`, { session: x.auditor.session });
    const entry = log.body.items.find((d: { id: string }) => d.id === decisionId);
    expect([entry.askOrigin, entry.status, entry.whyNow, entry.impactOfDelay, entry.ownerUserId]).toEqual([
      "agenda",
      "open",
      "Synthetic: the vendor's offer expires this month",
      "Synthetic: the discount is lost",
      x.sponsor.id,
    ]);
    expect((await auditOf(api.db, item.id)).map((e) => e.action)).toEqual([
      "agenda_item.create",
      "agenda_item.publish",
    ]);

    expect((await send("POST", `${m.url}/start`, { session: x.lead.session, headers: ifm(1) })).status).toBe(200);
    const decided = await send("POST", `${m.url}/agenda-items/${item.id}/outcome`, {
      session: x.sponsor.session,
      headers: ifm(2),
      body: { outcome: "decided", chosenOptionLabel: "A", outcomeText: "Synthetic: migrate now", decisionVersion: 1 },
    });
    expect(decided.status, JSON.stringify(decided.body)).toBe(200);
    expect([decided.body.status, decided.body.outcome, decided.body.outcomeRecordedBy]).toEqual([
      "closed",
      "decided",
      x.sponsor.id,
    ]);
    const t16 = await send("GET", `${T()}/executive-decisions/${decisionId}`, { session: x.auditor.session });
    expect([t16.body.status, t16.body.outcome, t16.body.decidedBy]).toEqual([
      "decided",
      "Synthetic: migrate now",
      x.sponsor.id,
    ]);
    const decidedLog = await send("GET", `${T()}/executive-decisions?status=decided`, { session: x.auditor.session });
    expect(decidedLog.body.items.map((d: { id: string }) => d.id)).toContain(decisionId);
    const outputs = await send("GET", `${m.url}/outputs`, { session: x.auditor.session });
    expect(outputs.body.items.map((o: Body) => [o.outputKind, o.recordType, o.recordId, o.agendaItemId])).toEqual([
      ["decision", "decision", decisionId, item.id],
    ]);
  });

  it("an item may link an open T16 ask instead of a brief; a decided ask or a non-executive decision is not linkable", async () => {
    const m = await meeting("executive_steerco");
    const raised = await send("POST", `${T()}/executive-decisions`, {
      session: x.lead.session,
      body: {
        title: "Synthetic: linked ask",
        whyNow: "Synthetic",
        options: [{ title: "One" }, { title: "Two" }],
        recommendation: "B",
        impactOfDelay: "Synthetic",
        ownerUserId: x.sponsor.id,
        requiredDate: plusDays(today, 12),
      },
    });
    expect(raised.status).toBe(201);
    const linked = await send("POST", `${m.url}/agenda-items`, {
      session: x.lead.session,
      body: { itemKind: "executive_ask", title: "Synthetic linked", decisionId: raised.body.id },
    });
    expect([linked.status, linked.body.decisionId, linked.body.brief, linked.body.missingElements]).toEqual([
      201,
      raised.body.id,
      null,
      [],
    ]);
    const pub = await send("POST", `${m.url}/agenda-items/${linked.body.id}/publish`, {
      session: x.sponsor.session,
      headers: ifm(1),
    });
    expect([pub.status, pub.body.decisionId]).toEqual([200, raised.body.id]);
    const design = await send("POST", `${m.url}/agenda-items`, {
      session: x.lead.session,
      body: { itemKind: "executive_ask", title: "Synthetic", decisionId: x.decisionId },
    });
    expect([design.status, design.body.code, design.body.errors[0].pointer]).toEqual([
      422,
      "agenda_item.decision_not_linkable",
      "/decisionId",
    ]);
    const both = await send("POST", `${m.url}/agenda-items`, {
      session: x.lead.session,
      body: { itemKind: "executive_ask", title: "Synthetic", decisionId: raised.body.id, brief: { whyNow: "X" } },
    });
    expect([both.status, both.body.errors[0].code]).toEqual([400, "validation.agenda_ask_shape"]);
    const t = await meeting("transformation_review");
    const notAsk = await send("POST", `${t.url}/agenda-items`, {
      session: x.lead.session,
      body: { itemKind: "discussion", title: "Synthetic", brief: { whyNow: "X" } },
    });
    expect([notAsk.status, notAsk.body.errors[0].pointer]).toEqual([400, "/brief"]);
  });
});

describe("createAgendaItem rules", () => {
  it("Escalate decisions, not status: an information item on the Executive SteerCo agenda is 422, nothing written", async () => {
    const m = await meeting("executive_steerco");
    const res = await send("POST", `${m.url}/agenda-items`, {
      session: x.lead.session,
      body: { itemKind: "information", title: "Synthetic status update" },
    });
    expect([res.status, res.body.code, res.body.detail]).toEqual([
      422,
      "agenda_item.executive_asks_only",
      "Escalate decisions, not status: this forum's agenda takes executive asks only.",
    ]);
    const n = await api.db.selectFrom("agenda_item").select("id").where("meeting_id", "=", m.id).execute();
    expect(n).toHaveLength(0);
    // Another layer takes discussion and information items.
    const t = await meeting("transformation_review");
    const ok = await send("POST", `${t.url}/agenda-items`, {
      session: x.lead.session,
      body: { itemKind: "information", title: "Synthetic status update", durationMinutes: 10 },
    });
    expect([ok.status, ok.body.ordinal, ok.body.late, ok.body.missingElements, ok.headers.etag]).toEqual([
      201,
      1,
      false,
      [],
      '"1"',
    ]);
    expect(ok.headers.location).toBe(`${t.url}/agenda-items/${ok.body.id}`);
  });

  it("late items are flagged or refused after the cut-off, and the forum's item limit is enforced", async () => {
    const F = `${T()}/forums/${x.forums.rapid_response}`;
    const f = await send("GET", F, { session: x.office.session });
    const patched = await send("PATCH", F, {
      session: x.office.session,
      headers: ifm(f.body.version),
      body: { cutoffWorkingDays: 5, agendaMaxItems: 2 },
    });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    const m = await meeting("rapid_response", 1);
    const item = { itemKind: "discussion", title: "Synthetic late item" };
    const late = await send("POST", `${m.url}/agenda-items`, { session: x.lead.session, body: item });
    expect([late.status, late.body.late]).toEqual([201, true]);
    const second = await send("POST", `${m.url}/agenda-items`, { session: x.lead.session, body: item });
    expect([second.status, second.body.ordinal]).toEqual([201, 2]);
    const third = await send("POST", `${m.url}/agenda-items`, { session: x.lead.session, body: item });
    expect([third.status, third.body.code, third.body.detail]).toEqual([
      422,
      "agenda_item.max_items",
      "This forum's agenda takes at most 2 items.",
    ]);
    await send("PATCH", F, {
      session: x.office.session,
      headers: ifm(patched.body.version),
      body: { lateItemsRule: "refuse", agendaMaxItems: null },
    });
    const refused = await send("POST", `${m.url}/agenda-items`, { session: x.lead.session, body: item });
    expect([refused.status, refused.body.code]).toEqual([422, "agenda_item.after_cutoff"]);
  });
});

describe("updateAgendaItem, withdrawAgendaItem and the chair rule", () => {
  it("a draft is edited (If-Match 428/409, audited); a published item is 422 not_draft; a withdrawn item is final", async () => {
    const m = await meeting("transformation_review");
    const c = await send("POST", `${m.url}/agenda-items`, {
      session: x.lead.session,
      body: { itemKind: "discussion", title: "Synthetic" },
    });
    const I = `${m.url}/agenda-items/${c.body.id}`;
    expect((await send("PATCH", I, { session: x.lead.session, body: { title: "X" } })).status).toBe(428);
    const stale = await send("PATCH", I, { session: x.lead.session, headers: ifm(9), body: { title: "X" } });
    expect([stale.status, stale.body.currentVersion]).toEqual([409, 1]);
    const ok = await send("PATCH", I, {
      session: x.lead.session,
      headers: ifm(1),
      body: { title: "Synthetic v2", presenterUserId: x.contributor.id },
    });
    expect([ok.status, ok.body.title, ok.body.presenterUserId, ok.body.version]).toEqual([
      200,
      "Synthetic v2",
      x.contributor.id,
      2,
    ]);
    const audit = await auditOf(api.db, c.body.id);
    expect(audit.map((e) => e.action)).toEqual(["agenda_item.create", "agenda_item.update"]);
    expect(audit[1]!.changes).toMatchObject({ title: { from: "Synthetic", to: "Synthetic v2" } });
    const foreign = await send("PATCH", I, {
      session: x.lead.session,
      headers: ifm(2),
      body: { presenterUserId: w.officeB.id },
    });
    expect([foreign.status, foreign.body.errors[0].pointer]).toEqual([400, "/presenterUserId"]);
    const pub = await send("POST", `${I}/publish`, { session: x.lead.session, headers: ifm(2) });
    expect([pub.status, pub.body.status]).toEqual([200, "published"]);
    const edit = await send("PATCH", I, { session: x.lead.session, headers: ifm(3), body: { title: "Y" } });
    expect([edit.status, edit.body.code]).toEqual([422, "agenda_item.not_draft"]);
    const wd = await send("POST", `${I}/withdraw`, { session: x.lead.session, headers: ifm(3) });
    expect([wd.status, wd.body.status]).toEqual([200, "withdrawn"]);
    const again = await send("POST", `${I}/withdraw`, { session: x.lead.session, headers: ifm(4) });
    expect([again.status, again.body.code, again.body.detail]).toEqual([
      422,
      "agenda_item.final",
      "This agenda item is withdrawn and can no longer be changed.",
    ]);
  });

  it("publish is the chair's: another meeting.chair holder 403 meeting.not_chair; no chair 422 meeting.chair_unassigned", async () => {
    const m = await meeting("transformation_review");
    const c = await send("POST", `${m.url}/agenda-items`, {
      session: x.lead.session,
      body: { itemKind: "discussion", title: "Synthetic" },
    });
    const I = `${m.url}/agenda-items/${c.body.id}`;
    const notChair = await send("POST", `${I}/publish`, { session: x.sponsor.session, headers: ifm(1) });
    expect([notChair.status, notChair.body.code]).toEqual([403, "meeting.not_chair"]);
    await send("PATCH", m.url, { session: x.lead.session, headers: ifm(1), body: { chairUserId: null } });
    const none = await send("POST", `${I}/publish`, { session: x.lead.session, headers: ifm(1) });
    expect([none.status, none.body.code]).toEqual([422, "meeting.chair_unassigned"]);
  });

  it("an item cannot be ordered onto another item's position (409 agenda_item.ordinal_taken)", async () => {
    const m = await meeting("transformation_review");
    const body = { itemKind: "discussion", title: "Synthetic" };
    await send("POST", `${m.url}/agenda-items`, { session: x.lead.session, body });
    const two = await send("POST", `${m.url}/agenda-items`, { session: x.lead.session, body });
    const clash = await send("PATCH", `${m.url}/agenda-items/${two.body.id}`, {
      session: x.lead.session,
      headers: ifm(1),
      body: { ordinal: 1 },
    });
    expect([clash.status, clash.body.code]).toEqual([409, "agenda_item.ordinal_taken"]);
    const moved = await send("PATCH", `${m.url}/agenda-items/${two.body.id}`, {
      session: x.lead.session,
      headers: ifm(1),
      body: { ordinal: 7 },
    });
    expect([moved.status, moved.body.ordinal]).toEqual([200, 7]);
    const list = await send("GET", `${m.url}/agenda-items?limit=1`, { session: x.auditor.session });
    expect([list.body.items.length, typeof list.body.nextCursor]).toEqual([1, "string"]);
    const next = await send("GET", `${m.url}/agenda-items?limit=1&cursor=${list.body.nextCursor}`, {
      session: x.auditor.session,
    });
    expect(next.body.items[0].id).toBe(two.body.id);
  });
});

describe("authorization (ADR-0032 §9)", () => {
  it("AUD 403 on every write, reads in scope; ADM-only and another organization 404", async () => {
    const m = await meeting("transformation_review");
    const c = await send("POST", `${m.url}/agenda-items`, {
      session: x.lead.session,
      body: { itemKind: "discussion", title: "Synthetic" },
    });
    const I = `${m.url}/agenda-items/${c.body.id}`;
    const outsider = await signIn(api.app, w.officeB.subject);
    const writes: [string, string, Record<string, unknown> | undefined][] = [
      ["POST", `${m.url}/agenda-items`, { itemKind: "discussion", title: "X" }],
      ["PATCH", I, { title: "X" }],
      ["POST", `${I}/publish`, undefined],
      ["POST", `${I}/withdraw`, undefined],
      ["POST", `${I}/outcome`, { outcome: "noted" }],
    ];
    for (const [method, url, body] of writes) {
      for (const [session, status] of [
        [x.auditor.session, 403],
        [x.admin, 404],
        [outsider, 404],
      ] as const) {
        const res = await send(method, url, { session, headers: ifm(1), ...(body ? { body } : {}) });
        expect(res.status, `${method} ${url}`).toBe(status);
      }
    }
    expect((await send("GET", `${m.url}/agenda-items`, { session: x.auditor.session })).status).toBe(200);
    expect((await send("GET", `${m.url}/agenda-items`, { session: x.admin })).status).toBe(404);
    expect((await send("GET", `${m.url}/agenda-items`, { session: outsider })).status).toBe(404);
    const row = await api.db
      .selectFrom("agenda_item")
      .selectAll()
      .where("id", "=", c.body.id)
      .executeTakeFirstOrThrow();
    expect([row.version, row.status]).toEqual([1, "draft"]);
  });

  it("commit-time: a TL whose grant is revoked while the request waits gets 403 and nothing is written", async () => {
    const m = await meeting("transformation_review");
    const tl = await person(api, w, x.transformationId, "TL");
    const res = await afterIdentity(
      api,
      tl.id,
      () =>
        call(api.app, "POST", `${m.url}/agenda-items`, {
          session: tl.session,
          body: { itemKind: "discussion", title: "Synthetic" },
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, tl.id),
    );
    expect(res.status).toBe(403);
    const n = await api.db.selectFrom("agenda_item").select("id").where("meeting_id", "=", m.id).execute();
    expect(n).toHaveLength(0);
  });
});

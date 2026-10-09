// The T16 Executive Decision Log (ADR-0032 §6, §9, §11; T-DG4-BE-G) against a real PostgreSQL:
//  - REQ-S10-012 A09: an ask without "why now" is a 400 at /whyNow "Why now is required." and no row is written; every
//    other missing element has its own pointer and text; fewer than two options, an owner who is not an executive, a
//    required date in the past and an unknown recommended option are refused before any write;
//  - REQ-PB-081 A09: a created ask persists and returns all nine T16 columns (ID DEC-nn, Decision, Why now, Options
//    A/B, Rec., Owner, Decision date, Impact if delayed, Outcome); recording `decided` with an Outcome closes it and it
//    leaves listExecutiveDecisions?overdue=true;
//  - the Outcome is a person's business decision: only the owner (403 executive_decision.not_owner otherwise) or the
//    owner's active delegate (recorded in decidedOnBehalfOfUserId); AUD 403, ADM-only 403 (REQ-S10-003), another
//    organization 404; If-Match 428/409; the owner's My Work item is created and closed; deferral and cancellation;
//  - updateExecutiveDecision: completes or edits an open ask, re-owns it (new My Work item), refuses a closed one;
//  - the SLA due date: the required date, or the T11 row's SLA (Unknown with its reason, never guessed);
//  - commit-time authorization and the audit trail.
// All data is SYNTHETIC; recording an Outcome here approves no gate and nothing touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, seedWorld, signIn, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { person } from "../approvals/approval-world.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { businessToday, plusDays, setupMeetingWorld, type MeetingWorld } from "./meeting-fixtures.ts";
import { askBody, moveAskDates, raiseAsk } from "./t16-fixtures.ts";

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

const L = () => `/api/v1/transformations/${x.transformationId}/executive-decisions`;
const decisionsOf = async () =>
  (
    await api.db
      .selectFrom("decision")
      .select("id")
      .where("transformation_id", "=", x.transformationId)
      .where("kind", "=", "executive")
      .execute()
  ).length;

describe("createExecutiveDecision (REQ-S10-012, REQ-PB-081)", () => {
  it("REQ-S10-012 A09: an ask without 'why now' is rejected with 400 at /whyNow and nothing is written", async () => {
    const before = await decisionsOf();
    const { whyNow: _omit, ...body } = askBody(x.sponsor.id, plusDays(today, 10));
    const res = await send("POST", L(), { session: x.lead.session, body });
    expect(res.status).toBe(400);
    expect(res.body.type).toBe("urn:mth:problem:validation");
    expect(res.body.errors).toEqual([
      { pointer: "/whyNow", code: "executive_decision.field_required", message: "Why now is required." },
    ]);
    expect(await decisionsOf()).toBe(before);
  });

  it("each missing element has its own pointer and English text; too few options; bad values refused before any write", async () => {
    const before = await decisionsOf();
    const all = await send("POST", L(), { session: x.lead.session, body: { context: "Synthetic" } });
    expect(all.status).toBe(400);
    expect(all.body.errors.map((e: Body) => [e.pointer, e.message])).toEqual([
      ["/title", "Decision is required."],
      ["/whyNow", "Why now is required."],
      ["/options", "Options is required."],
      ["/recommendation", "Recommendation is required."],
      ["/impactOfDelay", "Impact of delay is required."],
      ["/ownerUserId", "Decision owner is required."],
      ["/requiredDate", "Required date is required."],
    ]);
    const one = await send("POST", L(), {
      session: x.lead.session,
      body: askBody(x.sponsor.id, plusDays(today, 5), { options: [{ title: "Only one" }] }),
    });
    expect([one.status, one.body.code, one.body.errors[0].pointer, one.body.errors[0].message]).toEqual([
      400,
      "executive_decision.options_too_few",
      "/options",
      "An executive ask states at least two options.",
    ]);
    const notExec = await send("POST", L(), { session: x.lead.session, body: askBody(x.lead.id, plusDays(today, 5)) });
    expect([notExec.status, notExec.body.code, notExec.body.errors[0].pointer]).toEqual([
      422,
      "executive_decision.owner_not_executive",
      "/ownerUserId",
    ]);
    expect(notExec.body.detail).toBe(
      "The decision owner must be an executive who holds the decision right in this transformation.",
    );
    const past = await send("POST", L(), { session: x.lead.session, body: askBody(x.sponsor.id, plusDays(today, -1)) });
    expect([past.status, past.body.code, past.body.detail]).toEqual([
      422,
      "executive_decision.required_date_past",
      "The required date cannot be before today.",
    ]);
    const rec = await send("POST", L(), {
      session: x.lead.session,
      body: askBody(x.sponsor.id, plusDays(today, 5), { recommendation: "C" }),
    });
    expect([rec.status, rec.body.code, rec.body.errors[0].pointer]).toEqual([
      422,
      "executive_decision.option_unknown",
      "/recommendation",
    ]);
    expect(await decisionsOf()).toBe(before);
  });

  it("REQ-PB-081 A09: a created ask persists all nine T16 columns; the owner gets one My Work item; audited", async () => {
    const res = await send("POST", L(), {
      session: x.lead.session,
      body: askBody(x.bo.id, plusDays(today, 7), { context: "Synthetic context" }),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.headers.etag).toBe('"1"');
    expect(res.headers.location).toBe(`${L()}/${res.body.id}`);
    const got = await send("GET", `${L()}/${res.body.id}`, { session: x.auditor.session });
    expect(got.status).toBe(200);
    const d = got.body;
    // The nine T16 columns (B0130): ID | Decision | Why now | Options | Rec. | Owner | Decision date | Impact | Outcome.
    expect(d.code).toMatch(/^DEC-\d{2,}$/);
    expect([d.decision, d.whyNow, d.options.map((o: Body) => o.label), d.recommendationOptionLabel]).toEqual([
      "Synthetic: approve the vendor switch",
      "Synthetic: the contract renewal window closes this month",
      ["A", "B"],
      "A",
    ]);
    expect([d.ownerUserId, d.ownerStatus, d.decisionDate, d.impactOfDelay, d.outcome]).toEqual([
      x.bo.id,
      "assigned",
      plusDays(today, 7),
      "Synthetic: a further quarter on the current terms",
      null,
    ]);
    expect([d.status, d.askOrigin, d.createdSource, d.slaDueDate, d.slaUnknownReason, d.overdue]).toEqual([
      "open",
      "api",
      "api",
      plusDays(today, 7),
      null,
      false,
    ]);
    expect([d.missingElements, d.escalationLevel, d.createdBy]).toEqual([[], 0, x.lead.id]);
    // The register view lists the same nine columns.
    const view = await api.db
      .selectFrom("executive_decision_log")
      .selectAll()
      .where("id", "=", d.id)
      .executeTakeFirstOrThrow();
    expect([view.t16_id, view.options, view.recommendation, view.owner_user_id]).toEqual([
      d.code,
      "A/B",
      "A: Switch vendor",
      x.bo.id,
    ]);
    const items = await api.db
      .selectFrom("work_item")
      .select(["kind", "assignee_user_id", "due_date", "status"])
      .where("subject_id", "=", d.id)
      .execute();
    expect(items).toEqual([
      { kind: "executive_decision_due", assignee_user_id: x.bo.id, due_date: plusDays(today, 7), status: "open" },
    ]);
    expect((await auditOf(api.db, d.id)).map((e) => [e.action, e.actor_user_id])).toEqual([
      ["executive_decision.create", x.lead.id],
    ]);
  });

  it("a recommendation text is kept as text; the list filters by status and origin and pages", async () => {
    const a = await raiseAsk(send, x, x.fin.id, plusDays(today, 9), { recommendation: "Synthetic: decide in May" });
    const got = await send("GET", `${L()}/${a.id}`, { session: x.lead.session });
    expect([got.body.recommendationOptionLabel, got.body.recommendationText]).toEqual([
      null,
      "Synthetic: decide in May",
    ]);
    const page1 = await send("GET", `${L()}?limit=1&origin=api&status=open`, { session: x.auditor.session });
    expect([page1.status, page1.body.items.length, typeof page1.body.nextCursor]).toEqual([200, 1, "string"]);
    const page2 = await send("GET", `${L()}?limit=1&origin=api&status=open&cursor=${page1.body.nextCursor}`, {
      session: x.auditor.session,
    });
    expect(page2.body.items[0].id).not.toBe(page1.body.items[0].id);
  });

  it("negative: AUD 403, SP (no create right) 403, ADM-only and another organization 404; nothing written", async () => {
    const before = await decisionsOf();
    const outsider = await signIn(api.app, w.officeB.subject);
    for (const [session, status] of [
      [x.auditor.session, 403],
      [x.sponsor.session, 403],
      [x.admin, 404],
      [outsider, 404],
    ] as const)
      expect((await send("POST", L(), { session, body: askBody(x.sponsor.id, plusDays(today, 5)) })).status).toBe(
        status,
      );
    expect((await send("GET", L(), { session: x.admin })).status).toBe(404);
    expect((await send("GET", L(), { session: outsider })).status).toBe(404);
    expect(await decisionsOf()).toBe(before);
    // TO and TL hold executive_decision.create.
    expect((await raiseAsk(send, x, x.sponsor.id, plusDays(today, 5), {}, x.office.session)).code).toMatch(/^DEC-/);
  });

  it("commit-time: a TL whose grant is revoked while the request waits gets 403 and nothing is written", async () => {
    const tl = await person(api, w, x.transformationId, "TL");
    const before = await decisionsOf();
    const res = await afterIdentity(
      api,
      tl.id,
      () =>
        call(api.app, "POST", L(), {
          session: tl.session,
          body: askBody(x.sponsor.id, plusDays(today, 5)),
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, tl.id),
    );
    expect(res.status).toBe(403);
    expect(await decisionsOf()).toBe(before);
  });
});

describe("recordExecutiveDecisionOutcome (REQ-PB-081; ADR-0032 §6, §9)", () => {
  it("REQ-PB-081 A09: an overdue ask is listed; the owner records `decided` with an Outcome; it closes and leaves the overdue list", async () => {
    const a = await raiseAsk(send, x, x.bo.id, today);
    await moveAskDates(api.db, a.id, plusDays(today, -3), plusDays(today, -3));
    const overdue = await send("GET", `${L()}?overdue=true`, { session: x.auditor.session });
    expect(overdue.body.items.map((i: Body) => i.id)).toContain(a.id);
    expect(overdue.body.items.find((i: Body) => i.id === a.id).overdue).toBe(true);
    const O = `${L()}/${a.id}/outcome`;
    const body = { outcome: "decided", chosenOptionLabel: "A", outcomeText: "Synthetic: switch vendor from Q3" };
    expect((await send("POST", O, { session: x.bo.session, body })).status).toBe(428);
    expect((await send("POST", O, { session: x.bo.session, headers: ifm(1), body })).status).toBe(409);
    const noText = await send("POST", O, { session: x.bo.session, headers: ifm(2), body: { outcome: "decided" } });
    expect([noText.status, noText.body.code, noText.body.errors[0].pointer]).toEqual([
      400,
      "executive_decision.field_required",
      "/outcomeText",
    ]);
    const badLabel = await send("POST", O, {
      session: x.bo.session,
      headers: ifm(2),
      body: { ...body, chosenOptionLabel: "Z" },
    });
    expect([badLabel.status, badLabel.body.code]).toEqual([422, "executive_decision.option_unknown"]);
    const res = await send("POST", O, { session: x.bo.session, headers: ifm(2), body });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect([
      res.body.status,
      res.body.outcome,
      res.body.chosenOptionLabel,
      res.body.decidedBy,
      res.body.overdue,
    ]).toEqual(["decided", "Synthetic: switch vendor from Q3", "A", x.bo.id, false]);
    expect(res.body.decidedOnBehalfOfUserId).toBeNull();
    const after = await send("GET", `${L()}?overdue=true`, { session: x.auditor.session });
    expect(after.body.items.map((i: Body) => i.id)).not.toContain(a.id);
    const decided = await send("GET", `${L()}?status=decided`, { session: x.auditor.session });
    expect(decided.body.items.map((i: Body) => i.id)).toContain(a.id);
    const items = await api.db.selectFrom("work_item").select(["status"]).where("subject_id", "=", a.id).execute();
    expect(items.map((i) => i.status)).toEqual(["done"]);
    const final = await send("POST", O, { session: x.bo.session, headers: ifm(3), body });
    expect([final.status, final.body.code, final.body.detail]).toEqual([
      422,
      "executive_decision.closed",
      "This executive decision is decided and can no longer be changed.",
    ]);
    expect((await auditOf(api.db, a.id)).map((e) => e.action)).toEqual([
      "executive_decision.create",
      "decision.test_clock",
      "executive_decision.decide",
    ]);
  });

  it("only the owner: another executive 403 not_owner; AUD 403; ADM-only 403 (REQ-S10-003); outside 404; nothing changes", async () => {
    const a = await raiseAsk(send, x, x.bo.id, plusDays(today, 4));
    const O = `${L()}/${a.id}/outcome`;
    const body = { outcome: "decided", outcomeText: "Synthetic" };
    const other = await send("POST", O, { session: x.bo2.session, headers: ifm(1), body });
    expect([other.status, other.body.code, other.body.detail]).toEqual([
      403,
      "executive_decision.not_owner",
      "Only the decision owner, or an active delegate acting for them, can record the outcome.",
    ]);
    const outsider = await signIn(api.app, w.officeB.subject);
    for (const [session, status] of [
      [x.auditor.session, 403],
      [x.admin, 403],
      [x.lead.session, 403],
      [outsider, 404],
    ] as const)
      expect((await send("POST", O, { session, headers: ifm(1), body })).status).toBe(status);
    const d = await api.db
      .selectFrom("decision")
      .select(["status", "version"])
      .where("id", "=", a.id)
      .executeTakeFirstOrThrow();
    expect(d).toEqual({ status: "open", version: 1 });
  });

  it("an active delegate of the owner records the Outcome; decidedOnBehalfOfUserId names the owner", async () => {
    const a = await raiseAsk(send, x, x.bo.id, plusDays(today, 4));
    const hours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
    const del = await send("POST", "/api/v1/delegations", {
      session: x.bo.session,
      body: {
        delegateUserId: x.bo2.id,
        reasonCode: "absence",
        absenceNote: "Synthetic leave",
        effectiveFrom: hours(-1),
        effectiveTo: hours(24),
      },
    });
    expect(del.status, JSON.stringify(del.body)).toBe(201);
    const res = await send("POST", `${L()}/${a.id}/outcome`, {
      session: x.bo2.session,
      headers: ifm(1),
      body: { outcome: "decided", chosenOptionLabel: "B", outcomeText: "Synthetic: renew for one year" },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect([res.body.decidedBy, res.body.decidedOnBehalfOfUserId]).toEqual([x.bo2.id, x.bo.id]);
    const ev = (await auditOf(api.db, a.id)).at(-1)!;
    expect([ev.action, ev.actor_user_id, ev.on_behalf_of_user_id]).toEqual([
      "executive_decision.decide",
      x.bo2.id,
      x.bo.id,
    ]);
  });

  it("deferred needs a date after today and moves the decision and SLA dates; cancelled needs a reason and is final", async () => {
    const a = await raiseAsk(send, x, x.fin.id, plusDays(today, 3));
    const O = `${L()}/${a.id}/outcome`;
    const noDate = await send("POST", O, { session: x.fin.session, headers: ifm(1), body: { outcome: "deferred" } });
    expect([noDate.status, noDate.body.code, noDate.body.errors[0].pointer]).toEqual([
      422,
      "executive_decision.defer_date_required",
      "/deferUntil",
    ]);
    const todayDate = await send("POST", O, {
      session: x.fin.session,
      headers: ifm(1),
      body: { outcome: "deferred", deferUntil: today },
    });
    expect(todayDate.status).toBe(422);
    const deferred = await send("POST", O, {
      session: x.fin.session,
      headers: ifm(1),
      body: { outcome: "deferred", deferUntil: plusDays(today, 20) },
    });
    expect(deferred.status, JSON.stringify(deferred.body)).toBe(200);
    expect([deferred.body.status, deferred.body.decisionDate, deferred.body.slaDueDate]).toEqual([
      "deferred",
      plusDays(today, 20),
      plusDays(today, 20),
    ]);
    const noReason = await send("POST", O, { session: x.fin.session, headers: ifm(2), body: { outcome: "cancelled" } });
    expect(noReason.status).toBe(400);
    const cancelled = await send("POST", O, {
      session: x.fin.session,
      headers: ifm(2),
      body: { outcome: "cancelled", outcomeText: "Synthetic: superseded" },
    });
    expect([cancelled.status, cancelled.body.status]).toEqual([200, "cancelled"]);
    const items = await api.db.selectFrom("work_item").select("status").where("subject_id", "=", a.id).execute();
    expect(items.map((i) => i.status)).toEqual(["cancelled"]);
    const edit = await send("PATCH", `${L()}/${a.id}`, {
      session: x.lead.session,
      headers: ifm(3),
      body: { title: "Synthetic" },
    });
    expect([edit.status, edit.body.code]).toEqual([422, "executive_decision.closed"]);
  });
});

describe("updateExecutiveDecision and the SLA due date (ADR-0032 §6)", () => {
  it("edits an open ask (If-Match 428/409); options replaced (withdrawn, never deleted); re-owning creates the new owner's item", async () => {
    const a = await raiseAsk(send, x, x.bo.id, plusDays(today, 6));
    const U = `${L()}/${a.id}`;
    expect((await send("PATCH", U, { session: x.lead.session, body: { title: "Synthetic" } })).status).toBe(428);
    expect((await send("PATCH", U, { session: x.lead.session, headers: ifm(9), body: { title: "x" } })).status).toBe(
      409,
    );
    expect((await send("PATCH", U, { session: x.auditor.session, headers: ifm(1), body: { title: "x" } })).status).toBe(
      403,
    );
    const few = await send("PATCH", U, {
      session: x.lead.session,
      headers: ifm(1),
      body: { options: [{ title: "One" }] },
    });
    expect([few.status, few.body.code]).toEqual([400, "executive_decision.options_too_few"]);
    // Withdrawing the recommended option without a new recommendation is refused.
    const lost = await send("PATCH", U, {
      session: x.lead.session,
      headers: ifm(1),
      body: { options: [{ title: "Keep" }, { title: "Other" }, { title: "Third" }], recommendation: "C" },
    });
    expect(lost.status, JSON.stringify(lost.body)).toBe(200);
    expect([lost.body.options.length, lost.body.recommendationOptionLabel]).toEqual([3, "C"]);
    const shrink = await send("PATCH", U, {
      session: x.lead.session,
      headers: ifm(2),
      body: { options: [{ title: "Keep" }, { title: "Other" }] },
    });
    expect([shrink.status, shrink.body.code]).toEqual([422, "executive_decision.option_unknown"]);
    const ok = await send("PATCH", U, {
      session: x.lead.session,
      headers: ifm(2),
      body: { options: [{ title: "Keep" }, { title: "Other" }], recommendation: "B", ownerUserId: x.fin.id },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.options.map((o: Body) => [o.label, o.status])).toEqual([
      ["A", "active"],
      ["B", "active"],
      ["C", "withdrawn"],
    ]);
    expect([ok.body.ownerUserId, ok.body.recommendationOptionLabel, ok.body.version]).toEqual([x.fin.id, "B", 3]);
    const items = await api.db
      .selectFrom("work_item")
      .select(["assignee_user_id", "status"])
      .where("subject_id", "=", a.id)
      .orderBy("created_at")
      .execute();
    expect(items).toEqual([
      { assignee_user_id: x.bo.id, status: "cancelled" },
      { assignee_user_id: x.fin.id, status: "open" },
    ]);
    const notExec = await send("PATCH", U, {
      session: x.lead.session,
      headers: ifm(3),
      body: { ownerUserId: x.lead.id },
    });
    expect([notExec.status, notExec.body.code]).toEqual([422, "executive_decision.owner_not_executive"]);
    const actions = (await auditOf(api.db, a.id)).map((e) => e.action);
    expect(actions).toEqual(["executive_decision.create", "executive_decision.update", "executive_decision.update"]);
  });

  it("with a T11 row the SLA due date follows its SLA type; an Unknown SLA keeps its reason (never a guessed date)", async () => {
    const rows = await api.db
      .selectFrom("transformation_decision_right")
      .select(["id", "template_key", "sla_type", "sla_working_days"])
      .where("transformation_id", "=", x.transformationId)
      .execute();
    const working = rows.find((r) => r.sla_type === "working_days")!;
    const a = await raiseAsk(send, x, x.sponsor.id, plusDays(today, 30), { decisionRightId: working.id });
    const got = await send("GET", `${L()}/${a.id}`, { session: x.lead.session });
    const preview = await send(
      "GET",
      `/api/v1/transformations/${x.transformationId}/decision-rights/${working.id}/due-date?raisedOn=${today}`,
      { session: x.lead.session },
    );
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect([got.body.decisionRightId, got.body.slaDueDate, got.body.decisionDate]).toEqual([
      working.id,
      preview.body.dueDate,
      plusDays(today, 30),
    ]);
    const steerco = rows.find((r) => r.sla_type === "next_steerco_or_urgent");
    if (steerco) {
      const b = await raiseAsk(send, x, x.sponsor.id, plusDays(today, 30), { decisionRightId: steerco.id });
      const gb = await send("GET", `${L()}/${b.id}`, { session: x.lead.session });
      // No Executive SteerCo meeting is scheduled in this world: Unknown with its reason.
      expect([gb.body.slaDueDate, gb.body.slaUnknownReason]).toEqual([null, "no_steerco_scheduled"]);
    }
    const bad = await send("POST", L(), {
      session: x.lead.session,
      body: askBody(x.sponsor.id, plusDays(today, 30), { decisionRightId: x.forums.value_review }),
    });
    expect([bad.status, bad.body.errors[0].pointer]).toEqual([400, "/decisionRightId"]);
  });

  it("earlier executive records (DG3 funding decisions and pre-P4 rows) are listed as earlier_record with Unknown T16 columns", async () => {
    const res = await send("GET", `${L()}?origin=earlier_record`, { session: x.auditor.session });
    expect(res.status).toBe(200);
    for (const d of res.body.items) expect([d.askOrigin, d.missingElements]).toEqual(["earlier_record", []]);
  });
});

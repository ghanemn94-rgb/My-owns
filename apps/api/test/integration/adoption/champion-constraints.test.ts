// Champion constraints on T04 design decisions (T-DG4-BE-H; ADR-0033 §7, §9, §10; REQ-PB-073 "A01;A11: a champion's
// constraint links to a T04 decision and is visible on that decision"). Proves, against the run's disposable
// PostgreSQL:
//  - an active champion raises a constraint, in person, on a T04 design decision of the transformation; it is listed by
//    listChampionConstraints?decisionId= with the decision's code, and counted in the adoption plan;
//  - a non-champion (BO or WL holding champion_constraint.raise), a removed champion, or someone raising for another
//    champion is 403 champion_constraint.not_champion; a decision of another transformation is 422
//    champion_constraint.decision_invalid; nothing is written;
//  - address (decision.edit) or withdraw (the raising champion); anyone else 403
//    champion_constraint.not_resolvable_by_caller; final afterwards (422 champion_constraint.final); If-Match 428/409;
//  - AUD 403 on writes; ADM-only and outsiders 404; one audit event per mutation.
// All data is SYNTHETIC; nothing here is a business approval or touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { extraUser, seedBenefitWorld, type BenefitWorld } from "../benefits/fixtures.ts";

type Extra = Awaited<ReturnType<typeof extraUser>>;
let api: TestApi;
let w: World;
let b: BenefitWorld;
let other: BenefitWorld;
let wl: Extra;
let wl2: Extra;
let groupId: string;
let championId: string;
let decisionId: string;
let decisionCode: string;
let otherDecisionId: string;
let CC: string;

const decide = async (bw: BenefitWorld, title: string) => {
  const d = await call(api.app, "POST", "/api/v1/decisions", {
    session: bw.s.tl,
    body: {
      transformationId: bw.transformationId,
      title,
      ownerUserId: bw.users.tl.id,
      tomDimensionCode: "journeys_processes",
      options: [{ title: "Option A" }, { title: "Option B" }],
    },
  });
  expect(d.status, JSON.stringify(d.body)).toBe(201);
  return d.body as { id: string; code: string };
};

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  other = await seedBenefitWorld(api, w);
  wl = await extraUser(api, w, b, "WL");
  wl2 = await extraUser(api, w, b, "WL");
  const g = await call(api.app, "POST", `${b.base}/stakeholder-groups`, {
    session: b.s.tl,
    body: {
      name: "Synthetic contact-centre agents",
      impact: "H",
      currentStance: "resist",
      requiredBehavior: "Synthetic: resolve in the new console",
      interventionTypes: ["involvement"],
      ownerUserId: b.users.bo.id,
    },
  });
  expect(g.status, JSON.stringify(g.body)).toBe(201);
  groupId = g.body.id;
  const c = await call(api.app, "POST", `${b.base}/stakeholder-groups/${groupId}/champions`, {
    session: b.s.tl,
    body: { userId: wl.id },
  });
  expect(c.status, JSON.stringify(c.body)).toBe(201);
  championId = c.body.id;
  const d = await decide(b, "Synthetic design decision: console vendor");
  decisionId = d.id;
  decisionCode = d.code;
  otherDecisionId = (await decide(other, "Synthetic design decision elsewhere")).id;
  CC = `${b.base}/champion-constraints`;
}, 90_000);
afterAll(async () => {
  await api.close();
}, 60_000);

const raise = async (text: string, session = wl.session, champion = championId, decision = decisionId) =>
  call(api.app, "POST", CC, { session, body: { championId: champion, decisionId: decision, constraintText: text } });
const constraintCount = async () =>
  Number(
    (
      await api.db
        .selectFrom("champion_constraint")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("transformation_id", "=", b.transformationId)
        .executeTakeFirstOrThrow()
    ).n,
  );

describe("a champion's constraint on a T04 decision (REQ-PB-073 A01/A11)", () => {
  it("links to the T04 decision and is visible on that decision", async () => {
    const r = await raise("Synthetic: agents need offline mode");
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.headers.etag).toBe('"1"');
    expect(r.body).toMatchObject({
      championId,
      stakeholderGroupId: groupId,
      decisionId,
      decisionCode,
      constraintText: "Synthetic: agents need offline mode",
      status: "open",
      responseText: null,
      createdBy: wl.id,
      version: 1,
    });
    const onDecision = await call(api.app, "GET", `${CC}?decisionId=${decisionId}`, { session: b.s.auditor });
    expect(onDecision.status).toBe(200);
    expect(
      onDecision.body.items.map((x: { id: string; decisionCode: string }) => [x.id, x.decisionCode]),
    ).toContainEqual([r.body.id, decisionCode]);
    const elsewhere = await decide(b, "Synthetic design decision: unrelated");
    expect(
      (await call(api.app, "GET", `${CC}?decisionId=${elsewhere.id}`, { session: b.s.auditor })).body.items,
    ).toEqual([]);
    const plan = await call(api.app, "GET", `${b.base}/adoption-plan`, { session: b.s.auditor });
    const row = plan.body.rows.find((x: { stakeholderGroupId: string }) => x.stakeholderGroupId === groupId);
    expect(row.openChampionConstraintCount).toBeGreaterThanOrEqual(1);
    expect(row.championCount).toBe(1);
    expect((await auditOf(api.db, r.body.id)).map((a) => [a.action, a.new_version])).toEqual([
      ["champion_constraint.create", 1],
    ]);
  });

  it("a non-champion is 403 champion_constraint.not_champion; nothing is written", async () => {
    const before = await constraintCount();
    const text = "Only an active champion of this group can raise a constraint.";
    // BO and WL hold champion_constraint.raise but are not this champion.
    for (const session of [b.s.bo, wl2.session]) {
      const r = await raise("Synthetic constraint", session);
      expect([r.status, r.body.code, r.body.detail]).toEqual([403, "champion_constraint.not_champion", text]);
    }
    // An id that names no champion of this transformation.
    const r = await raise("Synthetic constraint", wl.session, otherDecisionId);
    expect([r.status, r.body.code]).toEqual([403, "champion_constraint.not_champion"]);
    expect(await constraintCount()).toBe(before);
  });

  it("a removed champion can no longer raise one (403); a decision of another transformation is 422", async () => {
    const wl3 = await extraUser(api, w, b, "WL");
    const C = `${b.base}/stakeholder-groups/${groupId}/champions`;
    const c = await call(api.app, "POST", C, { session: b.s.tl, body: { userId: wl3.id } });
    expect(c.status).toBe(201);
    const bad = await raise("Synthetic constraint", wl3.session, c.body.id, otherDecisionId);
    expect([bad.status, bad.body.code, bad.body.detail, bad.body.errors[0].pointer]).toEqual([
      422,
      "champion_constraint.decision_invalid",
      "A constraint links to a T04 design decision of this transformation.",
      "/decisionId",
    ]);
    expect((await call(api.app, "POST", `${C}/${c.body.id}/remove`, { session: b.s.tl, headers: ifm(1) })).status).toBe(
      200,
    );
    const after = await raise("Synthetic constraint", wl3.session, c.body.id);
    expect([after.status, after.body.code]).toEqual([403, "champion_constraint.not_champion"]);
  });

  it("AUD and FIN (no champion_constraint.raise) are 403; ADM-only and outsiders 404 on reads and writes", async () => {
    const before = await constraintCount();
    for (const session of [b.s.auditor, b.s.fin]) expect((await raise("Synthetic", session)).status).toBe(403);
    for (const session of [b.s.admin, b.s.outsider]) {
      expect((await raise("Synthetic", session)).status).toBe(404);
      expect((await call(api.app, "GET", CC, { session })).status).toBe(404);
    }
    expect(await constraintCount()).toBe(before);
  });
});

describe("resolving a constraint (ADR-0033 §7, §9)", () => {
  it("a decision editor addresses it with a response; final afterwards; If-Match 428/409; one audit event", async () => {
    const r = await raise("Synthetic: training slots clash with peak hours");
    const R = `${CC}/${r.body.id}/resolve`;
    const body = { outcome: "addressed", responseText: "Synthetic: sessions moved to mornings" };
    expect((await call(api.app, "POST", R, { session: b.s.tl, body })).status).toBe(428);
    expect((await call(api.app, "POST", R, { session: b.s.tl, headers: ifm(5), body })).status).toBe(409);
    const missing = await call(api.app, "POST", R, {
      session: b.s.tl,
      headers: ifm(1),
      body: { outcome: "addressed" },
    });
    expect([missing.status, missing.body.errors[0].pointer]).toEqual([400, "/responseText"]);
    const ok = await call(api.app, "POST", R, { session: b.s.tl, headers: ifm(1), body });
    expect([ok.status, ok.body.status, ok.body.responseText, ok.body.resolvedBy, ok.headers.etag]).toEqual([
      200,
      "addressed",
      "Synthetic: sessions moved to mornings",
      b.users.tl.id,
      '"2"',
    ]);
    const again = await call(api.app, "POST", R, { session: b.s.tl, headers: ifm(2), body });
    expect([again.status, again.body.code, again.body.detail]).toEqual([
      422,
      "champion_constraint.final",
      "This constraint is addressed and can no longer be changed.",
    ]);
    expect((await auditOf(api.db, r.body.id)).map((a) => a.action)).toEqual([
      "champion_constraint.create",
      "champion_constraint.address",
    ]);
  });

  it("only the raising champion withdraws; only a decision editor addresses; others 403 not_resolvable_by_caller", async () => {
    const r = await raise("Synthetic: no Arabic keyboard layout");
    const R = `${CC}/${r.body.id}/resolve`;
    const text = "Only a decision editor can address this constraint, and only its champion can withdraw it.";
    // TL edits decisions but did not raise it; BO raises constraints but holds no decision.edit; AUD holds neither.
    const denied: [typeof wl.session, Record<string, unknown>][] = [
      [b.s.tl, { outcome: "withdrawn" }],
      [wl2.session, { outcome: "withdrawn" }],
      [b.s.bo, { outcome: "addressed", responseText: "Synthetic" }],
      [b.s.auditor, { outcome: "addressed", responseText: "Synthetic" }],
    ];
    for (const [session, body] of denied) {
      const res = await call(api.app, "POST", R, { session, headers: ifm(1), body });
      expect([res.status, res.body.code, res.body.detail]).toEqual([
        403,
        "champion_constraint.not_resolvable_by_caller",
        text,
      ]);
    }
    for (const session of [b.s.admin, b.s.outsider])
      expect(
        (await call(api.app, "POST", R, { session, headers: ifm(1), body: { outcome: "withdrawn" } })).status,
      ).toBe(404);
    const withResponse = await call(api.app, "POST", R, {
      session: wl.session,
      headers: ifm(1),
      body: { outcome: "withdrawn", responseText: "Synthetic" },
    });
    expect([withResponse.status, withResponse.body.errors[0].pointer]).toEqual([400, "/responseText"]);
    const ok = await call(api.app, "POST", R, { session: wl.session, headers: ifm(1), body: { outcome: "withdrawn" } });
    expect([ok.status, ok.body.status, ok.body.responseText]).toEqual([200, "withdrawn", null]);
    const final = await call(api.app, "POST", R, {
      session: b.s.tl,
      headers: ifm(2),
      body: { outcome: "addressed", responseText: "Synthetic" },
    });
    expect([final.status, final.body.detail]).toEqual([
      422,
      "This constraint is withdrawn and can no longer be changed.",
    ]);
    const open = await call(api.app, "GET", `${CC}?status=withdrawn&stakeholderGroupId=${groupId}`, {
      session: b.s.auditor,
    });
    expect(open.body.items.map((x: { id: string }) => x.id)).toContain(r.body.id);
    expect((await auditOf(api.db, r.body.id)).map((a) => a.action)).toEqual([
      "champion_constraint.create",
      "champion_constraint.withdraw",
    ]);
  });
});

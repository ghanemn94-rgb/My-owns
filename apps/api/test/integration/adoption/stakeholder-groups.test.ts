// T13 Stakeholder & Adoption Plan, champions and impacted-team involvement (T-DG4-BE-H; ADR-0033 §7, §9, §10;
// REQ-PB-070, REQ-PB-073 (involvement half), REQ-S11-001, REQ-S16-020 StakeholderGroup). Proves, against the run's
// disposable PostgreSQL:
//  - a T13 row persists and returns all seven B0107 columns (Stakeholder, Impact, Current stance, Required behavior,
//    Intervention, Owner, Adoption KPI), in the group and in getAdoptionPlan (REQ-PB-070 A01);
//  - a stance of 'Hostile' is 400 stakeholder_group.stance_invalid at /currentStance with the exact text, and nothing
//    is written; the four intervention values are accepted, any other is 400 at /interventionTypes/n (REQ-PB-070 A01);
//  - influence and impact are recorded separately (REQ-S11-001 A11);
//  - the ADR-0033 §10 refusals (name taken, KPI of another transformation, archived) with their exact texts;
//  - champions (add, duplicate 409, remove, final) and involvement on a design workshop or a T04 design decision
//    (target_invalid, append-only withdrawal, already_withdrawn);
//  - If-Match 428/409; one audit event per mutation; AUD 403 on every write; ADM-only and outsiders 404 on every read
//    and write; commit-time authorisation (a right revoked mid-request is 403, nothing written).
// All data is SYNTHETIC; nothing here is a business approval or touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { extraUser, seedBenefitWorld, type BenefitWorld } from "../benefits/fixtures.ts";

type Extra = Awaited<ReturnType<typeof extraUser>>;
let api: TestApi;
let w: World;
let b: BenefitWorld;
let other: BenefitWorld;
let wl: Extra;
let SG: string;
let decisionId: string;
let workshopId: string;
let otherDecisionId: string;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  other = await seedBenefitWorld(api, w);
  wl = await extraUser(api, w, b, "WL");
  SG = `${b.base}/stakeholder-groups`;
  const decision = await call(api.app, "POST", "/api/v1/decisions", {
    session: b.s.tl,
    body: {
      transformationId: b.transformationId,
      title: "Synthetic design decision: CRM rollout",
      ownerUserId: b.users.tl.id,
      tomDimensionCode: "technology",
      options: [{ title: "Big bang" }, { title: "Phased" }],
    },
  });
  expect(decision.status, JSON.stringify(decision.body)).toBe(201);
  decisionId = decision.body.id;
  const ws = await call(api.app, "POST", `${b.base}/tom-workshops`, {
    session: b.s.tl,
    body: {
      title: "Synthetic TOM workshop",
      workshopDate: "2026-11-02",
      durationMinutes: 90,
      facilitatorUserId: b.users.tl.id,
    },
  });
  expect(ws.status, JSON.stringify(ws.body)).toBe(201);
  workshopId = ws.body.id;
  const od = await call(api.app, "POST", "/api/v1/decisions", {
    session: other.s.tl,
    body: {
      transformationId: other.transformationId,
      title: "Synthetic design decision elsewhere",
      ownerUserId: other.users.tl.id,
      tomDimensionCode: "technology",
      options: [{ title: "A" }, { title: "B" }],
    },
  });
  expect(od.status, JSON.stringify(od.body)).toBe(201);
  otherDecisionId = od.body.id;
}, 90_000);
afterAll(async () => {
  await api.close();
}, 60_000);

let seq = 0;
const groupBody = (extra: Record<string, unknown> = {}) => ({
  name: `Synthetic group ${++seq}`,
  impact: "H",
  influence: "L",
  currentStance: "resist",
  requiredBehavior: "Synthetic: use the new ordering journey",
  interventionTypes: ["comms", "training", "involvement", "incentive"],
  ownerUserId: wl.id,
  ...extra,
});
const newGroup = async (extra: Record<string, unknown> = {}) => {
  const r = await call(api.app, "POST", SG, { session: b.s.tl, body: groupBody(extra) });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { id: string; version: number; code: string; name: string };
};
const groupCount = async () =>
  Number(
    (
      await api.db
        .selectFrom("stakeholder_group")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("transformation_id", "=", b.transformationId)
        .executeTakeFirstOrThrow()
    ).n,
  );

describe("T13 rows (REQ-PB-070, REQ-S11-001)", () => {
  it("persists and returns all seven B0107 columns, influence separately from impact, in the group and the plan", async () => {
    const r = await call(api.app, "POST", SG, {
      session: b.s.tl,
      body: groupBody({
        name: "Synthetic retail shop staff",
        impact: "H",
        influence: "L",
        currentStance: "neutral",
        adoptionKpiDefinitionId: b.kpiDefinitionId,
        interventionPlan: "Synthetic: weekly huddles",
        headcount: 450,
      }),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.headers.etag).toBe('"1"');
    expect(r.headers.location).toBe(`${SG}/${r.body.id}`);
    expect(r.body).toMatchObject({
      code: expect.stringMatching(/^SG-\d{2,}$/),
      name: "Synthetic retail shop staff",
      impact: "H",
      influence: "L",
      currentStance: "neutral",
      requiredBehavior: "Synthetic: use the new ordering journey",
      interventionTypes: ["comms", "training", "involvement", "incentive"],
      ownerUserId: wl.id,
      adoptionKpiDefinitionId: b.kpiDefinitionId,
      headcount: 450,
      championCount: 0,
      openInterventionCount: 0,
      status: "active",
      createdBy: b.users.tl.id,
      version: 1,
    });
    const read = await call(api.app, "GET", `${SG}/${r.body.id}`, { session: b.s.auditor });
    expect([read.status, read.body.impact, read.body.influence]).toEqual([200, "H", "L"]);
    const plan = await call(api.app, "GET", `${b.base}/adoption-plan`, { session: b.s.auditor });
    expect(plan.status).toBe(200);
    const row = plan.body.rows.find((x: { stakeholderGroupId: string }) => x.stakeholderGroupId === r.body.id);
    expect(row).toEqual({
      stakeholderGroupId: r.body.id,
      code: r.body.code,
      stakeholder: "Synthetic retail shop staff",
      impact: "H",
      influence: "L",
      currentStance: "neutral",
      requiredBehavior: "Synthetic: use the new ordering journey",
      intervention: ["comms", "training", "involvement", "incentive"],
      ownerUserId: wl.id,
      adoptionKpiDefinitionId: b.kpiDefinitionId,
      adoptionKpiName: "Synthetic NPS (CX)",
      championCount: 0,
      openInterventionCount: 0,
      openChampionConstraintCount: 0,
    });
    expect((await auditOf(api.db, r.body.id)).map((a) => [a.action, a.new_version])).toEqual([
      ["stakeholder_group.create", 1],
    ]);
  });

  it("each of the four intervention values is accepted on its own", async () => {
    for (const t of ["comms", "training", "involvement", "incentive"]) {
      const g = await newGroup({ interventionTypes: [t] });
      const read = await call(api.app, "GET", `${SG}/${g.id}`, { session: b.s.auditor });
      expect(read.body.interventionTypes).toEqual([t]);
    }
  });

  it("'Hostile' is 400 stakeholder_group.stance_invalid at /currentStance with the exact text; nothing is written", async () => {
    const before = await groupCount();
    const r = await call(api.app, "POST", SG, { session: b.s.tl, body: groupBody({ currentStance: "hostile" }) });
    expect(r.status).toBe(400);
    expect(r.body.errors).toEqual([
      {
        pointer: "/currentStance",
        code: "stakeholder_group.stance_invalid",
        message: "Current stance must be Support, Neutral or Resist.",
      },
    ]);
    const g = await newGroup();
    const u = await call(api.app, "PATCH", `${SG}/${g.id}`, {
      session: b.s.tl,
      headers: ifm(1),
      body: { currentStance: "Hostile" },
    });
    expect([u.status, u.body.errors[0].code]).toEqual([400, "stakeholder_group.stance_invalid"]);
    expect(await groupCount()).toBe(before + 1);
    expect((await auditOf(api.db, g.id)).length).toBe(1);
  });

  it("impact, influence and intervention outside the closed lists: the exact codes, pointers and texts", async () => {
    const impact = await call(api.app, "POST", SG, { session: b.s.tl, body: groupBody({ impact: "X" }) });
    expect([impact.status, impact.body.errors]).toEqual([
      400,
      [{ pointer: "/impact", code: "stakeholder_group.impact_invalid", message: "Impact must be H, M or L." }],
    ]);
    const influence = await call(api.app, "POST", SG, { session: b.s.tl, body: groupBody({ influence: "high" }) });
    expect([influence.status, influence.body.errors]).toEqual([
      400,
      [{ pointer: "/influence", code: "stakeholder_group.impact_invalid", message: "Influence must be H, M or L." }],
    ]);
    const iv = await call(api.app, "POST", SG, {
      session: b.s.tl,
      body: groupBody({ interventionTypes: ["comms", "email"] }),
    });
    expect([iv.status, iv.body.errors]).toEqual([
      400,
      [
        {
          pointer: "/interventionTypes/1",
          code: "stakeholder_group.intervention_invalid",
          message: "Intervention must be Comms, Training, Involvement or Incentive.",
        },
      ],
    ]);
    const dupTypes = await call(api.app, "POST", SG, {
      session: b.s.tl,
      body: groupBody({ interventionTypes: ["comms", "comms"] }),
    });
    expect(dupTypes.status).toBe(400);
  });

  it("409 stakeholder_group.name_taken (case-insensitive); 422 kpi_invalid for another transformation's KPI", async () => {
    const g = await newGroup();
    const dup = await call(api.app, "POST", SG, { session: b.s.tl, body: groupBody({ name: g.name.toUpperCase() }) });
    expect([dup.status, dup.body.code, dup.body.detail]).toEqual([
      409,
      "stakeholder_group.name_taken",
      "A stakeholder group with this name already exists in this transformation.",
    ]);
    const kpi = await call(api.app, "POST", SG, {
      session: b.s.tl,
      body: groupBody({ adoptionKpiDefinitionId: other.kpiDefinitionId }),
    });
    expect([kpi.status, kpi.body.code, kpi.body.detail, kpi.body.errors[0].pointer]).toEqual([
      422,
      "stakeholder_group.kpi_invalid",
      "The adoption KPI must be a KPI of this transformation.",
      "/adoptionKpiDefinitionId",
    ]);
    const g2 = await newGroup();
    const rename = await call(api.app, "PATCH", `${SG}/${g2.id}`, {
      session: b.s.tl,
      headers: ifm(1),
      body: { name: g.name },
    });
    expect([rename.status, rename.body.code]).toEqual([409, "stakeholder_group.name_taken"]);
  });

  it("update needs If-Match (428/409), writes one audit event; archive is final (422 stakeholder_group.archived)", async () => {
    const g = await newGroup();
    const G = `${SG}/${g.id}`;
    expect((await call(api.app, "PATCH", G, { session: b.s.tl, body: { headcount: 9 } })).status).toBe(428);
    const stale = await call(api.app, "PATCH", G, { session: b.s.tl, headers: ifm(7), body: { headcount: 9 } });
    expect([stale.status, stale.body.code]).toEqual([409, "version_conflict"]);
    const u = await call(api.app, "PATCH", G, {
      session: b.s.tl,
      headers: ifm(1),
      body: { impact: "L", influence: "H", currentStance: "support" },
    });
    expect([u.status, u.headers.etag, u.body.impact, u.body.influence, u.body.currentStance]).toEqual([
      200,
      '"2"',
      "L",
      "H",
      "support",
    ]);
    expect(
      (await call(api.app, "POST", `${G}/archive`, { session: b.s.tl, body: { reason: "Synthetic" } })).status,
    ).toBe(428);
    const a = await call(api.app, "POST", `${G}/archive`, {
      session: b.s.tl,
      headers: ifm(2),
      body: { reason: "Synthetic: merged into another group" },
    });
    expect([a.status, a.body.status, a.body.archiveReason, a.body.version]).toEqual([
      200,
      "archived",
      "Synthetic: merged into another group",
      3,
    ]);
    const frozen = await call(api.app, "PATCH", G, { session: b.s.tl, headers: ifm(3), body: { headcount: 9 } });
    expect([frozen.status, frozen.body.code, frozen.body.detail]).toEqual([
      422,
      "stakeholder_group.archived",
      "This stakeholder group is archived and can no longer be changed.",
    ]);
    const again = await call(api.app, "POST", `${G}/archive`, {
      session: b.s.tl,
      headers: ifm(3),
      body: { reason: "Synthetic again" },
    });
    expect([again.status, again.body.code]).toEqual([422, "stakeholder_group.archived"]);
    const champ = await call(api.app, "POST", `${G}/champions`, { session: b.s.tl, body: { userId: wl.id } });
    expect([champ.status, champ.body.code]).toEqual([422, "stakeholder_group.archived"]);
    expect((await auditOf(api.db, g.id)).map((x) => x.action)).toEqual([
      "stakeholder_group.create",
      "stakeholder_group.update",
      "stakeholder_group.archive",
    ]);
    const active = await call(api.app, "GET", `${SG}?status=archived`, { session: b.s.auditor });
    expect(active.body.items.map((x: { id: string }) => x.id)).toContain(g.id);
    const plan = await call(api.app, "GET", `${b.base}/adoption-plan`, { session: b.s.auditor });
    expect(plan.body.rows.map((x: { stakeholderGroupId: string }) => x.stakeholderGroupId)).not.toContain(g.id);
  });
});

describe("champions (M0215; B0116)", () => {
  it("add, duplicate 409, list, remove with If-Match, remove again 422; counts follow; one audit event each", async () => {
    const g = await newGroup();
    const C = `${SG}/${g.id}/champions`;
    const c = await call(api.app, "POST", C, { session: b.s.tl, body: { userId: wl.id, note: "Synthetic" } });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    expect([c.body.status, c.body.userId, c.headers.etag]).toEqual(["active", wl.id, '"1"']);
    const dup = await call(api.app, "POST", C, { session: b.s.tl, body: { userId: wl.id } });
    expect([dup.status, dup.body.code, dup.body.detail]).toEqual([
      409,
      "stakeholder_champion.exists",
      "This person is already a champion of this group.",
    ]);
    const outsiderUser = await call(api.app, "POST", C, { session: b.s.tl, body: { userId: w.officeB.id } });
    expect([outsiderUser.status, outsiderUser.body.code]).toEqual([422, "validation.user_invalid"]);
    expect((await call(api.app, "GET", `${SG}/${g.id}`, { session: b.s.auditor })).body.championCount).toBe(1);
    const R = `${C}/${c.body.id}/remove`;
    expect((await call(api.app, "POST", R, { session: b.s.tl })).status).toBe(428);
    expect((await call(api.app, "POST", R, { session: b.s.tl, headers: ifm(4) })).status).toBe(409);
    const rm = await call(api.app, "POST", R, { session: b.s.tl, headers: ifm(1) });
    expect([rm.status, rm.body.status, rm.body.removedBy]).toEqual([200, "removed", b.users.tl.id]);
    const again = await call(api.app, "POST", R, { session: b.s.tl, headers: ifm(2) });
    expect([again.status, again.body.code]).toEqual([422, "invalid_transition"]);
    const list = await call(api.app, "GET", C, { session: b.s.auditor });
    expect(list.body.items.map((x: { status: string }) => x.status)).toEqual(["removed"]);
    expect((await call(api.app, "GET", `${SG}/${g.id}`, { session: b.s.auditor })).body.championCount).toBe(0);
    // A removed champion can be named again (one ACTIVE row per group and user).
    expect((await call(api.app, "POST", C, { session: b.s.tl, body: { userId: wl.id } })).status).toBe(201);
    expect((await auditOf(api.db, c.body.id)).map((x) => x.action)).toEqual([
      "stakeholder_champion.create",
      "stakeholder_champion.remove",
    ]);
    const otherGroup = await newGroup();
    expect(
      (
        await call(api.app, "POST", `${SG}/${otherGroup.id}/champions/${c.body.id}/remove`, {
          session: b.s.tl,
          headers: ifm(2),
        })
      ).status,
    ).toBe(404);
  });
});

describe("involvement in design (REQ-PB-073; B0116)", () => {
  const IV = () => `${b.base}/stakeholder-involvements`;

  it("records a group's involvement in a workshop and a T04 decision; withdrawal appends, history stays", async () => {
    const g = await newGroup();
    const ws = await call(api.app, "POST", IV(), {
      session: b.s.tl,
      body: { stakeholderGroupId: g.id, workshopId, note: "Synthetic: attended" },
    });
    expect(ws.status, JSON.stringify(ws.body)).toBe(201);
    expect(ws.body).toMatchObject({ involvementKind: "workshop", workshopId, decisionId: null, withdrawn: false });
    const d = await call(api.app, "POST", IV(), { session: b.s.tl, body: { stakeholderGroupId: g.id, decisionId } });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    expect(d.body).toMatchObject({ involvementKind: "decision", decisionId, workshopId: null, withdrawn: false });
    const onDecision = await call(api.app, "GET", `${IV()}?decisionId=${decisionId}&stakeholderGroupId=${g.id}`, {
      session: b.s.auditor,
    });
    expect(onDecision.body.items.map((x: { id: string }) => x.id)).toEqual([d.body.id]);

    const wd = await call(api.app, "POST", `${IV()}/${d.body.id}/withdraw`, {
      session: b.s.tl,
      body: { reason: "Synthetic: recorded on the wrong decision" },
    });
    expect(wd.status, JSON.stringify(wd.body)).toBe(201);
    expect(wd.body).toMatchObject({
      withdrawsInvolvementId: d.body.id,
      decisionId,
      stakeholderGroupId: g.id,
      note: "Synthetic: recorded on the wrong decision",
      withdrawn: true,
    });
    const history = await call(api.app, "GET", `${IV()}?stakeholderGroupId=${g.id}`, { session: b.s.auditor });
    expect(history.body.items.map((x: { id: string; withdrawn: boolean }) => [x.id, x.withdrawn])).toEqual([
      [ws.body.id, false],
      [d.body.id, true],
      [wd.body.id, true],
    ]);
    const twice = await call(api.app, "POST", `${IV()}/${d.body.id}/withdraw`, {
      session: b.s.tl,
      body: { reason: "Synthetic again" },
    });
    expect([twice.status, twice.body.code, twice.body.detail]).toEqual([
      422,
      "stakeholder_involvement.already_withdrawn",
      "This involvement record is already withdrawn.",
    ]);
    const ofWithdrawal = await call(api.app, "POST", `${IV()}/${wd.body.id}/withdraw`, {
      session: b.s.tl,
      body: { reason: "Synthetic" },
    });
    expect([ofWithdrawal.status, ofWithdrawal.body.code]).toEqual([422, "invalid_transition"]);
    expect((await auditOf(api.db, wd.body.id)).map((x) => [x.action, x.reason])).toEqual([
      ["stakeholder_involvement.withdraw", "Synthetic: recorded on the wrong decision"],
    ]);
  });

  it("422 stakeholder_involvement.target_invalid: neither, both, another transformation's decision or workshop", async () => {
    const g = await newGroup();
    const text = "Involvement is recorded on a design workshop or a T04 design decision of this transformation.";
    const cases: [Record<string, unknown>, string][] = [
      [{}, ""],
      [{ workshopId, decisionId }, "/decisionId"],
      [{ decisionId: otherDecisionId }, "/decisionId"],
      [{ workshopId: otherDecisionId }, "/workshopId"],
    ];
    for (const [target, pointer] of cases) {
      const r = await call(api.app, "POST", IV(), { session: b.s.tl, body: { stakeholderGroupId: g.id, ...target } });
      expect([r.status, r.body.code, r.body.detail, r.body.errors[0].pointer]).toEqual([
        422,
        "stakeholder_involvement.target_invalid",
        text,
        pointer,
      ]);
    }
  });
});

describe("authorization (ADR-0033 §9; S-4)", () => {
  it("AUD is 403 on every write; ADM-only and outsiders 404 on every read and write; nothing is written", async () => {
    const g = await newGroup();
    const G = `${SG}/${g.id}`;
    const c = await call(api.app, "POST", `${G}/champions`, { session: b.s.tl, body: { userId: wl.id } });
    const inv = await call(api.app, "POST", `${b.base}/stakeholder-involvements`, {
      session: b.s.tl,
      body: { stakeholderGroupId: g.id, decisionId },
    });
    const writes: [string, string, Record<string, unknown> | undefined, boolean][] = [
      ["POST", SG, groupBody(), false],
      ["PATCH", G, { headcount: 5 }, true],
      ["POST", `${G}/archive`, { reason: "Synthetic" }, true],
      ["POST", `${G}/champions`, { userId: b.users.bo.id }, false],
      ["POST", `${G}/champions/${c.body.id}/remove`, undefined, true],
      ["POST", `${b.base}/stakeholder-involvements`, { stakeholderGroupId: g.id, workshopId }, false],
      ["POST", `${b.base}/stakeholder-involvements/${inv.body.id}/withdraw`, { reason: "Synthetic" }, false],
    ];
    const before = await groupCount();
    for (const [method, url, body, versioned] of writes) {
      const opts = { ...(body !== undefined ? { body } : {}), ...(versioned ? { headers: ifm(1) } : {}) };
      expect((await call(api.app, method, url, { session: b.s.auditor, ...opts })).status, `${method} ${url}`).toBe(
        403,
      );
      for (const session of [b.s.admin, b.s.outsider])
        expect((await call(api.app, method, url, { session, ...opts })).status, `${method} ${url}`).toBe(404);
    }
    const reads = [SG, G, `${b.base}/adoption-plan`, `${G}/champions`, `${b.base}/stakeholder-involvements`];
    for (const url of reads) {
      expect((await call(api.app, "GET", url, { session: b.s.auditor })).status, url).toBe(200);
      for (const session of [b.s.admin, b.s.outsider])
        expect((await call(api.app, "GET", url, { session })).status, url).toBe(404);
    }
    expect(await groupCount()).toBe(before);
    expect((await auditOf(api.db, g.id)).length).toBe(1);
    expect((await auditOf(api.db, c.body.id)).length).toBe(1);
    // BO and WL hold adoption.edit (REQ-PB-070 "create/edit:BO,WL,TL").
    for (const session of [b.s.bo, wl.session])
      expect((await call(api.app, "POST", SG, { session, body: groupBody() })).status).toBe(201);
    expect((await call(api.app, "POST", SG, { session: b.s.fin, body: groupBody() })).status).toBe(403);
    // Another transformation's group is not found through this transformation's path.
    expect(
      (await call(api.app, "GET", `${other.base}/stakeholder-groups/${g.id}`, { session: other.s.tl })).status,
    ).toBe(404);
  });

  it("re-checks adoption.edit at commit time: a right revoked mid-request is 403 and nothing is written", async () => {
    const g = await newGroup();
    const u = await extraUser(api, w, b, "WL");
    const res = await afterIdentity(
      api,
      u.id,
      () =>
        call(api.app, "PATCH", `${SG}/${g.id}`, {
          session: u.session,
          headers: ifm(1),
          body: { headcount: 77 },
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    const row = await api.db
      .selectFrom("stakeholder_group")
      .select(["headcount", "version"])
      .where("id", "=", g.id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ headcount: null, version: 1 });
  });
});

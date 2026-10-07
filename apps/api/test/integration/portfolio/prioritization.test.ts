// Prioritization (T06) against a real PostgreSQL (ADR-0022; REQ-PB-047, REQ-PB-048, REQ-PB-049, REQ-S09-001,
// REQ-S09-003, REQ-S09-004, REQ-S09-005; T-DG3-BE-D):
//  - scores 1-5 (6, 0, 2.5 -> 400; the weighted score is never an input); 5,4,3,2,1 under v1 -> 3.3000 stored, 3.30
//    shown, 57.5 in the labelled 0-100 view; a missing score -> 'incomplete' with weightedScore null, never a number;
//  - weight sets: 95% / 105% -> 422 prioritization.weights_total with NOTHING written; v2 with risk_compliance 10 and
//    strategic fit 15 accepted as version 2, approved by the Sponsor (never the proposer), used for rescoring; v1
//    results keep v1 forever; a set is immutable (DB guard);
//  - rankings: deterministic tie-break, causes and labels ('weight version 2'), submitted -> ranked with its audit;
//  - overrides: a reason is required (400 / 422), the proposer cannot approve;
//  - every mutation: AUD 403, If-Match 428/409, an audit event, authorization re-checked at commit.
// All data is SYNTHETIC. Weight-set and override approvals are demo business decisions inside the product that approve
// nothing real; nothing here touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildPrioritizationView,
  DEFAULT_FLAG_SOURCES,
  PORTFOLIO_VIEW_MAX,
} from "../../../src/modules/portfolio/prioritization.ts";
import { rankOrder } from "../../../src/modules/portfolio/rankings.ts";
import {
  auditOf,
  call,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { ifm, setupP2World, type P2World } from "../../support/p2-fixtures.ts";
import { cancelInitiative, insertInitiative } from "../contract/p3-exercises-be-d.ts";

let api: TestApi;
let w: World;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 60_000);
afterAll(() => api.close());

const CODES = ["strategic_fit", "financial_value", "customer_impact", "feasibility", "time_to_value"] as const;
const V2_WEIGHTS = [
  { criterionCode: "strategic_fit", weightPercent: "15" },
  { criterionCode: "financial_value", weightPercent: "25" },
  { criterionCode: "customer_impact", weightPercent: "20" },
  { criterionCode: "feasibility", weightPercent: "15" },
  { criterionCode: "time_to_value", weightPercent: "15" },
  { criterionCode: "risk_compliance", weightPercent: "10" },
];
const T = (p: P2World) => `/api/v1/transformations/${p.transformationId}/prioritization`;
const S = (initiativeId: string) => `/api/v1/initiatives/${initiativeId}/scores`;

const score = (s: Session, initiativeId: string, criterionCode: string, value: unknown) =>
  call(api.app, "POST", S(initiativeId), { session: s, body: { criterionCode, score: value } });

async function scoreAll(s: Session, initiativeId: string, values: Record<string, number>) {
  for (const [c, v] of Object.entries(values)) {
    const r = await score(s, initiativeId, c, v);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  }
}

async function proposeV2(p: P2World, session: Session = p.lead.session) {
  return call(api.app, "POST", `${T(p)}/weight-sets`, {
    session,
    body: {
      rationale: "Synthetic: regulated transformation, risk/compliance replaces part of strategic fit (B0077).",
      weights: V2_WEIGHTS,
    },
  });
}

async function approve(p: P2World, versionNo: number, version: number, session: Session = p.sponsor.session) {
  return call(api.app, "POST", `${T(p)}/weight-sets/${versionNo}/approve`, {
    session,
    headers: ifm(version),
    body: { note: "Synthetic demo business approval." },
  });
}

const counts = async (p: P2World) => {
  const sets = await api.db
    .selectFrom("scoring_weight_set")
    .select("id")
    .where("transformation_id", "=", p.transformationId)
    .execute();
  const weights = await api.db
    .selectFrom("scoring_weight")
    .select("id")
    .where("transformation_id", "=", p.transformationId)
    .execute();
  const audit = await api.db
    .selectFrom("audit_event")
    .select("id")
    .where("transformation_id", "=", p.transformationId)
    .where("record_type", "=", "scoring_weight_set")
    .execute();
  return { sets: sets.length, weights: weights.length, audit: audit.length };
};

// ------------------------------------------------------------------------------------------------ scores

describe("scores (REQ-PB-047, REQ-PB-048, REQ-S09-001)", () => {
  it("score 6 -> 400; 0, 2.5 and '4' -> 400; a weightedScore property -> 400 (read-only); nothing written", async () => {
    const p = await setupP2World(api, w);
    const ini = await insertInitiative(api, p.transformationId, p.lead.id);
    for (const bad of [6, 0, 2.5, "4"]) {
      const r = await score(p.lead.session, ini.id, "feasibility", bad);
      expect(r.status, `score ${JSON.stringify(bad)}`).toBe(400);
      expect(r.body.errors.some((e: { pointer: string }) => e.pointer === "/score")).toBe(true);
    }
    const injected = await call(api.app, "POST", S(ini.id), {
      session: p.lead.session,
      body: { criterionCode: "feasibility", score: 4, weightedScore: "5.0000" },
    });
    expect(injected.status).toBe(400);
    const rows = await api.db.selectFrom("initiative_score").select("id").where("initiative_id", "=", ini.id).execute();
    expect(rows).toHaveLength(0);
  });

  it("5,4,3,2,1 under v1 -> stored 3.3000, shown 3.30, 0-100 view 57.5 with its label; appended with its cause; audited", async () => {
    const p = await setupP2World(api, w);
    const ini = await insertInitiative(api, p.transformationId, p.lead.id);
    await scoreAll(p.lead.session, ini.id, {
      strategic_fit: 5,
      financial_value: 4,
      customer_impact: 3,
      feasibility: 2,
      time_to_value: 1,
    });
    const sheet = await call(api.app, "GET", S(ini.id), { session: p.auditor.session });
    expect(sheet.status).toBe(200);
    expect(sheet.body.result).toMatchObject({
      weightSetVersionNo: 1,
      completeness: "complete",
      weightedScore: "3.3000",
      weightedScoreDisplay: "3.30",
      display100: "57.5",
      conversion: "(score-1)/4*100",
      missingCriteria: [],
    });
    const results = await api.db
      .selectFrom("initiative_score_result")
      .selectAll()
      .where("initiative_id", "=", ini.id)
      .orderBy("computed_at")
      .orderBy("id")
      .execute();
    expect(results.map((r) => [r.cause, r.completeness, r.weighted_score])).toEqual([
      ["initial", "incomplete", null],
      ["score_change", "incomplete", null],
      ["score_change", "incomplete", null],
      ["score_change", "incomplete", null],
      ["score_change", "complete", "3.3000"],
    ]);
    const view = await call(api.app, "GET", T(p), { session: p.auditor.session });
    expect(view.body.conversionLabel).toBe("0–100 view = (weighted score − 1) ÷ 4 × 100");
    expect(view.body.items[0].result.display100).toBe("57.5");
    const scoreRow = await api.db
      .selectFrom("initiative_score")
      .select("id")
      .where("initiative_id", "=", ini.id)
      .where("criterion_code", "=", "time_to_value")
      .executeTakeFirstOrThrow();
    const audit = await auditOf(api.db, scoreRow.id);
    expect(audit.map((a) => a.action)).toEqual(["initiative_score.create"]);
    expect(audit[0]!.changes).toMatchObject({ weightedScore: { from: null, to: "3.3000" } });
  });

  it("a missing score -> 'incomplete' with weightedScore null (never a number, never 0)", async () => {
    const p = await setupP2World(api, w);
    const ini = await insertInitiative(api, p.transformationId, p.lead.id);
    await scoreAll(p.lead.session, ini.id, {
      strategic_fit: 5,
      financial_value: 4,
      customer_impact: 3,
      feasibility: 2,
    });
    const sheet = await call(api.app, "GET", S(ini.id), { session: p.lead.session });
    expect(sheet.body.result).toMatchObject({
      completeness: "incomplete",
      weightedScore: null,
      weightedScoreDisplay: null,
      display100: null,
      missingCriteria: ["time_to_value"],
    });
    // An initiative with no score at all: the live result is incomplete too (computedAt null), never 0.
    const empty = await insertInitiative(api, p.transformationId, p.lead.id);
    const none = await call(api.app, "GET", S(empty.id), { session: p.lead.session });
    expect(none.body.result).toMatchObject({ completeness: "incomplete", weightedScore: null, computedAt: null });
    expect(none.body.result.missingCriteria).toEqual([...CODES]);
  });

  it("PATCH: If-Match 428/409; clearing (null) makes it incomplete again; duplicate POST 409; AUD 403 on POST and PATCH", async () => {
    const p = await setupP2World(api, w);
    const ini = await insertInitiative(api, p.transformationId, p.lead.id);
    await scoreAll(p.contributor.session, ini.id, {
      strategic_fit: 5,
      financial_value: 4,
      customer_impact: 3,
      feasibility: 2,
      time_to_value: 1,
    });
    expect((await score(p.contributor.session, ini.id, "feasibility", 3)).status).toBe(409);
    const url = `${S(ini.id)}/feasibility`;
    expect((await call(api.app, "PATCH", url, { session: p.contributor.session, body: { score: 3 } })).status).toBe(
      428,
    );
    expect(
      (await call(api.app, "PATCH", url, { session: p.contributor.session, headers: ifm(5), body: { score: 3 } }))
        .status,
    ).toBe(409);
    expect((await score(p.auditor.session, ini.id, "risk_compliance", 3)).status).toBe(403);
    expect(
      (await call(api.app, "PATCH", url, { session: p.auditor.session, headers: ifm(1), body: { score: 3 } })).status,
    ).toBe(403);
    const changed = await call(api.app, "PATCH", url, {
      session: p.contributor.session,
      headers: ifm(1),
      body: { score: 4 },
    });
    expect([changed.status, changed.body.version, changed.headers["etag"]]).toEqual([200, 2, '"2"']);
    let sheet = await call(api.app, "GET", S(ini.id), { session: p.lead.session });
    expect(sheet.body.result.weightedScore).toBe("3.6000"); // 125 + 100 + 60 + 60 + 15
    const cleared = await call(api.app, "PATCH", url, {
      session: p.contributor.session,
      headers: ifm(2),
      body: { score: null },
    });
    expect([cleared.status, cleared.body.score, cleared.body.scoredBy]).toEqual([200, null, null]);
    sheet = await call(api.app, "GET", S(ini.id), { session: p.lead.session });
    expect(sheet.body.result).toMatchObject({
      completeness: "incomplete",
      weightedScore: null,
      missingCriteria: ["feasibility"],
    });
    const audit = await auditOf(api.db, changed.body.id);
    expect(audit.map((a) => a.action)).toEqual([
      "initiative_score.create",
      "initiative_score.update",
      "initiative_score.update",
    ]);
  });
});

// ------------------------------------------------------------------------------------------------ weight sets

describe("weight sets (REQ-PB-049)", () => {
  it("95% and 105% -> 422 prioritization.weights_total, nothing written; 0 -> 422 weight_range; bad pattern -> 400", async () => {
    const p = await setupP2World(api, w);
    const before = await counts(p);
    for (const [last, got] of [
      ["10", "95.00"],
      ["20", "105.00"],
    ] as const) {
      const r = await call(api.app, "POST", `${T(p)}/weight-sets`, {
        session: p.lead.session,
        body: {
          rationale: "Synthetic wrong total",
          weights: [
            { criterionCode: "strategic_fit", weightPercent: "25" },
            { criterionCode: "financial_value", weightPercent: "25" },
            { criterionCode: "customer_impact", weightPercent: "20" },
            { criterionCode: "feasibility", weightPercent: "15" },
            { criterionCode: "time_to_value", weightPercent: last },
          ],
        },
      });
      expect(r.status).toBe(422);
      expect(r.body).toMatchObject({
        type: "urn:mth:problem:validation",
        code: "prioritization.weights_total",
        detail: `Weights must total 100% (got ${got}%)`,
      });
      expect(r.body.errors[0].pointer).toBe("/weights");
    }
    const zero = await call(api.app, "POST", `${T(p)}/weight-sets`, {
      session: p.lead.session,
      body: {
        rationale: "Synthetic zero",
        weights: [
          { criterionCode: "strategic_fit", weightPercent: "100" },
          { criterionCode: "feasibility", weightPercent: "0" },
        ],
      },
    });
    expect([zero.status, zero.body.code, zero.body.errors[0].pointer]).toEqual([
      422,
      "prioritization.weight_range",
      "/weights/1/weightPercent",
    ]);
    const pattern = await call(api.app, "POST", `${T(p)}/weight-sets`, {
      session: p.lead.session,
      body: {
        rationale: "Synthetic",
        weights: [
          { criterionCode: "strategic_fit", weightPercent: 50 },
          { criterionCode: "feasibility", weightPercent: "50" },
        ],
      },
    });
    expect(pattern.status).toBe(400);
    expect(await counts(p)).toEqual(before);
  });

  it("v2 with risk_compliance 10 and strategic fit 15 is accepted as version 2; the proposer cannot approve; the Sponsor does; AUD 403; If-Match 428/409; audited", async () => {
    const p = await setupP2World(api, w);
    // The lead also holds SP here, so the 403 is separation of duties, not a missing permission.
    await grant(api.db, w.grantor.id, p.lead.id, "SP", { type: "transformation", id: p.transformationId }, w.orgA.id);
    expect((await proposeV2(p, p.auditor.session)).status).toBe(403);
    const v2 = await proposeV2(p);
    expect(v2.status, JSON.stringify(v2.body)).toBe(201);
    expect(v2.body).toMatchObject({ versionNo: 2, status: "proposed", version: 1, approvedBy: null });
    expect(v2.headers["location"]).toBe(`${T(p)}/weight-sets/2`);
    expect(v2.body.weights).toEqual(V2_WEIGHTS.map((x) => ({ ...x, weightPercent: `${x.weightPercent}.00` })));
    const self = await approve(p, 2, 1, p.lead.session);
    expect([self.status, self.body.code]).toEqual([403, "approval.approver_is_proposer"]);
    expect((await approve(p, 2, 1, p.auditor.session)).status).toBe(403);
    expect(
      (await call(api.app, "POST", `${T(p)}/weight-sets/2/approve`, { session: p.sponsor.session, body: {} })).status,
    ).toBe(428);
    expect((await approve(p, 2, 9)).status).toBe(409);
    const ok = await approve(p, 2, 1);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({
      status: "active",
      approvalBasis: "approved",
      approvedBy: p.sponsor.id,
      version: 2,
    });
    const list = await call(api.app, "GET", `${T(p)}/weight-sets`, { session: p.auditor.session });
    expect(list.body.items.map((s: { versionNo: number; status: string }) => [s.versionNo, s.status])).toEqual([
      [2, "active"],
      [1, "superseded"],
    ]);
    expect((await approve(p, 2, 2)).status).toBe(422); // no longer proposed
    const audit = await auditOf(api.db, v2.body.id);
    expect(audit.map((a) => a.action)).toEqual(["scoring_weight_set.create", "scoring_weight_set.approve"]);
    expect(audit[1]!.actor_user_id).toBe(p.sponsor.id);
  });

  it("the v2 set is used for rescoring; v1 results keep v1; a set is immutable (DB guard)", async () => {
    const p = await setupP2World(api, w);
    const ini = await insertInitiative(api, p.transformationId, p.lead.id);
    await scoreAll(p.lead.session, ini.id, {
      strategic_fit: 5,
      financial_value: 4,
      customer_impact: 3,
      feasibility: 2,
      time_to_value: 1,
    });
    const v1Before = await api.db
      .selectFrom("initiative_score_result")
      .selectAll()
      .where("initiative_id", "=", ini.id)
      .orderBy("id")
      .execute();
    const v2 = await proposeV2(p);
    expect((await approve(p, 2, v2.body.version)).status).toBe(200);
    // Activation appended a v2 result (risk_compliance not yet scored -> incomplete, never a number).
    let sheet = await call(api.app, "GET", S(ini.id), { session: p.lead.session });
    expect(sheet.body.result).toMatchObject({
      weightSetVersionNo: 2,
      completeness: "incomplete",
      weightedScore: null,
      missingCriteria: ["risk_compliance"],
    });
    expect((await score(p.lead.session, ini.id, "risk_compliance", 5)).status).toBe(201);
    sheet = await call(api.app, "GET", S(ini.id), { session: p.lead.session });
    // (75 + 100 + 60 + 30 + 15 + 50) / 100 = 3.3000 under v2
    expect(sheet.body.result).toMatchObject({
      weightSetVersionNo: 2,
      completeness: "complete",
      weightedScore: "3.3000",
    });
    const all = await api.db
      .selectFrom("initiative_score_result")
      .selectAll()
      .where("initiative_id", "=", ini.id)
      .orderBy("id")
      .execute();
    // v1 rows are unchanged and still reference v1; the v2 rows are new.
    expect(all.slice(0, v1Before.length)).toEqual(v1Before);
    expect(v1Before.every((r) => r.weight_set_version_no === 1)).toBe(true);
    expect(all.slice(v1Before.length).map((r) => [r.weight_set_version_no, r.cause, r.weighted_score])).toEqual([
      [2, "weight_set_activated", null],
      [2, "score_change", "3.3000"],
    ]);
    // Immutable: weights cannot be updated, and a set's content cannot change.
    // The app role cannot even UPDATE weights (no grant); the owner role hits the append-only trigger.
    await expect(
      api.db
        .updateTable("scoring_weight")
        .set({ weight_percent: "30" })
        .where("weight_set_id", "=", v2.body.id)
        .execute(),
    ).rejects.toThrow(/permission denied/);
    await expect(
      api.owner.query("update scoring_weight set weight_percent = 30 where weight_set_id = $1", [v2.body.id]),
    ).rejects.toThrow(/append-only/);
    await expect(
      api.db
        .updateTable("scoring_weight_set")
        .set({ rationale: "changed", version: 3 })
        .where("id", "=", v2.body.id)
        .execute(),
    ).rejects.toThrow(/immutable/);
  });

  it("withdraw: proposed -> withdrawn with a reason (If-Match 428/409, AUD 403, audited); an active set cannot be withdrawn", async () => {
    const p = await setupP2World(api, w);
    const v2 = await proposeV2(p);
    const url = `${T(p)}/weight-sets/2/withdraw`;
    const reason = { reason: "Synthetic: wrong rationale." };
    expect((await call(api.app, "POST", url, { session: p.lead.session, body: reason })).status).toBe(428);
    expect((await call(api.app, "POST", url, { session: p.lead.session, headers: ifm(3), body: reason })).status).toBe(
      409,
    );
    expect(
      (await call(api.app, "POST", url, { session: p.auditor.session, headers: ifm(1), body: reason })).status,
    ).toBe(403);
    const r = await call(api.app, "POST", url, { session: p.lead.session, headers: ifm(1), body: reason });
    expect([r.status, r.body.status]).toEqual([200, "withdrawn"]);
    expect((await auditOf(api.db, v2.body.id)).map((a) => a.action)).toEqual([
      "scoring_weight_set.create",
      "scoring_weight_set.withdraw",
    ]);
    const v1 = await call(api.app, "POST", `${T(p)}/weight-sets/1/withdraw`, {
      session: p.lead.session,
      headers: ifm(1),
      body: reason,
    });
    expect([v1.status, v1.body.code]).toEqual([422, "prioritization.weight_set_not_proposed"]);
  });
});

// ------------------------------------------------------------------------------------------------ rankings

describe("rankings and history (REQ-S09-005, REQ-S09-003)", () => {
  it("snapshot: deterministic tie-break, incomplete unranked, submitted -> ranked with audit; v2 activation -> history shows 'weight version 2' as the cause of the rank change", async () => {
    const p = await setupP2World(api, w);
    const a = await insertInitiative(api, p.transformationId, p.lead.id, { code: "INI-01" });
    const b = await insertInitiative(api, p.transformationId, p.lead.id, { code: "INI-02" });
    const tie = await insertInitiative(api, p.transformationId, p.lead.id, { code: "INI-00" });
    const inc = await insertInitiative(api, p.transformationId, p.lead.id, { code: "INI-03" });
    const gone = await insertInitiative(api, p.transformationId, p.lead.id, { code: "INI-04" });
    // v1: A = 3.50, B = 3.25, tie = 3.25 (same as B; INI-00 < INI-02), gone = 1.00. v2: A = 3.10, B = 3.65.
    await scoreAll(p.lead.session, a.id, {
      strategic_fit: 5,
      financial_value: 3,
      customer_impact: 3,
      feasibility: 3,
      time_to_value: 3,
      risk_compliance: 1,
    });
    await scoreAll(p.lead.session, b.id, {
      strategic_fit: 1,
      financial_value: 4,
      customer_impact: 4,
      feasibility: 4,
      time_to_value: 4,
      risk_compliance: 5,
    });
    await scoreAll(p.lead.session, tie.id, {
      strategic_fit: 1,
      financial_value: 4,
      customer_impact: 4,
      feasibility: 4,
      time_to_value: 4,
    });
    await scoreAll(p.lead.session, gone.id, {
      strategic_fit: 1,
      financial_value: 1,
      customer_impact: 1,
      feasibility: 1,
      time_to_value: 1,
    });
    await scoreAll(p.lead.session, inc.id, { strategic_fit: 3 });

    expect((await call(api.app, "POST", `${T(p)}/rankings`, { session: p.auditor.session, body: {} })).status).toBe(
      403,
    );
    const s1 = await call(api.app, "POST", `${T(p)}/rankings`, {
      session: p.lead.session,
      body: { note: "Synthetic proposal 1" },
    });
    expect(s1.status, JSON.stringify(s1.body)).toBe(201);
    expect([s1.headers["etag"], s1.headers["location"]]).toEqual(['"1"', `${T(p)}/rankings/1`]);
    const ranked1 = s1.body.entries.map((e: { initiativeId: string; rank: number | null; causes: string[] }) => [
      e.initiativeId,
      e.rank,
      e.causes,
    ]);
    expect(ranked1).toEqual([
      [a.id, 1, ["new"]],
      [tie.id, 2, ["new"]],
      [b.id, 3, ["new"]],
      [gone.id, 4, ["new"]],
      [inc.id, null, ["new"]],
    ]);
    const statuses = await api.db
      .selectFrom("initiative")
      .select(["id", "status"])
      .where("transformation_id", "=", p.transformationId)
      .execute();
    const st = new Map(statuses.map((s) => [s.id, s.status]));
    expect([st.get(a.id), st.get(b.id), st.get(tie.id), st.get(gone.id), st.get(inc.id)]).toEqual([
      "ranked",
      "ranked",
      "ranked",
      "ranked",
      "submitted",
    ]);
    expect((await auditOf(api.db, a.id)).map((x) => x.action)).toEqual([
      "initiative.fixture_create",
      "initiative.rank",
    ]);

    // v2 approved by the Sponsor, then B outranks A because of the weights; `gone` leaves the portfolio.
    const v2 = await proposeV2(p);
    expect((await approve(p, 2, v2.body.version)).status).toBe(200);
    await cancelInitiative(api, gone.id, p.lead.id);
    const s2 = await call(api.app, "POST", `${T(p)}/rankings`, { session: p.office.session, body: {} });
    expect(s2.status, JSON.stringify(s2.body)).toBe(201);
    expect(s2.body.snapshot).toMatchObject({ snapshotNo: 2, weightSetVersionNo: 2, status: "current" });
    const e2 = new Map(s2.body.entries.map((e: { initiativeId: string }) => [e.initiativeId, e]));
    expect(e2.get(b.id)).toMatchObject({
      rank: 1,
      previousRank: 3,
      causes: ["weight"],
      causeLabels: ["weight version 2"],
    });
    expect(e2.get(a.id)).toMatchObject({
      rank: 2,
      previousRank: 1,
      causes: ["weight"],
      causeLabels: ["weight version 2"],
    });
    expect(e2.get(gone.id)).toMatchObject({
      rank: null,
      completeness: "removed",
      previousRank: 4,
      causes: ["removed"],
    });
    expect(e2.get(tie.id)).toMatchObject({ rank: null, completeness: "incomplete" }); // no risk_compliance score under v2

    const history = await call(api.app, "GET", `${T(p)}/ranking-history?initiativeId=${b.id}`, {
      session: p.auditor.session,
    });
    expect(history.status).toBe(200);
    expect(history.body.items[0]).toMatchObject({ snapshotNo: 2, entry: { rank: 1, previousRank: 3 } });
    expect(history.body.items[0].entry.causeLabels).toContain("weight version 2");
    const snaps = await call(api.app, "GET", `${T(p)}/rankings`, { session: p.auditor.session });
    expect(snaps.body.items.map((s: { snapshotNo: number; status: string }) => [s.snapshotNo, s.status])).toEqual([
      [2, "current"],
      [1, "superseded"],
    ]);
    expect((await call(api.app, "GET", `${T(p)}/rankings/9`, { session: p.auditor.session })).status).toBe(404);
    expect((await auditOf(api.db, s1.body.snapshot.id)).map((x) => x.action)).toEqual([
      "ranking_snapshot.create",
      "ranking_snapshot.supersede",
    ]);
    // Ranking is not selection and not funding (REQ-S09-003): the view shows them as separate columns.
    const view = await call(api.app, "GET", T(p), { session: p.auditor.session });
    const vb = view.body.items.find((i: { initiative: { id: string } }) => i.initiative.id === b.id);
    expect(vb).toMatchObject({ rank: 1, selection: "not_selected", funding: "not_applicable" });
    expect(vb.valueAxis).toBe("4.0000");
  });

  it("score cause lists the criteria; relative cause when another initiative moved", async () => {
    const p = await setupP2World(api, w);
    const a = await insertInitiative(api, p.transformationId, p.lead.id, { code: "INI-01" });
    const b = await insertInitiative(api, p.transformationId, p.lead.id, { code: "INI-02" });
    await scoreAll(p.lead.session, a.id, {
      strategic_fit: 4,
      financial_value: 4,
      customer_impact: 4,
      feasibility: 4,
      time_to_value: 4,
    });
    await scoreAll(p.lead.session, b.id, {
      strategic_fit: 3,
      financial_value: 3,
      customer_impact: 3,
      feasibility: 3,
      time_to_value: 3,
    });
    expect((await call(api.app, "POST", `${T(p)}/rankings`, { session: p.lead.session, body: {} })).status).toBe(201);
    // b: 3.00 -> (125 + 125 + 100 + 45 + 45) / 100 = 4.40 > a (4.00)
    for (const c of ["customer_impact", "strategic_fit", "financial_value"]) {
      const patch = await call(api.app, "PATCH", `${S(b.id)}/${c}`, {
        session: p.lead.session,
        headers: ifm(1),
        body: { score: 5 },
      });
      expect(patch.status).toBe(200);
    }
    const s2 = await call(api.app, "POST", `${T(p)}/rankings`, { session: p.lead.session, body: {} });
    const e2 = new Map(s2.body.entries.map((e: { initiativeId: string }) => [e.initiativeId, e]));
    expect(e2.get(b.id)).toMatchObject({
      rank: 1,
      causes: ["score"],
      causeLabels: ["score change (strategic_fit, financial_value, customer_impact)"],
    });
    expect(e2.get(a.id)).toMatchObject({ rank: 2, causes: ["relative"], causeLabels: ["relative"] });
  });

  it("rankOrder: score desc, code asc, overrides move to their position (pure)", () => {
    expect(
      rankOrder(
        [
          { id: "x", code: "INI-03", weightedScore: "3.3000" },
          { id: "y", code: "INI-01", weightedScore: "3.3000" },
          { id: "z", code: "INI-02", weightedScore: "4.1000" },
        ],
        [],
      ).map((e) => e.initiativeId),
    ).toEqual(["z", "y", "x"]);
    expect(
      rankOrder(
        [
          { id: "x", code: "INI-03", weightedScore: "2.0000" },
          { id: "y", code: "INI-01", weightedScore: "3.0000" },
          { id: "z", code: "INI-02", weightedScore: "4.0000" },
        ],
        [{ id: "o", initiativeId: "x", overrideRank: 1 }],
      ),
    ).toEqual([
      { initiativeId: "x", rank: 1, overrideId: "o" },
      { initiativeId: "z", rank: 2, overrideId: null },
      { initiativeId: "y", rank: 3, overrideId: null },
    ]);
  });
});

// ------------------------------------------------------------------------------------------------ overrides

describe("overrides (REQ-S09-005)", () => {
  it("an override without a reason is rejected (missing/empty -> 400 at /reason; blank/invisible -> 422); the proposer cannot approve; approved applies with 'override: <reason>'; revoke; AUD 403; If-Match", async () => {
    const p = await setupP2World(api, w);
    await grant(api.db, w.grantor.id, p.lead.id, "SP", { type: "transformation", id: p.transformationId }, w.orgA.id);
    const a = await insertInitiative(api, p.transformationId, p.lead.id, { code: "INI-01" });
    const b = await insertInitiative(api, p.transformationId, p.lead.id, { code: "INI-02" });
    await scoreAll(p.lead.session, a.id, {
      strategic_fit: 5,
      financial_value: 5,
      customer_impact: 5,
      feasibility: 5,
      time_to_value: 5,
    });
    await scoreAll(p.lead.session, b.id, {
      strategic_fit: 2,
      financial_value: 2,
      customer_impact: 2,
      feasibility: 2,
      time_to_value: 2,
    });
    const O = `${T(p)}/overrides`;
    const propose = (body: Record<string, unknown>, session: Session = p.lead.session) =>
      call(api.app, "POST", O, { session, body });

    for (const body of [
      { initiativeId: b.id, overrideRank: 1 },
      { initiativeId: b.id, overrideRank: 1, reason: "" },
    ]) {
      const r = await propose(body);
      expect(r.status).toBe(400);
      expect(r.body.errors.map((e: { pointer: string }) => e.pointer)).toContain("/reason");
    }
    for (const reason of ["     ", "​​​⁠"]) {
      const r = await propose({ initiativeId: b.id, overrideRank: 1, reason });
      expect([r.status, r.body.code, r.body.errors[0].pointer]).toEqual([
        422,
        "prioritization.override_reason_required",
        "/reason",
      ]);
    }
    expect(
      (await propose({ initiativeId: b.id, overrideRank: 1, reason: "Synthetic" }, p.auditor.session)).status,
    ).toBe(403);
    const o = await propose({ initiativeId: b.id, overrideRank: 1, reason: "Synthetic: regulator deadline in Q1." });
    expect([o.status, o.body.status, o.body.version]).toEqual([201, "proposed", 1]);
    expect((await propose({ initiativeId: b.id, overrideRank: 2, reason: "Synthetic second" })).status).toBe(409);

    const D = `${O}/${o.body.id}/decision`;
    const decision = { result: "approved", note: "Synthetic demo decision." };
    const self = await call(api.app, "POST", D, { session: p.lead.session, headers: ifm(1), body: decision });
    expect([self.status, self.body.code]).toEqual([403, "approval.approver_is_proposer"]);
    expect(
      (await call(api.app, "POST", D, { session: p.auditor.session, headers: ifm(1), body: decision })).status,
    ).toBe(403);
    expect((await call(api.app, "POST", D, { session: p.sponsor.session, body: decision })).status).toBe(428);
    expect(
      (await call(api.app, "POST", D, { session: p.sponsor.session, headers: ifm(4), body: decision })).status,
    ).toBe(409);
    const ok = await call(api.app, "POST", D, { session: p.sponsor.session, headers: ifm(1), body: decision });
    expect([ok.status, ok.body.status, ok.body.decidedBy]).toEqual([200, "approved", p.sponsor.id]);

    const snap = await call(api.app, "POST", `${T(p)}/rankings`, { session: p.lead.session, body: {} });
    const eb = snap.body.entries.find((e: { initiativeId: string }) => e.initiativeId === b.id);
    expect(eb).toMatchObject({
      rank: 1,
      overrideId: o.body.id,
      causes: ["new", "override"],
      causeLabels: ["new", "override: Synthetic: regulator deadline in Q1."],
    });

    const R = `${O}/${o.body.id}/revoke`;
    const reason = { reason: "Synthetic: deadline moved." };
    expect((await call(api.app, "POST", R, { session: p.auditor.session, headers: ifm(2), body: reason })).status).toBe(
      403,
    );
    expect((await call(api.app, "POST", R, { session: p.sponsor.session, body: reason })).status).toBe(428);
    const rv = await call(api.app, "POST", R, { session: p.sponsor.session, headers: ifm(2), body: reason });
    expect([rv.status, rv.body.status, rv.body.revokeReason]).toEqual([200, "revoked", "Synthetic: deadline moved."]);
    expect((await auditOf(api.db, o.body.id)).map((x) => x.action)).toEqual([
      "ranking_override.create",
      "ranking_override.decide",
      "ranking_override.revoke",
    ]);
    const s2 = await call(api.app, "POST", `${T(p)}/rankings`, { session: p.lead.session, body: {} });
    expect(s2.body.entries.find((e: { initiativeId: string }) => e.initiativeId === b.id)).toMatchObject({
      rank: 2,
      overrideId: null,
      causes: ["relative"],
    });
  });

  it("the DB refuses an approval by the proposer even without the API (ranking_override_approver_not_proposer)", async () => {
    const p = await setupP2World(api, w);
    const b = await insertInitiative(api, p.transformationId, p.lead.id);
    const o = await call(api.app, "POST", `${T(p)}/overrides`, {
      session: p.lead.session,
      body: { initiativeId: b.id, overrideRank: 1, reason: "Synthetic DB guard" },
    });
    await expect(
      api.db
        .updateTable("ranking_override")
        .set({ status: "approved", decided_by: p.lead.id, decided_at: new Date(), version: 2 })
        .where("id", "=", o.body.id)
        .execute(),
    ).rejects.toThrow(/approver_not_proposer/);
  });
});

// ------------------------------------------------------------------------------------------------ commit-time authorization

describe("every BE-D mutation re-authorises inside its transaction (BE18A)", () => {
  /**
   * Sends the request while the caller's session row is locked, so the request stops in the identity hook's
   * touchSession AFTER its grants were loaded (preValidation) and BEFORE the handler runs; the caller's only grant is
   * then revoked (when `revoke`) and the lock released. A handler that authorised on the request-start snapshot would
   * commit; one that re-authorises inside its transaction (openWrite atCommit) answers 403.
   */
  async function revokedAfterIdentity(
    method: "POST" | "PATCH",
    url: string,
    role: string,
    p: P2World,
    body: unknown,
    headers: Record<string, string> = {},
    revoke = true,
  ) {
    const user = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, user.id, role, { type: "transformation", id: p.transformationId }, w.orgA.id);
    const session = await signIn(api.app, user.subject);
    await api.owner.query(`update session set last_seen_at = now() - interval '5 minutes' where user_id = $1`, [
      user.id,
    ]);
    const locker = await api.owner.connect();
    try {
      await locker.query("begin");
      const lockerPid = (await locker.query("select pg_backend_pid() as pid")).rows[0].pid as number;
      await locker.query("select id from session where user_id = $1 for update", [user.id]);
      const pending = call(api.app, method, url, { session, body, headers, contract: false });
      let waited = false;
      for (let i = 0; i < 200 && !waited; i++) {
        const r = await api.owner.query(
          "select count(*)::int as n from pg_locks where not granted and $1 = any (pg_blocking_pids(pid))",
          [lockerPid],
        );
        waited = r.rows[0].n > 0;
        if (!waited) await new Promise((r2) => setTimeout(r2, 25));
      }
      expect(waited, "the request reached touchSession and waits on the session row").toBe(true);
      if (revoke)
        await api.owner.query(
          `update scoped_assignment set revoked_at = now(), revoked_by = $1, revoke_reason = 'synthetic BE-D BE18A' where user_id = $2 and revoked_at is null`,
          [w.grantor.id, user.id],
        );
      await locker.query("commit");
      return await pending;
    } finally {
      locker.release();
    }
  }

  it("weight sets, scores, rankings and overrides: 403 at commit and nothing changes", async () => {
    const p = await setupP2World(api, w);
    const ini = await insertInitiative(api, p.transformationId, p.lead.id);
    expect((await score(p.lead.session, ini.id, "feasibility", 3)).status).toBe(201);
    const v2 = await proposeV2(p);
    const v3 = await proposeV2(p);
    expect([v2.status, v3.status]).toEqual([201, 201]);
    const O = `${T(p)}/overrides`;
    const o = await call(api.app, "POST", O, {
      session: p.lead.session,
      body: { initiativeId: ini.id, overrideRank: 1, reason: "Synthetic BE18A" },
    });
    expect(o.status).toBe(201);
    const ini2 = await insertInitiative(api, p.transformationId, p.lead.id);
    const o2 = await call(api.app, "POST", O, {
      session: p.lead.session,
      body: { initiativeId: ini2.id, overrideRank: 2, reason: "Synthetic BE18A 2" },
    });
    const ok2 = await call(api.app, "POST", `${O}/${o2.body.id}/decision`, {
      session: p.sponsor.session,
      headers: ifm(1),
      body: { result: "approved" },
    });
    expect(ok2.status).toBe(200);
    const ini3 = await insertInitiative(api, p.transformationId, p.lead.id);
    const cases: [string, "POST" | "PATCH", string, string, unknown, Record<string, string>?][] = [
      ["createWeightSet", "POST", `${T(p)}/weight-sets`, "TO", { rationale: "Synthetic", weights: V2_WEIGHTS }],
      ["approveWeightSet", "POST", `${T(p)}/weight-sets/2/approve`, "SP", {}, ifm(1)],
      ["withdrawWeightSet", "POST", `${T(p)}/weight-sets/3/withdraw`, "TO", { reason: "Synthetic" }, ifm(1)],
      ["createInitiativeScore", "POST", S(ini.id), "WL", { criterionCode: "strategic_fit", score: 4 }],
      ["updateInitiativeScore", "PATCH", `${S(ini.id)}/feasibility`, "WL", { score: 5 }, ifm(1)],
      ["createRankingSnapshot", "POST", `${T(p)}/rankings`, "TO", {}],
      ["createRankingOverride", "POST", O, "TO", { initiativeId: ini3.id, overrideRank: 1, reason: "Synthetic" }],
      ["decideRankingOverride", "POST", `${O}/${o.body.id}/decision`, "SP", { result: "approved" }, ifm(1)],
      ["revokeRankingOverride", "POST", `${O}/${o2.body.id}/revoke`, "SP", { reason: "Synthetic" }, ifm(2)],
    ];
    const state = async () => ({
      sets: await api.db
        .selectFrom("scoring_weight_set")
        .select(["version_no", "status", "version"])
        .where("transformation_id", "=", p.transformationId)
        .orderBy("version_no")
        .execute(),
      scores: await api.db
        .selectFrom("initiative_score")
        .select(["criterion_code", "score", "version"])
        .where("initiative_id", "=", ini.id)
        .execute(),
      snapshots: (
        await api.db
          .selectFrom("ranking_snapshot")
          .select("id")
          .where("transformation_id", "=", p.transformationId)
          .execute()
      ).length,
      overrides: await api.db
        .selectFrom("ranking_override")
        .select(["id", "status", "version"])
        .where("transformation_id", "=", p.transformationId)
        .orderBy("id")
        .execute(),
    });
    const before = await state();
    for (const [op, method, url, role, body, headers] of cases) {
      const res = await revokedAfterIdentity(method, url, role, p, body, headers);
      expect(res.status, `${op}: ${JSON.stringify(res.body)}`).toBe(403);
    }
    expect(await state()).toEqual(before);
  }, 60_000);

  it("control: the same pause WITHOUT a revocation commits (so the 403 above comes from the commit-time check)", async () => {
    const p = await setupP2World(api, w);
    const res = await revokedAfterIdentity(
      "POST",
      `${T(p)}/weight-sets`,
      "TO",
      p,
      { rationale: "Synthetic control", weights: V2_WEIGHTS },
      {},
      false,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  }, 30_000);
});

// ------------------------------------------------------------------------------------------------ comparison view

describe("comparison view (REQ-S09-004)", () => {
  it("axes, filters (status, completeness, funding, flag) and injected sequencing/capacity flags", async () => {
    const p = await setupP2World(api, w);
    const a = await insertInitiative(api, p.transformationId, p.lead.id, { code: "INI-01" });
    const b = await insertInitiative(api, p.transformationId, p.lead.id, { code: "INI-02" });
    await insertInitiative(api, p.transformationId, p.lead.id, { code: "INI-03", status: "draft" });
    await scoreAll(p.lead.session, a.id, {
      strategic_fit: 5,
      financial_value: 5,
      customer_impact: 3,
      feasibility: 2,
      time_to_value: 4,
    });
    const all = await call(api.app, "GET", T(p), { session: p.auditor.session });
    expect(all.status).toBe(200);
    expect(all.body.items.map((i: { initiative: { code: string } }) => i.initiative.code)).toEqual([
      "INI-01",
      "INI-02",
    ]);
    const ia = all.body.items[0];
    // value = (5×25 + 3×20)/45 = 4.1111; feasibility = (2×15 + 4×15)/30 = 3.0000
    expect([ia.valueAxis, ia.feasibilityAxis, ia.rank, ia.flags]).toEqual(["4.1111", "3.0000", null, []]);
    expect(all.body.items[1]).toMatchObject({
      valueAxis: null,
      feasibilityAxis: null,
      result: { completeness: "incomplete", weightedScore: null },
    });
    const inc = await call(api.app, "GET", `${T(p)}?completeness=incomplete`, { session: p.auditor.session });
    expect(inc.body.items.map((i: { initiative: { id: string } }) => i.initiative.id)).toEqual([b.id]);
    const st = await call(api.app, "GET", `${T(p)}?status=ranked`, { session: p.auditor.session });
    expect(st.body.items).toEqual([]);
    expect((await call(api.app, "GET", `${T(p)}?completeness=zero`, { session: p.auditor.session })).status).toBe(400);
    const view = await buildPrioritizationView(
      api.db,
      p.transformationId,
      { flag: "capacity.over_allocated", funding: "not_applicable" },
      {
        ...DEFAULT_FLAG_SOURCES,
        capacityFlags: async (_db, _t, ids) =>
          new Map([
            [ids.find((x) => x === b.id)!, [{ code: "capacity.over_allocated", message: "Synthetic over-allocation" }]],
          ]),
      },
    );
    expect(view.items.map((i) => [i.initiative.id, i.flags.map((f) => f.code)])).toEqual([
      [b.id, ["capacity.over_allocated"]],
    ]);
  });

  it(`more than ${PORTFOLIO_VIEW_MAX} initiatives -> 422 prioritization.portfolio_too_large`, async () => {
    const p = await setupP2World(api, w);
    for (let i = 0; i <= PORTFOLIO_VIEW_MAX; i++)
      await insertInitiative(api, p.transformationId, p.lead.id, { code: `INI-${String(i).padStart(4, "0")}` });
    await expect(buildPrioritizationView(api.db, p.transformationId, {})).rejects.toMatchObject({
      status: 422,
      code: "prioritization.portfolio_too_large",
    });
  }, 120_000);
});

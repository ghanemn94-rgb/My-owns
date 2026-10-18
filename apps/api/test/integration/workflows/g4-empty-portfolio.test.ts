// F-DG5-122 (REQ-PB-019; D-172; T-DG5-BE-X1): G4 readiness over an EMPTY approved portfolio fails closed, live and
// frozen, against a real PostgreSQL.
//
// The domain reviewer's reproduction (docs/delivery/reviews/DG5/round-2/domain-reviewer.json): a transformation at
// `mobilize` whose approved portfolio (initiatives selected, funded or launched) is empty, with a validated
// transformation-level business case and an accepted exception on 'Initiative cards' only. Before the fix the live
// G4 readiness read Roadmap, Owners, Funding and Capacity (and Business cases, Finance validation) as Complete,
// vacuously "for every initiative in the approved portfolio", and a submission froze them as complete. Now each of
// them is incomplete with the missing item `g4.no_approved_initiative` ('No initiative in the approved portfolio'),
// in the live view and in the frozen snapshot and criterion rows, and the exception on Initiative cards covers that
// one criterion only: the submission needs one accepted exception per incomplete criterion (the exception rules are
// unchanged; ADR-0035 §4).
//
// All data is SYNTHETIC. Every decision here (the Finance validation, the exceptions) is a demo in-product decision by
// a test person that approves nothing real, and nothing touches the engineering delivery gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import {
  acceptException,
  coverGate,
  plusDays,
  requestException,
  seedGateWorld,
  stageGates,
  submitThroughApi,
  todayOf,
  type GateWorld,
} from "../contract/p4-exercises-be-k.ts";

let api: TestApi;
let w: World;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call(api.app, m, u, o);
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 60_000);
afterAll(() => api.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const ok = (res: { status: number; body: Body }, status: number, what: string): Body => {
  expect(res.status, `${what}: ${JSON.stringify(res.body).slice(0, 800)}`).toBe(status);
  return res.body;
};

const NO_INITIATIVE = {
  code: "g4.no_approved_initiative",
  message: "No initiative in the approved portfolio",
  pointer: "/initiatives",
};
/** The criteria whose subject set is the approved portfolio (D-172), besides Initiative cards. */
const OVER_PORTFOLIO = [
  "g4.business_cases",
  "g4.finance_validation",
  "g4.prioritization",
  "g4.roadmap",
  "g4.owners",
  "g4.funding",
  "g4.capacity",
] as const;

/** A gate world at `mobilize` (G1-G3 staged approved; its one initiative stays a draft: the portfolio is empty). */
async function emptyPortfolioWorld(): Promise<GateWorld> {
  const g = await seedGateWorld(api, w);
  await stageGates(api, g, ["G1", "G2", "G3"], "mobilize");
  const inScope = await api.db
    .selectFrom("initiative")
    .select("id")
    .where("transformation_id", "=", g.b.transformationId)
    .where("status", "in", ["selected", "funded", "launched"])
    .execute();
  expect(inScope).toEqual([]);
  return g;
}

/** TL writes a complete transformation-level case; FIN (never the author) validates its baseline. Synthetic. */
async function validatedTransformationCase(g: GateWorld) {
  const { b } = g;
  const top = ok(
    await send("POST", "/api/v1/business-cases", {
      session: b.s.tl,
      body: {
        transformationId: b.transformationId,
        level: "transformation",
        title: "Synthetic transformation case",
        sections: {
          strategicRationale: "Synthetic rationale.",
          baselineSummary: "Synthetic baseline: roaming revenue 1.2m SAR per year.",
          valuePoolsSummary: "Synthetic value pools.",
          interventionsSummary: "Synthetic interventions.",
          investmentSummary: "Synthetic investment.",
          benefitsSummary: "Synthetic benefits.",
          benefitRamp: "Synthetic ramp: 25% / 75% / 100%.",
          recurrenceSummary: "Synthetic: recurring.",
          implementationHorizon: "Synthetic: 12 months.",
          keyAssumptions: "Synthetic assumptions.",
          downsideCase: "Synthetic downside.",
          upsideCase: "Synthetic upside.",
          benefitOwnerUserId: b.users.bo.id,
          initiativeOwnerUserId: g.sp.id,
          financeValidatorUserId: b.users.fin.id,
          decisionAskTypes: ["funding"],
        },
      },
    }),
    201,
    "transformation case",
  );
  // The investment and benefits sections need at least one active line of each kind (ADR-0024 §1); the benefit line
  // carries a T09 formula, whose current version FIN validates below (Finance validation counts it).
  const formula = ok(
    await send("POST", "/api/v1/benefit-formulas", {
      session: b.s.tl,
      body: {
        transformationId: b.transformationId,
        benefitName: "Synthetic revenue uplift",
        fromExample: "revenue_uplift",
      },
    }),
    201,
    "formula",
  );
  for (const line of [
    { lineKind: "investment", class: "capex", valueBasis: "cash", title: "Synthetic platform", amount: "40000" },
    {
      lineKind: "benefit",
      class: "revenue",
      valueBasis: "revenue_uplift",
      title: "Synthetic uplift",
      amount: "100000",
      benefitFormulaId: formula.id,
    },
  ])
    ok(
      await send("POST", `/api/v1/business-cases/${top.id}/lines`, {
        session: b.s.tl,
        body: { ...line, currency: "SAR" },
      }),
      201,
      `${line.lineKind} line`,
    );
  const current = ok(await send("GET", `/api/v1/business-cases/${top.id}`, { session: b.s.tl }), 200, "case");
  expect(current.missingSections).toEqual([]);
  ok(
    await send("POST", `/api/v1/business-cases/${top.id}/baseline-validation`, {
      session: b.s.fin,
      headers: ifm(current.version),
      body: { result: "validated", note: "Synthetic demo validation; approves nothing real." },
    }),
    200,
    "baseline validation",
  );
  ok(
    await send("POST", `/api/v1/benefit-formulas/${formula.id}/versions/1/validation`, {
      session: b.s.fin,
      headers: ifm(1),
      body: { result: "validated", note: "Synthetic demo validation; approves nothing real." },
    }),
    200,
    "formula validation",
  );
}

const g4View = async (g: GateWorld) => ok(await send("GET", `${g.gates}/G4`, { session: g.b.s.tl }), 200, "G4 view");
const criterion = (view: Body, key: string) => view.criteria.find((c: Body) => c.key === key);

describe("F-DG5-122: G4 over an empty approved portfolio fails closed (D-172)", () => {
  it("with an accepted exception on Initiative cards only, the live G4 reads every portfolio criterion incomplete, naming the cause", async () => {
    const g = await emptyPortfolioWorld();
    await validatedTransformationCase(g);
    const today = await todayOf(api, g);
    await acceptException(send, g, await requestException(send, g, "G4", "g4.initiative_cards", plusDays(today, 30)));
    const view = await g4View(g);
    // The exception covers Initiative cards only; the criterion itself stays incomplete (g4.portfolio_empty).
    expect(criterion(view, "g4.initiative_cards").missing.map((m: Body) => m.code)).toEqual(["g4.portfolio_empty"]);
    // The transformation-level case and its Finance validation hold, so the only missing item of Business cases and
    // Finance validation is the empty portfolio: the criterion is complete only if both parts hold.
    for (const key of ["g4.business_cases", "g4.finance_validation"])
      expect([key, criterion(view, key).missing]).toEqual([key, [NO_INITIATIVE]]);
    for (const key of ["g4.roadmap", "g4.owners", "g4.funding", "g4.capacity"])
      expect([key, criterion(view, key).missing]).toEqual([key, [NO_INITIATIVE]]);
    expect(criterion(view, "g4.prioritization").missing).toContainEqual(NO_INITIATIVE);
    // The reviewer's final assertion: none of them reads Complete, and the gate cannot be submitted on one exception.
    expect(OVER_PORTFOLIO.map((k) => [k, criterion(view, k).completeness])).toEqual(
      OVER_PORTFOLIO.map((k) => [k, "incomplete"]),
    );
    expect(view.canSubmit).toBe(false);
    const refused = await submitThroughApi(api, send, g, "G4");
    expect([refused.status, (refused.body as Body).code]).toEqual([422, "gate_criteria_incomplete"]);
    expect(((refused.body as Body).errors as Body[]).map((e) => e.pointer)).toEqual(
      OVER_PORTFOLIO.map((k) => `/criteria/${k}`),
    );
  });

  it("a submission on an empty portfolio needs one accepted exception per incomplete criterion and freezes them incomplete", async () => {
    const g = await emptyPortfolioWorld();
    await validatedTransformationCase(g);
    const today = await todayOf(api, g);
    const covered = await coverGate(send, g, "G4", plusDays(today, 30));
    expect(covered.map((c) => c.key).sort()).toEqual(["g4.initiative_cards", ...OVER_PORTFOLIO].sort());
    const res = await submitThroughApi(api, send, g, "G4");
    expect(res.status, JSON.stringify(res.body).slice(0, 800)).toBe(201);
    const snapshot = (res.body as Body).snapshot;
    // The G4 part of the snapshot records the empty portfolio (ADR-0021 §7).
    expect([snapshot.g4.initiatives, snapshot.g4.fundingDecisionIds, snapshot.g4.committedDemandIds]).toEqual([
      [],
      [],
      [],
    ]);
    // The frozen criteria read as the live ones: incomplete, each with its own exception.
    for (const key of OVER_PORTFOLIO) {
      const entry = snapshot.criteria.find((x: Body) => x.key === key);
      expect([key, entry.completeness, entry.exception?.id]).toEqual([
        key,
        "incomplete",
        covered.find((c) => c.key === key)!.id,
      ]);
      expect([key, entry.missing]).toEqual([key, expect.arrayContaining([NO_INITIATIVE])]);
    }
    const rows = await api.db
      .selectFrom("gate_submission_criterion")
      .select(["criterion_key", "completeness", "gate_exception_id"])
      .where("gate_submission_id", "=", (res.body as Body).id)
      .execute();
    for (const key of OVER_PORTFOLIO) {
      const row = rows.find((r) => r.criterion_key === key)!;
      expect([key, row.completeness, row.gate_exception_id]).toEqual([
        key,
        "incomplete",
        covered.find((c) => c.key === key)!.id,
      ]);
    }
    // The submission's criterion table (the review page) reads the same.
    const table = ok(
      await send("GET", `${g.gates}/G4/submissions/${(res.body as Body).submissionNo}/criteria`, {
        session: g.b.s.auditor,
      }),
      200,
      "criteria table",
    );
    for (const key of OVER_PORTFOLIO)
      expect([key, table.items.find((r: Body) => r.criterionKey === key).completeness]).toEqual([key, "incomplete"]);
  });
});

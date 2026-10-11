// F-DG4-100, slice B part (T-DG4-KBE-R5; D-117; ADR-0004 §3 coverage rule; REQ-S10-001, REQ-S10-003): every slice B
// mutation's permission refusal writes EXACTLY ONE `authorization.denied` audit event naming the permission, in a
// separate transaction after the mutation's own rolled back (access/denials.ts). Swept over all 26 slice B mutations of
// the contract (ADR-0029, ADR-0030), each against EXISTING records of one synthetic transformation, as:
//  - AUD (the org-wide read-only auditor): 403 on every one;
//  - the ADM-only user (ADM_ACCESS + ADM_TECH, no business role): 403 on every one;
//  - a Business Owner on the six Finance decisions (finance.validate: the value decision, its amendment and reversal,
//    the baseline decision, the overlap resolution and the valuation-method decision).
// Each request writes nothing else: its only audit row is the denial, on the transformation, by the caller. The
// separation-of-duties refusals of the Finance decisions (the submitter, the benefit owner) are denials too.
// completeWorkItem is backend-workflow-engineer's (T-DG4-BE-R5). All data is SYNTHETIC; nothing here grants a real
// business or Finance approval, and nothing touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { operations } from "../../support/contract.ts";
import {
  auditOfRequest,
  call,
  grant,
  seedWorld,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { P4_OPERATION_IDS } from "../../support/p4-operations.ts";
import {
  benefitAt,
  extraUser,
  financialBody,
  insertInitiative,
  seedBenefitWorld,
  type BenefitWorld,
} from "./fixtures.ts";
import { ALL_ACCEPTED, approve, measuredBenefit, submittedValue, type Body } from "./value-fixtures.ts";

/** The 26 slice B mutations (p4-operations.ts, T-DG4-ARCH-03 block) and the permission each one requires. */
const SLICE_B_MUTATIONS: Readonly<Record<string, string>> = {
  createBenefit: "benefit.edit",
  updateBenefit: "benefit.edit",
  archiveBenefit: "benefit.edit",
  advanceBenefitLifecycle: "benefit.advance",
  createBenefitEnabler: "benefit.edit",
  removeBenefitEnabler: "benefit.edit",
  replaceBenefitAllocations: "benefit.allocate",
  createBenefitGroup: "benefit_group.manage",
  updateBenefitGroup: "benefit_group.manage",
  createBenefitOverlap: "benefit.edit",
  resolveBenefitOverlap: "finance.validate",
  createBenefitScenario: "benefit_scenario.edit",
  updateBenefitScenario: "benefit_scenario.edit",
  createBenefitScenarioValue: "benefit_scenario.edit",
  updateBenefitScenarioValue: "benefit_scenario.edit",
  createBenefitValuationMethod: "benefit.edit",
  decideBenefitValuationMethod: "finance.validate",
  decideBenefitBaseline: "finance.validate",
  createBenefitPlanValue: "benefit.edit",
  updateBenefitPlanValue: "benefit.edit",
  createBenefitMeasurement: "benefit.measure",
  updateBenefitMeasurement: "benefit.measure",
  submitBenefitMeasurement: "benefit.measure",
  decideFinanceValidation: "finance.validate",
  amendFinanceValidation: "finance.validate",
  reverseFinanceValidation: "finance.validate",
};
const FINANCE_DECISIONS = Object.keys(SLICE_B_MUTATIONS).filter((id) => SLICE_B_MUTATIONS[id] === "finance.validate");

/** A plausible body per operation: the refusal does not depend on it (403 whatever the body; ADR-0029 §9). */
const BODIES: Readonly<Record<string, (r: Records) => unknown>> = {
  createBenefit: (r) => financialBody(r.b),
  updateBenefit: () => ({ title: "Synthetic rename" }),
  archiveBenefit: () => ({ reason: "Synthetic archive" }),
  advanceBenefitLifecycle: () => ({ toStep: "measure" }),
  createBenefitEnabler: (r) => ({ initiativeId: r.initiativeId }),
  removeBenefitEnabler: () => ({ reason: "Synthetic removal" }),
  replaceBenefitAllocations: (r) => ({ allocations: [{ initiativeId: r.initiativeId, share: "1" }] }),
  createBenefitGroup: () => ({ title: "Synthetic group" }),
  updateBenefitGroup: () => ({ title: "Synthetic group renamed" }),
  createBenefitOverlap: (r) => ({ benefitAId: r.benefitId, benefitBId: r.otherBenefitId, note: "Synthetic overlap" }),
  resolveBenefitOverlap: () => ({ resolution: "no_overlap", note: "Synthetic resolution" }),
  createBenefitScenario: () => ({ kind: "upside", title: "Synthetic upside" }),
  updateBenefitScenario: () => ({ title: "Synthetic scenario renamed" }),
  createBenefitScenarioValue: (r) => ({
    benefitId: r.benefitId,
    periodStart: "2031-01-01",
    periodEnd: "2031-12-31",
    amount: "1",
  }),
  updateBenefitScenarioValue: () => ({ amount: "2" }),
  createBenefitValuationMethod: (r) => ({
    name: "Synthetic NPS point value",
    method: "Each NPS point is valued at a synthetic retention value per point.",
    appliesToType: "cx",
    kpiDefinitionId: r.b.kpiDefinitionId,
    unitValue: "125000",
    currency: "SAR",
  }),
  decideBenefitValuationMethod: () => ({ decision: "approved" }),
  decideBenefitBaseline: () => ({ decision: "validated" }),
  createBenefitPlanValue: () => ({
    valueKind: "planned",
    periodStart: "2031-01-01",
    periodEnd: "2031-12-31",
    amount: "1",
  }),
  updateBenefitPlanValue: () => ({ amount: "2" }),
  createBenefitMeasurement: () => ({ periodStart: "2031-01-01", periodEnd: "2031-01-31", amount: "1" }),
  updateBenefitMeasurement: () => ({ amount: "2" }),
  submitBenefitMeasurement: () => ({}),
  decideFinanceValidation: () => ({ decision: "approved", items: ALL_ACCEPTED, approvedAmount: "100" }),
  amendFinanceValidation: () => ({ correctedAmount: "90", reason: "Synthetic amendment" }),
  reverseFinanceValidation: () => ({ reason: "Synthetic reversal" }),
};

interface Records {
  readonly b: BenefitWorld;
  readonly benefitId: string;
  readonly otherBenefitId: string;
  readonly initiativeId: string;
  readonly params: ReadonlyMap<string, string>;
}

let api: TestApi;
let w: World;
let r: Records;

const created = async (url: string, session: Session, body: unknown): Promise<Body> => {
  const res = await call<Body>(api.app, "POST", url, { session, body });
  expect(res.status, `${url}: ${JSON.stringify(res.body)}`).toBe(201);
  return res.body;
};

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  const b = await seedBenefitWorld(api, w);
  const ben = await measuredBenefit(api, b);
  const approved = await submittedValue(api, b, ben.id, "100", { periodStart: "2030-01-01", periodEnd: "2030-01-31" });
  await approve(api, b, approved, "100");
  const queued = await submittedValue(api, b, ben.id, "100", { periodStart: "2030-02-01", periodEnd: "2030-02-28" });
  const initiativeId = await insertInitiative(api.db, b);
  const enabler = await created(`${b.base}/benefits/${ben.id}/enablers`, b.s.bo, { initiativeId });
  const planValue = await created(`${b.base}/benefits/${ben.id}/plan-values`, b.s.bo, {
    valueKind: "planned",
    periodStart: "2030-01-01",
    periodEnd: "2030-12-31",
    amount: "1000",
  });
  const group = await created(`${b.base}/benefit-groups`, b.s.tl, { title: "Synthetic group" });
  const scenario = await created(`${b.base}/benefit-scenarios`, b.s.tl, { kind: "base", title: "Synthetic base" });
  const scenarioValue = await created(`${b.base}/benefit-scenarios/${scenario.id}/values`, b.s.tl, {
    benefitId: ben.id,
    periodStart: "2030-01-01",
    periodEnd: "2030-12-31",
    amount: "500",
  });
  const method = await created(`${b.base}/benefit-valuation-methods`, b.s.bo, {
    name: "Synthetic NPS point value",
    method: "Each NPS point is valued at a synthetic retention value per point.",
    appliesToType: "cx",
    kpiDefinitionId: b.kpiDefinitionId,
    unitValue: "125000",
    currency: "SAR",
  });
  // Two benefits with the same driver and window: the rule raises an open overlap warning (KBE-D2).
  const keys = { driverKey: "synthetic.sweep.driver", realizationStart: "2030-01-01", realizationEnd: "2030-12-31" };
  await benefitAt(api, b, "identify", financialBody(b, keys));
  const two = await benefitAt(api, b, "identify", financialBody(b, { ...keys, title: "Synthetic duplicate" }));
  const overlap = await api.db
    .selectFrom("benefit_overlap")
    .select("id")
    .where("transformation_id", "=", b.transformationId)
    .where("status", "=", "open")
    .executeTakeFirstOrThrow();
  r = {
    b,
    benefitId: ben.id,
    otherBenefitId: two.id,
    initiativeId,
    params: new Map([
      ["transformationId", b.transformationId],
      ["benefitId", ben.id],
      ["benefitEnablerId", enabler.id],
      ["benefitPlanValueId", planValue.id],
      ["benefitGroupId", group.id],
      ["benefitOverlapId", overlap.id],
      ["benefitScenarioId", scenario.id],
      ["benefitScenarioValueId", scenarioValue.id],
      ["benefitValuationMethodId", method.id],
      ["benefitMeasurementId", queued.measurementId],
      // The approved value for amend/reverse; the queued one for the decision (both exist and are pending/approved).
      ["financeValidationId", approved.validationId],
      ["queuedFinanceValidationId", queued.validationId],
    ]),
  };
}, 180_000);
afterAll(async () => {
  await api.close();
}, 60_000);

const contractOps = () => {
  const byId = new Map(operations.map((o) => [o.operationId, o]));
  return Object.keys(SLICE_B_MUTATIONS).map((id) => {
    const op = byId.get(id);
    expect(op, id).toBeDefined();
    return op!;
  });
};

/** Calls `operationId` as `session` against the existing records; returns the response and its audit rows. */
async function attempt(operationId: string, session: Session) {
  const op = contractOps().find((o) => o.operationId === operationId)!;
  // The decision takes the QUEUED validation; the amendment and reversal take the approved one.
  const param = (name: string) =>
    operationId === "decideFinanceValidation" && name === "financeValidationId" ? "queuedFinanceValidationId" : name;
  const url = op.path.replace(/\{(\w+)\}/g, (_m, name: string) => {
    const value = r.params.get(param(name));
    expect(value, `${operationId}: no record for {${name}}`).toBeDefined();
    return value!;
  });
  // If-Match "1" on every call: a create ignores it, a change of an existing record needs it (else 428 would mask).
  const res = await call<Body>(api.app, op.method, url, { session, headers: ifm(1), body: BODIES[operationId]!(r) });
  const audit = await auditOfRequest(api.db, String(res.headers["x-request-id"]));
  return { op, res, audit };
}

/** Exactly one authorization.denied, by `actorId`, on the transformation, naming the permission of the operation. */
function expectOneDenial(
  operationId: string,
  a: Awaited<ReturnType<typeof attempt>>,
  actorId: string,
  permission = SLICE_B_MUTATIONS[operationId]!,
) {
  const label = `${operationId} ${a.op.method} ${a.op.path}`;
  expect([a.res.status, a.res.body.code], `${label}: ${JSON.stringify(a.res.body)}`).toEqual([403, "forbidden"]);
  const route = a.op.path.replace(/\{(\w+)\}/g, ":$1");
  expect(
    a.audit.map((e) => [e.action, e.actor_user_id, e.record_type, e.record_id, e.transformation_id, e.reason]),
    label,
  ).toEqual([
    [
      "authorization.denied",
      actorId,
      "transformation",
      r.b.transformationId,
      r.b.transformationId,
      `${a.op.method} ${route} requires ${permission}`,
    ],
  ]);
}

describe("F-DG4-100 (slice B): one authorization.denied per refused mutation, naming the permission", () => {
  it("the sweep covers all 26 slice B mutations of the contract", () => {
    const ops = contractOps();
    expect(ops).toHaveLength(26);
    for (const o of ops) {
      expect(P4_OPERATION_IDS.has(o.operationId), o.operationId).toBe(true);
      expect(o.method, o.operationId).not.toBe("GET");
    }
  });

  it("AUD: every slice B mutation is 403 with exactly one denial", async () => {
    for (const id of Object.keys(SLICE_B_MUTATIONS))
      expectOneDenial(id, await attempt(id, r.b.s.auditor), r.b.users.auditor.id);
  });

  it("ADM-only (ADM_ACCESS + ADM_TECH): every slice B mutation is 403 with exactly one denial", async () => {
    for (const id of Object.keys(SLICE_B_MUTATIONS))
      expectOneDenial(id, await attempt(id, r.b.s.admin), r.b.users.admin.id);
  });

  it("a Business Owner on the six Finance decisions: 403 with exactly one denial naming finance.validate", async () => {
    expect(FINANCE_DECISIONS.sort()).toEqual(
      [
        "amendFinanceValidation",
        "decideBenefitBaseline",
        "decideBenefitValuationMethod",
        "decideFinanceValidation",
        "resolveBenefitOverlap",
        "reverseFinanceValidation",
      ].sort(),
    );
    for (const id of FINANCE_DECISIONS) expectOneDenial(id, await attempt(id, r.b.s.bo), r.b.users.bo.id);
  });

  it("an unknown transformation: 403 and no audit row (a missing record is not an authorization event)", async () => {
    const res = await call<Body>(
      api.app,
      "POST",
      "/api/v1/transformations/01920000-0000-7000-8000-00000000abcd/finance-validations/01920000-0000-7000-8000-00000000abce/decision",
      { session: r.b.s.auditor, headers: ifm(1), body: BODIES["decideFinanceValidation"]!(r) },
    );
    expect([res.status, res.body.code]).toEqual([403, "forbidden"]);
    expect(await auditOfRequest(api.db, String(res.headers["x-request-id"]))).toEqual([]);
  });
});

describe("F-DG4-100 (slice B): the separation-of-duties refusals of the Finance decisions are denials too", () => {
  it("the submitter of a value (FIN + BO) is 403 finance_validation.sod_submitter with one denial", async () => {
    const both = await extraUser(api, w, r.b, "FIN");
    await grant(api.db, w.grantor.id, both.id, "BO", { type: "transformation", id: r.b.transformationId }, w.orgA.id);
    const ben = await measuredBenefit(api, r.b);
    const own = await submittedValue(api, r.b, ben.id, "10", {
      periodStart: "2030-03-01",
      periodEnd: "2030-03-31",
      send: (m, u, o) => call(api.app, m, u, { ...o, session: both.session }),
    });
    const res = await call<Body>(api.app, "POST", `${r.b.base}/finance-validations/${own.validationId}/decision`, {
      session: both.session,
      headers: ifm(own.validationVersion),
      body: { decision: "approved", items: ALL_ACCEPTED, approvedAmount: "10" },
    });
    expect([res.status, res.body.code]).toEqual([403, "finance_validation.sod_submitter"]);
    expect(
      (await auditOfRequest(api.db, String(res.headers["x-request-id"]))).map((e) => [
        e.action,
        e.actor_user_id,
        e.record_type,
        e.record_id,
        e.reason,
      ]),
    ).toEqual([
      [
        "authorization.denied",
        both.id,
        "transformation",
        r.b.transformationId,
        "POST /api/v1/transformations/:transformationId/finance-validations/:financeValidationId/decision requires finance.validate",
      ],
    ]);
  });

  it("the owner of a benefit (FIN as owner) is 403 benefit.baseline_validator_is_owner with one denial", async () => {
    const owner = await extraUser(api, w, r.b, "FIN");
    await grant(api.db, w.grantor.id, owner.id, "BO", { type: "transformation", id: r.b.transformationId }, w.orgA.id);
    const ben = await benefitAt(
      api,
      r.b,
      "identify",
      financialBody(r.b, { ownerUserId: owner.id, baselineValue: "1" }),
    );
    const res = await call<Body>(api.app, "POST", `${r.b.base}/benefits/${ben.id}/baseline-validation`, {
      session: owner.session,
      headers: ifm(ben.version),
      body: { decision: "validated" },
    });
    expect([res.status, res.body.code], JSON.stringify(res.body)).toEqual([403, "benefit.baseline_validator_is_owner"]);
    expect(
      (await auditOfRequest(api.db, String(res.headers["x-request-id"]))).map((e) => [
        e.action,
        e.actor_user_id,
        e.record_id,
        e.reason,
      ]),
    ).toEqual([
      [
        "authorization.denied",
        owner.id,
        r.b.transformationId,
        "POST /api/v1/transformations/:transformationId/benefits/:benefitId/baseline-validation requires finance.validate",
      ],
    ]);
  });
});

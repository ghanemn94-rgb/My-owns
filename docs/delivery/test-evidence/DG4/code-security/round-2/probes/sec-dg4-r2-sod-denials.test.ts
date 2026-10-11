// code-security-reviewer DG4 round-2 probe D (T-DG4-REV-SEC-R2): F-DG4-100's FOUR separation-of-duties refusals of the
// Finance decisions are denials too (KBE-R5 claim). The repair's own slice-b-denials.test.ts covers two of them (the
// submitter and the baseline owner); this probe exercises all four independently, each by a user who HOLDS
// finance.validate, and asserts: 403 with the SoD code, exactly ONE audit row for the request (authorization.denied, by
// the caller, naming finance.validate), and the target row unchanged.
//   D1 finance_validation.sod_submitter          (FIN+BO submits a value, then decides it)
//   D2 benefit.baseline_validator_is_owner       (FIN+BO owns the benefit, then validates its baseline)
//   D3 benefit_overlap.resolver_is_owner         (FIN owns one of the overlapping benefits, then resolves)
//   D4 benefit_valuation_method.decider_is_proposer (FIN+BO proposes, then decides)
// NOT product code; disposable clone only (copied to apps/api/test/integration/zz-sec-dg4/). All data is synthetic.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOfRequest, call, createUser, grant, seedWorld, signIn, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { benefitAt, extraUser, financialBody, seedBenefitWorld, type BenefitWorld } from "../benefits/fixtures.ts";
import { ALL_ACCEPTED, measuredBenefit, submittedValue, type Body } from "../benefits/value-fixtures.ts";

let api: TestApi;
let w: World;
let b: BenefitWorld;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
}, 120_000);
afterAll(() => api.close(), 60_000);

const finAndBo = async () => {
  const u = await createUser(api.db, w.orgA.id);
  const scope = { type: "transformation" as const, id: b.transformationId };
  await grant(api.db, w.grantor.id, u.id, "BO", scope, w.orgA.id);
  await grant(api.db, w.grantor.id, u.id, "FIN", scope, w.orgA.id);
  return { id: u.id, session: await signIn(api.app, u.subject) };
};
const audited = async (res: { headers: Record<string, unknown> }) =>
  (await auditOfRequest(api.db, String(res.headers["x-request-id"]))).map((e) => [e.action, e.actor_user_id, e.reason]);
const report = (label: string, res: { status: number; body: Body }, rows: unknown[][]) =>
  console.log(`[probe-D] ${label} -> ${res.status} ${res.body.code}; audit ${JSON.stringify(rows)}`);
const expectDenial = (rows: unknown[][], actor: string) => {
  expect(rows.length).toBe(1);
  expect(rows[0]![0]).toBe("authorization.denied");
  expect(rows[0]![1]).toBe(actor);
  expect(String(rows[0]![2])).toMatch(/requires finance\.validate$/);
};

describe("SEC-DG4-R2 probe D: the four Finance SoD refusals each write one authorization.denied", () => {
  it("D1 finance_validation.sod_submitter", async () => {
    const u = await finAndBo();
    const ben = await measuredBenefit(api, b);
    const own = await submittedValue(api, b, ben.id, "10", {
      periodStart: "2031-03-01",
      periodEnd: "2031-03-31",
      send: (m, url, o) => call(api.app, m, url, { ...o, session: u.session }),
    });
    const res = await call<Body>(api.app, "POST", `${b.base}/finance-validations/${own.validationId}/decision`, {
      session: u.session, headers: ifm(own.validationVersion), body: { decision: "approved", items: ALL_ACCEPTED, approvedAmount: "10" },
    });
    const rows = await audited(res);
    const fv = await api.db.selectFrom("finance_validation").select(["status", "version"]).where("id", "=", own.validationId).executeTakeFirstOrThrow();
    report("D1", res, rows);
    expect([res.status, res.body.code, fv.status, fv.version]).toEqual([403, "finance_validation.sod_submitter", "queued", own.validationVersion]);
    expectDenial(rows, u.id);
  });

  it("D2 benefit.baseline_validator_is_owner", async () => {
    const u = await finAndBo();
    const ben = await benefitAt(api, b, "identify", financialBody(b, { ownerUserId: u.id, baselineValue: "1" }));
    const res = await call<Body>(api.app, "POST", `${b.base}/benefits/${ben.id}/baseline-validation`, {
      session: u.session, headers: ifm(ben.version), body: { decision: "validated" },
    });
    const rows = await audited(res);
    const after = await api.db.selectFrom("benefit").select(["version"]).where("id", "=", ben.id).executeTakeFirstOrThrow();
    report("D2", res, rows);
    expect([res.status, res.body.code, after.version]).toEqual([403, "benefit.baseline_validator_is_owner", ben.version]);
    expectDenial(rows, u.id);
  });

  it("D3 benefit_overlap.resolver_is_owner", async () => {
    const fin = await extraUser(api, w, b, "FIN");
    const d = `synthetic.driver.secr2.${Date.now()}`;
    const mk = async (extra: Record<string, unknown>) => {
      const r = await call<Body>(api.app, "POST", `${b.base}/benefits`, { session: b.s.bo, body: financialBody(b, { driverKey: d, ...extra }) });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      return r.body as { id: string };
    };
    await mk({});
    const owned = await mk({ ownerUserId: fin.id });
    const [warning] = await api.db.selectFrom("benefit_overlap").selectAll()
      .where((eb) => eb.or([eb("benefit_a_id", "=", owned.id), eb("benefit_b_id", "=", owned.id)])).where("status", "=", "open").execute();
    const res = await call<Body>(api.app, "POST", `${b.base}/benefit-overlaps/${warning!.id}/resolve`, {
      session: fin.session, headers: ifm(warning!.version), body: { resolution: "no_economic_overlap", note: "Synthetic" },
    });
    const rows = await audited(res);
    const after = await api.db.selectFrom("benefit_overlap").select(["status", "version"]).where("id", "=", warning!.id).executeTakeFirstOrThrow();
    report("D3", res, rows);
    expect([res.status, res.body.code, after.status, after.version]).toEqual([403, "benefit_overlap.resolver_is_owner", "open", warning!.version]);
    expectDenial(rows, fin.id);
  });

  it("D4 benefit_valuation_method.decider_is_proposer", async () => {
    const u = await finAndBo();
    const M = `${b.base}/benefit-valuation-methods`;
    const p = await call<Body>(api.app, "POST", M, {
      session: u.session,
      body: { name: "Synthetic NPS point value", method: "Each NPS point is valued at a synthetic value.", appliesToType: "cx", kpiDefinitionId: b.kpiDefinitionId, unitValue: "125000", currency: "SAR" },
    });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    const res = await call<Body>(api.app, "POST", `${M}/${p.body.id}/decision`, { session: u.session, headers: ifm(1), body: { decision: "approved" } });
    const rows = await audited(res);
    const after = await api.db.selectFrom("benefit_valuation_method").select(["status", "version"]).where("id", "=", String(p.body.id)).executeTakeFirstOrThrow();
    report("D4", res, rows);
    expect([res.status, res.body.code, after.status, after.version]).toEqual([403, "benefit_valuation_method.decider_is_proposer", "proposed", 1]);
    expectDenial(rows, u.id);
  });
});

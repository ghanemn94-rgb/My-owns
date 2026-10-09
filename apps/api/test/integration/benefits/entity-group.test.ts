// REQ-S16-017: the master prompt §16 entity group BusinessCase, Scenario, Benefit, BenefitAllocation,
// BenefitFormulaVersion, BenefitMeasurement and FinanceValidation (T-DG4-KBE-E; ADR-0030 §12; ERD §1f; migrations
// 0037-0039). Each entity is created and read through the API with authorization enforced: the read-only auditor (AUD)
// gets 403 on each mutation and 200 on each read. BusinessCase and BenefitFormulaVersion go through the DG3 operations;
// Scenario, Benefit, BenefitAllocation and BenefitMeasurement through createBenefitScenario, createBenefit,
// replaceBenefitAllocations and createBenefitMeasurement; FinanceValidation has no create operation: a measurement is
// submitted and the benefits.finance_queue handler runs in the test, then getFinanceValidation reads it.
// All data is SYNTHETIC; nothing here grants a real business or Finance approval or touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { financialBody, insertInitiative, seedBenefitWorld, type BenefitWorld } from "./fixtures.ts";
import {
  evidenceItem,
  measuredBenefit,
  queueItemOf,
  REVENUE_VERSION,
  runFinanceQueue,
  type Body,
} from "./value-fixtures.ts";

let api: TestApi;
let w: World;
let b: BenefitWorld;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

/** AUD: 403 on the mutation (nothing written), 200 on the read. */
async function audit(method: string, url: string, body: unknown, read: string, version?: number) {
  const denied = await call<Body>(api.app, method, url, {
    session: b.s.auditor,
    ...(version === undefined ? {} : { headers: ifm(version) }),
    body,
  });
  expect(denied.status, `${method} ${url}`).toBe(403);
  const ok = await call<Body>(api.app, "GET", read, { session: b.s.auditor });
  expect(ok.status, `GET ${read}`).toBe(200);
  return ok.body;
}

describe("REQ-S16-017: the benefits entity group through the API", () => {
  it("creates and reads each of the seven entities; AUD is refused every mutation and reads every record", async () => {
    // BusinessCase (DG3).
    const caseBody = { transformationId: b.transformationId, level: "transformation", title: "Synthetic case" };
    const bc = await call<Body>(api.app, "POST", "/api/v1/business-cases", { session: b.s.tl, body: caseBody });
    expect(bc.status, JSON.stringify(bc.body)).toBe(201);
    expect((await audit("POST", "/api/v1/business-cases", caseBody, `/api/v1/business-cases/${bc.body.id}`)).id).toBe(
      bc.body.id,
    );

    // BenefitFormulaVersion (DG3).
    const fBody = {
      transformationId: b.transformationId,
      benefitName: "Synthetic formula",
      initialVersion: REVENUE_VERSION,
    };
    const f = await call<Body>(api.app, "POST", "/api/v1/benefit-formulas", { session: b.s.tl, body: fBody });
    expect(f.status, JSON.stringify(f.body)).toBe(201);
    const version = await audit(
      "POST",
      `/api/v1/benefit-formulas/${f.body.id}/versions`,
      REVENUE_VERSION,
      `/api/v1/benefit-formulas/${f.body.id}/versions/1`,
      f.body.version,
    );
    expect(version.id).toBe(f.body.currentVersion.id);

    // Scenario.
    const S = `${b.base}/benefit-scenarios`;
    const scBody = { kind: "downside", title: "Synthetic downside", assumptions: "Synthetic" };
    const sc = await call<Body>(api.app, "POST", S, { session: b.s.tl, body: scBody });
    expect(sc.status, JSON.stringify(sc.body)).toBe(201);
    expect((await audit("POST", S, scBody, `${S}/${sc.body.id}`)).id).toBe(sc.body.id);

    // Benefit.
    const B = `${b.base}/benefits`;
    const bBody = financialBody(b);
    const ben = await call<Body>(api.app, "POST", B, { session: b.s.bo, body: bBody });
    expect(ben.status, JSON.stringify(ben.body)).toBe(201);
    expect((await audit("POST", B, bBody, `${B}/${ben.body.id}`)).id).toBe(ben.body.id);

    // BenefitAllocation.
    const ini = await insertInitiative(api.db, b);
    const allocations = { allocations: [{ initiativeId: ini, share: "0.5" }] };
    const A = `${B}/${ben.body.id}/allocations`;
    const denied = await call<Body>(api.app, "PUT", A, {
      session: b.s.auditor,
      headers: ifm(ben.body.version),
      body: allocations,
    });
    expect(denied.status).toBe(403);
    const put = await call<Body>(api.app, "PUT", A, {
      session: b.s.tl,
      headers: ifm(ben.body.version),
      body: allocations,
    });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    const readA = await call<Body>(api.app, "GET", A, { session: b.s.auditor });
    expect([readA.status, readA.body.unallocatedShare]).toEqual([200, "0.500000"]);

    // BenefitMeasurement.
    const measured = await measuredBenefit(api, b);
    const ev = await evidenceItem(api, b);
    const M = `${B}/${measured.id}/measurements`;
    const mBody = {
      periodStart: "2038-01-01",
      periodEnd: "2038-01-31",
      amount: "1000",
      evidenceIds: [ev],
      submit: true,
    };
    const m = await call<Body>(api.app, "POST", M, { session: b.s.bo, body: mBody });
    expect(m.status, JSON.stringify(m.body)).toBe(201);
    const readM = await audit("POST", M, mBody, `${b.base}/benefit-measurements/${m.body.id}`);
    expect([readM.id, readM.status]).toEqual([m.body.id, "submitted"]);

    // FinanceValidation (no create operation: the queue handler creates it from the submission event).
    await runFinanceQueue(api, m.body.id);
    const item = await queueItemOf(api, m.body.id);
    const FV = `${b.base}/finance-validations/${item!.id}`;
    const readFv = await audit(
      "POST",
      `${FV}/decision`,
      { decision: "approved", items: {}, approvedAmount: "1000" },
      FV,
      item!.version,
    );
    expect([readFv.id, readFv.benefitMeasurementId, readFv.status]).toEqual([item!.id, m.body.id, "queued"]);
    expect(Object.keys(readFv.content).sort()).toEqual(
      ["assumptions", "attribution", "baseline", "calculation", "evidence", "measurementPeriod"].sort(),
    );
  });
});

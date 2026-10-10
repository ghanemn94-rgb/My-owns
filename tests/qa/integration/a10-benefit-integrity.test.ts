// A10 "Benefit integrity" (master prompt §20): "A shared benefit rolls up once; 110% allocation is rejected; unvalidated
// or forecast value cannot appear as validated actual."
//
// Black-box acceptance suite (qa-verifier, T-DG4-QA-A) through the REAL API (Fastify inject, every response validated
// against docs/api/openapi.yaml) on the run's disposable PostgreSQL. Each `it` names the requirement row whose A10 text
// it proves. The Finance queue item that follows a submitted measurement is written by the worker's
// benefits.finance_queue consumer, invoked here with the outbox envelope exactly as the relay delivers it (the A04 suite
// runs the full relay + pg-boss worker). Amounts are compared as decimal strings (canon), never as floats.
// All data is SYNTHETIC; every Finance decision here is a synthetic in-product approval of test data.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { queueFinanceValidation } from "../../../apps/worker/src/handlers/benefits.ts";
import { call, startApi, type Session, type TestApi } from "../support/api.ts";
import {
  activeOutcome,
  canon,
  createKpi,
  cxBody,
  envelopeOf,
  evidenceItem,
  expectCode,
  financialBody,
  get200,
  ifMatch,
  insertInitiative,
  measuredBenefit,
  outcomeKpi,
  seedBenefitWorld,
  seedWorld,
  SIX_ACCEPTED,
  type Body,
  type BenefitWorld,
  type KpiWorld,
  type World,
} from "../support/p4.ts";

let api: TestApi;
let w: World;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 60_000);
afterAll(() => api?.close());

// ------------------------------------------------------------------------------------------------ helpers

const totals = async (b: BenefitWorld, query = "") => get200(api, b.s.auditor, `${b.base}/benefit-totals${query}`);
/** The amount (canonical decimal string) of one class/state line in SAR, or null when the line is absent. */
const line = (t: Body, valueClass: string, state: string, currency = "SAR") => {
  const c = (t.currencies as Body[]).find((x) => x.currency === currency);
  const l = (c?.lines as Body[] | undefined)?.find((x) => x.valueClass === valueClass && x.state === state);
  return l ? { amount: canon(l.total.amount), status: l.total.status as string, count: l.count as number } : null;
};
const validatedSar = async (b: BenefitWorld, valueClass = "revenue_uplift") =>
  line(await totals(b), valueClass, "validated")?.amount ?? "0";
const series = async (b: BenefitWorld, benefitId: string) => {
  const v = await get200(api, b.s.auditor, `${b.base}/benefits/${benefitId}/values`);
  return Object.fromEntries((v.series as Body[]).map((s) => [s.state, s])) as Body;
};

async function newBenefit(b: BenefitWorld, extra: Record<string, unknown> = {}): Promise<Body> {
  const r = await call<Body>(api.app, "POST", `${b.base}/benefits`, { session: b.s.bo, body: financialBody(b, extra) });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
}
/** A planned or forecast value for 2026-01..2026-06 (inside the dashboards' "to date" window). */
async function planValue(b: BenefitWorld, benefitId: string, valueKind: "planned" | "forecast", amount: string) {
  const r = await call<Body>(api.app, "POST", `${b.base}/benefits/${benefitId}/plan-values`, {
    session: b.s.bo,
    body: { valueKind, periodStart: "2026-01-01", periodEnd: "2026-06-30", amount },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
}

/** BO submits a measurement with evidence; returns the measurement (the queue item is not yet written). */
async function submitMeasurement(
  b: BenefitWorld,
  benefitId: string,
  amount: string,
  period: { start: string; end: string } = { start: "2036-01-01", end: "2036-01-31" },
): Promise<Body> {
  const ev = await evidenceItem(api, b);
  const r = await call<Body>(api.app, "POST", `${b.base}/benefits/${benefitId}/measurements`, {
    session: b.s.bo,
    body: {
      periodStart: period.start,
      periodEnd: period.end,
      amount,
      attribution: "Synthetic: untreated control group",
      assumptions: "Synthetic: ARPU stable over the period",
      evidenceIds: [ev],
      submit: true,
    },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
}

/** Delivers the measurement's benefit.evidence_submitted event to the Finance queue consumer, as the relay would. */
async function deliverToFinanceQueue(measurementId: string, jobId = `qa-a10-${measurementId}`) {
  const env = await envelopeOf(api, measurementId, "benefit.evidence_submitted");
  expect(env, "submitting a measurement writes benefit.evidence_submitted").toBeDefined();
  return queueFinanceValidation(api.db, env, jobId);
}

const queueItemsOf = (measurementId: string) =>
  api.db
    .selectFrom("finance_validation")
    .select(["id", "version", "status", "kind"])
    .where("benefit_measurement_id", "=", measurementId)
    .execute();

/** Submit + queue; returns the queue item id and version. */
async function queued(b: BenefitWorld, benefitId: string, amount: string, period?: { start: string; end: string }) {
  const m = await submitMeasurement(b, benefitId, amount, period);
  await deliverToFinanceQueue(m.id);
  const [item] = await queueItemsOf(m.id);
  expect(item, "one Finance queue item").toBeDefined();
  return { measurementId: m.id as string, id: item!.id, version: item!.version };
}

function decide(
  b: BenefitWorld,
  item: { id: string; version: number },
  body: Record<string, unknown>,
  session: Session = b.s.fin,
) {
  return call<Body>(api.app, "POST", `${b.base}/finance-validations/${item.id}/decision`, {
    session,
    headers: ifMatch(item.version),
    body,
  });
}
async function approve(b: BenefitWorld, item: { id: string; version: number }, approvedAmount: string) {
  const r = await decide(b, item, { decision: "approved", items: SIX_ACCEPTED, approvedAmount });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
}

/**
 * An outcome KPI (T02 row: an active outcome linked to an active KPI definition) of the benefit world: the source node
 * of a kpi_benefit trace link (contract TraceLinkCreate: "kpi_benefit: outcome KPI -> benefit").
 */
async function outcomeKpiOf(b: BenefitWorld, name: string): Promise<string> {
  const k = {
    base: b.base,
    transformationId: b.transformationId,
    users: b.users,
    s: { kds: b.s.tl },
  } as unknown as KpiWorld;
  const kpiId = (await createKpi(api, k, { name, unitKind: "count", unitLabel: "lines" })).id;
  const outcomeId = await activeOutcome(api.db, b.organizationId, b.transformationId, b.users.tl.id);
  return outcomeKpi(api.db, k, outcomeId, kpiId, b.organizationId);
}

// ------------------------------------------------------------------------------------------------ A10 part 1: counted once

describe("A10: a shared benefit rolls up once (REQ-PB-058)", () => {
  it("REQ-PB-058: a benefit with two owners is rejected", async () => {
    const b = await seedBenefitWorld(api, w);
    const before = await api.db
      .selectFrom("benefit")
      .select("id")
      .where("transformation_id", "=", b.transformationId)
      .execute();
    // Two owners as a list in the single-owner field, and as a second owner field: both refused by the contract.
    for (const body of [
      financialBody(b, { ownerUserId: [b.users.bo.id, b.users.bo2.id] }),
      financialBody(b, { ownerUserIds: [b.users.bo.id, b.users.bo2.id] }),
    ]) {
      const r = await call<Body>(api.app, "POST", `${b.base}/benefits`, { session: b.s.bo, body, contract: false });
      expect(r.status, JSON.stringify(r.body)).toBe(400);
    }
    const after = await api.db
      .selectFrom("benefit")
      .select("id")
      .where("transformation_id", "=", b.transformationId)
      .execute();
    expect(after).toHaveLength(before.length);
  });

  it("REQ-PB-058: a 10 million SAR benefit shared by two initiatives appears once (10 million SAR) in the totals", async () => {
    const b = await seedBenefitWorld(api, w);
    const ben = await newBenefit(b);
    await planValue(b, ben.id, "planned", "10000000");
    const [i1, i2] = [await insertInitiative(api.db, b), await insertInitiative(api.db, b)];
    const put = await call<Body>(api.app, "PUT", `${b.base}/benefits/${ben.id}/allocations`, {
      session: b.s.bo,
      headers: ifMatch(ben.version),
      body: {
        allocations: [
          { initiativeId: i1, share: "0.5" },
          { initiativeId: i2, share: "0.5" },
        ],
      },
    });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    const t = await totals(b);
    expect(line(t, "revenue_uplift", "planned")).toEqual({ amount: "10000000", status: "known", count: 1 });
    // The organization-level Finance dashboard (the portfolio view) shows it once too.
    const fd = await get200(
      api,
      b.s.auditor,
      `/api/v1/dashboards/finance?organizationId=${b.organizationId}&transformationId=${b.transformationId}`,
    );
    const planned = (fd.lines as Body[]).filter(
      (l) => l.valueClass === "revenue_uplift" && l.state === "planned" && l.currency === "SAR",
    );
    expect(planned.map((l) => canon(l.total.value))).toEqual(["10000000"]);
  });

  it("REQ-PB-058: two initiative records of one shared benefit in a shared-benefit group count once", async () => {
    const b = await seedBenefitWorld(api, w);
    const g = await call<Body>(api.app, "POST", `${b.base}/benefit-groups`, {
      session: b.s.bo,
      body: { title: "Synthetic shared 10 M SAR churn benefit" },
    });
    expect(g.status, JSON.stringify(g.body)).toBe(201);
    const a = await newBenefit(b, { benefitGroupId: g.body.id, title: "Synthetic shared benefit (initiative 1)" });
    const c = await newBenefit(b, { benefitGroupId: g.body.id, title: "Synthetic shared benefit (initiative 2)" });
    await planValue(b, a.id, "planned", "10000000");
    await planValue(b, c.id, "planned", "10000000");
    // Until the counted member is named, the group adds nothing (never 20 M).
    const unnamed = line(await totals(b), "revenue_uplift", "planned");
    expect(unnamed?.amount ?? "0").not.toBe("20000000");
    const named = await call<Body>(api.app, "PATCH", `${b.base}/benefit-groups/${g.body.id}`, {
      session: b.s.bo,
      headers: ifMatch(g.body.version),
      body: { countedBenefitId: a.id },
    });
    expect(named.status, JSON.stringify(named.body)).toBe(200);
    const t = await totals(b);
    expect(line(t, "revenue_uplift", "planned")).toEqual({ amount: "10000000", status: "known", count: 1 });
    expect((t.excluded as Body[]).map((e) => [e.benefitId, e.reason])).toContainEqual([
      c.id,
      "group_member_not_counted",
    ]);
  });
});

// ------------------------------------------------------------------------------------------------ A10 part 2: 110 % refused

describe("A10: 110% allocation is rejected (REQ-S08-013, REQ-S03-006)", () => {
  it("REQ-S08-013: allocations 60% + 50% are rejected; 60% + 30% saves and shows 10% unallocated", async () => {
    const b = await seedBenefitWorld(api, w);
    const ben = await newBenefit(b);
    const [i1, i2] = [await insertInitiative(api.db, b), await insertInitiative(api.db, b)];
    const put = (shares: [string, string], version: number) =>
      call<Body>(api.app, "PUT", `${b.base}/benefits/${ben.id}/allocations`, {
        session: b.s.bo,
        headers: ifMatch(version),
        body: {
          allocations: [
            { initiativeId: i1, share: shares[0] },
            { initiativeId: i2, share: shares[1] },
          ],
        },
      });
    const over = await put(["0.6", "0.5"], ben.version);
    expectCode(over, 422, "benefit_allocation.over_100");
    const kept = await get200(api, b.s.auditor, `${b.base}/benefits/${ben.id}/allocations`);
    expect(kept.allocations).toEqual([]);
    const ok = await put(["0.6", "0.3"], ben.version);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const set = await get200(api, b.s.auditor, `${b.base}/benefits/${ben.id}/allocations`);
    expect([canon(set.allocatedShare), canon(set.unallocatedShare)]).toEqual(["0.9", "0.1"]);
  });

  it("REQ-S03-006: an allocation link set totalling 110% into one benefit is rejected; 100% is accepted", async () => {
    const b = await seedBenefitWorld(api, w);
    const ben = await newBenefit(b);
    const k1 = await outcomeKpiOf(b, "Synthetic KPI one");
    const k2 = await outcomeKpiOf(b, "Synthetic KPI two");
    const link = (kpiId: string, share: string) =>
      call<Body>(api.app, "POST", `${b.base}/trace-links`, {
        session: b.s.bo,
        body: {
          linkKind: "kpi_benefit",
          fromId: kpiId,
          toId: ben.id,
          contributionStatement: "Synthetic KPI movement drives the benefit",
          allocationShare: share,
        },
      });
    const first = await link(k1, "0.6");
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expectCode(await link(k2, "0.5"), 422, "trace_link.allocation_exceeds_total");
    const set = await get200(api, b.s.auditor, `${b.base}/allocation-sets/benefit/${ben.id}`);
    expect(canon(set.unallocatedShare)).toBe("0.4");
    const fits = await link(k2, "0.4");
    expect(fits.status, JSON.stringify(fits.body)).toBe(201);
    const full = await get200(api, b.s.auditor, `${b.base}/allocation-sets/benefit/${ben.id}`);
    expect(canon(full.unallocatedShare)).toBe("0");
  });
});

// ------------------------------------------------------------------------------------------------ A10 part 3: validated only

describe("A10: unvalidated or forecast value never appears as validated actual", () => {
  it("REQ-PB-075, REQ-S08-016: a submitted value stays pending; approval raises the validated total by exactly the approved amount", async () => {
    const b = await seedBenefitWorld(api, w);
    const ben = await measuredBenefit(api, b);
    expect(await validatedSar(b)).toBe("0");
    const item = await queued(b, ben.id, "250000.10");
    // Pending: labelled submitted, excluded from validated.
    let s = await series(b, ben.id);
    expect([canon(s.submitted.total.amount), canon(s.validated.total.amount)]).toEqual(["250000.1", "0"]);
    expect(await validatedSar(b)).toBe("0");
    expect(line(await totals(b), "revenue_uplift", "submitted")?.amount).toBe("250000.1");
    // Finance approves a lower amount: the total rises by exactly that amount.
    await approve(b, item, "240000.05");
    expect(await validatedSar(b)).toBe("240000.05");
    s = await series(b, ben.id);
    expect([canon(s.validated.total.amount), canon(s.submitted.total.amount)]).toEqual(["240000.05", "0"]);
  });

  it("REQ-S08-001: a forecast amount never appears in the validated total; a rejected measurement is kept and shown rejected", async () => {
    const b = await seedBenefitWorld(api, w);
    const ben = await measuredBenefit(api, b);
    await planValue(b, ben.id, "forecast", "500000");
    let t = await totals(b);
    expect(line(t, "revenue_uplift", "forecast")?.amount).toBe("500000");
    expect(line(t, "revenue_uplift", "validated")?.amount ?? "0").toBe("0");
    const item = await queued(b, ben.id, "70000");
    const rejected = await decide(b, item, {
      decision: "rejected",
      items: {
        ...SIX_ACCEPTED,
        evidence: { decision: "rejected", note: "Synthetic: extract does not cover the period" },
      },
      note: "Synthetic: evidence incomplete",
    });
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(200);
    const s = await series(b, ben.id);
    expect([canon(s.rejected.total.amount), s.rejected.count, canon(s.validated.total.amount)]).toEqual([
      "70000",
      1,
      "0",
    ]);
    const m = await get200(api, b.s.auditor, `${b.base}/benefit-measurements/${item.measurementId}`);
    expect(m.id).toBe(item.measurementId);
    t = await totals(b);
    expect(line(t, "revenue_uplift", "validated")?.amount ?? "0").toBe("0");
  });

  it("REQ-S08-018: upside scenario values never appear in the realized (measured) or validated totals", async () => {
    const b = await seedBenefitWorld(api, w);
    const ben = await measuredBenefit(api, b);
    const before = await totals(b);
    const sc = await call<Body>(api.app, "POST", `${b.base}/benefit-scenarios`, {
      session: b.s.tl,
      body: { kind: "upside", title: "Synthetic upside", assumptions: "Synthetic: double attach rate" },
    });
    expect(sc.status, JSON.stringify(sc.body)).toBe(201);
    const v = await call<Body>(api.app, "POST", `${b.base}/benefit-scenarios/${sc.body.id}/values`, {
      session: b.s.tl,
      body: { benefitId: ben.id, periodStart: "2036-01-01", periodEnd: "2036-12-31", amount: "900000" },
    });
    expect(v.status, JSON.stringify(v.body)).toBe(201);
    const after = await totals(b);
    for (const state of ["measured", "validated", "submitted", "sustained"])
      expect(line(after, "revenue_uplift", state), state).toEqual(line(before, "revenue_uplift", state));
    const s = await series(b, ben.id);
    for (const state of ["measured", "validated"]) expect(canon(s[state].total.amount), state).toBe("0");
  });

  it("REQ-PB-076: a CX benefit with Value n/a is excluded from SAR totals and not counted as zero", async () => {
    const b = await seedBenefitWorld(api, w);
    const fin = await newBenefit(b);
    await planValue(b, fin.id, "planned", "1000");
    const before = await totals(b);
    const cx = await call<Body>(api.app, "POST", `${b.base}/benefits`, { session: b.s.bo, body: cxBody(b) });
    expect(cx.status, JSON.stringify(cx.body)).toBe(201);
    const after = await totals(b);
    expect(after.nonFinancialCount).toBe(before.nonFinancialCount + 1);
    // The SAR figures are unchanged, and no SAR line counts the CX benefit as a 0 amount.
    expect(JSON.stringify(after.currencies)).toBe(JSON.stringify(before.currencies));
    const sar = (after.currencies as Body[]).find((c) => c.currency === "SAR");
    expect((sar.lines as Body[]).filter((l) => l.valueClass === "non_financial_valued")).toEqual([]);
  });

  it("REQ-S08-010: a SAR value on a CX benefit without an approved valuation method is rejected", async () => {
    const b = await seedBenefitWorld(api, w);
    const noMethod = await call<Body>(api.app, "POST", `${b.base}/benefits`, {
      session: b.s.bo,
      body: cxBody(b, { plannedValue: "50000" }),
    });
    expect(noMethod.status, JSON.stringify(noMethod.body)).toBe(422);
    expect(String(noMethod.body.code)).toMatch(/^benefit\.valuation_method_(required|not_approved)$/);
    const proposed = await call<Body>(api.app, "POST", `${b.base}/benefit-valuation-methods`, {
      session: b.s.bo,
      body: {
        name: "Synthetic NPS point value",
        method: "Synthetic: churn saved per NPS point",
        appliesToType: "cx",
        unitValue: "1000",
        currency: "SAR",
      },
    });
    expect(proposed.status, JSON.stringify(proposed.body)).toBe(201);
    expectCode(
      await call<Body>(api.app, "POST", `${b.base}/benefits`, {
        session: b.s.bo,
        body: cxBody(b, { plannedValue: "50000", valuationMethodId: proposed.body.id }),
      }),
      422,
      "benefit.valuation_method_not_approved",
    );
    // Finance approves the method (synthetic): now the SAR value is accepted.
    const approved = await call<Body>(
      api.app,
      "POST",
      `${b.base}/benefit-valuation-methods/${proposed.body.id}/decision`,
      { session: b.s.fin, headers: ifMatch(proposed.body.version), body: { decision: "approved" } },
    );
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    const ok = await call<Body>(api.app, "POST", `${b.base}/benefits`, {
      session: b.s.bo,
      body: cxBody(b, { plannedValue: "50000", valuationMethodId: proposed.body.id }),
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
  });

  it("REQ-S08-009: revenue uplift and margin are separate Finance-dashboard lines; avoided cost is not cash saving", async () => {
    const b = await seedBenefitWorld(api, w);
    const rev = await newBenefit(b, { benefitType: "revenue", valueClass: "revenue_uplift" });
    const mar = await newBenefit(b, { benefitType: "revenue", valueClass: "margin_uplift" });
    const avoided = await newBenefit(b, {
      benefitType: "cost",
      valueClass: "avoided_cost",
      financialStatementLine: "Opex - network",
    });
    await planValue(b, rev.id, "planned", "300");
    await planValue(b, mar.id, "planned", "70");
    await planValue(b, avoided.id, "planned", "45");
    const t = await totals(b);
    expect(line(t, "revenue_uplift", "planned")?.amount).toBe("300");
    expect(line(t, "margin_uplift", "planned")?.amount).toBe("70");
    expect(line(t, "avoided_cost", "planned")?.amount).toBe("45");
    expect(line(t, "cash_saving", "planned")?.amount ?? "0").toBe("0");
    const fd = await get200(
      api,
      b.s.auditor,
      `/api/v1/dashboards/finance?organizationId=${b.organizationId}&transformationId=${b.transformationId}`,
    );
    const planned = (cls: string) =>
      (fd.lines as Body[])
        .filter((l) => l.valueClass === cls && l.state === "planned" && l.currency === "SAR")
        .map((l) => canon(l.total.value));
    expect([planned("revenue_uplift"), planned("margin_uplift")]).toEqual([["300"], ["70"]]);
    expect(planned("cash_saving").filter((v) => v !== "0" && v !== null)).toEqual([]);
  });

  it("REQ-S08-011: a 1 million SAR initiative cost reduces transformation net value by exactly 1 million", async () => {
    const b = await seedBenefitWorld(api, w);
    const ben = await newBenefit(b);
    await planValue(b, ben.id, "planned", "3000000");
    const BC = "/api/v1/business-cases";
    const top = await call<Body>(api.app, "POST", BC, {
      session: b.s.tl,
      body: { transformationId: b.transformationId, level: "transformation", title: "Synthetic transformation case" },
    });
    expect(top.status, JSON.stringify(top.body)).toBe(201);
    const before = (await totals(b)).currencies.find((c: Body) => c.currency === "SAR");
    const ini = await insertInitiative(api.db, b);
    const iniCase = await call<Body>(api.app, "POST", BC, {
      session: b.s.tl,
      body: { transformationId: b.transformationId, level: "initiative", initiativeId: ini, title: "Synthetic case" },
    });
    expect(iniCase.status, JSON.stringify(iniCase.body)).toBe(201);
    const cost = await call<Body>(api.app, "POST", `${BC}/${iniCase.body.id}/lines`, {
      session: b.s.tl,
      body: {
        lineKind: "investment",
        class: "capex",
        valueBasis: "cash",
        title: "Synthetic platform",
        amount: "1000000",
        currency: "SAR",
      },
    });
    expect(cost.status, JSON.stringify(cost.body)).toBe(201);
    const after = (await totals(b)).currencies.find((c: Body) => c.currency === "SAR");
    expect(canon(after.gross.planned.amount)).toBe("3000000");
    expect(canon(after.implementationCost.total.amount)).toBe("1000000");
    expect(canon(after.net.planned.amount)).toBe("2000000");
    // Exactly one million less than before the cost line (never 2 million).
    const beforeNet = canon(before.net.planned.amount);
    expect(beforeNet).toBe("3000000");
  });

  it("REQ-S08-014: two benefits with the same driver and period raise a warning and stay out of validated totals until Finance resolves", async () => {
    const b = await seedBenefitWorld(api, w);
    const shared = { driverKey: "qa.prepaid.churn", populationKey: "qa.prepaid.base" };
    const one = await measuredBenefit(api, b, { extra: shared });
    const two = await measuredBenefit(api, b, { extra: { ...shared, title: "Synthetic churn reduction (2)" } });
    // "The system flags benefits sharing driver, population and period": the warning exists without anyone raising it.
    let overlaps = await get200(api, b.s.auditor, `${b.base}/benefit-overlaps`);
    const pair = [one.id, two.id].sort().join();
    const overlap: Body = (overlaps.items as Body[]).find(
      (o) => o.status === "open" && [o.benefitAId, o.benefitBId].sort().join() === pair,
    );
    expect(overlap, `system-raised overlap warning: ${JSON.stringify(overlaps.items)}`).toBeDefined();
    await approve(b, await queued(b, one.id, "100000"), "100000");
    await approve(b, await queued(b, two.id, "200000"), "200000");
    // Finance-approved values of both benefits stay out of the validated total while the warning is open.
    const t = await totals(b);
    expect(line(t, "revenue_uplift", "validated")?.amount ?? "0").toBe("0");
    const pending = (t.currencies as Body[]).find((c) => c.currency === "SAR").pendingOverlap as Body[];
    expect(pending.map((l) => [l.valueClass, l.state, canon(l.total.amount)])).toContainEqual([
      "revenue_uplift",
      "validated",
      "300000",
    ]);
    // Only Finance resolves it.
    const byBo = await call<Body>(api.app, "POST", `${b.base}/benefit-overlaps/${overlap.id}/resolve`, {
      session: b.s.bo,
      headers: ifMatch(overlap.version),
      body: { resolution: "no_economic_overlap", note: "Synthetic: different customers" },
    });
    expect(byBo.status).toBe(403);
    const resolved = await call<Body>(api.app, "POST", `${b.base}/benefit-overlaps/${overlap.id}/resolve`, {
      session: b.s.fin,
      headers: ifMatch(overlap.version),
      body: { resolution: "no_economic_overlap", note: "Synthetic: different customers" },
    });
    expect(resolved.status, JSON.stringify(resolved.body)).toBe(200);
    expect(await validatedSar(b)).toBe("300000");
    overlaps = await get200(api, b.s.auditor, `${b.base}/benefit-overlaps`);
    expect((overlaps.items as Body[]).find((o) => o.id === overlap.id).status).not.toBe("open");
  });

  it("REQ-S08-015, REQ-PB-013: a validation lacking a measurement period is rejected; non-Finance 403; the audit records the validator", async () => {
    const b = await seedBenefitWorld(api, w);
    const ben = await measuredBenefit(api, b);
    // A value submitted for validation without its measurement period is refused.
    const ev = await evidenceItem(api, b);
    const noPeriod = await call<Body>(api.app, "POST", `${b.base}/benefits/${ben.id}/measurements`, {
      session: b.s.bo,
      body: { amount: "1000", evidenceIds: [ev], submit: true },
    });
    expectCode(noPeriod, 422, "benefit_measurement.period_required");
    const item = await queued(b, ben.id, "1000");
    // A decision without the measurement-period item is refused.
    const { measurementPeriod: _omit, ...fiveItems } = SIX_ACCEPTED;
    void _omit;
    const incomplete = await decide(b, item, { decision: "approved", items: fiveItems, approvedAmount: "1000" });
    expect(incomplete.status, JSON.stringify(incomplete.body)).toBe(422);
    // A Business Owner and an auditor get 403; nothing changes.
    for (const s of [b.s.bo, b.s.auditor]) {
      const r = await decide(b, item, { decision: "approved", items: SIX_ACCEPTED, approvedAmount: "1000" }, s);
      expect(r.status, JSON.stringify(r.body)).toBe(403);
    }
    expect(await validatedSar(b)).toBe("0");
    // Finance succeeds; the decision's audit event names the Finance user.
    await approve(b, item, "1000");
    const audit = await api.db
      .selectFrom("audit_event")
      .select(["action", "actor_user_id"])
      .where("record_id", "=", item.id)
      .orderBy("seq")
      .execute();
    const decision = audit.filter((e) => e.actor_user_id === b.users.fin.id);
    expect(decision.length, JSON.stringify(audit)).toBeGreaterThanOrEqual(1);
    expect(audit.some((e) => e.actor_user_id === b.users.bo.id)).toBe(false);
    expect(await validatedSar(b)).toBe("1000");
  });

  it("REQ-S08-017: an in-place edit of a validated value is 409; a reversal nets the total and both records stay visible", async () => {
    const b = await seedBenefitWorld(api, w);
    const ben = await measuredBenefit(api, b);
    const item = await queued(b, ben.id, "80000");
    await approve(b, item, "80000");
    expect(await validatedSar(b)).toBe("80000");
    const m = await call<Body>(api.app, "GET", `${b.base}/benefit-measurements/${item.measurementId}`, {
      session: b.s.bo,
    });
    const edit = await call<Body>(api.app, "PATCH", `${b.base}/benefit-measurements/${item.measurementId}`, {
      session: b.s.bo,
      headers: ifMatch(m.body.version),
      body: { amount: "90000" },
    });
    expectCode(edit, 409, "benefit_measurement.validated_immutable");
    const original = await get200(api, b.s.auditor, `${b.base}/finance-validations/${item.id}`);
    const rev = await call<Body>(api.app, "POST", `${b.base}/finance-validations/${item.id}/reversals`, {
      session: b.s.fin,
      headers: ifMatch(original.version),
      body: { reason: "Synthetic: the extract double-counted one region" },
    });
    expect(rev.status, JSON.stringify(rev.body)).toBe(201);
    expect(await validatedSar(b)).toBe("0");
    const queue = await get200(api, b.s.auditor, `${b.base}/finance-validations?status=approved`);
    const ofBenefit = (queue.items as Body[]).filter((v) => v.benefitId === ben.id);
    const kinds = ofBenefit.map((v) => v.kind).sort();
    expect(kinds).toEqual(["reversal", "validation"]);
    expect(ofBenefit.find((v) => v.kind === "reversal").correctsValidationId).toBe(item.id);
  });

  it("REQ-S12-014: submitting benefit evidence creates exactly one Finance queue item; replaying the event creates none", async () => {
    const b = await seedBenefitWorld(api, w);
    const ben = await measuredBenefit(api, b);
    const m = await submitMeasurement(b, ben.id, "5000");
    expect(await queueItemsOf(m.id)).toHaveLength(0);
    const first = await deliverToFinanceQueue(m.id, "qa-a10-first");
    expect(first.outcome).toBe("done");
    // The same event again (a relay replay, and a redelivery under another job id): no second item.
    expect((await deliverToFinanceQueue(m.id, "qa-a10-first")).outcome).toBe("duplicate");
    expect((await deliverToFinanceQueue(m.id, "qa-a10-redelivery")).outcome).toBe("duplicate");
    const items = await queueItemsOf(m.id);
    expect(items.map((i) => [i.kind, i.status])).toEqual([["validation", "queued"]]);
    const listed = await get200(api, b.s.fin, `${b.base}/finance-validations`);
    expect((listed.items as Body[]).filter((v) => v.benefitMeasurementId === m.id)).toHaveLength(1);
  });
});

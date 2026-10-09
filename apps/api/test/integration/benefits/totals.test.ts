// Benefit totals counted once (T-DG4-KBE-E; ADR-0030 §7, §8). Proves, against the run's disposable PostgreSQL:
//  - REQ-PB-058 "a 10 M SAR benefit shared by two initiatives appears once": planned 10000000.0000 at transformation
//    level with allocations of 60 % and 40 %; the initiative view shows 6000000.0000, labelled allocated;
//  - REQ-S08-011 "a 1 M SAR initiative cost reduces transformation net by exactly 1 M SAR": an initiative case's
//    1000000 cash investment line is in implementationCost once and net = gross - 1000000.0000; a cost line without an
//    amount makes cost and net Unknown, never 0;
//  - REQ-S08-009: revenue uplift vs margin and cash saving vs avoided cost are separate lines (never converted);
//  - REQ-PB-076 "a CX benefit with Value n/a is excluded from SAR totals and not counted as zero": nonFinancialCount;
//  - REQ-S08-014: a benefit with an open overlap warning has its validated value on pendingOverlap, not validated;
//  - REQ-S08-016: a pending value is never in the validated line; excluded benefits are listed with their reason;
//  - the portfolio total of the organization (AUD) and 404 for an outsider.
// All data is SYNTHETIC; nothing here grants a real business or Finance approval or touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { benefitAt, cxBody, financialBody, insertInitiative, seedBenefitWorld, type BenefitWorld } from "./fixtures.ts";
import { approve, lineOf, measuredBenefit, submittedValue, totalsOf, type Body } from "./value-fixtures.ts";

let api: TestApi;
let w: World;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

const plan = async (b: BenefitWorld, benefitId: string, amount: string, periodStart = "2036-01-01") => {
  const r = await call<Body>(api.app, "POST", `${b.base}/benefits/${benefitId}/plan-values`, {
    session: b.s.bo,
    body: { valueKind: "planned", periodStart, periodEnd: "2036-12-31", amount },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
};
const newBenefit = async (b: BenefitWorld, extra: Record<string, unknown> = {}) => {
  const r = await call<Body>(api.app, "POST", `${b.base}/benefits`, { session: b.s.bo, body: financialBody(b, extra) });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as Body;
};

describe("counted once (REQ-PB-058) and the initiative view", () => {
  it("a 10 M SAR benefit allocated 60 % / 40 % to two initiatives is 10000000.0000 once; the view shows 60 %", async () => {
    const b = await seedBenefitWorld(api, w);
    const ben = await newBenefit(b);
    await plan(b, ben.id, "10000000");
    const [i1, i2] = [await insertInitiative(api.db, b), await insertInitiative(api.db, b)];
    const put = await call<Body>(api.app, "PUT", `${b.base}/benefits/${ben.id}/allocations`, {
      session: b.s.tl,
      headers: ifm(ben.version),
      body: {
        allocations: [
          { initiativeId: i1, share: "0.6" },
          { initiativeId: i2, share: "0.4" },
        ],
      },
    });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    const t = await totalsOf(api, b);
    expect([t.scope, t.scopeId, t.allocated, t.transformationIds]).toEqual([
      "transformation",
      b.transformationId,
      false,
      [b.transformationId],
    ]);
    expect(lineOf(t, "revenue_uplift", "planned")).toEqual({
      valueClass: "revenue_uplift",
      state: "planned",
      total: { status: "known", amount: "10000000.0000", currency: "SAR", reason: null },
      count: 1,
    });
    expect(t.currencies[0].gross.planned.amount).toBe("10000000.0000");
    const view = await totalsOf(api, b, `?initiativeId=${i1}`);
    expect([view.scope, view.scopeId, view.allocated]).toEqual(["initiative", i1, true]);
    expect(lineOf(view, "revenue_uplift", "planned").total.amount).toBe("6000000.0000");
    const view2 = await totalsOf(api, b, `?initiativeId=${i2}`);
    expect(lineOf(view2, "revenue_uplift", "planned").total.amount).toBe("4000000.0000");
    // An initiative of another transformation is not found.
    const other = await seedBenefitWorld(api, w);
    const foreign = await insertInitiative(api.db, other);
    expect(
      (await call(api.app, "GET", `${b.base}/benefit-totals?initiativeId=${foreign}`, { session: b.s.auditor })).status,
    ).toBe(404);
  });

  it("a parent is a roll-up: its children are summed once and the parent is listed as excluded", async () => {
    const b = await seedBenefitWorld(api, w);
    const parent = await newBenefit(b);
    const c1 = await newBenefit(b, { parentBenefitId: parent.id });
    const c2 = await newBenefit(b, { parentBenefitId: parent.id });
    await plan(b, c1.id, "100.10");
    await plan(b, c2.id, "200.20");
    const t = await totalsOf(api, b);
    expect(lineOf(t, "revenue_uplift", "planned").total.amount).toBe("300.3000");
    expect(t.excluded).toEqual([{ benefitId: parent.id, code: parent.code, reason: "parent_rollup" }]);
  });
});

describe("classes, states, n/a (REQ-S08-009, REQ-S08-016, REQ-PB-076)", () => {
  it("cash saving and avoided cost are separate lines; pending is not validated; CX is counted, never 0", async () => {
    const b = await seedBenefitWorld(api, w);
    const cash = await newBenefit(b, {
      benefitType: "cost",
      valueClass: "cash_saving",
      financialStatementLine: "Opex - care",
    });
    const avoided = await newBenefit(b, {
      benefitType: "cost",
      valueClass: "avoided_cost",
      financialStatementLine: "Opex - care",
    });
    await plan(b, cash.id, "0.1");
    await plan(b, avoided.id, "0.2");
    const margin = await newBenefit(b, { valueClass: "margin_uplift" });
    await plan(b, margin.id, "7");
    const cx = await benefitAt(api, b, "plan", cxBody(b));
    expect(cx.id).toBeDefined();
    const ben = await measuredBenefit(api, b);
    const v = await submittedValue(api, b, ben.id, "5000", { periodStart: "2036-02-01", periodEnd: "2036-02-29" });
    let t = await totalsOf(api, b);
    expect(lineOf(t, "cash_saving", "planned").total.amount).toBe("0.1000");
    expect(lineOf(t, "avoided_cost", "planned").total.amount).toBe("0.2000");
    // Revenue uplift and margin are separate lines (REQ-S08-009); gross adds the five financial classes exactly.
    expect(lineOf(t, "margin_uplift", "planned").total.amount).toBe("7.0000");
    expect(lineOf(t, "revenue_uplift", "planned").total.amount).toBe("0.0000");
    expect(t.currencies[0].gross.planned.amount).toBe("7.3000");
    expect(lineOf(t, "revenue_uplift", "submitted").total.amount).toBe("5000.0000");
    expect(lineOf(t, "revenue_uplift", "validated")).toMatchObject({ total: { amount: "0.0000" }, count: 0 });
    expect(t.nonFinancialCount).toBe(1);
    expect((t.currencies[0].lines as Body[]).some((l) => l.valueClass === "non_financial_valued")).toBe(false);
    await approve(api, b, v, "4800");
    t = await totalsOf(api, b);
    expect(lineOf(t, "revenue_uplift", "validated")).toMatchObject({ total: { amount: "4800.0000" }, count: 1 });
    expect(lineOf(t, "revenue_uplift", "submitted")).toMatchObject({ total: { amount: "0.0000" }, count: 0 });
    expect(t.currencies[0].gross.validated.amount).toBe("4800.0000");
  });
});

describe("gross, implementation cost and net (REQ-S08-011)", () => {
  it("a 1 M SAR initiative cost reduces net by exactly 1 M; a cost without an amount makes cost and net Unknown", async () => {
    const b = await seedBenefitWorld(api, w);
    const ben = await newBenefit(b);
    await plan(b, ben.id, "3000000");
    const BC = "/api/v1/business-cases";
    const top = await call<Body>(api.app, "POST", BC, {
      session: b.s.tl,
      body: { transformationId: b.transformationId, level: "transformation", title: "Synthetic transformation case" },
    });
    expect(top.status, JSON.stringify(top.body)).toBe(201);
    const ini = await insertInitiative(api.db, b);
    const iniCase = await call<Body>(api.app, "POST", BC, {
      session: b.s.tl,
      body: {
        transformationId: b.transformationId,
        level: "initiative",
        initiativeId: ini,
        title: "Synthetic initiative case",
      },
    });
    expect(iniCase.status, JSON.stringify(iniCase.body)).toBe(201);
    const line = await call<Body>(api.app, "POST", `${BC}/${iniCase.body.id}/lines`, {
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
    expect(line.status, JSON.stringify(line.body)).toBe(201);
    let t = await totalsOf(api, b);
    const c = t.currencies[0];
    expect(c.implementationCost).toEqual({
      cash: { status: "known", amount: "1000000.0000", currency: "SAR", reason: null },
      nonCash: { status: "known", amount: "0.0000", currency: "SAR", reason: null },
      total: { status: "known", amount: "1000000.0000", currency: "SAR", reason: null },
    });
    expect([c.gross.planned.amount, c.net.planned.amount, c.net.validated.amount]).toEqual([
      "3000000.0000",
      "2000000.0000",
      "-1000000.0000",
    ]);
    // The initiative view carries that initiative's own cost line.
    const view = await totalsOf(api, b, `?initiativeId=${ini}`);
    expect(view.currencies[0].implementationCost.total.amount).toBe("1000000.0000");
    // A cost line without an amount: cost and net Unknown with a reason, never 0.
    const blank = await call<Body>(api.app, "POST", `${BC}/${top.body.id}/lines`, {
      session: b.s.tl,
      body: {
        lineKind: "investment",
        class: "internal_fte",
        valueBasis: "non_cash",
        title: "Synthetic analysts",
        amount: null,
        currency: "SAR",
      },
    });
    expect(blank.status, JSON.stringify(blank.body)).toBe(201);
    t = await totalsOf(api, b);
    expect(t.currencies[0].implementationCost.nonCash).toEqual({
      status: "unknown",
      amount: null,
      currency: "SAR",
      reason: "benefit.cost_amount_missing",
    });
    expect(t.currencies[0].net.planned).toEqual({
      status: "unknown",
      amount: null,
      currency: "SAR",
      reason: "benefit.cost_amount_missing",
    });
  });
});

describe("open overlaps (REQ-S08-014) and the portfolio", () => {
  it("a validated value of a benefit with an open overlap is on pendingOverlap, not in validated", async () => {
    const b = await seedBenefitWorld(api, w);
    const keys = { driverKey: "synthetic.prepaid.churn", realizationStart: "2036-01-01", realizationEnd: "2036-12-31" };
    const one = await measuredBenefit(api, b, { extra: keys });
    const v = await submittedValue(api, b, one.id, "700", { periodStart: "2036-03-01", periodEnd: "2036-03-31" });
    await approve(api, b, v, "700");
    let t = await totalsOf(api, b);
    expect(lineOf(t, "revenue_uplift", "validated").total.amount).toBe("700.0000");
    await newBenefit(b, keys); // same driver and period -> the rule raises an open warning (KBE-D2)
    t = await totalsOf(api, b);
    expect(lineOf(t, "revenue_uplift", "validated")).toMatchObject({ total: { amount: "0.0000" }, count: 0 });
    expect(t.currencies[0].pendingOverlap).toEqual([
      {
        valueClass: "revenue_uplift",
        state: "validated",
        total: { status: "known", amount: "700.0000", currency: "SAR", reason: null },
        count: 1,
      },
    ]);
    expect(t.currencies[0].gross.validated.amount).toBe("0.0000");
  });

  it("the organization's portfolio total covers the readable transformations; an outsider gets 404", async () => {
    const b = await seedBenefitWorld(api, w);
    const ben = await newBenefit(b);
    await plan(b, ben.id, "42");
    const url = `/api/v1/organizations/${b.organizationId}/benefit-totals`;
    const r = await call<Body>(api.app, "GET", url, { session: b.s.auditor });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect([r.body.scope, r.body.scopeId, r.body.allocated]).toEqual(["organization", b.organizationId, false]);
    expect(r.body.transformationIds).toContain(b.transformationId);
    expect((await call(api.app, "GET", url, { session: b.s.outsider })).status).toBe(404);
    expect((await call(api.app, "GET", `${b.base}/benefit-totals`, { session: b.s.outsider })).status).toBe(404);
  });
});

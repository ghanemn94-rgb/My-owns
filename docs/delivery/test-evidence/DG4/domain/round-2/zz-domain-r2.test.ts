// domain-reviewer DG4 round 2 (T-DG4-REV-DOM-R2; adapted from round 1): in-process domain probe on the real API (Fastify inject) and a
// disposable PostgreSQL (the integration project's global setup). Placed ONLY in the disposable clone as
// tests/qa/integration/zz-domain-r2.test.ts; it is review evidence, not part of the candidate. SYNTHETIC data; nothing
// here is a real business or Finance approval and nothing touches DG0-DG7.
// Questions: (1) what does the totals' gross/net headline add together (revenue uplift vs margin, avoided cost vs cash,
// master prompt M0278); (2) are currencies kept apart; (3) is a CX benefit n/a (never 0) in every SAR figure.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, startApi, type TestApi } from "../support/api.ts";
import { canon, cxBody, financialBody, get200, seedBenefitWorld, seedWorld, type Body, type BenefitWorld, type World } from "../support/p4.ts";

let api: TestApi;
let w: World;
beforeAll(async () => { api = await startApi(); w = await seedWorld(api.db); }, 60_000);
afterAll(() => api?.close());

const totals = (b: BenefitWorld) => get200(api, b.s.auditor, `${b.base}/benefit-totals`);
async function newBenefit(b: BenefitWorld, extra: Record<string, unknown> = {}): Promise<Body> {
  const r = await call<Body>(api.app, "POST", `${b.base}/benefits`, { session: b.s.bo, body: financialBody(b, extra) });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
}
async function planValue(b: BenefitWorld, benefitId: string, amount: string) {
  const r = await call<Body>(api.app, "POST", `${b.base}/benefits/${benefitId}/plan-values`, {
    session: b.s.bo, body: { valueKind: "planned", periodStart: "2026-01-01", periodEnd: "2026-06-30", amount },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
}

describe("domain-reviewer DG4 R2: what the benefit totals add together", () => {
  it("DOM-GROSS: revenue uplift 300 + margin 70 + cash saving 20 + avoided cost 45 (planned) -> gross = net = 90 (D-117)", async () => {
    const b = await seedBenefitWorld(api, w);
    const rev = await newBenefit(b, { benefitType: "revenue", valueClass: "revenue_uplift" });
    const mar = await newBenefit(b, { benefitType: "revenue", valueClass: "margin_uplift" });
    const cash = await newBenefit(b, { benefitType: "cost", valueClass: "cash_saving", financialStatementLine: "Opex - care" });
    const avoided = await newBenefit(b, { benefitType: "cost", valueClass: "avoided_cost", financialStatementLine: "Opex - network" });
    await planValue(b, rev.id, "300");
    await planValue(b, mar.id, "70");
    await planValue(b, cash.id, "20");
    await planValue(b, avoided.id, "45");
    const t = await totals(b);
    const sar = (t.currencies as Body[]).find((c) => c.currency === "SAR");
    const gross = canon(sar.gross.planned.amount);
    const net = canon(sar.net.planned.amount);
    const planned = Object.fromEntries((sar.lines as Body[]).filter((l) => l.state === "planned").map((l) => [l.valueClass, canon(l.total.amount)]));
    console.log(`DOM-GROSS lines=${JSON.stringify(planned)} gross.planned=${gross} net.planned=${net} gross.validated=${JSON.stringify(sar.gross.validated)} cost=${JSON.stringify(sar.implementationCost)}`);
    expect(planned).toMatchObject({ revenue_uplift: "300", margin_uplift: "70", cash_saving: "20", avoided_cost: "45" });
    expect(gross).toBe("90");
    expect(net).toBe("90");
    // The other surfaces of the same world (recorded): the T10 Value area headline and the Finance dashboard.
    const dash = await call<Body>(api.app, "GET", `${b.base}/dashboard`, { session: b.s.auditor });
    const value = (dash.body.areas as Body[] | undefined)?.find((a) => a.areaKey === "value" || a.key === "value" || a.code === "value");
    console.log(`DOM-GROSS T10 status=${dash.status} value-area=${JSON.stringify(value ?? dash.body).slice(0, 2500)}`);
    const fin = await call<Body>(api.app, "GET", `/api/v1/dashboards/finance?organizationId=${b.organizationId}&transformationId=${b.transformationId}`, { session: b.s.auditor });
    const fl = fin.status === 200 ? (fin.body.lines as Body[]).filter((l) => l.state === "planned" || l.valueClass === "gross" || l.valueClass === "net").map((l) => [l.valueClass, l.state, l.currency, l.total?.value ?? l.total?.amount ?? l.total, l.drilldownHref]) : fin.body;
    console.log(`DOM-GROSS FINANCE status=${fin.status} lines=${JSON.stringify(fl)} headlines=${JSON.stringify(fin.body?.headlines).slice(0, 2500)}`);
  });

  it("DOM-GROSS-ONLYREV: only a revenue uplift is planned -> what gross and net show (recorded)", async () => {
    const b = await seedBenefitWorld(api, w);
    const rev = await newBenefit(b, { benefitType: "revenue", valueClass: "revenue_uplift" });
    await planValue(b, rev.id, "300");
    const t = await totals(b);
    const sar = (t.currencies as Body[]).find((c) => c.currency === "SAR");
    console.log(`DOM-GROSS-ONLYREV gross=${JSON.stringify(sar?.gross)} net=${JSON.stringify(sar?.net)} lines=${JSON.stringify(sar?.lines).slice(0, 800)}`);
    expect(sar).toBeDefined();
  });

  it("DOM-CURRENCY: a USD benefit and a SAR benefit are never summed into one block", async () => {
    const b = await seedBenefitWorld(api, w);
    const s = await newBenefit(b, {});
    const u = await call<Body>(api.app, "POST", `${b.base}/benefits`, { session: b.s.bo, body: financialBody(b, { currency: "USD", title: "Synthetic USD benefit" }) });
    console.log(`DOM-CURRENCY usd-create=${u.status} ${u.status === 201 ? "" : JSON.stringify(u.body).slice(0, 300)}`);
    await planValue(b, s.id, "100");
    if (u.status === 201) await planValue(b, u.body.id, "7");
    const t = await totals(b);
    const blocks = (t.currencies as Body[]).map((c) => [c.currency, canon(c.gross.planned.amount)]);
    console.log(`DOM-CURRENCY blocks=${JSON.stringify(blocks)}`);
    // R2: both benefits are revenue_uplift (financialBody's default), which D-117 keeps out of gross, so the check is on
    // the revenue_uplift planned line of each currency block (round 1 asserted SAR gross 100 under the old rule).
    const rev = (cur: string) => canon(((t.currencies as Body[]).find((c) => c.currency === cur)?.lines as Body[] | undefined)?.find((l) => l.valueClass === "revenue_uplift" && l.state === "planned")?.total.amount);
    console.log(`DOM-CURRENCY revenue_uplift planned SAR=${rev("SAR")} USD=${rev("USD")}`);
    expect(rev("SAR")).toBe("100");
    if (u.status === 201) expect(rev("USD")).toBe("7");
  });

  it("DOM-NA: a CX benefit without a valuation method is n/a, counted in nonFinancialCount, never 0 in a SAR figure", async () => {
    const b = await seedBenefitWorld(api, w);
    const before = await totals(b);
    const cx = await call<Body>(api.app, "POST", `${b.base}/benefits`, { session: b.s.bo, body: cxBody(b) });
    expect(cx.status, JSON.stringify(cx.body)).toBe(201);
    const after = await totals(b);
    console.log(`DOM-NA before=${JSON.stringify(before).slice(0, 300)} after=${JSON.stringify(after).slice(0, 300)}`);
    expect(after.nonFinancialCount).toBe(before.nonFinancialCount + 1);
    expect(JSON.stringify(after.currencies)).toBe(JSON.stringify(before.currencies));
  });
});

// code-security-reviewer DG4 ROUND-3 probe GC, revision 2 (adds the REPRO test; rev 1 log: probe-GC-node22-lang-unset.log) (T-DG4-REV-SEC-R3): ADR-0030 amendment N3 item 1 says "in any state and
// currency the Finance gross line and the profit-and-cash headline are the same figure". Edge case: a currency whose
// only financial benefit is revenue_uplift (top line), next to a currency with a profit-and-cash benefit.
// World: one transformation; SAR margin_uplift planned 70; USD revenue_uplift planned 11 (no USD profit-and-cash benefit).
// Prints, per currency, the Finance gross planned line, the profit-and-cash 'Planned value' headline (Finance and T10),
// and what each one's drilldownHref returns. Observational: asserts only what the code is documented to do, and logs
// the rest for the reviewer. NOT product code; disposable clone only. All data synthetic.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { financialBody, type BenefitWorld } from "../benefits/fixtures.ts";
import { areaOf, benefitWorldIn, planValue } from "../contract/p4-exercises-kbe-g.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
let api: TestApi;
let w: World;
let b: BenefitWorld;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await benefitWorldIn(api, w, w.a1);
  const mk = async (extra: Record<string, unknown>) => {
    const r = await call<Body>(api.app, "POST", `${b.base}/benefits`, { session: b.s.bo, body: financialBody(b, extra) });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.id as string;
  };
  await planValue(api, b, await mk({ valueClass: "margin_uplift", benefitType: "revenue" }), "70", "2026-01-01", "2026-06-30");
  await planValue(api, b, await mk({ valueClass: "revenue_uplift", benefitType: "revenue", currency: "USD" }), "11", "2026-01-01", "2026-06-30");
}, 300_000);
afterAll(() => api?.close());

describe("SEC-DG4-R3 probe GC: gross line vs profit-and-cash headline per currency", () => {
  it("logs gross, headline and drill-downs for SAR and USD", async () => {
    const q = `organizationId=${b.organizationId}&transformationId=${b.transformationId}`;
    const fin = (await call<Body>(api.app, "GET", `/api/v1/dashboards/finance?${q}`, { session: b.s.auditor })).body;
    const t10 = (await call<Body>(api.app, "GET", `${b.base}/dashboard`, { session: b.s.auditor })).body;
    const out: Record<string, unknown> = {};
    for (const cur of ["SAR", "USD"]) {
      const gross = fin.lines.find((l: Body) => l.valueClass === "gross" && l.state === "planned" && l.currency === cur);
      const hFin = fin.headlines.find((h: Body) => h.metric === "value.planned" && h.headlineBasis === "profit_and_cash" && h.value.currency === cur);
      const hT10 = areaOf(t10, "value").headlines.find((h: Body) => h.metric === "value.planned" && h.headlineBasis === "profit_and_cash" && h.value.currency === cur);
      const gd = gross ? (await call<Body>(api.app, "GET", gross.drilldownHref, { session: b.s.auditor })).body : null;
      out[cur] = {
        grossTotal: gross?.total ?? null,
        grossHref: gross?.drilldownHref ?? null,
        grossDrillValue: gd?.value ?? null,
        grossDrillItemCurrencies: gd ? [...new Set(gd.items.map((i: Body) => i.value?.currency))] : null,
        financeHeadline: hFin?.value ?? null,
        t10Headline: hT10?.value ?? null,
        sameHref: gross && hFin ? gross.drilldownHref === hFin.drilldownHref : null,
      };
    }
    console.log(`[probe-GC] ${JSON.stringify(out, null, 1)}`);
    const usd = out.USD as Body;
    // Documented by ADR-0037 N3 item 4: the USD profit-and-cash headline is not_applicable (no such benefit).
    expect(usd.financeHeadline.state).toBe("not_applicable");
    expect(usd.financeHeadline.reasonKey).toBe("dashboard.value.no_profit_and_cash_benefit");
  });

  // Revision 2 (fails BY DESIGN on this candidate; it is the reproduction of the finding): the drill-down of the USD
  // profit-and-cash headline (not_applicable) and of the USD gross line must not present another currency's figure.
  // Expected per the KBE-R6 handback 5.3(a) ("the gross drill-down ... is n/a no_profit_and_cash_benefit with no item")
  // and the headline-basis.test.ts invariant (an n/a headline drills to no item).
  it("REPRO: the USD n/a headline's drill-down is n/a with no item (not the SAR figure)", async () => {
    const t10 = (await call<Body>(api.app, "GET", `${b.base}/dashboard`, { session: b.s.auditor })).body;
    const h = areaOf(t10, "value").headlines.find((x: Body) => x.metric === "value.planned" && x.headlineBasis === "profit_and_cash" && x.value.currency === "USD");
    const d = (await call<Body>(api.app, "GET", h.drilldownHref, { session: b.s.auditor })).body;
    console.log(`[probe-GC REPRO] USD headline ${JSON.stringify(h.value)} -> drill value ${JSON.stringify(d.value)} items ${JSON.stringify(d.items.map((i: Body) => [i.code, i.value?.value, i.value?.currency]))}`);
    expect(d.value.currency === "SAR" && d.value.state === "value", "USD headline drills to a SAR value").toBe(false);
    expect(d.items, "an n/a headline drills to no item").toEqual([]);
  });
});

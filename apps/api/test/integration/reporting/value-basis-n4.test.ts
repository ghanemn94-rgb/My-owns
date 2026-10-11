// T-DG4-KBE-R7 (F-DG4-126, F-DG4-127; D-122, D-123; ADR-0037 and ADR-0030 amendment N4): on the real API and a
// disposable PostgreSQL,
//  - R3-6: margin 70 fully validated beside 300 of unvalidated revenue uplift (or avoided cost) is Red, never Green, on
//    T10, the workstream dashboard, the Executive Overview (its area and its row's Value status) and the Finance
//    dashboard (its headlines and its row), with one gap per basis and currency in `ruleParams.lines`;
//  - R3-8: the Portfolio initiative value is on the profit-and-cash basis (90, never 435), labelled `valueBasis`;
//  - the ranking world: profit-and-cash value first, then not_applicable (only top line or non-cash) and unknown
//    (nothing allocated) by code; the `portfolio.initiatives` drill-down carries the same values;
//  - D-123 item 3: a profit-and-cash planned line without an amount makes the initiative unknown, never omitted.
// All data is SYNTHETIC; a Finance validation here is a synthetic in-product approval of test data that approves
// nothing real, and nothing here touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, startApi, type Session, type TestApi, type World } from "../../support/harness.ts";
import { financialBody, insertInitiative, type BenefitWorld } from "../benefits/fixtures.ts";
import { approve, measuredBenefit, submittedValue } from "../benefits/value-fixtures.ts";
import { areaOf, benefitWorldIn, planValue, workstreamOf, type Body } from "../contract/p4-exercises-kbe-g.ts";
import type { KpiWorld } from "../kpi/fixtures.ts";

let api: TestApi;
let w: World;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 60_000);
afterAll(() => api?.close());

const H1 = { start: "2026-01-01", end: "2026-06-30" };

function classBody(b: BenefitWorld, valueClass: string) {
  const cost = { benefitType: "cost", financialStatementLine: "Opex - care" };
  const shape: Record<string, Record<string, unknown>> = {
    revenue_uplift: { benefitType: "revenue" },
    margin_uplift: { benefitType: "revenue" },
    cash_saving: cost,
    avoided_cost: { ...cost, financialStatementLine: "Opex - network" },
  };
  return financialBody(b, { valueClass, ...shape[valueClass] });
}
async function benefit(b: BenefitWorld, valueClass: string): Promise<string> {
  const r = await call<Body>(api.app, "POST", `${b.base}/benefits`, {
    session: b.s.bo,
    body: classBody(b, valueClass),
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id as string;
}
const get = async (url: string, session: Session) => {
  const r = await call<Body>(api.app, "GET", url, { session });
  expect(r.status, `${url} ${JSON.stringify(r.body)}`).toBe(200);
  return r.body;
};
async function allocate(b: BenefitWorld, benefitId: string, allocations: { initiativeId: string; share: string }[]) {
  const cur = await get(`${b.base}/benefits/${benefitId}`, b.s.auditor);
  const r = await call<Body>(api.app, "PUT", `${b.base}/benefits/${benefitId}/allocations`, {
    session: b.s.tl,
    headers: { "if-match": `"${cur.version}"` },
    body: { allocations },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
}
const lineOf = (l: Body) => [l.currency, l.headlineBasis, l.gapRatio, l.status, l.reasonKey];

describe("F-DG4-126 (R3-6): the Value RAG is the worst of the per-basis gaps, never a false Green", () => {
  for (const [other, basis, cls] of [
    ["revenue_uplift", "top_line", "revenue_uplift"],
    ["avoided_cost", "non_cash", "avoided_cost"],
  ] as const)
    it(`margin 70 validated 70 beside ${other} 300 unvalidated: Red on T10, workstream, Overview and Finance`, async () => {
      const b = await benefitWorldIn(api, w, w.a1);
      const m = await measuredBenefit(api, b, { extra: { valueClass: "margin_uplift" } });
      await planValue(api, b, m.id, "70", H1.start, H1.end);
      await approve(
        api,
        b,
        await submittedValue(api, b, m.id, "70", { periodStart: "2026-02-01", periodEnd: "2026-02-28" }),
        "70",
      );
      const o = await benefit(b, other);
      await planValue(api, b, o, "300", H1.start, H1.end);
      // The workstream dashboard: both benefits allocated to its one initiative.
      const ini = await insertInitiative(api.db, b, { status: "completed" });
      await allocate(b, m.id, [{ initiativeId: ini, share: "1" }]);
      await allocate(b, o, [{ initiativeId: ini, share: "1" }]);
      const ws = await workstreamOf(api.db, b as unknown as KpiWorld, b.organizationId, [ini]);
      const q = `organizationId=${b.organizationId}&transformationId=${b.transformationId}`;
      const t10 = await get(`${b.base}/dashboard`, b.s.auditor);
      const wsd = await get(`${b.base}/workstreams/${ws}/dashboard`, b.s.auditor);
      const overview = await get(`/api/v1/overview?${q}`, b.s.auditor);
      const finance = await get(`/api/v1/dashboards/finance?${q}`, b.s.auditor);
      const expectedLines = [
        ["SAR", "profit_and_cash", "0", "green", null],
        ["SAR", basis, "1", "red", null],
      ];
      for (const [where, body] of [
        ["T10", t10],
        ["workstream", wsd],
        ["overview", overview],
      ] as const) {
        const rag = areaOf(body, "value").rag;
        expect([rag.status, rag.ruleKey], where).toEqual(["red", "dashboard.rag.value.validated_gap"]);
        expect(rag.ruleParams.lines.map(lineOf), where).toEqual(expectedLines);
        expect(rag.ruleParams.headlineBasis, where).toBeUndefined();
        // The amounts are unchanged: the profit-and-cash gap is 0, the other basis's gap 1, each its own headline.
        const gaps = (areaOf(body, "value").headlines as Body[]).filter((h) => h.metric === "value.gap");
        expect(
          gaps.map((h) => [h.headlineBasis, h.value.value, h.labelKey]),
          where,
        ).toEqual([
          ["profit_and_cash", "0", "dashboard.headline.value_gap_profit_and_cash"],
          [basis, "1", `dashboard.headline.value_gap_${basis}`],
        ]);
        expect(gaps[1].drilldownHref, where).toContain(`metric=value.gap`);
        expect(gaps[1].drilldownHref, where).toContain(`valueClass=${cls}&currency=SAR`);
      }
      const statusOf = (rows: Body[]) =>
        rows.find((t) => t.transformationId === b.transformationId).areaStatuses.find((a: Body) => a.code === "value")
          .status;
      expect(statusOf(overview.transformations)).toBe("red");
      expect(statusOf(finance.transformations)).toBe("red");
      // Finance headlines carry the same per-basis gaps.
      const fgap = (finance.headlines as Body[]).filter((h) => h.metric === "value.gap");
      expect(fgap.map((h) => [h.headlineBasis, h.value.value])).toEqual([
        ["profit_and_cash", "0"],
        [basis, "1"],
      ]);
      // The basis's gap drill-down: its rule key, inputs and items are that basis's only.
      const d = await get(fgap[1].drilldownHref, b.s.auditor);
      expect([d.headlineBasis, d.value.value, d.currency, d.calculation.ruleKey]).toEqual([
        basis,
        "1",
        "SAR",
        `dashboard.value.gap_ratio_${basis}`,
      ]);
      expect(d.calculation.inputs.map((i: Body) => [i.name, i.value.value])).toEqual([
        ["planned_SAR", "300"],
        ["validated_SAR", "0"],
      ]);
      expect(d.items.map((i: Body) => i.value.value)).toEqual(["300"]);
    });
});

describe("F-DG4-127 (R3-8): the Portfolio initiative value on the profit-and-cash basis", () => {
  it("DOM-GROSS allocated 100 % to one completed initiative: 90 labelled profit_and_cash, never 435", async () => {
    const b = await benefitWorldIn(api, w, w.a1);
    const ini = await insertInitiative(api.db, b, { status: "completed" });
    for (const [c, a] of Object.entries({
      revenue_uplift: "300",
      margin_uplift: "70",
      cash_saving: "20",
      avoided_cost: "45",
    })) {
      const id = await benefit(b, c);
      await planValue(api, b, id, a, H1.start, H1.end);
      await allocate(b, id, [{ initiativeId: ini, share: "1" }]);
    }
    const dash = await get(`${b.base}/dashboard`, b.s.auditor);
    const row = (areaOf(dash, "portfolio").items as Body[]).find((i) => i.recordId === ini);
    // Was {state: value, value: "435"} with no basis.
    expect([row.value, row.valueBasis]).toEqual([
      { state: "value", value: "90", unit: "currency", currency: "SAR", reasonKey: null },
      "profit_and_cash",
    ]);
    expect(JSON.stringify(dash)).not.toMatch(/"435(\.0+)?"/);
    // The Value area's benefit items are labelled with their class's basis.
    expect((areaOf(dash, "value").items as Body[]).map((i) => i.valueBasis).sort()).toEqual([
      "non_cash",
      "profit_and_cash",
      "profit_and_cash",
      "top_line",
    ]);
    // Every other item carries valueBasis null.
    for (const a of dash.areas as Body[])
      if (a.code !== "portfolio" && a.code !== "value")
        for (const i of a.items as Body[]) expect(i.valueBasis, a.code).toBeNull();
  });

  it("the ranking world: INI-B (margin 70) first, then INI-A (revenue only, n/a) and INI-C (nothing, unknown) by code", async () => {
    const b = await benefitWorldIn(api, w, w.a1);
    const iniA = await insertInitiative(api.db, b, { status: "completed" });
    const iniB = await insertInitiative(api.db, b, { status: "completed" });
    const iniC = await insertInitiative(api.db, b, { status: "completed" });
    const rev = await benefit(b, "revenue_uplift");
    await planValue(api, b, rev, "300", H1.start, H1.end);
    await allocate(b, rev, [{ initiativeId: iniA, share: "1" }]);
    const mar = await benefit(b, "margin_uplift");
    await planValue(api, b, mar, "70", H1.start, H1.end);
    await allocate(b, mar, [{ initiativeId: iniB, share: "1" }]);
    const dash = await get(`${b.base}/dashboard`, b.s.auditor);
    const items = areaOf(dash, "portfolio").items as Body[];
    // Was INI-A (300) first, then INI-B (70), then INI-C (unknown).
    expect(
      items.map((i) => [i.recordId, i.value.state, i.value.value, i.value.reasonKey, i.value.currency, i.valueBasis]),
    ).toEqual([
      [iniB, "value", "70", null, "SAR", "profit_and_cash"],
      [iniA, "not_applicable", null, "dashboard.portfolio.no_profit_and_cash_allocation", "SAR", "profit_and_cash"],
      [iniC, "unknown", null, "dashboard.portfolio.no_allocated_value", "SAR", "profit_and_cash"],
    ]);
    // The portfolio.initiatives drill-down: the same values, on the profit-and-cash basis (its headlineBasis was null).
    const d = await get(areaOf(dash, "portfolio").headlines[0].drilldownHref, b.s.auditor);
    expect(d.headlineBasis).toBe("profit_and_cash");
    expect(d.currency).toBeNull();
    expect(d.items.map((i: Body) => [i.recordId, i.value])).toEqual(items.map((i) => [i.recordId, i.value]));
  });

  it("D-123 item 3: a profit-and-cash planned line without an amount makes the initiative unknown, never a sum omitting it", async () => {
    const b = await benefitWorldIn(api, w, w.a1);
    const ini = await insertInitiative(api.db, b, { status: "completed" });
    const mar = await benefit(b, "margin_uplift");
    await planValue(api, b, mar, "70", H1.start, H1.end);
    const cash = await benefit(b, "cash_saving");
    await planValue(api, b, cash, "20", H1.start, H1.end);
    const missing = await call<Body>(api.app, "POST", `${b.base}/benefits/${cash}/plan-values`, {
      session: b.s.bo,
      body: { valueKind: "planned", periodStart: "2026-07-01", periodEnd: "2026-07-31", amount: null, kpiValue: "12" },
    });
    expect(missing.status, JSON.stringify(missing.body)).toBe(201);
    await allocate(b, mar, [{ initiativeId: ini, share: "1" }]);
    await allocate(b, cash, [{ initiativeId: ini, share: "1" }]);
    const dash = await get(`${b.base}/dashboard`, b.s.auditor);
    const row = (areaOf(dash, "portfolio").items as Body[]).find((i) => i.recordId === ini);
    // As built it was {value, "90"}: the line without an amount was skipped.
    expect(row.value).toEqual({
      state: "unknown",
      value: null,
      unit: "currency",
      currency: "SAR",
      reasonKey: "benefit.value_amount_missing",
    });
    expect(row.valueBasis).toBe("profit_and_cash");
  });
});

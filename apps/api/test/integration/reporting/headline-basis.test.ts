// F-DG4-123 (D-119; ADR-0030 and ADR-0037 amendment N3; T-DG4-KBE-R6): the value headlines use ONE basis per figure,
// on all four surfaces (T10 = getTransformationDashboard, the Executive Overview = getExecutiveOverview, the workspace
// header = getWorkspaceHeader, the Finance dashboard = getFinanceDashboard), against a real PostgreSQL:
//  - 'Planned value', forecast, submitted, 'Validated value', the value-gap ratio and the Value RAG sum only
//    margin_uplift + cash_saving + working_capital_release per currency (headlineBasis profit_and_cash);
//  - revenue_uplift (top_line) and avoided_cost (non_cash) are headlines of their own, never added into a
//    profit-and-cash figure, with no gap or RAG;
//  - a currency with no profit-and-cash benefit shows not_applicable (dashboard.value.no_profit_and_cash_benefit) on
//    the profit-and-cash headlines, the gap and the Value RAG, never 0 or green;
//  - every value headline drills to records whose decimal sum, per currency, equals it (or both are unknown), with a
//    second currency (USD) to prove it per currency.
// The fixture is the domain reviewer's DOM-GROSS world (revenue uplift 300, margin uplift 70, cash saving 20, avoided
// cost 45 SAR, planned; nothing validated) and ARCH-R5's variants A-C (handback §7). All data is SYNTHETIC; a Finance
// validation here is a synthetic in-product business approval of test data that approves nothing real, and nothing
// here touches the engineering delivery gates DG0-DG7.
import { Decimal } from "decimal.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sumItems } from "../../../src/modules/reporting/dashboards/drilldown.ts";
import { call, seedWorld, startApi, type Session, type TestApi, type World } from "../../support/harness.ts";
import { financialBody, type BenefitWorld } from "../benefits/fixtures.ts";
import { approve, measuredBenefit, submittedValue } from "../benefits/value-fixtures.ts";
import { areaOf, benefitWorldIn, planValue, type Body } from "../contract/p4-exercises-kbe-g.ts";

let api: TestApi;
let w: World;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 60_000);
afterAll(() => api?.close());

const STATES = ["planned", "forecast", "submitted", "validated"] as const;
const H1 = { start: "2026-01-01", end: "2026-06-30" };

/** The register body of a benefit of `valueClass` (the benefit type and statement line each class needs). */
function classBody(b: BenefitWorld, valueClass: string, extra: Record<string, unknown> = {}) {
  const cost = { benefitType: "cost", financialStatementLine: "Opex - care" };
  const shape: Record<string, Record<string, unknown>> = {
    revenue_uplift: { benefitType: "revenue" },
    margin_uplift: { benefitType: "revenue" },
    cash_saving: cost,
    avoided_cost: { ...cost, financialStatementLine: "Opex - network" },
    working_capital_release: { benefitType: "working_capital", financialStatementLine: "Working capital - inventory" },
  };
  return financialBody(b, { valueClass, ...shape[valueClass], ...extra });
}
async function benefit(b: BenefitWorld, valueClass: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await call<Body>(api.app, "POST", `${b.base}/benefits`, {
    session: b.s.bo,
    body: classBody(b, valueClass, extra),
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id as string;
}
async function plan(b: BenefitWorld, id: string, kind: "planned" | "forecast", body: Record<string, unknown>) {
  const r = await call<Body>(api.app, "POST", `${b.base}/benefits/${id}/plan-values`, {
    session: b.s.bo,
    body: { valueKind: kind, periodStart: H1.start, periodEnd: H1.end, ...body },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
}
/** The DOM-GROSS world, with only the classes asked for (amounts: the reviewer's). */
async function domGross(classes: readonly string[]): Promise<BenefitWorld> {
  const amounts: Record<string, string> = {
    revenue_uplift: "300",
    margin_uplift: "70",
    cash_saving: "20",
    avoided_cost: "45",
  };
  const b = await benefitWorldIn(api, w, w.a1);
  for (const c of classes) await planValue(api, b, await benefit(b, c), amounts[c]!, H1.start, H1.end);
  return b;
}

interface Surfaces {
  readonly t10: Body;
  readonly overview: Body;
  readonly finance: Body;
  readonly header: Body;
}
const get = async (url: string, session: Session) => {
  const r = await call<Body>(api.app, "GET", url, { session });
  expect(r.status, `${url} ${JSON.stringify(r.body)}`).toBe(200);
  return r.body;
};
async function surfaces(b: BenefitWorld): Promise<Surfaces> {
  const q = `organizationId=${b.organizationId}&transformationId=${b.transformationId}`;
  return {
    t10: await get(`${b.base}/dashboard`, b.s.auditor),
    overview: await get(`/api/v1/overview?${q}`, b.s.auditor),
    finance: await get(`/api/v1/dashboards/finance?${q}`, b.s.auditor),
    header: await get(`${b.base}/summary`, b.s.auditor),
  };
}
/** The value headlines of the three dashboard surfaces (the header's are checked against T10's below). */
function valueHeadlines(s: Surfaces): [string, Body[]][] {
  return [
    ["T10", areaOf(s.t10, "value").headlines],
    ["overview", areaOf(s.overview, "value").headlines],
    ["finance", (s.finance.headlines as Body[]).filter((h) => String(h.metric).startsWith("value."))],
  ];
}
/** The headline of a metric, basis and currency (n/a profit-and-cash values carry their currency too). */
function pick(list: Body[], metric: string, basis: string | null, currency = "SAR"): Body | undefined {
  return list.find((h) => h.metric === metric && h.headlineBasis === basis && h.value.currency === currency);
}
const dec = (v: string | null) => (v === null ? null : new Decimal(v).toFixed());

/** Every drill-down page of a headline href (limit 50), the items concatenated. */
async function drillAll(href: string, session: Session): Promise<{ first: Body; items: Body[] }> {
  let url: string | null = `${href}&limit=50`;
  let first: Body | null = null;
  const items: Body[] = [];
  while (url !== null) {
    const page = await get(url, session);
    first ??= page;
    items.push(...(page.items as Body[]));
    url = page.nextCursor === null ? null : `${href}&limit=50&cursor=${page.nextCursor}`;
  }
  return { first: first!, items };
}

/** The `currency` an href names (ADR-0037 amendment N4 item 3), or null. */
const hrefCurrency = (href: string): string | null => new URLSearchParams(href.split("?")[1]).get("currency");

/**
 * ADR-0037 N3 item 3 / K1 item 4, sharpened by N4 item 3 (T-DG4-KBE-R7): every value headline's href names its
 * currency; the drill-down echoes it, lists only items in it and its value is the headline's figure; per currency, the
 * decimal sum of a value-state headline's drill-down items equals its value, or both are unknown, and an n/a headline
 * drills to no item; the drill-down's basis is the headline's. The gap headlines (one per basis) are checked for the
 * currency, the value and the basis. Returns the number of value-state headlines checked.
 */
async function assertDrillInvariant(list: Body[], session: Session, where: string): Promise<number> {
  let n = 0;
  for (const h of list) {
    if (h.headlineBasis === null) continue;
    const { first, items } = await drillAll(h.drilldownHref, session);
    const label = `${where} ${h.metric} ${h.headlineBasis} ${h.value.currency} ${h.drilldownHref}`;
    const currency = hrefCurrency(h.drilldownHref);
    expect(currency, label).not.toBeNull();
    if (h.value.currency !== null) expect(currency, label).toBe(h.value.currency);
    expect(first.currency, label).toBe(currency);
    expect(first.value, label).toEqual(h.value);
    expect(
      items.filter((i) => i.value?.currency !== currency),
      label,
    ).toEqual([]);
    expect(first.headlineBasis, label).toBe(h.headlineBasis);
    if (h.metric === "value.gap") continue;
    const sum = sumItems(items, h.value.currency);
    if (h.value.state === "unknown") expect(sum, label).toBeNull();
    else if (h.value.state === "not_applicable") {
      expect(sum, label).toBe("0");
      expect(items, label).toEqual([]);
    } else expect(dec(sum), label).toBe(dec(h.value.value));
    n += 1;
  }
  return n;
}

describe("F-DG4-123: the value headlines on one basis (DOM-GROSS world)", () => {
  it("profit-and-cash planned 90, revenue uplift 300, avoided cost 45, gap 1 and Red, on all four surfaces; 435 nowhere", async () => {
    const b = await domGross(["revenue_uplift", "margin_uplift", "cash_saving", "avoided_cost"]);
    const s = await surfaces(b);
    for (const [where, list] of valueHeadlines(s)) {
      // The reviewer's reproduction, read as a client reads it (the first SAR 'Planned value'): 90, not 435.
      const first = list.find((h) => h.metric === "value.planned" && h.value.currency === "SAR");
      expect(dec(first.value.value), `${where} first SAR value.planned`).toBe("90");
      const v = (m: string, basis: string) => pick(list, m, basis)?.value;
      expect(dec(v("value.planned", "profit_and_cash")!.value), where).toBe("90");
      expect(v("value.validated", "profit_and_cash"), where).toMatchObject({ state: "zero", currency: "SAR" });
      expect(v("value.forecast", "profit_and_cash")?.state, where).toBe("zero");
      expect(v("value.submitted", "profit_and_cash")?.state, where).toBe("zero");
      expect(dec(v("value.planned", "top_line")!.value), where).toBe("300");
      expect(dec(v("value.planned", "non_cash")!.value), where).toBe("45");
      for (const st of ["forecast", "submitted", "validated"]) {
        expect(v(`value.${st}`, "top_line")?.state, `${where} ${st}`).toBe("zero");
        expect(v(`value.${st}`, "non_cash")?.state, `${where} ${st}`).toBe("zero");
      }
      const gap = pick(list, "value.gap", "profit_and_cash");
      expect(gap?.value, where).toMatchObject({ state: "value", unit: "ratio", currency: "SAR" });
      expect(dec(gap!.value.value), where).toBe("1");
      // T-DG4-KBE-R7 (ADR-0037 amendment N4 item 1): one gap per basis (was 1: profit-and-cash only), never summed.
      expect(list.filter((h) => h.metric === "value.gap").length, where).toBe(3);
      for (const [basis, cls] of [
        ["top_line", "revenue_uplift"],
        ["non_cash", "avoided_cost"],
      ] as const) {
        const g = pick(list, "value.gap", basis)!;
        expect([g.value.state, dec(g.value.value), g.value.unit, g.value.currency], `${where} ${basis}`).toEqual([
          "value",
          "1",
          "ratio",
          "SAR",
        ]);
        expect(g.labelKey).toBe(`dashboard.headline.value_gap_${basis}`);
        expect(g.drilldownHref).toContain(`valueClass=${cls}&currency=SAR`);
      }
      // Labels name the basis; the retired A2 keys are no longer sent.
      expect(pick(list, "value.planned", "profit_and_cash")?.labelKey).toBe(
        "dashboard.headline.value_planned_profit_and_cash",
      );
      expect(pick(list, "value.planned", "top_line")?.labelKey).toBe("dashboard.headline.value_planned_top_line");
      expect(pick(list, "value.planned", "non_cash")?.labelKey).toBe("dashboard.headline.value_planned_non_cash");
      expect(gap?.labelKey).toBe("dashboard.headline.value_gap_profit_and_cash");
      for (const k of ["planned", "forecast", "submitted", "validated", "gap"])
        expect(
          list.some((h) => h.labelKey === `dashboard.headline.value_${k}`),
          `${where} ${k}`,
        ).toBe(false);
      // Hrefs: profit_and_cash without valueClass; top_line and non_cash with their class.
      expect(pick(list, "value.planned", "profit_and_cash")!.drilldownHref).not.toContain("valueClass");
      expect(pick(list, "value.planned", "top_line")!.drilldownHref).toContain("valueClass=revenue_uplift");
      expect(pick(list, "value.planned", "non_cash")!.drilldownHref).toContain("valueClass=avoided_cost");
      // Order per currency: each basis's states then its gap (N4: the top-line and non-cash gaps are new).
      expect(list.map((h) => `${h.metric}/${h.headlineBasis}`)).toEqual([
        ...STATES.map((st) => `value.${st}/profit_and_cash`),
        "value.gap/profit_and_cash",
        ...STATES.map((st) => `value.${st}/top_line`),
        "value.gap/top_line",
        ...STATES.map((st) => `value.${st}/non_cash`),
        "value.gap/non_cash",
      ]);
    }
    // The Value RAG: Red on the profit-and-cash gap (default policy amber 0.05, red 0.15).
    for (const body of [s.t10, s.overview]) {
      const rag = areaOf(body, "value").rag;
      expect(rag).toMatchObject({ status: "red", ruleKey: "dashboard.rag.value.validated_gap" });
      // T-DG4-KBE-R7 (N4 item 1): no top-level headlineBasis (was "profit_and_cash"); a line per basis and currency.
      expect(rag.ruleParams.headlineBasis).toBeUndefined();
      expect(rag.ruleParams.lines.map((l: Body) => [l.currency, l.headlineBasis, l.gapRatio, l.status])).toEqual([
        ["SAR", "profit_and_cash", "1", "red"],
        ["SAR", "top_line", "1", "red"],
        ["SAR", "non_cash", "1", "red"],
      ]);
    }
    const row = (s.overview.transformations as Body[]).find((t) => t.transformationId === b.transformationId);
    expect(row.areaStatuses.find((a: Body) => a.code === "value").status).toBe("red");
    // Finance: gross planned 90 = the profit-and-cash headline, and it always drills (no valueClass).
    const gross = (s.finance.lines as Body[]).find(
      (l) => l.valueClass === "gross" && l.state === "planned" && l.currency === "SAR",
    );
    expect(dec(gross.total.value)).toBe("90");
    expect(gross.drilldownHref).toBe(pick(s.finance.headlines, "value.planned", "profit_and_cash")!.drilldownHref);
    // The header: profit-and-cash 90, with the top-line and non-cash figures beside it.
    expect(s.header.benefits.planned).toHaveLength(1);
    expect(dec(s.header.benefits.planned[0].value.value)).toBe("90");
    expect(s.header.benefits.validated[0].value.state).toBe("zero");
    expect(dec(pick(s.header.benefits.headlines, "value.planned", "top_line")!.value.value)).toBe("300");
    expect(dec(pick(s.header.benefits.headlines, "value.planned", "non_cash")!.value.value)).toBe("45");
    // 435 (= 300 + 70 + 20 + 45) appears in no figure of any surface.
    for (const body of [s.t10, s.overview, s.finance, s.header])
      expect(JSON.stringify(body)).not.toMatch(/"435(\.0+)?"/);
    // Every headline drills to records summing to it.
    for (const [where, list] of valueHeadlines(s)) await assertDrillInvariant(list, b.s.auditor, where);
    await assertDrillInvariant(s.header.benefits.headlines, b.s.auditor, "header");
  });

  it("the header's headlines are the T10 planned and validated headlines of the three bases, hrefs included", async () => {
    const b = await domGross(["revenue_uplift", "margin_uplift", "cash_saving", "avoided_cost"]);
    const s = await surfaces(b);
    const t10 = (areaOf(s.t10, "value").headlines as Body[]).filter(
      (h) => (h.metric === "value.planned" || h.metric === "value.validated") && h.headlineBasis !== null,
    );
    expect(s.header.benefits.headlines).toEqual(t10);
    expect(s.header.benefits.headlines.map((h: Body) => `${h.metric}/${h.headlineBasis}`)).toEqual([
      "value.planned/profit_and_cash",
      "value.validated/profit_and_cash",
      "value.planned/top_line",
      "value.validated/top_line",
      "value.planned/non_cash",
      "value.validated/non_cash",
    ]);
    // Every non-value headline carries headlineBasis null; value.investment too.
    for (const a of s.t10.areas as Body[])
      for (const h of a.headlines as Body[])
        if (!String(h.metric).startsWith("value.") || h.metric === "value.investment")
          expect(h.headlineBasis, `${a.code} ${h.metric}`).toBeNull();
    const pending = (s.finance.headlines as Body[]).find((h) => h.metric === "finance.pending_validation");
    expect(pending.headlineBasis).toBeNull();
  });

  it("variant A: only revenue uplift and avoided cost -> profit-and-cash n/a (never 0 or green), 300 and 45 still shown", async () => {
    const b = await domGross(["revenue_uplift", "avoided_cost"]);
    const s = await surfaces(b);
    const NA = { state: "not_applicable", value: null, reasonKey: "dashboard.value.no_profit_and_cash_benefit" };
    for (const [where, list] of valueHeadlines(s)) {
      for (const st of STATES)
        expect(pick(list, `value.${st}`, "profit_and_cash")?.value, `${where} ${st}`).toMatchObject(NA);
      expect(pick(list, "value.gap", "profit_and_cash")?.value, where).toMatchObject(NA);
      expect(dec(pick(list, "value.planned", "top_line")!.value.value), where).toBe("300");
      expect(dec(pick(list, "value.planned", "non_cash")!.value.value), where).toBe("45");
      expect(list.some((h) => h.headlineBasis === "profit_and_cash" && ["value", "zero"].includes(h.value.state))).toBe(
        false,
      );
      await assertDrillInvariant(list, b.s.auditor, where);
    }
    // T-DG4-KBE-R7 (N4 item 1; D-123 item 1): was {not_applicable, dashboard.rag.value.no_profit_and_cash_benefit}
    // and the row n/a; the top-line and non-cash gaps (300 and 45 due, nothing validated) now decide the status.
    for (const body of [s.t10, s.overview]) {
      expect(areaOf(body, "value").rag).toMatchObject({ status: "red", ruleKey: "dashboard.rag.value.validated_gap" });
      expect(areaOf(body, "value").rag.ruleParams.lines.map((l: Body) => l.headlineBasis)).toEqual([
        "top_line",
        "non_cash",
      ]);
    }
    const row = (s.overview.transformations as Body[]).find((t) => t.transformationId === b.transformationId);
    expect(row.areaStatuses.find((a: Body) => a.code === "value").status).toBe("red");
    expect(s.header.benefits.planned).toEqual([{ currency: "SAR", value: expect.objectContaining(NA) }]);
    expect(s.header.benefits.validated).toEqual([{ currency: "SAR", value: expect.objectContaining(NA) }]);
    // The profit-and-cash drill-down is n/a with the same reason, never a fabricated 0.
    const drill = await get(
      pick(areaOf(s.t10, "value").headlines, "value.planned", "profit_and_cash")!.drilldownHref,
      b.s.auditor,
    );
    expect(drill.value).toMatchObject({
      state: "not_applicable",
      reasonKey: "dashboard.value.no_profit_and_cash_benefit",
    });
    expect(drill.calculation.ruleKey).toBe("dashboard.value.sum_planned_profit_and_cash");
  });

  it("variant B: a margin benefit whose only line is outside the window -> profit-and-cash planned is a known zero, gap n/a nothing_planned", async () => {
    const b = await benefitWorldIn(api, w, w.a1);
    await planValue(api, b, await benefit(b, "margin_uplift"), "70", "2027-01-01", "2027-03-31");
    await planValue(api, b, await benefit(b, "revenue_uplift"), "300", H1.start, H1.end);
    const s = await surfaces(b);
    for (const [where, list] of valueHeadlines(s)) {
      expect(pick(list, "value.planned", "profit_and_cash")?.value, where).toMatchObject({
        state: "zero",
        currency: "SAR",
      });
      expect(list.find((h) => h.metric === "value.gap")?.value, where).toMatchObject({
        state: "not_applicable",
        reasonKey: "dashboard.value.nothing_planned",
      });
      expect(dec(pick(list, "value.planned", "top_line")!.value.value), where).toBe("300");
      expect(pick(list, "value.planned", "non_cash"), where).toBeUndefined();
      await assertDrillInvariant(list, b.s.auditor, where);
    }
    // T-DG4-KBE-R7 (N4 item 1): was {not_applicable, nothing_due}; the top-line gap (300 due, none validated) is red.
    expect(areaOf(s.t10, "value").rag).toMatchObject({
      status: "red",
      ruleKey: "dashboard.rag.value.validated_gap",
    });
    expect(
      areaOf(s.t10, "value").rag.ruleParams.lines.map((l: Body) => [l.headlineBasis, l.status, l.reasonKey]),
    ).toEqual([
      ["profit_and_cash", "not_applicable", "dashboard.value.nothing_planned"],
      ["top_line", "red", null],
    ]);
  });

  it("variant C: a revenue line without an amount makes only the top-line headline unknown", async () => {
    const b = await benefitWorldIn(api, w, w.a1);
    const rev = await benefit(b, "revenue_uplift");
    await plan(b, rev, "planned", { amount: null, kpiValue: "12" });
    await planValue(api, b, await benefit(b, "margin_uplift"), "70", H1.start, H1.end);
    const s = await surfaces(b);
    for (const [where, list] of valueHeadlines(s)) {
      expect(pick(list, "value.planned", "top_line")?.value, where).toMatchObject({
        state: "unknown",
        reasonKey: "benefit.value_amount_missing",
      });
      expect(dec(pick(list, "value.planned", "profit_and_cash")!.value.value), where).toBe("70");
      expect(dec(pick(list, "value.gap", "profit_and_cash")!.value.value), where).toBe("1");
      await assertDrillInvariant(list, b.s.auditor, where);
    }
    expect(areaOf(s.t10, "value").rag.status).toBe("red");
  });

  it("drill invariant per currency (SAR and USD), in every state, on all four surfaces", async () => {
    const b = await benefitWorldIn(api, w, w.a1);
    // SAR: margin 70 planned, 10 forecast, 30 validated; cash saving 20 planned and 5 submitted (not validated);
    // working capital 2.5 planned; revenue 300 planned and 40 forecast; avoided cost 45 planned.
    const m = await measuredBenefit(api, b, { extra: { valueClass: "margin_uplift" } });
    await planValue(api, b, m.id, "70", H1.start, H1.end);
    await plan(b, m.id, "forecast", { amount: "10", periodStart: "2026-11-01", periodEnd: "2026-11-30" });
    await approve(
      api,
      b,
      await submittedValue(api, b, m.id, "30", { periodStart: "2026-02-01", periodEnd: "2026-02-28" }),
      "30",
    );
    const cash = await measuredBenefit(api, b, {
      extra: { valueClass: "cash_saving", benefitType: "cost", financialStatementLine: "Opex - care" },
    });
    await planValue(api, b, cash.id, "20", H1.start, H1.end);
    await submittedValue(api, b, cash.id, "5", { periodStart: "2026-03-01", periodEnd: "2026-03-31" });
    await planValue(api, b, await benefit(b, "working_capital_release"), "2.5", H1.start, H1.end);
    const rev = await benefit(b, "revenue_uplift");
    await planValue(api, b, rev, "300", H1.start, H1.end);
    await plan(b, rev, "forecast", { amount: "40", periodStart: "2026-11-01", periodEnd: "2026-11-30" });
    await planValue(api, b, await benefit(b, "avoided_cost"), "45", H1.start, H1.end);
    // USD: margin 7 and revenue 11 planned (currencies are never added together).
    await planValue(api, b, await benefit(b, "margin_uplift", { currency: "USD" }), "7", H1.start, H1.end);
    await planValue(api, b, await benefit(b, "revenue_uplift", { currency: "USD" }), "11", H1.start, H1.end);
    const s = await surfaces(b);
    const expected: Record<string, Record<string, string>> = {
      "SAR/profit_and_cash": { planned: "92.5", forecast: "10", submitted: "5", validated: "30" },
      "SAR/top_line": { planned: "300", forecast: "40", submitted: "0", validated: "0" },
      "SAR/non_cash": { planned: "45", forecast: "0", submitted: "0", validated: "0" },
      "USD/profit_and_cash": { planned: "7", forecast: "0", submitted: "0", validated: "0" },
      "USD/top_line": { planned: "11", forecast: "0", submitted: "0", validated: "0" },
    };
    let checked = 0;
    for (const [where, list] of valueHeadlines(s)) {
      for (const [key, states] of Object.entries(expected)) {
        const [currency, basis] = key.split("/") as [string, string];
        for (const st of STATES)
          expect(dec(pick(list, `value.${st}`, basis, currency)?.value.value ?? null), `${where} ${key} ${st}`).toBe(
            states[st],
          );
      }
      expect(pick(list, "value.planned", "non_cash", "USD"), where).toBeUndefined();
      expect(dec(pick(list, "value.gap", "profit_and_cash", "SAR")!.value.value)).toBe(
        new Decimal("92.5").minus(30).dividedBy("92.5").toDecimalPlaces(6, Decimal.ROUND_HALF_EVEN).toFixed(),
      );
      expect(pick(list, "value.gap", "profit_and_cash", "USD")!.value.value).toBe("1");
      checked += await assertDrillInvariant(list, b.s.auditor, where);
      // The profit-and-cash gap drill-down lists only margin, cash saving and working-capital lines.
      const gap = await drillAll(pick(list, "value.gap", "profit_and_cash", "SAR")!.drilldownHref, b.s.auditor);
      expect(gap.first.headlineBasis).toBe("profit_and_cash");
      expect(gap.items.some((i) => /\(planned\)|\(validated\)/.test(i.label))).toBe(true);
      expect(gap.items.map((i) => i.value.value).filter((v) => ["300", "45", "11"].includes(dec(v)!))).toEqual([]);
    }
    // 3 surfaces × (SAR 3 bases + USD 2 bases) × 4 states.
    expect(checked).toBe(3 * 5 * 4);
    checked = await assertDrillInvariant(s.header.benefits.headlines, b.s.auditor, "header");
    expect(checked).toBe(5 * 2);
    // Finance: per state and currency, gross total = the profit-and-cash headline = its drill-down's sum.
    for (const currency of ["SAR", "USD"])
      for (const st of ["planned", "validated"] as const) {
        const g = (s.finance.lines as Body[]).find(
          (l) => l.valueClass === "gross" && l.state === st && l.currency === currency,
        );
        const h = pick(s.finance.headlines, `value.${st}`, "profit_and_cash", currency)!;
        expect(dec(g.total.value), `${currency} ${st}`).toBe(dec(h.value.value));
        expect(g.drilldownHref).toBe(h.drilldownHref);
        const { items } = await drillAll(g.drilldownHref, b.s.auditor);
        expect(dec(sumItems(items, currency))).toBe(dec(g.total.value));
      }
    // The header's per-currency figures are the profit-and-cash headlines.
    expect(s.header.benefits.planned.map((c: Body) => [c.currency, dec(c.value.value)])).toEqual([
      ["SAR", "92.5"],
      ["USD", "7"],
    ]);
  });

  it("a drill-down's headlineBasis follows its class: profit_and_cash, top_line, non_cash or null", async () => {
    const b = await domGross(["revenue_uplift", "margin_uplift"]);
    const base = `/api/v1/dashboard-drilldown?organizationId=${b.organizationId}&transformationId=${b.transformationId}`;
    const basis = async (q: string) => (await get(`${base}&${q}`, b.s.auditor)).headlineBasis;
    expect(await basis("metric=value.planned")).toBe("profit_and_cash");
    expect(await basis("metric=value.measured")).toBe("profit_and_cash");
    for (const c of ["margin_uplift", "cash_saving", "working_capital_release"])
      expect(await basis(`metric=value.planned&valueClass=${c}`), c).toBe("profit_and_cash");
    expect(await basis("metric=value.planned&valueClass=revenue_uplift")).toBe("top_line");
    expect(await basis("metric=value.planned&valueClass=avoided_cost")).toBe("non_cash");
    expect(await basis("metric=value.planned&valueClass=non_financial_valued")).toBeNull();
    expect(await basis("metric=value.gap")).toBe("profit_and_cash");
    expect(await basis("metric=value.investment")).toBeNull();
    expect(await basis("metric=outcomes.area")).toBeNull();
    // Without valueClass the planned drill-down sums margin only (70), never margin + revenue (370).
    const d = await get(`${base}&metric=value.planned`, b.s.auditor);
    expect(dec(d.value.value)).toBe("70");
    expect(d.calculation.ruleKey).toBe("dashboard.value.sum_planned_profit_and_cash");
    const k = await get(`${base}&metric=value.planned&valueClass=revenue_uplift`, b.s.auditor);
    expect(k.calculation.ruleKey).toBe("dashboard.value.sum_planned");
  });

  it("F-DG4-105 (probe GC): USD with no profit-and-cash benefit beside SAR with one: every figure drills to its own currency only", async () => {
    // T-DG4-KBE-R7 (ADR-0037 amendment N4 item 3): SAR margin 70 and USD revenue uplift 11 planned, nothing validated.
    const b = await benefitWorldIn(api, w, w.a1);
    await planValue(api, b, await benefit(b, "margin_uplift"), "70", H1.start, H1.end);
    await planValue(api, b, await benefit(b, "revenue_uplift", { currency: "USD" }), "11", H1.start, H1.end);
    const s = await surfaces(b);
    const usdNa = {
      state: "not_applicable",
      value: null,
      unit: "currency",
      currency: "USD",
      reasonKey: "dashboard.value.no_profit_and_cash_benefit",
    };
    for (const [where, list] of [...valueHeadlines(s), ["header", s.header.benefits.headlines as Body[]] as const]) {
      const usd = pick(list, "value.planned", "profit_and_cash", "USD")!;
      expect(usd.value, where).toEqual(usdNa);
      expect(hrefCurrency(usd.drilldownHref), where).toBe("USD");
      const d = await get(usd.drilldownHref, b.s.auditor);
      // Before T-DG4-KBE-R7 this drilled to {value, "70", SAR} with the SAR item B01 (the finding's reproduction).
      expect([d.value, d.items, d.currency, d.calculation.inputs], where).toEqual([usdNa, [], "USD", []]);
      const sar = await get(pick(list, "value.planned", "profit_and_cash", "SAR")!.drilldownHref, b.s.auditor);
      expect([dec(sar.value.value), sar.value.currency, sar.currency, sar.items.length], where).toEqual([
        "70",
        "SAR",
        "SAR",
        1,
      ]);
      const top = await get(pick(list, "value.planned", "top_line", "USD")!.drilldownHref, b.s.auditor);
      expect([dec(top.value.value), top.value.currency, top.items.length], where).toEqual(["11", "USD", 1]);
      await assertDrillInvariant(list, b.s.auditor, where);
    }
    // The Value RAG (F-DG4-126): SAR profit and cash 1 red, USD top line 1 red.
    for (const body of [s.t10, s.overview])
      expect(
        areaOf(body, "value").rag.ruleParams.lines.map((l: Body) => [l.currency, l.headlineBasis, l.status]),
      ).toEqual([
        ["SAR", "profit_and_cash", "red"],
        ["USD", "top_line", "red"],
      ]);
    // Every Finance line with an href: it names the line's currency; the drill-down echoes it, lists only its items,
    // and their decimal sum is the line's total (or both unknown). The one exception (N4 item 3): the USD gross line, a
    // known zero beside the n/a profit-and-cash headline, drills to that n/a with no item, whose sum (0) is its total.
    let lines = 0;
    for (const l of s.finance.lines as Body[]) {
      if (l.drilldownHref === null) {
        expect(l.valueClass, JSON.stringify(l)).toBe("net");
        continue;
      }
      const label = `${l.valueClass} ${l.state} ${l.currency}`;
      expect(hrefCurrency(l.drilldownHref), label).toBe(l.currency);
      const { first, items } = await drillAll(l.drilldownHref, b.s.auditor);
      expect(first.currency, label).toBe(l.currency);
      expect(
        items.filter((i) => i.value?.currency !== l.currency),
        label,
      ).toEqual([]);
      if (l.total.state === "unknown") expect(sumItems(items, l.currency), label).toBeNull();
      else expect(dec(sumItems(items, l.currency)), label).toBe(dec(l.total.value));
      if (l.valueClass === "gross" && l.currency === "USD") {
        expect(l.total, label).toMatchObject({ state: "zero", currency: "USD" });
        expect([first.value, items], label).toEqual([{ ...usdNa }, []]);
        expect(l.drilldownHref, label).toBe(
          pick(s.finance.headlines, `value.${l.state}`, "profit_and_cash", "USD")!.drilldownHref,
        );
      } else if (l.total.state !== "unknown") expect(first.value, label).toEqual(l.total);
      lines += 1;
    }
    // SAR: margin_uplift × 7 states + gross × 2; USD: revenue_uplift × 7 + gross × 2.
    expect(lines).toBe(18);
    // Without `currency` the scope's two value currencies make the drill-down's own value n/a (it was SAR 70).
    const base = `/api/v1/dashboard-drilldown?organizationId=${b.organizationId}&transformationId=${b.transformationId}`;
    const all = await get(`${base}&metric=value.planned`, b.s.auditor);
    expect([all.value.state, all.value.reasonKey, all.currency]).toEqual([
      "not_applicable",
      "dashboard.value.multiple_currencies",
      null,
    ]);
    expect(all.items.map((i: Body) => i.value.currency)).toEqual(["SAR"]);
    // A currency holding no benefit of the class asked for: n/a no_benefit_in_class, no item.
    const cls = await get(`${base}&metric=value.planned&valueClass=margin_uplift&currency=USD`, b.s.auditor);
    expect([cls.value, cls.items]).toEqual([
      {
        state: "not_applicable",
        value: null,
        unit: "currency",
        currency: "USD",
        reasonKey: "dashboard.value.no_benefit_in_class",
      },
      [],
    ]);
    // A currency holding no financial benefit at all: n/a no_financial_benefit in that currency.
    const eur = await get(`${base}&metric=value.planned&currency=EUR`, b.s.auditor);
    expect([eur.value.reasonKey, eur.value.currency, eur.items]).toEqual([
      "dashboard.value.no_financial_benefit",
      "EUR",
      [],
    ]);
  });
});

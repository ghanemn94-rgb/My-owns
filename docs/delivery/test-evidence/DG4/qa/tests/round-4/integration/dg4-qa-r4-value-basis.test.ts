// qa-verifier DG4 round 4 (T-DG4-REV-QA-R4): independent acceptance-side probes of the round-3 repairs (F-DG4-126,
// F-DG4-127, F-DG4-105; D-122, D-123; ADR-0037 amendments N4 and N5) beyond the candidate's own tests. This file lives
// OUTSIDE the frozen candidate (docs/delivery/test-evidence/DG4/qa/tests/round-4/) and is copied into a disposable
// clone's tests/qa/integration/ only to run, then removed. Every request goes through the QA `call`, which validates
// the response against docs/api/openapi.yaml.
//
//  Q1 (F-DG4-126, lines beside a Red): margin 70 planned AND validated 70, revenue uplift 300 planned unvalidated, and
//     avoided cost 45 planned only in 2099 (nothing due on the non-cash basis): Red on T10, the Overview (area and row)
//     and Finance (row); ruleParams.lines = SAR profit_and_cash 0 green, SAR top_line 1 red, SAR non_cash null
//     not_applicable (dashboard.value.nothing_planned); the not_applicable line takes no part; the non-cash gap headline
//     is not_applicable with currency null; never green.
//  Q2 (F-DG4-126, Unknown never green): margin 70 planned and validated 70 (gap 0, green) beside a revenue-uplift
//     planned line WITHOUT an amount: the top-line gap is unknown and the Value RAG is unknown, never green.
//  Q3 (F-DG4-105, the K1/N4 invariant swept): SAR margin 70 + cash 20, SAR revenue 300, USD revenue 11, EUR margin 5,
//     all planned in 2026-H1. EVERY value headline (T10, Overview, Finance headlines), every Finance line with an href
//     and every header benefits headline names its currency; following it gives a drill-down whose `currency` echoes
//     it, whose items are all in it, whose `value` equals the figure, and whose items sum to it (sum metrics), with
//     the one ADR exception (a known-zero gross line in a currency without profit-and-cash drills to not_applicable).
//  Q4 (F-DG4-105 negatives): currency=sar / SARX -> 400; currency with outcomes.area, portfolio.initiatives,
//     decisions.overdue -> 422 dashboard.currency_not_applicable; value.planned without currency in a 3-currency scope
//     -> not_applicable dashboard.value.multiple_currencies with items in each currency; subjectId of a SAR benefit
//     with currency=USD -> not_applicable, currency USD, no item; a cursor minted with currency=SAR replayed with
//     currency=USD is refused; a user without a grant gets no figure.
//  Q5 (F-DG4-127, decimals and currency): a completed initiative allocated 50 % of margin 70.5 (SAR) and 100 % of a USD
//     margin 1000 benefit of the SAR transformation: value SAR 35.25 (the USD benefit is not in the transformation's
//     currency, so never added), labelled profit_and_cash; never 1035.25.
//  Q6 (N5): every money, gap and count value in the Q3 bodies carries kpiUnit null.
// All data is SYNTHETIC; a Finance approval here is a synthetic in-product approval of test data. No product gate
// (G1-G6) is decided, and nothing here relates to the engineering gates DG0-DG7.
import { FORMULA_DECIMAL as Decimal } from "../../../packages/shared/src/formula/index.ts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, signIn, type Session, type TestApi, startApi } from "../support/api.ts";
import { financialBody, insertInitiative, seedWorld, type Body, type BenefitWorld, type World } from "../support/p4.ts";
import {
  areaOf,
  benefitWorldIn,
  planValue,
  validatedBenefit,
} from "../../../apps/api/test/integration/contract/p4-exercises-kbe-g.ts";

let api: TestApi;
let w: World;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 120_000);
afterAll(() => api?.close());

const H1 = { start: "2026-01-01", end: "2026-06-30" };
const get = async (url: string, session: Session) => {
  const r = await call<Body>(api.app, "GET", url, { session });
  expect(r.status, `${url} ${JSON.stringify(r.body).slice(0, 400)}`).toBe(200);
  return r.body;
};
const dec = (v: string | null | undefined) => (v === null || v === undefined ? null : new Decimal(v).toFixed());
function shape(valueClass: string) {
  const cost = { benefitType: "cost", financialStatementLine: "Opex - care" };
  const m: Record<string, Record<string, unknown>> = {
    revenue_uplift: { benefitType: "revenue", financialStatementLine: "Revenue - roaming" },
    margin_uplift: { benefitType: "revenue", financialStatementLine: "Gross margin - roaming" },
    cash_saving: cost,
    avoided_cost: { ...cost, financialStatementLine: "Opex - network" },
  };
  return m[valueClass]!;
}
async function benefit(b: BenefitWorld, valueClass: string, currency = "SAR"): Promise<string> {
  const r = await call<Body>(api.app, "POST", `${b.base}/benefits`, {
    session: b.s.bo,
    body: financialBody(b, { valueClass, currency, title: `Synthetic QA-R4 ${valueClass} ${currency}`, ...shape(valueClass) }),
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id as string;
}
async function allocate(b: BenefitWorld, benefitId: string, allocations: { initiativeId: string; share: string }[]) {
  const cur = await get(`${b.base}/benefits/${benefitId}`, b.s.auditor);
  const r = await call<Body>(api.app, "PUT", `${b.base}/benefits/${benefitId}/allocations`, {
    session: b.s.tl,
    headers: { "if-match": `"${cur.version}"` },
    body: { allocations },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
}
const q = (b: BenefitWorld) => `organizationId=${b.organizationId}&transformationId=${b.transformationId}`;
const lineOf = (l: Body) => [l.currency, l.headlineBasis, dec(l.gapRatio), l.status, l.reasonKey];
const rowStatus = (rows: Body[], tid: string) =>
  rows.find((t) => t.transformationId === tid).areaStatuses.find((a: Body) => a.code === "value").status;

/** All pages of a drill-down (limit 100). */
async function drillAll(href: string, session: Session): Promise<{ first: Body; items: Body[] }> {
  const first = await get(`${href}&limit=100`, session);
  const items: Body[] = [...first.items];
  let cursor = first.nextCursor as string | null;
  while (cursor) {
    const page = await get(`${href}&limit=100&cursor=${encodeURIComponent(cursor)}`, session);
    items.push(...page.items);
    cursor = page.nextCursor;
  }
  return { first, items };
}

describe("Q1 F-DG4-126: Red beside a not_applicable (nothing due) line; the n/a line takes no part", () => {
  it("margin 70 validated, revenue 300 unvalidated, avoided cost due only in 2099", async () => {
    const b = await benefitWorldIn(api, w, w.a1);
    await validatedBenefit(api, b, [{ amount: "70", ...H1 }], { amount: "70", start: "2026-02-01", end: "2026-02-28" }, {
      valueClass: "margin_uplift",
    });
    const rev = await benefit(b, "revenue_uplift");
    await planValue(api, b, rev, "300", H1.start, H1.end);
    const avo = await benefit(b, "avoided_cost");
    await planValue(api, b, avo, "45", "2099-01-01", "2099-06-30");
    const t10 = await get(`${b.base}/dashboard`, b.s.auditor);
    const ov = await get(`/api/v1/overview?${q(b)}`, b.s.auditor);
    const fin = await get(`/api/v1/dashboards/finance?${q(b)}`, b.s.auditor);
    const expected = [
      ["SAR", "profit_and_cash", "0", "green", null],
      ["SAR", "top_line", "1", "red", null],
      ["SAR", "non_cash", null, "not_applicable", "dashboard.value.nothing_planned"],
    ];
    for (const [where, body] of [
      ["T10", t10],
      ["overview", ov],
    ] as const) {
      const rag = areaOf(body, "value").rag;
      expect([rag.status, rag.ruleKey], where).toEqual(["red", "dashboard.rag.value.validated_gap"]);
      expect(rag.ruleParams.lines.map(lineOf), where).toEqual(expected);
      const gaps = (areaOf(body, "value").headlines as Body[]).filter((h) => h.metric === "value.gap");
      expect(
        gaps.map((h) => [h.headlineBasis, h.value.state, dec(h.value.value), h.value.currency, h.value.reasonKey]),
        where,
      ).toEqual([
        ["profit_and_cash", "zero", "0", "SAR", null],
        ["top_line", "value", "1", "SAR", null],
        ["non_cash", "not_applicable", null, null, "dashboard.value.nothing_planned"],
      ]);
    }
    expect(rowStatus(ov.transformations, b.transformationId)).toBe("red");
    expect(rowStatus(fin.transformations, b.transformationId)).toBe("red");
    // The validated 70 is shown, and never borrowed by the top line (its gap stays 1).
    const pcVal = (areaOf(t10, "value").headlines as Body[]).find(
      (h) => h.metric === "value.validated" && h.headlineBasis === "profit_and_cash",
    );
    expect(dec(pcVal.value.value)).toBe("70");
  });
});

describe("Q2 F-DG4-126: an unknown basis gap makes the Value RAG unknown, never green", () => {
  it("margin 70 validated 70 (green) beside a revenue-uplift planned line without an amount", async () => {
    const b = await benefitWorldIn(api, w, w.a1);
    await validatedBenefit(api, b, [{ amount: "70", ...H1 }], { amount: "70", start: "2026-02-01", end: "2026-02-28" }, {
      valueClass: "margin_uplift",
    });
    const rev = await benefit(b, "revenue_uplift");
    const r = await call<Body>(api.app, "POST", `${b.base}/benefits/${rev}/plan-values`, {
      session: b.s.bo,
      body: { valueKind: "planned", periodStart: "2026-03-01", periodEnd: "2026-03-31", amount: null, kpiValue: "12" },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const t10 = await get(`${b.base}/dashboard`, b.s.auditor);
    const rag = areaOf(t10, "value").rag;
    expect(rag.status).toBe("unknown");
    expect(rag.ruleParams.lines.map(lineOf)).toEqual([
      ["SAR", "profit_and_cash", "0", "green", null],
      ["SAR", "top_line", null, "unknown", "benefit.value_amount_missing"],
    ]);
    const topGap = (areaOf(t10, "value").headlines as Body[]).find(
      (h) => h.metric === "value.gap" && h.headlineBasis === "top_line",
    );
    expect([topGap.value.state, topGap.value.value, topGap.value.currency]).toEqual(["unknown", null, "SAR"]);
    const ov = await get(`/api/v1/overview?${q(b)}`, b.s.auditor);
    expect(rowStatus(ov.transformations, b.transformationId)).toBe("unknown");
  });
});

/** A three-currency world: SAR margin 70 + cash 20 + revenue 300, USD revenue 11, EUR margin 5 (2026-H1). */
async function threeCurrencyWorld(): Promise<{ b: BenefitWorld; sarMargin: string }> {
  const b = await benefitWorldIn(api, w, w.a1);
  let sarMargin = "";
  for (const [cls, cur, amount] of [
    ["margin_uplift", "SAR", "70"],
    ["cash_saving", "SAR", "20"],
    ["revenue_uplift", "SAR", "300"],
    ["revenue_uplift", "USD", "11"],
    ["margin_uplift", "EUR", "5"],
  ] as const) {
    const id = await benefit(b, cls, cur);
    if (cls === "margin_uplift" && cur === "SAR") sarMargin = id;
    await planValue(api, b, id, amount, H1.start, H1.end);
  }
  return { b, sarMargin };
}

const VALUE_METRICS = new Set([
  "value.planned",
  "value.forecast",
  "value.submitted",
  "value.validated",
  "value.measured",
  "value.rejected",
  "value.sustained",
]);

describe("Q3 F-DG4-105: every value figure with a currency drills to exactly that currency's figure", () => {
  it("T10, Overview, Finance (headlines and lines) and the header, followed one by one", async () => {
    const { b } = await threeCurrencyWorld();
    const t10 = await get(`${b.base}/dashboard`, b.s.auditor);
    const ov = await get(`/api/v1/overview?${q(b)}`, b.s.auditor);
    const fin = await get(`/api/v1/dashboards/finance?${q(b)}`, b.s.auditor);
    const hdr = await get(`${b.base}/summary`, b.s.auditor);
    type Fig = { where: string; metric: string; value: Body; href: string | null; currency: string | null; gross?: boolean };
    const figs: Fig[] = [];
    for (const [where, list] of [
      ["T10", areaOf(t10, "value").headlines],
      ["overview", areaOf(ov, "value").headlines],
      ["finance", fin.headlines],
      ["header", hdr.benefits.headlines],
    ] as const)
      for (const h of list as Body[])
        if (h.metric.startsWith("value."))
          figs.push({ where, metric: h.metric, value: h.value, href: h.drilldownHref, currency: h.value.currency });
    for (const l of fin.lines as Body[])
      figs.push({
        where: `finance-line ${l.valueClass}/${l.state}`,
        metric: "line",
        value: l.total,
        href: l.drilldownHref,
        currency: l.currency,
        gross: l.valueClass === "gross",
      });
    // Expected surfaces: three currencies, each on four surfaces.
    for (const cur of ["SAR", "USD", "EUR"])
      expect(figs.filter((f) => f.currency === cur && f.where === "T10").length, cur).toBeGreaterThan(0);
    let followed = 0;
    for (const f of figs) {
      const label = `${f.where} ${f.metric} ${f.currency} ${f.href}`;
      if (f.where.startsWith("finance-line net")) {
        expect(f.href, label).toBeNull();
        continue;
      }
      if (f.currency === null) continue; // the n/a gap of nothing due carries no currency (N4 item 1)
      expect(f.href, label).not.toBeNull();
      expect(f.href!, label).toContain(`currency=${f.currency}`);
      const { first, items } = await drillAll(f.href!, b.s.auditor);
      followed += 1;
      expect(first.currency, label).toBe(f.currency);
      for (const it of items) expect(it.value?.currency ?? f.currency, `${label} item ${it.recordId}`).toBe(f.currency);
      const sumMetric = VALUE_METRICS.has(f.metric) || f.metric === "value.investment" || f.metric === "line";
      if (f.gross && f.value.state === "zero" && first.value.state === "not_applicable") {
        // The ADR N4 item 3 exception: the sum of no item is the line's zero.
        expect(items, label).toEqual([]);
        continue;
      }
      expect([first.value.state, dec(first.value.value)], label).toEqual([f.value.state, dec(f.value.value)]);
      if (sumMetric && f.value.state !== "unknown" && f.value.state !== "not_applicable") {
        let s = new Decimal(0);
        for (const it of items) s = s.plus(it.value.value);
        expect(s.toFixed(), label).toBe(dec(f.value.value));
      }
      if (f.value.state === "not_applicable") expect(items, label).toEqual([]);
    }
    expect(followed).toBeGreaterThan(30);
    // Q6 (N5): every money, gap and count value carries kpiUnit null.
    for (const f of figs) expect(f.value.kpiUnit, `${f.where} ${f.metric}`).toBeNull();
    // 370 (all SAR classes summed) / 381 (SAR+USD) nowhere as a figure.
    expect(JSON.stringify([t10, ov, fin, hdr])).not.toMatch(/"(370|381|386)(\.0+)?"/);
  });
});

describe("Q4 F-DG4-105 negatives", () => {
  it("400 / 422 / multiple_currencies / subject in another currency / cursor rebinding / no grant", async () => {
    const { b, sarMargin } = await threeCurrencyWorld();
    const base = `/api/v1/dashboard-drilldown?${q(b)}`;
    for (const bad of ["sar", "SARX", "S1R"]) {
      const r = await call<Body>(api.app, "GET", `${base}&metric=value.planned&currency=${bad}`, { session: b.s.auditor });
      expect(r.status, bad).toBe(400);
    }
    for (const metric of ["outcomes.area", "portfolio.initiatives", "decisions.overdue", "dependencies.open"]) {
      const r = await call<Body>(api.app, "GET", `${base}&metric=${metric}&currency=SAR`, { session: b.s.auditor });
      expect([r.status, r.body.code], metric).toEqual([422, "dashboard.currency_not_applicable"]);
    }
    const multi = await get(`${base}&metric=value.planned&limit=100`, b.s.auditor);
    expect([multi.value.state, multi.value.reasonKey, multi.currency]).toEqual([
      "not_applicable",
      "dashboard.value.multiple_currencies",
      null,
    ]);
    expect(new Set((multi.items as Body[]).map((i) => i.value.currency))).toEqual(new Set(["SAR", "EUR"]));
    const gapMulti = await get(`${base}&metric=value.gap&limit=100`, b.s.auditor);
    expect([gapMulti.value.state, gapMulti.value.reasonKey]).toEqual([
      "not_applicable",
      "dashboard.value.multiple_currencies",
    ]);
    const subj = await get(`${base}&metric=value.planned&subjectId=${sarMargin}&currency=USD`, b.s.auditor);
    expect([subj.value.state, subj.value.currency, subj.items.length, subj.currency]).toEqual([
      "not_applicable",
      "USD",
      0,
      "USD",
    ]);
    const subjSar = await get(`${base}&metric=value.planned&subjectId=${sarMargin}&currency=SAR`, b.s.auditor);
    expect([subjSar.value.state, dec(subjSar.value.value), subjSar.items.length]).toEqual(["value", "70", 1]);
    // A cursor is bound to its filters, currency included.
    const p1 = await get(`${base}&metric=value.planned&currency=SAR&limit=1`, b.s.auditor);
    expect(p1.nextCursor).not.toBeNull();
    const replay = await call<Body>(
      api.app,
      "GET",
      `${base}&metric=value.planned&currency=USD&limit=1&cursor=${encodeURIComponent(p1.nextCursor)}`,
      { session: b.s.auditor },
    );
    expect(replay.status).toBeGreaterThanOrEqual(400);
    expect(replay.status).toBeLessThan(500);
    const p2 = await get(
      `${base}&metric=value.planned&currency=SAR&limit=1&cursor=${encodeURIComponent(p1.nextCursor)}`,
      b.s.auditor,
    );
    expect(p2.currency).toBe("SAR");
    // No grant in the organization: no figure.
    const nobody = await signIn(api.app, w.nobody.subject);
    const r = await call<Body>(api.app, "GET", `${base}&metric=value.planned&currency=SAR`, { session: nobody });
    expect([403, 404]).toContain(r.status);
    expect(JSON.stringify(r.body)).not.toContain('"70"');
  });
});

describe("Q5 F-DG4-127: the Portfolio value keeps decimals and the transformation's currency", () => {
  it("50 % of margin 70.5 SAR + 100 % of a USD margin 1000: SAR 35.25, never 1035.25", async () => {
    const b = await benefitWorldIn(api, w, w.a1);
    const ini = await insertInitiative(api.db, b, { status: "completed" });
    const other = await insertInitiative(api.db, b, { status: "completed" });
    const m = await benefit(b, "margin_uplift");
    await planValue(api, b, m, "70.5", H1.start, H1.end);
    await allocate(b, m, [
      { initiativeId: ini, share: "0.5" },
      { initiativeId: other, share: "0.5" },
    ]);
    const usd = await benefit(b, "margin_uplift", "USD");
    await planValue(api, b, usd, "1000", H1.start, H1.end);
    await allocate(b, usd, [{ initiativeId: ini, share: "1" }]);
    const dash = await get(`${b.base}/dashboard`, b.s.auditor);
    const row = (areaOf(dash, "portfolio").items as Body[]).find((i) => i.recordId === ini);
    expect([row.value.state, dec(row.value.value), row.value.currency, row.valueBasis, row.value.kpiUnit]).toEqual([
      "value",
      "35.25",
      "SAR",
      "profit_and_cash",
      null,
    ]);
    expect(JSON.stringify(areaOf(dash, "portfolio"))).not.toMatch(/1035\.25/);
  });
});

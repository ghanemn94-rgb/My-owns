// The drill-down against a real PostgreSQL (T-DG4-KBE-G; ADR-0037 §5; REQ-S13-003 "the validated benefit total drills
// to its benefit records; a KPI with no data shows Unknown, not 0"):
//  - the validated total drills to its benefit records, and the decimal sum of items over ALL pages equals the
//    headline (the invariant), with the Finance decision's evidence and the window as period;
//  - zero (nothing validated yet), unknown (a KPI with no actual) and not_applicable (no financial benefit; a
//    non-financial benefit) are distinct states, never 0 or green;
//  - subjectId narrows a per-record metric; a mismatched subject is the exact 422; pagination is bound to the filters.
// All data is synthetic; the Finance validations are synthetic business approvals of test data.
import { FORMULA_DECIMAL as D } from "@mth/shared/calc";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import type { KpiWorld } from "../kpi/fixtures.ts";
import { benefitAt, cxBody, type BenefitWorld } from "../benefits/fixtures.ts";
import {
  areaOf,
  benefitWorldIn,
  dashboardWorld,
  openPeriod,
  outcomeKpi,
  trajectoryKpi,
  validatedBenefit,
  type Body,
} from "../contract/p4-exercises-kbe-g.ts";

let api: TestApi;
let w: World;
let k: KpiWorld;
let b: BenefitWorld;
let empty: BenefitWorld;
const benefits: { benefitId: string; code: string; measurementId: string | null }[] = [];
let nonFinancial: string;
let okNoData: string;

const get = (url: string) => call<Body>(api.app, "GET", url, { session: k.s.auditor });
const drill = (metric: string, query = "") =>
  get(`/api/v1/dashboard-drilldown?metric=${metric}&organizationId=${w.orgA.id}${query}`);

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  k = await dashboardWorld(api, w);
  await openPeriod(api, w, "monthly", "2026-04", "2026-04-01", "2026-04-30");
  const kpi = await trajectoryKpi(api, k);
  okNoData = await outcomeKpi(api.db, k, k.outcomeId, kpi.id, w.orgA.id);
  b = await benefitWorldIn(api, w, w.a1);
  benefits.push(
    await validatedBenefit(api, b, [{ amount: "1000.25", start: "2026-02-01", end: "2026-02-28" }], {
      amount: "900.10",
      start: "2026-02-01",
      end: "2026-02-28",
    }),
  );
  benefits.push(
    await validatedBenefit(api, b, [{ amount: "500", start: "2026-03-01", end: "2026-03-31" }], {
      amount: "333.33",
      start: "2026-03-01",
      end: "2026-03-31",
    }),
  );
  benefits.push(await validatedBenefit(api, b, [{ amount: "70", start: "2026-03-01", end: "2026-03-31" }], null));
  nonFinancial = (await benefitAt(api, b, "plan", cxBody(b))).id;
  empty = await benefitWorldIn(api, w, w.a1);
  await validatedBenefit(api, empty, [{ amount: "10", start: "2026-03-01", end: "2026-03-31" }], null);
}, 240_000);
afterAll(() => api.close());

describe("REQ-S13-003: the validated total drills to its benefit records", () => {
  it("items are the benefits, their decimal sum over all pages equals the headline, with evidence", async () => {
    const t = await get(`${b.base}/dashboard`);
    const headline = areaOf(t.body, "value").headlines.find((h: Body) => h.metric === "value.validated");
    expect(headline.value).toMatchObject({ state: "value", value: "1233.43", currency: "SAR" });
    // Page through with limit 1: every page carries the same headline value, items are the benefit records.
    const items: Body[] = [];
    let url: string | null = `${headline.drilldownHref}&limit=1`;
    let pages = 0;
    while (url !== null) {
      const page = await get(url);
      expect(page.status, JSON.stringify(page.body)).toBe(200);
      expect(page.body.value).toEqual(headline.value);
      items.push(...page.body.items);
      pages += 1;
      url = page.body.nextCursor === null ? null : `${headline.drilldownHref}&limit=1&cursor=${page.body.nextCursor}`;
    }
    expect(pages).toBe(2);
    expect(items.map((i) => [i.recordType, i.recordId]).sort()).toEqual(
      [benefits[0]!, benefits[1]!].map((x) => ["benefit", x.benefitId]).sort(),
    );
    const sum = items.reduce((acc, i) => acc.plus(new D(i.value.value)), new D(0));
    expect(sum.eq(new D(headline.value.value))).toBe(true);
    for (const i of items) expect(i.href).toBe(`${b.base}/benefits/${i.recordId}`);
    const full = await get(headline.drilldownHref);
    expect(full.body.calculation.ruleKey).toBe("dashboard.value.sum_validated");
    expect(full.body.calculation.inputs).toEqual([
      { name: "total_SAR", value: headline.value, recordType: null, recordId: null },
    ]);
    expect(full.body.evidence.map((e: Body) => e.recordId).sort()).toEqual(
      [benefits[0]!.measurementId, benefits[1]!.measurementId].sort(),
    );
  });

  it("the planned and gap drills hold the same invariant; subjectId narrows to one benefit", async () => {
    const planned = await drill("value.planned", `&transformationId=${b.transformationId}`);
    expect(planned.body.value).toMatchObject({ state: "value", value: "1570.25" });
    const sum = planned.body.items.reduce(
      (acc: InstanceType<typeof D>, i: Body) => acc.plus(new D(i.value.value)),
      new D(0),
    );
    expect(sum.toFixed()).toBe("1570.25");
    const one = await drill(
      "value.validated",
      `&transformationId=${b.transformationId}&subjectId=${benefits[1]!.benefitId}`,
    );
    expect([one.body.items.length, one.body.value.value]).toEqual([1, "333.33"]);
    const gap = await drill("value.gap", `&transformationId=${b.transformationId}`);
    // (1570.25 - 1233.43) / 1570.25 = 0.21450087..., presented half-even at 6 places (the status uses the exact ratio).
    expect(gap.body.value.value).toBe("0.214501");
    expect(gap.body.calculation.rounding).toEqual({ scale: 6, mode: "half_even", appliesTo: "presentation" });
    expect(gap.body.calculation.expression).toBe("(plannedToDate - validatedToDate) / plannedToDate");
    expect(gap.body.items.length).toBe(5); // 3 planned lines + 2 validated lines
  });
});

describe("REQ-S13-003: zero, Unknown and not_applicable are distinct", () => {
  it("nothing validated yet is a known zero; no financial benefit is n/a; a KPI with no data is unknown", async () => {
    const zero = await drill("value.validated", `&transformationId=${empty.transformationId}`);
    expect(zero.body.items).toEqual([]);
    const emptyDash = await get(`${empty.base}/dashboard`);
    expect(areaOf(emptyDash.body, "value").headlines.find((h: Body) => h.metric === "value.validated").value).toEqual({
      state: "zero",
      value: "0",
      unit: "currency",
      currency: "SAR",
      reasonKey: null,
    });
    const na = await get(`${k.base}/dashboard`);
    expect(areaOf(na.body, "value").headlines[0].value).toEqual({
      state: "not_applicable",
      value: null,
      unit: "currency",
      currency: null,
      reasonKey: "dashboard.value.no_financial_benefit",
    });
    const unknown = await drill("outcomes.kpi_status", `&subjectId=${okNoData}`);
    expect(unknown.status, JSON.stringify(unknown.body)).toBe(200);
    expect(unknown.body.value).toMatchObject({ state: "unknown", value: null, reasonKey: "kpi.no_accepted_actual" });
    expect(unknown.body.items).toEqual([]);
    // A non-financial benefit is listed with Value n/a, never 0.
    const item = areaOf((await get(`${b.base}/dashboard`)).body, "value").items.find(
      (i: Body) => i.recordId === nonFinancial,
    );
    expect(item.value).toMatchObject({ state: "not_applicable", value: null });
    expect(item.flags).toContain("non_financial");
  });

  it("a subject of the wrong kind is 422 with the exact text; a subject on a metric without one too", async () => {
    const wrong = await drill("outcomes.kpi_status", `&subjectId=${benefits[0]!.benefitId}`);
    expect([wrong.status, wrong.body.code, wrong.body.detail, wrong.body.errors[0].pointer]).toEqual([
      422,
      "dashboard.metric_subject_mismatch",
      "This drill-down needs a record of the kind the metric is about.",
      "/subjectId",
    ]);
    expect((await drill("outcomes.kpi_status")).status).toBe(422);
    expect((await drill("dependencies.open", `&subjectId=${okNoData}`)).status).toBe(422);
    // A cursor of other filters is refused (bound to the filter hash).
    const first = await drill("value.planned", `&transformationId=${b.transformationId}&limit=1`);
    const other = await drill("value.planned", `&limit=1&cursor=${first.body.nextCursor}`);
    expect(other.status).toBe(400);
  });
});

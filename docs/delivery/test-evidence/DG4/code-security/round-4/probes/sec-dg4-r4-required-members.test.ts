// code-security-reviewer DG4 ROUND-4 probe RM4 (T-DG4-REV-SEC-R4): the round-3 repair members DashboardItem.valueBasis,
// DashboardDrilldown.currency (ARCH-R6/KBE-R7) and DashboardValue.kpiUnit (ARCH-R7/KBE-R8) are REQUIRED; the contract
// validator used by every integration `call` (apps/api/test/support/contract.ts) and the shared zod mirror reject a live
// response with the member deleted, and a malformed kpiUnit. NOT product code; disposable clone only. Data synthetic.
import { dashboardDrilldown, dashboardItem, dashboardValue, transformationDashboard } from "@mth/shared/schemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { matchesComponent, openapi } from "../../support/contract.ts";
import { call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { financialBody, type BenefitWorld } from "../benefits/fixtures.ts";
import { areaOf, benefitWorldIn, planValue } from "../contract/p4-exercises-kbe-g.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
let api: TestApi;
let w: World;
let b: BenefitWorld;
let dash: Body;
let drill: Body;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await benefitWorldIn(api, w, w.a1);
  const r = await call<Body>(api.app, "POST", `${b.base}/benefits`, { session: b.s.bo, body: financialBody(b, { valueClass: "margin_uplift", benefitType: "revenue" }) });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  await planValue(api, b, r.body.id, "10", "2026-01-01", "2026-06-30");
  dash = (await call<Body>(api.app, "GET", `${b.base}/dashboard`, { session: b.s.auditor })).body;
  const h = areaOf(dash, "value").headlines.find((x: Body) => x.metric === "value.planned");
  drill = (await call<Body>(api.app, "GET", h.drilldownHref, { session: b.s.auditor })).body;
}, 300_000);
afterAll(() => api?.close());

describe("SEC-DG4-R4 probe RM4: valueBasis, currency, kpiUnit required", () => {
  it("openapi required lists contain the members", () => {
    const s = openapi.components.schemas;
    const r = { item: s.DashboardItem.required, drill: s.DashboardDrilldown.required, value: s.DashboardValue.required, kpiUnit: s.DashboardKpiUnit?.required };
    console.log(`[probe-RM4] ${JSON.stringify(r)}`);
    expect(r.item).toContain("valueBasis");
    expect(r.drill).toContain("currency");
    expect(r.value).toContain("kpiUnit");
    expect(r.kpiUnit).toEqual(expect.arrayContaining(["kind", "label"]));
  });
  it("live values valid; each member deleted or malformed is rejected by ajv and zod", () => {
    const item = areaOf(dash, "value").items[0];
    const value = areaOf(dash, "value").headlines[0].value;
    expect(item, "a value-area item exists").toBeTruthy();
    expect(matchesComponent("DashboardItem", item).ok).toBe(true);
    expect(matchesComponent("DashboardDrilldown", drill).ok).toBe(true);
    expect(matchesComponent("DashboardValue", value).ok).toBe(true);
    expect(dashboardItem.safeParse(item).success).toBe(true);
    expect(dashboardDrilldown.safeParse(drill).success).toBe(true);
    expect(dashboardValue.safeParse(value).success).toBe(true);
    const del = (o: Body, k: string) => { const c = structuredClone(o); delete c[k]; return c; };
    const ku = (kpiUnit: unknown) => ({ ...value, kpiUnit });
    const bad = {
      item_no_valueBasis: [matchesComponent("DashboardItem", del(item, "valueBasis")).ok, dashboardItem.safeParse(del(item, "valueBasis")).success],
      drill_no_currency: [matchesComponent("DashboardDrilldown", del(drill, "currency")).ok, dashboardDrilldown.safeParse(del(drill, "currency")).success],
      drill_lower_currency: [matchesComponent("DashboardDrilldown", { ...drill, currency: "sar" }).ok, dashboardDrilldown.safeParse({ ...drill, currency: "sar" }).success],
      value_no_kpiUnit: [matchesComponent("DashboardValue", del(value, "kpiUnit")).ok, dashboardValue.safeParse(del(value, "kpiUnit")).success],
      kpiUnit_bad_kind: [matchesComponent("DashboardValue", ku({ kind: "percent", label: null })).ok, dashboardValue.safeParse(ku({ kind: "percent", label: null })).success],
      kpiUnit_empty_label: [matchesComponent("DashboardValue", ku({ kind: "ratio", label: "" })).ok, dashboardValue.safeParse(ku({ kind: "ratio", label: "" })).success],
      kpiUnit_long_label: [matchesComponent("DashboardValue", ku({ kind: "ratio", label: "x".repeat(51) })).ok, dashboardValue.safeParse(ku({ kind: "ratio", label: "x".repeat(51) })).success],
      kpiUnit_extra: [matchesComponent("DashboardValue", ku({ kind: "ratio", label: null, html: "<b>" })).ok, dashboardValue.safeParse(ku({ kind: "ratio", label: null, html: "<b>" })).success],
      kpiUnit_no_label: [matchesComponent("DashboardValue", ku({ kind: "ratio" })).ok, dashboardValue.safeParse(ku({ kind: "ratio" })).success],
      item_bad_basis: [matchesComponent("DashboardItem", { ...item, valueBasis: "all" }).ok, dashboardItem.safeParse({ ...item, valueBasis: "all" }).success],
    };
    const good = { kpiUnit_ok: [matchesComponent("DashboardValue", ku({ kind: "percentage", label: "% of users" })).ok, dashboardValue.safeParse(ku({ kind: "percentage", label: "% of users" })).success], t10_zod: transformationDashboard.safeParse(dash).success };
    console.log(`[probe-RM4] bad=${JSON.stringify(bad)} good=${JSON.stringify(good)} itemValueBasis=${item.valueBasis}`);
    for (const [k, v] of Object.entries(bad)) expect(v, k).toEqual([false, false]);
    expect(good.kpiUnit_ok).toEqual([true, true]);
    expect(good.t10_zod).toBe(true);
  });
});

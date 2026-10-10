// Cumulative lineage down to every accepted actual version of the window (T-DG4-KBE-R4; ADR-0027 amendment C5, with
// C1 and C4; REQ-S08-006 "any displayed number can show its lineage"), end to end against a real PostgreSQL: the API's
// accept transactions, then the worker's kpi.recalculate consumer as the relay would deliver it (runRecalculation).
// Worked fixture (synthetic): a flow KPI (sum) entered per business unit, two consecutive monthly periods P1, P2 in one
// YTD window; a1 reports 4 (P1) and 10 (P2); a2 reports 6 (P1) and, later, 20 (P2).
//  - C5 missing-scope rule (pinned): after a1's P2 value only, a2 has earlier accepted values but none for P2, so its
//    cumulative value is Unknown; it is expected, so it is in missingScopes; the cumulative roll-up is Unknown with
//    kpi.scope_missing; a2 has no `entries` element; no finding is written on the cumulative basis (the period basis
//    writes its scope_missing finding);
//  - C5 windowValues: once a2 reports P2, the cumulative roll-up (4+10+6+20 = 40) lists, per scope, both periods'
//    kpiActualId and valueNo in window order (the current period last, equal to the entry's own); the entered
//    cumulative evaluation of each scope lists the same two versions next to its as-built `window`;
//  - an Unknown cumulative value has no windowValues (its `window` still lists the periods);
//  - the period-basis shapes are unchanged: { kpiActualId, valueNo } and entries without windowValues.
// All data is SYNTHETIC; nothing here is a business approval or touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { seedKpiWorld, type KpiWorld } from "../kpi/fixtures.ts";
import { DIRECT_FLOW, monthlyPeriod, ownedKpi, runRecalculation, submitActual, type Body } from "./kbe-c-fixtures.ts";

let api: TestApi;
let w: World;
let k: KpiWorld;
let p1: { id: string; label: string; start: string; end: string };
let p2: { id: string; label: string; start: string; end: string };
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  k = await seedKpiWorld(api, w);
  // Two consecutive months of one YTD window (a December period would start a new year's window after it).
  p1 = await monthlyPeriod(api, w);
  while (p1.start.slice(5, 7) === "12") p1 = await monthlyPeriod(api, w);
  p2 = await monthlyPeriod(api, w);
  expect(p2.start.slice(0, 4)).toBe(p1.start.slice(0, 4));
}, 60_000);
afterAll(() => api.close());

/** The latest stored evaluation (by run sequence) of a slot. */
async function evaluation(kpiId: string, basis: string, scopeKind: string, scopeId: string, periodId: string) {
  return api.db
    .selectFrom("kpi_evaluation as e")
    .innerJoin("calculation_run as r", "r.id", "e.calculation_run_id")
    .selectAll("e")
    .where("e.kpi_definition_id", "=", kpiId)
    .where("e.value_basis", "=", basis)
    .where("e.scope_kind", "=", scopeKind)
    .where("e.scope_id", "=", scopeId)
    .where("e.reporting_period_id", "=", periodId)
    .orderBy("r.seq", "desc")
    .executeTakeFirst();
}

async function accept(kpiId: string, scopeKind: string, scopeId: string, periodId: string, value: string) {
  const r = await submitActual(api, k, kpiId, { reportingPeriodId: periodId, scopeKind, scopeId, value });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  expect((await runRecalculation(api, r.body.actual.id)).map((x) => x.outcome)).toEqual(["done"]);
  return r.body.actual.id as string;
}

const byId = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);

describe("a cumulative roll-up names the actual versions of each scope's whole window (ADR-0027 amendment C5)", () => {
  let kpiId: string;
  const actual: Record<string, Record<string, string>> = {};

  it("C5 missing-scope rule: a scope with earlier values but no current actual is missing; Unknown; no entry; no finding", async () => {
    const kpi = await ownedKpi(api, k, {
      ...DIRECT_FLOW,
      entryScopeKind: "business_unit",
      ytdStartMonth: Number(p1.start.slice(5, 7)),
    });
    kpiId = kpi.id;
    actual[w.a1] = { [p1.id]: await accept(kpiId, "business_unit", w.a1, p1.id, "4") };
    actual[w.a2] = { [p1.id]: await accept(kpiId, "business_unit", w.a2, p1.id, "6") };
    actual[w.a1]![p2.id] = await accept(kpiId, "business_unit", w.a1, p2.id, "10");

    const cum = await evaluation(kpiId, "cumulative", "transformation", k.transformationId, p2.id);
    expect(cum).toMatchObject({
      value: null,
      value_source: "rolled_up",
      value_status: "unknown",
      value_reason: "kpi.scope_missing",
    });
    const inputs = cum!.inputs as Body;
    expect([inputs.expectedScopes, inputs.missingScopes]).toEqual([[w.a1, w.a2].sort(byId), [w.a2]]);
    // a2 gets no entries element; a1, whose own cumulative value (4 + 10) is known, names its whole window.
    expect(inputs.entries).toEqual([
      {
        scopeId: w.a1,
        kpiActualId: actual[w.a1]![p2.id],
        valueNo: 1,
        windowValues: [
          { reportingPeriodId: p1.id, kpiActualId: actual[w.a1]![p1.id], valueNo: 1 },
          { reportingPeriodId: p2.id, kpiActualId: actual[w.a1]![p2.id], valueNo: 1 },
        ],
      },
    ]);
    // A missing scope never counts as zero: no partial sum (14) is stored.
    expect(cum!.value).toBeNull();
    // No finding on the cumulative basis; the period basis records its scope_missing finding for P2.
    const run = await api.db
      .selectFrom("calculation_run")
      .select("id")
      .where("trigger_record_id", "=", actual[w.a1]![p2.id]!)
      .executeTakeFirstOrThrow();
    const findings = await api.db
      .selectFrom("data_quality_finding")
      .select(["rule_code", "scope_kind"])
      .where("detected_by_run_id", "=", run.id)
      .where("kpi_definition_id", "=", kpiId)
      .execute();
    expect(findings.map((f) => [f.rule_code, f.scope_kind])).toEqual([["scope_missing", "transformation"]]);
  });

  it("C5 windowValues: each cumulative entry lists both periods' kpiActualId and valueNo, in window order", async () => {
    actual[w.a2]![p2.id] = await accept(kpiId, "business_unit", w.a2, p2.id, "20");
    const cum = await evaluation(kpiId, "cumulative", "transformation", k.transformationId, p2.id);
    expect(cum).toMatchObject({ value: "40.000000", value_source: "rolled_up", value_status: "ok" });
    const scopes = [w.a1, w.a2].sort(byId);
    expect(cum!.inputs).toEqual({
      expectedScopes: scopes,
      missingScopes: [],
      entries: scopes.map((s) => ({
        scopeId: s,
        kpiActualId: actual[s]![p2.id],
        valueNo: 1,
        windowValues: [p1.id, p2.id].map((pid) => ({
          reportingPeriodId: pid,
          kpiActualId: actual[s]![pid],
          valueNo: 1,
        })),
      })),
    });
    // The last element is the entry's own actual version (C5).
    for (const e of (cum!.inputs as Body).entries)
      expect(e.windowValues.at(-1)).toEqual({
        reportingPeriodId: p2.id,
        kpiActualId: e.kpiActualId,
        valueNo: e.valueNo,
      });
  });

  it("the entered cumulative evaluation of each scope lists the same two versions next to its window", async () => {
    for (const [scope, value] of [
      [w.a1, "14.000000"],
      [w.a2, "26.000000"],
    ] as const) {
      const e = await evaluation(kpiId, "cumulative", "business_unit", scope, p2.id);
      expect(e, scope).toMatchObject({ value, value_source: "entered" });
      expect(e!.inputs, scope).toEqual({
        kpiActualId: actual[scope]![p2.id],
        valueNo: 1,
        window: [p1.id, p2.id],
        windowValues: [p1.id, p2.id].map((pid) => ({
          reportingPeriodId: pid,
          kpiActualId: actual[scope]![pid],
          valueNo: 1,
        })),
      });
    }
  });

  it("period-basis shapes are unchanged: { kpiActualId, valueNo } and entries without windowValues", async () => {
    const entered = await evaluation(kpiId, "period", "business_unit", w.a2, p2.id);
    expect(entered!.inputs).toEqual({ kpiActualId: actual[w.a2]![p2.id], valueNo: 1 });
    const rolled = await evaluation(kpiId, "period", "transformation", k.transformationId, p2.id);
    expect(rolled).toMatchObject({ value: "30.000000", value_source: "rolled_up" });
    const scopes = [w.a1, w.a2].sort(byId);
    expect(rolled!.inputs).toEqual({
      expectedScopes: scopes,
      missingScopes: [],
      entries: scopes.map((s) => ({ scopeId: s, kpiActualId: actual[s]![p2.id], valueNo: 1 })),
    });
  });
});

describe("an Unknown cumulative value records no windowValues (ADR-0027 amendment C5)", () => {
  it("a value for P2 without one for P1: Unknown (kpi.cumulative_incomplete), window listed, no windowValues", async () => {
    const kpi = await ownedKpi(api, k, { ...DIRECT_FLOW, ytdStartMonth: Number(p1.start.slice(5, 7)) });
    const id = await accept(kpi.id, "transformation", k.transformationId, p2.id, "7");
    const cum = await evaluation(kpi.id, "cumulative", "transformation", k.transformationId, p2.id);
    expect(cum).toMatchObject({ value: null, value_source: "entered", value_reason: "kpi.cumulative_incomplete" });
    expect(cum!.inputs).toEqual({ kpiActualId: id, valueNo: 1, window: [p1.id, p2.id] });
    const period = await evaluation(kpi.id, "period", "transformation", k.transformationId, p2.id);
    expect(period).toMatchObject({ value: "7.000000", value_source: "entered" });
    expect(period!.inputs).toEqual({ kpiActualId: id, valueNo: 1 });
  });
});

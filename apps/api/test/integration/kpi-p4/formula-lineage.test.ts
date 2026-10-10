// Formula and roll-up lineage down to the accepted actual versions (T-DG4-KBE-R3; ARCH-R2 item 5; ADR-0027 amendment C1
// and ADR-0028 amendment of 2026-10-10; REQ-S08-006 "any displayed number can show its lineage"), end to end against a
// real PostgreSQL: the API's accept transactions, then the worker's kpi.recalculate consumer as the relay would deliver
// it (kbe-c-fixtures runRecalculation). Proven:
//  - a formula over a formula source nests one level: N = s * 2 over S = a + b stores, for `s`, S's own
//    `{formula, values, sources}`, whose `a` and `b` entries name each ACCEPTED kpiActualId and valueNo (a accepted in an
//    earlier run and bound only, b accepted in this run). S is evaluated and stored in the run (it reads b); N's `s`
//    entry is the same lineage S stores for itself;
//  - a roll-up lists `entries`: one { scopeId, kpiActualId, valueNo } per business-unit scope whose accepted value
//    entered the transformation-scope roll-up, ordered by scopeId, next to the as-built expectedScopes/missingScopes.
// (KBE-R1's T = a + b fixture, the Unknown input and the unchanged rows, findings and events are in
// formula-recalc.test.ts.) All data is SYNTHETIC; nothing here is a business approval or touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { seedKpiWorld, type KpiWorld } from "../kpi/fixtures.ts";
import {
  DIRECT_FLOW,
  mapPartyTo,
  monthlyPeriod,
  ownedKpi,
  runRecalculation,
  submitActual,
  type Body,
} from "./kbe-c-fixtures.ts";

let api: TestApi;
let w: World;
let k: KpiWorld;
let period: { id: string; label: string; end: string };
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  k = await seedKpiWorld(api, w);
  await mapPartyTo(api, k, "BO", k.users.bo.id);
  period = await monthlyPeriod(api, w);
}, 60_000);
afterAll(() => api.close());

const evalOf = async (actualId: string, kpiId: string, basis: "period" | "cumulative" = "period") => {
  const runs = await api.db
    .selectFrom("calculation_run")
    .select("id")
    .where("trigger_record_id", "=", actualId)
    .orderBy("trigger_slot", "desc")
    .execute();
  expect(runs.length).toBeGreaterThan(0);
  return api.db
    .selectFrom("kpi_evaluation")
    .selectAll()
    .where("calculation_run_id", "=", runs[0]!.id)
    .where("kpi_definition_id", "=", kpiId)
    .where("value_basis", "=", basis)
    .where("scope_kind", "=", "transformation")
    .where("reporting_period_id", "=", period.id)
    .executeTakeFirst();
};

const slot = () => ({
  inputBasis: "period",
  scopeKind: "transformation",
  scopeId: k.transformationId,
  reportingPeriodId: period.id,
});

describe("formula lineage nests through a formula source (ADR-0027 amendment C1)", () => {
  it("N = s * 2 over S = a + b names a's and b's accepted actual versions one level down", async () => {
    const def = { unitKind: "count", unitLabel: "lines", frequency: "monthly" } as const;
    const a = await ownedKpi(api, k, DIRECT_FLOW, { ...def, name: "Synthetic lineage prepaid" });
    const b = await ownedKpi(api, k, DIRECT_FLOW, { ...def, name: "Synthetic lineage postpaid" });
    const sum = await ownedKpi(
      api,
      k,
      {
        ...DIRECT_FLOW,
        calculationMethod: "formula",
        formulaExpression: "a + b",
        formulaInputs: [
          { variableName: "a", sourceKpiDefinitionId: a.id, inputBasis: "period" },
          { variableName: "b", sourceKpiDefinitionId: b.id, inputBasis: "period" },
        ],
      },
      { ...def, name: "Synthetic lineage total" },
    );
    const nested = await ownedKpi(
      api,
      k,
      {
        ...DIRECT_FLOW,
        calculationMethod: "formula",
        formulaExpression: "s * 2",
        formulaInputs: [{ variableName: "s", sourceKpiDefinitionId: sum.id, inputBasis: "period" }],
      },
      { ...def, name: "Synthetic lineage doubled total" },
    );

    const ra = await submitActual(api, k, a.id, { reportingPeriodId: period.id, value: "70" });
    expect(ra.status, JSON.stringify(ra.body)).toBe(201);
    expect((await runRecalculation(api, ra.body.actual.id)).map((r) => r.outcome)).toEqual(["done"]);
    const rb = await submitActual(api, k, b.id, { reportingPeriodId: period.id, value: "5" });
    expect(rb.status, JSON.stringify(rb.body)).toBe(201);
    expect((await runRecalculation(api, rb.body.actual.id)).map((r) => r.outcome)).toEqual(["done"]);

    const sumLineage = {
      formula: "a + b",
      values: { a: "70", b: "5" },
      sources: {
        a: {
          kpiDefinitionId: a.id,
          kpiVersionId: a.versionId,
          ...slot(),
          valueSource: "entered",
          valueStatus: "ok",
          value: "70",
          inputs: { kpiActualId: ra.body.actual.id, valueNo: 1 },
        },
        b: {
          kpiDefinitionId: b.id,
          kpiVersionId: b.versionId,
          ...slot(),
          valueSource: "entered",
          valueStatus: "ok",
          value: "5",
          inputs: { kpiActualId: rb.body.actual.id, valueNo: 1 },
        },
      },
    };
    const s = await evalOf(rb.body.actual.id, sum.id);
    expect(s).toMatchObject({ value: "75.000000", value_source: "formula" });
    expect(s!.inputs).toEqual(sumLineage);
    const n = await evalOf(rb.body.actual.id, nested.id);
    expect(n).toMatchObject({ value: "150.000000", value_source: "formula", kpi_version_id: nested.versionId });
    expect(n!.inputs).toEqual({
      formula: "s * 2",
      values: { s: "75" },
      sources: {
        s: {
          kpiDefinitionId: sum.id,
          kpiVersionId: sum.versionId,
          ...slot(),
          valueSource: "formula",
          valueStatus: "ok",
          value: "75",
          inputs: sumLineage,
        },
      },
    });
    // Every leaf of N's lineage is an accepted kpi_actual_value version (the slot's value in force).
    const leaves = Object.values((n!.inputs as Body).sources.s.inputs.sources).map((x: Body) => x.inputs);
    for (const leaf of leaves) {
      const row = await api.db
        .selectFrom("kpi_actual")
        .select(["accepted_value_no", "status"])
        .where("id", "=", leaf.kpiActualId)
        .executeTakeFirstOrThrow();
      expect([row.status, row.accepted_value_no]).toEqual(["accepted", leaf.valueNo]);
    }
  });
});

describe("roll-up lineage lists its entries (ADR-0027 amendment C1)", () => {
  it("two business-unit values roll up with one entry per scope, ordered by scopeId", async () => {
    const kpi = await ownedKpi(api, k, { ...DIRECT_FLOW, entryScopeKind: "business_unit" });
    const actualOf: Record<string, string> = {};
    for (const [scopeId, value] of [
      [w.a1, "4"],
      [w.a2, "6"],
    ] as const) {
      const r = await submitActual(api, k, kpi.id, {
        reportingPeriodId: period.id,
        scopeKind: "business_unit",
        scopeId,
        value,
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      actualOf[scopeId] = r.body.actual.id;
      expect((await runRecalculation(api, r.body.actual.id)).map((x) => x.outcome)).toEqual(["done"]);
    }
    const sorted = [w.a1, w.a2].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
    const entries = sorted.map((scopeId) => ({ scopeId, kpiActualId: actualOf[scopeId], valueNo: 1 }));
    const e = await evalOf(actualOf[w.a2]!, kpi.id);
    expect(e).toMatchObject({ value: "10.000000", value_source: "rolled_up" });
    expect(e!.inputs).toEqual({ expectedScopes: sorted, missingScopes: [], entries });
    // The earlier run (only the first scope reported so far) listed the one entry that entered its roll-up.
    const first = await evalOf(actualOf[w.a1]!, kpi.id);
    expect(first).toMatchObject({ value: "4.000000", value_source: "rolled_up" });
    expect((first!.inputs as Body).entries).toEqual([{ scopeId: w.a1, kpiActualId: actualOf[w.a1], valueNo: 1 }]);
  });
});

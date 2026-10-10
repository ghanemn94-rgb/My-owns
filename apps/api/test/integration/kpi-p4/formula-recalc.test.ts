// A formula KPI recalculated from ACCEPTED input actuals, end to end against a real PostgreSQL (T-DG4-KBE-R1 item 4;
// the KBE-C handback §7 item 10 "there is no integration test of a formula KPI recalculation"; ADR-0027 §8 step 2,
// ADR-0028 §8; REQ-S07-011, REQ-S07-013). The API's accept transaction, then the worker's kpi.recalculate consumer as
// the relay would deliver it (kbe-c-fixtures runRecalculation). Proven:
//  - with only input A accepted, the formula KPI T = a + b is Unknown with kpi.formula_input_unknown, value NULL (never
//    0, never green), in the same run as A's own evaluation;
//  - a value of B that is submitted for review but not accepted is not an input: T stays Unknown and no run is written;
//  - once B is accepted, its run re-evaluates T = 120 + 30 = 150 for the same period, binding A to its accepted value
//    from A's earlier acceptance (this test found that defect: before T-DG4-KBE-R1 an input the run did not
//    recalculate was Unknown, so T could never compute) and storing evaluations of B and T only;
//  - A's later accepted correction (value 2 = 125) recalculates T again to 125 + 30 = 155 in one new run, and the live
//    status of T shows that latest evaluation; nothing is ever summed from unaccepted values.
//  - Formula lineage (T-DG4-KBE-R3; ARCH-R2 item 5; ADR-0027 amendment C1, ADR-0028 amendment of 2026-10-10): T's
//    evaluation stores `sources` per variable, each with the source KPI, its version, the slot, what the binding used
//    and the source's own `inputs`, i.e. the ACCEPTED actual version (kpiActualId, valueNo). With B unaccepted, b is
//    Unknown with `inputs: {}` and `values` is absent; once B is accepted, T = a + b over separately accepted actuals
//    shows both source actual versions (A's bound from its earlier acceptance, binding only); A's correction shows
//    A's value 2. The run's other rows (A's, B's own evaluations), its findings and its events are those of the build
//    before the lineage (asserted exactly below).
// All data is SYNTHETIC; nothing here is a business approval or touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { seedKpiWorld, type KpiWorld } from "../kpi/fixtures.ts";
import {
  actualAction,
  type Body,
  DIRECT_FLOW,
  mapPartyTo,
  monthlyPeriod,
  ownedKpi,
  REVIEW_FLOW,
  runRecalculation,
  statusOf,
  submitActual,
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

const runsOf = (recordId: string) =>
  api.db.selectFrom("calculation_run").selectAll().where("trigger_record_id", "=", recordId).execute();
/** The period-basis evaluation of `kpiId` in run `runId` at the transformation scope, or undefined. */
const periodEvalOf = async (runId: string, kpiId: string) =>
  api.db
    .selectFrom("kpi_evaluation")
    .selectAll()
    .where("calculation_run_id", "=", runId)
    .where("kpi_definition_id", "=", kpiId)
    .where("value_basis", "=", "period")
    .where("scope_kind", "=", "transformation")
    .where("reporting_period_id", "=", period.id)
    .executeTakeFirst();
/** The lineage entry ADR-0027 amendment C1 specifies for one formula variable bound at the transformation scope. */
const sourceOf = (
  kpi: { id: string; versionId: string },
  value: string | null,
  inputs: Body,
  status = "ok",
  source = "entered",
) => ({
  kpiDefinitionId: kpi.id,
  kpiVersionId: kpi.versionId,
  inputBasis: "period",
  scopeKind: "transformation",
  scopeId: k.transformationId,
  reportingPeriodId: period.id,
  valueSource: source,
  valueStatus: status,
  value,
  inputs,
});

describe("a formula KPI recalculated from accepted input actuals (T-DG4-KBE-R1 item 4)", () => {
  it("is Unknown until every input is accepted, then a + b of the accepted values, re-evaluated on each acceptance", async () => {
    const def = { unitKind: "count", unitLabel: "lines", frequency: "monthly" } as const;
    const a = await ownedKpi(api, k, DIRECT_FLOW, { ...def, name: "Synthetic prepaid lines" });
    const b = await ownedKpi(api, k, REVIEW_FLOW, { ...def, name: "Synthetic postpaid lines" });
    const total = await ownedKpi(
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
      { ...def, name: "Synthetic total lines" },
    );

    // 1. A accepted (direct accept), B has nothing: T is Unknown with its reason, in A's run.
    const ra = await submitActual(api, k, a.id, { reportingPeriodId: period.id, value: "120" });
    expect(ra.status, JSON.stringify(ra.body)).toBe(201);
    const aActualId = ra.body.actual.id as string;
    expect((await runRecalculation(api, aActualId)).map((r) => r.outcome)).toEqual(["done"]);
    const [aRun] = await runsOf(aActualId);
    expect(aRun!.status).toBe("completed");
    expect(await periodEvalOf(aRun!.id, a.id)).toMatchObject({ value: "120.000000", value_status: "ok" });
    const t1 = await periodEvalOf(aRun!.id, total.id);
    expect(t1).toMatchObject({ value: null, value_status: "unknown", value_reason: "kpi.formula_input_unknown" });
    expect(t1!.calculated_rag).not.toBe("green");
    // Lineage with an Unknown input: b has no accepted value (valueSource none, Unknown, inputs {}), `values` absent;
    // a names A's accepted actual version.
    expect(t1!.inputs).toEqual({
      formula: "a + b",
      sources: {
        a: sourceOf(a, "120", { kpiActualId: aActualId, valueNo: 1 }),
        b: sourceOf(b, null, {}, "unknown", "none"),
      },
    });

    // 2. B submitted for review, not accepted: no run, and its value is not an input.
    const rb = await submitActual(api, k, b.id, { reportingPeriodId: period.id, value: "30" });
    expect(rb.status, JSON.stringify(rb.body)).toBe(201);
    const bActualId = rb.body.actual.id as string;
    expect(await runRecalculation(api, bActualId)).toEqual([]);
    expect(await runsOf(bActualId)).toEqual([]);

    // 3. B accepted by the reviewer (BO; a synthetic in-product review, not a G1-G6 approval): T = 120 + 30.
    const accepted = await actualAction(api, k, bActualId, "accept", rb.body.actual.version, {});
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect(accepted.body.status ?? accepted.body.actual?.status).toBe("accepted");
    expect((await runRecalculation(api, bActualId)).map((r) => r.outcome)).toEqual(["done"]);
    const [bRun] = await runsOf(bActualId);
    const t2 = await periodEvalOf(bRun!.id, total.id);
    expect(t2).toMatchObject({ value: "150.000000", value_status: "ok", value_source: "formula" });
    // The formula evaluation's lineage (ADR-0027 amendment C1): the expression, each variable's bound value, and per
    // variable the source slot down to its ACCEPTED actual version: A's actual value 1 (accepted in A's earlier run,
    // bound only here) and B's actual value 1 (accepted now). T = a + b over separately accepted actuals shows both.
    expect(t2!.inputs).toEqual({
      formula: "a + b",
      values: { a: "120", b: "30" },
      sources: {
        a: sourceOf(a, "120", { kpiActualId: aActualId, valueNo: 1 }),
        b: sourceOf(b, "30", { kpiActualId: bActualId, valueNo: 1 }),
      },
    });
    // The run's other rows, findings and events are unchanged by the lineage: B's own evaluations carry the entered
    // shape as built, the run records no finding (A's binding-only slot records none), and its events are one
    // kpi.deviation_evaluated per period-basis row plus one kpi.values_recalculated.
    const bRows = await api.db
      .selectFrom("kpi_evaluation")
      .select(["id", "value_basis", "value_source", "inputs"])
      .where("calculation_run_id", "=", bRun!.id)
      .where("kpi_definition_id", "=", b.id)
      .orderBy("value_basis")
      .execute();
    expect(bRows.map((r) => [r.value_basis, r.value_source, r.inputs])).toEqual([
      ["cumulative", "entered", { kpiActualId: bActualId, valueNo: 1, window: [period.id] }],
      ["period", "entered", { kpiActualId: bActualId, valueNo: 1 }],
    ]);
    expect([bRun!.evaluation_count, bRun!.finding_count]).toEqual([4, 0]);
    const runEvents = await api.db
      .selectFrom("outbox_event")
      .select(["event_type", "aggregate_id"])
      .where((eb) =>
        eb.or([
          eb("aggregate_id", "=", bRun!.id),
          eb(
            "aggregate_id",
            "in",
            eb.selectFrom("kpi_evaluation").select("id").where("calculation_run_id", "=", bRun!.id),
          ),
        ]),
      )
      .orderBy("seq")
      .execute();
    expect(runEvents.map((e) => e.event_type).sort()).toEqual([
      "kpi.deviation_evaluated",
      "kpi.deviation_evaluated",
      "kpi.values_recalculated",
    ]);
    // B's run stores evaluations of B and T only: A's value was bound, not re-evaluated or re-stored.
    const bRunKpis = await api.db
      .selectFrom("kpi_evaluation")
      .select("kpi_definition_id")
      .distinct()
      .where("calculation_run_id", "=", bRun!.id)
      .execute();
    expect(bRunKpis.map((r) => r.kpi_definition_id).sort()).toEqual([b.id, total.id].sort());
    expect(bRun!.formula_engine_version).toBe("mth-formula/1.0.0");

    // 4. A's accepted correction (value 2 = 125, direct accept): one new run, T = 125 + 30 = 155, and the live view
    //    of T shows it.
    const corrected = await actualAction(api, k, aActualId, "values", ra.body.actual.version, {
      action: "submit",
      value: "125",
      dataAsOf: "2041-01-31",
    });
    expect(corrected.status, JSON.stringify(corrected.body)).toBe(200);
    expect([corrected.body.actual.status, corrected.body.actual.acceptedValueNo]).toEqual(["accepted", 2]);
    expect((await runRecalculation(api, aActualId)).map((r) => r.outcome)).toEqual(["duplicate", "done"]);
    const aRuns = await runsOf(aActualId);
    expect(aRuns.map((r) => [r.trigger_slot, r.status])).toEqual([
      [1, "completed"],
      [2, "completed"],
    ]);
    const t3 = await periodEvalOf(aRuns[1]!.id, total.id);
    expect(t3).toMatchObject({ value: "155.000000", value_status: "ok" });
    // A's accepted correction is value 2 of the same actual; B's accepted value is still its value 1.
    expect(t3!.inputs).toEqual({
      formula: "a + b",
      values: { a: "125", b: "30" },
      sources: {
        a: sourceOf(a, "125", { kpiActualId: aActualId, valueNo: 2 }),
        b: sourceOf(b, "30", { kpiActualId: bActualId, valueNo: 1 }),
      },
    });
    const status = await statusOf(api, k, total.id);
    expect(status.status, JSON.stringify(status.body)).toBe(200);
    expect(status.body).toMatchObject({ actual: "155", actualStatus: "ok", evaluationId: t3!.id });
  });
});

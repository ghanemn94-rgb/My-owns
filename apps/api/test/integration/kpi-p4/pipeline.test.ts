// The accept pipeline end to end against a real PostgreSQL (T-DG4-KBE-C; ADR-0027 §7-§9; ADR-0028 §2-§7): the API's
// accept transaction, then the worker's kpi.recalculate consumer run in the test as the relay would deliver it.
//  - REQ-S07-013 "one accept -> exactly one calculation run and one audit event"; a redelivery writes no second run;
//    the live view (getKpiStatus) shows the new value once;
//  - REQ-S12-006 "one accepted actual -> one recalculation and one kpi.values_recalculated" (slice B writes its flag);
//  - REQ-S07-012 the review route: no run and Unknown until accepted;
//  - REQ-S07-007 RAG from the approved trajectory and the thresholds only (actual below red -> Red); "a new threshold
//    version -> one run, new RAG";
//  - REQ-S07-010 two business-unit ratios 1/10 and 9/10 roll up to 0.50 (weighted, never the mean of percentages);
//  - REQ-S07-006 a scope that reported before and is missing now makes the roll-up Unknown (no zero contribution), with
//    a scope_missing finding; no actual for the current period -> Unknown, never 0 or green.
// All data is synthetic; the trajectory approvals are synthetic in-product business approvals by a seeded SP user.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { seedKpiWorld, type KpiWorld } from "../kpi/fixtures.ts";
import {
  actualAction,
  approvedTrajectory,
  DIRECT_FLOW,
  mapPartyTo,
  monthlyPeriod,
  outboxOf,
  ownedKpi,
  REVIEW_FLOW,
  runRecalculation,
  statusOf,
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

const runsOf = (recordId: string) =>
  api.db.selectFrom("calculation_run").selectAll().where("trigger_record_id", "=", recordId).execute();
const evaluationsOf = (runId: string) =>
  api.db.selectFrom("kpi_evaluation").selectAll().where("calculation_run_id", "=", runId).execute();
const outboxOfType = (type: string, aggregateId: string) =>
  api.db
    .selectFrom("outbox_event")
    .select(["idempotency_key", "payload"])
    .where("event_type", "=", type)
    .where("aggregate_id", "=", aggregateId)
    .execute();

describe("the accept pipeline (REQ-S07-013, REQ-S12-006)", () => {
  it("one accept -> one audit event, one run (also after a redelivery), one values_recalculated; RAG from the trajectory", async () => {
    const kpi = await ownedKpi(api, k, DIRECT_FLOW);
    await approvedTrajectory(api, k, kpi.id, [{ pointDate: period.end, expectedValue: "100" }]);
    const res = await submitActual(api, k, kpi.id, { reportingPeriodId: period.id, value: "80" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const actualId = res.body.actual.id;
    expect((await auditOf(api.db, actualId)).length).toBe(1);
    const [first] = await runRecalculation(api, actualId);
    expect(first).toMatchObject({ outcome: "done" });
    // Redelivery and a restart: the same message again writes nothing.
    const [again] = await runRecalculation(api, actualId);
    expect(again!.outcome).toBe("duplicate");
    const runs = await runsOf(actualId);
    expect(runs.map((r) => [r.trigger_kind, r.trigger_slot, r.status, r.kpi_rules_version])).toEqual([
      ["actual_accepted", 1, "completed", "mth-kpi/1.0.0"],
    ]);
    expect((await auditOf(api.db, actualId)).length).toBe(1);
    expect((await auditOf(api.db, runs[0]!.id)).length).toBe(0);
    const evaluations = await evaluationsOf(runs[0]!.id);
    const periodEval = evaluations.find((e) => e.value_basis === "period")!;
    expect(periodEval).toMatchObject({
      value: "80.000000",
      value_status: "ok",
      expected_value: "100.000000",
      variance: "-20.000000",
      variance_ratio: "-0.200000",
      calculated_rag: "red",
      deviation: "adverse",
      threshold_source: "default",
      explanation_key: "kpi.rag.red_threshold",
    });
    expect(evaluations.map((e) => e.value_basis).sort()).toEqual(["cumulative", "period"]);
    expect(runs[0]!.evaluation_count).toBe(2);
    // One kpi.values_recalculated per run; one kpi.deviation_evaluated per evaluation of basis period.
    const recalculated = await outboxOfType("kpi.values_recalculated", runs[0]!.id);
    expect(recalculated.map((e) => e.idempotency_key)).toEqual([`kpi.values_recalculated:${runs[0]!.id}`]);
    expect(recalculated[0]!.payload).toMatchObject({
      runId: runs[0]!.id,
      kpiDefinitionIds: [kpi.id],
      reportingPeriodId: period.id,
    });
    expect((await outboxOfType("kpi.deviation_evaluated", periodEval.id)).length).toBe(1);
    // The live view shows the new value once, with the seven elements.
    const status = await statusOf(api, k, kpi.id);
    expect(status.status, JSON.stringify(status.body)).toBe(200);
    expect(status.body).toMatchObject({
      actual: "80",
      actualStatus: "ok",
      expectedToDate: "100",
      variance: "-20",
      varianceRatio: "-0.2",
      calculatedRag: "red",
      displayedRag: "red",
      periodLabel: period.label,
      evaluationId: periodEval.id,
      calculationRunId: runs[0]!.id,
    });
    expect(status.body.explanation).toMatchObject({ key: "kpi.rag.red_threshold", thresholdSource: "default" });

    // REQ-S07-007: a new threshold version -> one run, new RAG (d = 0.20 <= amber 0.25 -> green).
    const threshold = await call<Body>(api.app, "POST", `${k.base}/kpi-definitions/${kpi.id}/rag-thresholds`, {
      session: k.s.kds,
      body: { toleranceMode: "relative", amberThreshold: "0.25", redThreshold: "0.30", reason: "Synthetic tolerance" },
    });
    expect(threshold.status, JSON.stringify(threshold.body)).toBe(201);
    const [t] = await runRecalculation(api, threshold.body.id);
    expect(t!.outcome).toBe("done");
    const thresholdRuns = await runsOf(threshold.body.id);
    expect(thresholdRuns.map((r) => [r.trigger_kind, r.trigger_slot])).toEqual([["threshold_changed", 1]]);
    const after = await statusOf(api, k, kpi.id);
    expect([
      after.body.calculatedRag,
      after.body.explanation.thresholdSource,
      after.body.explanation.thresholdVersion,
    ]).toEqual(["green", "configured", 1]);
    expect(after.body.explanation.amberThreshold).toBe("0.25");
  });

  it("review route: no run and Unknown until a reviewer accepts; then one run and the value", async () => {
    const kpi = await ownedKpi(api, k, REVIEW_FLOW);
    const res = await submitActual(api, k, kpi.id, { reportingPeriodId: period.id, value: "50" });
    const a = res.body.actual;
    expect(await runRecalculation(api, a.id)).toEqual([]);
    const before = await statusOf(api, k, kpi.id);
    expect([before.body.actual, before.body.actualStatus, before.body.actualReason, before.body.calculatedRag]).toEqual(
      [null, "unknown", "kpi.no_accepted_actual", "unknown"],
    );
    const accepted = await actualAction(api, k, a.id, "accept", a.version, {});
    expect(accepted.status).toBe(200);
    const pending = await statusOf(api, k, kpi.id);
    expect(pending.body.actualReason).toBe("kpi.calculation_pending");
    await runRecalculation(api, a.id);
    expect((await runsOf(a.id)).length).toBe(1);
    const status = await statusOf(api, k, kpi.id);
    expect([status.body.actual, status.body.actualStatus]).toEqual(["50", "ok"]);
    // No trajectory: the RAG is Unknown with its reason, never green.
    expect([status.body.calculatedRag, status.body.expectedReason]).toEqual(["unknown", "kpi.no_approved_trajectory"]);
  });
});

describe("roll-up across scopes (REQ-S07-006, REQ-S07-010)", () => {
  it("two business-unit ratios 1/10 and 9/10 roll up to 0.50 at the transformation scope", async () => {
    const kpi = await ownedKpi(
      api,
      k,
      {
        measureType: "higher_is_better",
        valueNature: "ratio",
        aggregationRule: "weighted_ratio",
        submissionRoute: "direct_accept",
        entryScopeKind: "business_unit",
        numeratorLabel: "Synthetic converted",
        denominatorLabel: "Synthetic offered",
      },
      { unitKind: "percentage", unitLabel: null },
    );
    const one = await submitActual(api, k, kpi.id, {
      reportingPeriodId: period.id,
      scopeKind: "business_unit",
      scopeId: w.a1,
      numerator: "1",
      denominator: "10",
    });
    const two = await submitActual(api, k, kpi.id, {
      reportingPeriodId: period.id,
      scopeKind: "business_unit",
      scopeId: w.a2,
      numerator: "9",
      denominator: "10",
    });
    expect([one.status, two.status]).toEqual([201, 201]);
    await runRecalculation(api, one.body.actual.id);
    await runRecalculation(api, two.body.actual.id);
    const status = await statusOf(api, k, kpi.id);
    expect(
      [status.body.actual, status.body.actualStatus, status.body.changeLabel],
      JSON.stringify(status.body),
    ).toEqual(["0.5", "ok", "pp"]);
    const bu = await statusOf(api, k, kpi.id, `?scopeKind=business_unit&scopeId=${w.a1}`);
    expect(bu.body.actual).toBe("0.1");
  });

  it("a scope missing in the current period makes the roll-up Unknown (no zero), with a scope_missing finding", async () => {
    const kpi = await ownedKpi(api, k, { ...DIRECT_FLOW, entryScopeKind: "business_unit" });
    const earlier = period;
    for (const scopeId of [w.a1, w.a2]) {
      const r = await submitActual(api, k, kpi.id, {
        reportingPeriodId: earlier.id,
        scopeKind: "business_unit",
        scopeId,
        value: "5",
      });
      await runRecalculation(api, r.body.actual.id);
    }
    const next = await monthlyPeriod(api, w);
    const only = await submitActual(api, k, kpi.id, {
      reportingPeriodId: next.id,
      scopeKind: "business_unit",
      scopeId: w.a1,
      value: "7",
      dataAsOf: next.end,
    });
    expect(only.status, JSON.stringify(only.body)).toBe(201);
    await runRecalculation(api, only.body.actual.id);
    const status = await statusOf(api, k, kpi.id, `?reportingPeriodId=${next.id}`);
    expect([status.body.actual, status.body.actualStatus, status.body.actualReason, status.body.calculatedRag]).toEqual(
      [null, "unknown", "kpi.scope_missing", "unknown"],
    );
    const findings = await api.db
      .selectFrom("data_quality_finding")
      .select(["rule_code", "scope_kind", "status"])
      .where("kpi_definition_id", "=", kpi.id)
      .where("reporting_period_id", "=", next.id)
      .execute();
    expect(findings).toContainEqual({ rule_code: "scope_missing", scope_kind: "transformation", status: "open" });
    // The earlier period's roll-up was complete: 5 + 5.
    const earlierStatus = await statusOf(api, k, kpi.id, `?reportingPeriodId=${earlier.id}`);
    expect(earlierStatus.body.actual).toBe("10");
  });

  it("a KPI with no actual for the current period renders Unknown, never 0 or green", async () => {
    const kpi = await ownedKpi(api, k, DIRECT_FLOW);
    const status = await statusOf(api, k, kpi.id);
    expect(status.body).toMatchObject({
      actual: null,
      actualStatus: "unknown",
      actualReason: "kpi.no_accepted_actual",
      calculatedRag: "unknown",
      displayedRag: "unknown",
      freshness: { status: "unknown", dataAsOf: null },
    });
    const list = await call<Body>(api.app, "GET", `${k.base}/kpi-status`, { session: k.s.auditor });
    const item = list.body.items.find((i: Body) => i.kpiDefinitionId === kpi.id);
    expect([item.actual, item.calculatedRag]).toEqual([null, "unknown"]);
  });
});

describe("outbox events of the pipeline", () => {
  it("writes kpi.actual_accepted with its idempotency key and the slot payload", async () => {
    const kpi = await ownedKpi(api, k, DIRECT_FLOW);
    const res = await submitActual(api, k, kpi.id, { reportingPeriodId: period.id, value: "1" });
    const events = await outboxOf(api, res.body.actual.id);
    expect(events[0]!.payload).toEqual({
      kpiActualId: res.body.actual.id,
      valueNo: 1,
      kpiDefinitionId: kpi.id,
      transformationId: k.transformationId,
      scopeKind: "transformation",
      scopeId: k.transformationId,
      reportingPeriodId: period.id,
    });
  });
});

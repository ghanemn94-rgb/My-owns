// A05 "Calculation correctness" (master prompt §20): "Automated tests cover higher/lower/band measures, stale/missing
// values, zero denominator, percentage points, periods and currency/decimal precision."
//
// Black-box acceptance suite (qa-verifier, T-DG4-QA-A) through the REAL API (Fastify inject; every response validated
// against docs/api/openapi.yaml) on the run's disposable PostgreSQL. The rows whose A05 text says "unit tests"
// (REQ-S07-002) and the pure display/period rules are covered again in tests/qa/unit/a05-calc-units.test.ts.
// KPI recalculation after an accept or a threshold change is the worker's kpi.recalculate consumer, invoked here with the
// outbox envelope as the relay delivers it (the A04 suite runs the full relay + pg-boss worker). Values are decimal
// strings compared with `canon`, never floats.
// All data is SYNTHETIC; trajectory, Finance and Sponsor approvals here are synthetic in-product approvals of test data.
import { sql } from "../../../packages/db/src/index.ts";
import { businessDateOf } from "../../../packages/shared/src/time/index.ts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recalculatePending } from "../../../apps/worker/src/handlers/benefits.ts";
import { call, startApi, type TestApi } from "../support/api.ts";
import {
  approvedTrajectory,
  asBenefitWorld,
  canon,
  createKpi,
  dashboardWorld,
  DIRECT_FLOW,
  ensureDefaultCalendar,
  envelopeOf,
  evidenceItem,
  expectCode,
  get200,
  ifMatch,
  insertExecInitiative,
  measuredBenefit,
  newDependency,
  openPeriod,
  ownedKpi,
  riyadhToday,
  revenueFormula,
  runRecalculation,
  seedBenefitWorld,
  seedExecutionWorld,
  seedWorld,
  setDuration,
  SIX_ACCEPTED,
  submitActual,
  type Body,
  type KpiWorld,
  type World,
} from "../support/p4.ts";

let api: TestApi;
let w: World;
let k: KpiWorld;
let jan: { id: string; label: string; start: string; end: string };
let feb: { id: string; label: string; start: string; end: string };
/** 2026-10 (the REQ-S15-008 example) and the reporting period that contains today (Asia/Riyadh). */
let oct: { id: string; label: string; start: string; end: string };
let current: { id: string; label: string; start: string; end: string };
/** Today's business date in Asia/Riyadh: actuals are entered "as of today", so they are fresh, not Stale. */
let today: string;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  k = await dashboardWorld(api, w);
  ({ today } = await riyadhToday(api));
  jan = await openPeriod(api, w, "monthly", "2026-01", "2026-01-01", "2026-01-31");
  feb = await openPeriod(api, w, "monthly", "2026-02", "2026-02-01", "2026-02-28");
  oct = await openPeriod(api, w, "monthly", "2026-10", "2026-10-01", "2026-10-31");
  const [y, m] = today.split("-").map(Number) as [number, number];
  const label = `${y}-${String(m).padStart(2, "0")}`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  current =
    label === oct.label
      ? oct
      : label === jan.label
        ? jan
        : label === feb.label
          ? feb
          : await openPeriod(api, w, "monthly", label, `${label}-01`, `${label}-${String(last).padStart(2, "0")}`);
}, 120_000);
afterAll(() => api?.close());

const status = (kpiId: string, query = "") =>
  get200(api, k.s.auditor, `${k.base}/kpi-definitions/${kpiId}/status${query}`);
/** Submit on the direct-accept route and run the recalculation it triggers; returns the actual. */
async function accepted(kpiId: string, body: Record<string, unknown>): Promise<Body> {
  const r = await submitActual(api, k, kpiId, { dataAsOf: today, ...body });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  await runRecalculation(api, r.body.actual.id);
  return r.body.actual;
}
const runsOf = (triggerRecordId: string) =>
  api.db
    .selectFrom("calculation_run")
    .select(["id", "trigger_kind"])
    .where("trigger_record_id", "=", triggerRecordId)
    .orderBy("seq")
    .execute();
const check = (body: Record<string, unknown>) =>
  call<Body>(api.app, "POST", "/api/v1/benefit-formulas/validate", { session: k.s.tl, body });

// ------------------------------------------------------------------------------------------------ measures and RAG

describe("A05: higher/lower/band measures and RAG from the trajectory (REQ-S07-002, REQ-S07-007)", () => {
  it("REQ-S07-007: actual below the red threshold of the approved trajectory is Red; a new threshold version recomputes RAG", async () => {
    // ADR-0027 §8 / ADR-0028 §5: a new threshold version re-evaluates the KPI's CURRENT reporting period.
    const kpi = await ownedKpi(api, k, DIRECT_FLOW);
    await approvedTrajectory(api, k, kpi.id, [{ pointDate: current.end, expectedValue: "100" }]);
    const a = await accepted(kpi.id, { reportingPeriodId: current.id, value: "80" });
    let s = await status(kpi.id, `?reportingPeriodId=${current.id}`);
    expect([canon(s.actual), canon(s.expectedToDate), s.calculatedRag], JSON.stringify(s)).toEqual([
      "80",
      "100",
      "red",
    ]);
    expect((await runsOf(a.id)).map((r) => r.trigger_kind)).toEqual(["actual_accepted"]);
    // Threshold version: 20 % shortfall is inside a 25 % amber tolerance -> green after ONE recalculation run.
    const t = await call<Body>(api.app, "POST", `${k.base}/kpi-definitions/${kpi.id}/rag-thresholds`, {
      session: k.s.kds,
      body: { toleranceMode: "relative", amberThreshold: "0.25", redThreshold: "0.30", reason: "Synthetic tolerance" },
    });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    await runRecalculation(api, t.body.id);
    expect((await runsOf(t.body.id)).map((r) => r.trigger_kind)).toEqual(["threshold_changed"]);
    s = await status(kpi.id, `?reportingPeriodId=${current.id}`);
    expect(s.calculatedRag).toBe("green");
  });

  it("REQ-S07-002: lower-is-better 80 against 90 is favourable (green); higher-is-better 80 against 90 is adverse (not green)", async () => {
    const lower = await ownedKpi(
      api,
      k,
      { ...DIRECT_FLOW, measureType: "lower_is_better" },
      { polarity: "lower_is_better" },
    );
    const higher = await ownedKpi(api, k, DIRECT_FLOW);
    for (const kpi of [lower, higher]) {
      await approvedTrajectory(api, k, kpi.id, [{ pointDate: jan.end, expectedValue: "90" }]);
      await accepted(kpi.id, { reportingPeriodId: jan.id, value: "80" });
    }
    expect((await status(lower.id, `?reportingPeriodId=${jan.id}`)).calculatedRag).toBe("green");
    expect(["amber", "red"]).toContain((await status(higher.id, `?reportingPeriodId=${jan.id}`)).calculatedRag);
  });

  it("REQ-S07-002: an acceptable band 5-10 with actual 12 is outside the band (not green)", async () => {
    const band = await ownedKpi(
      api,
      k,
      {
        measureType: "acceptable_band",
        valueNature: "stock",
        aggregationRule: "last_value",
        submissionRoute: "direct_accept",
        bandLower: "5",
        bandUpper: "10",
      },
      { polarity: "within_band" },
    );
    await accepted(band.id, { reportingPeriodId: jan.id, value: "12" });
    const s = await status(band.id, `?reportingPeriodId=${jan.id}`);
    expect(canon(s.actual)).toBe("12");
    expect(["amber", "red"], JSON.stringify(s)).toContain(s.calculatedRag);
  });
});

// ------------------------------------------------------------------------------------------------ missing, zero, periods

describe("A05: stale/missing values, zero denominator, percentage points and periods", () => {
  it("REQ-S07-006: a KPI with no actual for the period renders Unknown (labelled), never 0 or green", async () => {
    const kpi = await ownedKpi(api, k, DIRECT_FLOW);
    await approvedTrajectory(api, k, kpi.id, [{ pointDate: jan.end, expectedValue: "100" }]);
    const s = await status(kpi.id, `?reportingPeriodId=${jan.id}`);
    expect([s.actual, s.actualStatus, s.calculatedRag, s.displayedRag]).toEqual([
      null,
      "unknown",
      "unknown",
      "unknown",
    ]);
    expect(typeof s.actualReason).toBe("string");
    const list = await get200(api, k.s.auditor, `${k.base}/kpi-status`);
    const item = (list.items as Body[]).find((i) => i.kpiDefinitionId === kpi.id);
    expect([item.actual, item.calculatedRag]).toEqual([null, "unknown"]);
  });

  it("REQ-S07-006: a roll-up with a scope that reported before but is missing now is Unknown, not a sum with 0", async () => {
    const kpi = await ownedKpi(api, k, { ...DIRECT_FLOW, entryScopeKind: "business_unit" });
    for (const scopeId of [w.a1, w.a2])
      await accepted(kpi.id, { reportingPeriodId: jan.id, scopeKind: "business_unit", scopeId, value: "5" });
    await accepted(kpi.id, { reportingPeriodId: feb.id, scopeKind: "business_unit", scopeId: w.a1, value: "7" });
    expect(canon((await status(kpi.id, `?reportingPeriodId=${jan.id}`)).actual)).toBe("10");
    const s = await status(kpi.id, `?reportingPeriodId=${feb.id}`);
    expect([s.actual, s.actualStatus]).toEqual([null, "unknown"]);
  });

  it("REQ-S07-005: a zero denominator is 'Not computable' (no division error, not 0)", async () => {
    const r = await check({
      expression: "saved / handled",
      variables: [
        { name: "saved", kind: "number", period: "none", value: "5" },
        { name: "handled", kind: "number", period: "none", value: "0" },
      ],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.result).toBeNull();
    expect((r.body.errors as Body[]).map((e) => e.code)).toContain("formula.division_by_zero");
    // A ratio KPI entry with a zero denominator is not stored as 0 either.
    const ratio = await ownedKpi(
      api,
      k,
      {
        measureType: "higher_is_better",
        valueNature: "ratio",
        aggregationRule: "weighted_ratio",
        submissionRoute: "direct_accept",
        numeratorLabel: "Synthetic converted",
        denominatorLabel: "Synthetic offered",
      },
      { unitKind: "percentage", unitLabel: null },
    );
    const z = await submitActual(api, k, ratio.id, {
      reportingPeriodId: jan.id,
      numerator: "0",
      denominator: "0",
      dataAsOf: "2026-01-31",
    });
    if (z.status === 201) {
      await runRecalculation(api, z.body.actual.id);
      const s = await status(ratio.id, `?reportingPeriodId=${jan.id}`);
      expect(s.actual, JSON.stringify(s)).toBeNull();
      expect(s.actualStatus).not.toBe("ok");
    } else {
      expect(z.status, JSON.stringify(z.body)).toBe(422);
    }
  });

  it("REQ-S07-004: a percentage KPI moving 0.10 -> 0.12 is labelled in percentage points (pp), rates stored as fractions", async () => {
    const pct = await ownedKpi(
      api,
      k,
      { ...DIRECT_FLOW, valueNature: "stock", aggregationRule: "last_value" },
      { unitKind: "percentage", unitLabel: null },
    );
    await approvedTrajectory(api, k, pct.id, [{ pointDate: jan.end, expectedValue: "0.10" }]);
    await accepted(pct.id, { reportingPeriodId: jan.id, value: "0.12" });
    const s = await status(pct.id, `?reportingPeriodId=${jan.id}`);
    expect([canon(s.actual), canon(s.expectedToDate), canon(s.variance), s.changeLabel], JSON.stringify(s)).toEqual([
      "0.12",
      "0.1",
      "0.02",
      "pp",
    ]);
    expect(canon(s.varianceRatio)).toBe("0.2");
  });

  it("REQ-S07-004: the cumulative (YTD) value of a flow KPI equals the sum of its period flows", async () => {
    const flow = await ownedKpi(api, k, DIRECT_FLOW);
    await accepted(flow.id, { reportingPeriodId: jan.id, value: "10.5" });
    const second = await accepted(flow.id, { reportingPeriodId: feb.id, value: "15.25" });
    const [run] = await runsOf(second.id);
    const detail = await get200(api, k.s.auditor, `${k.base}/calculation-runs/${run!.id}`);
    const byBasis = Object.fromEntries((detail.evaluations as Body[]).map((e) => [e.valueBasis, e]));
    expect([canon(byBasis.period?.value), canon(byBasis.cumulative?.value)], JSON.stringify(detail)).toEqual([
      "15.25",
      "25.75",
    ]);
  });
});

// ------------------------------------------------------------------------------------------------ aggregation and formulas

describe("A05: aggregation, formulas and currency/decimal precision", () => {
  it("REQ-S07-010: two business-unit ratios 1/10 and 9/10 roll up to 0.50 (weighted), not the mean of percentages", async () => {
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
    await accepted(kpi.id, {
      reportingPeriodId: jan.id,
      scopeKind: "business_unit",
      scopeId: w.a1,
      numerator: "1",
      denominator: "10",
    });
    await accepted(kpi.id, {
      reportingPeriodId: jan.id,
      scopeKind: "business_unit",
      scopeId: w.a2,
      numerator: "80",
      denominator: "90",
    });
    // The acceptance example: 1/10 and 9/10 -> (1 + 9) / (10 + 10) = 0.5.
    const kpi2 = await ownedKpi(
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
    await accepted(kpi2.id, {
      reportingPeriodId: jan.id,
      scopeKind: "business_unit",
      scopeId: w.a1,
      numerator: "1",
      denominator: "10",
    });
    await accepted(kpi2.id, {
      reportingPeriodId: jan.id,
      scopeKind: "business_unit",
      scopeId: w.a2,
      numerator: "9",
      denominator: "10",
    });
    expect(canon((await status(kpi2.id, `?reportingPeriodId=${jan.id}`)).actual)).toBe("0.5");
    // The row's example cannot tell weighted from averaged (both give 0.5). Unequal weights can: 1/10 and 80/90 roll up
    // to (1 + 80) / (10 + 90) = 0.81, while the mean of the two percentages would be 0.4944...
    expect(canon((await status(kpi.id, `?reportingPeriodId=${jan.id}`)).actual)).toBe("0.81");
  });

  it("REQ-S07-010: summing SAR with USD without conversion is rejected", async () => {
    const sar = await ownedKpi(api, k, DIRECT_FLOW, { unitKind: "currency", unitLabel: null, currency: "SAR" });
    const usd = await submitActual(api, k, sar.id, {
      reportingPeriodId: jan.id,
      value: "100",
      currency: "USD",
      dataAsOf: "2026-01-31",
    });
    expectCode(usd, 422, "kpi_actual.currency_mismatch");
    const mixed = await check({
      expression: "a + b",
      variables: [
        { name: "a", kind: "currency", currency: "SAR", period: "none", value: "1" },
        { name: "b", kind: "currency", currency: "USD", period: "none", value: "1" },
      ],
    });
    expect(mixed.status, JSON.stringify(mixed.body)).toBe(422);
  });

  it("REQ-S07-011: KPI A = B + 1 and B = A * 2 is rejected as circular; adding SAR to a count is rejected", async () => {
    const score = (name: string) =>
      createKpi(api, k, { name, unitKind: "score", unitLabel: null, frequency: "ad_hoc" });
    const a = await score("QA A05 KPI A");
    const b = await score("QA A05 KPI B");
    const version = (expression: string, variableName: string, sourceKpiDefinitionId: string) => ({
      ...DIRECT_FLOW,
      calculationMethod: "formula",
      formulaExpression: expression,
      formulaInputs: [{ variableName, sourceKpiDefinitionId, inputBasis: "period" }],
    });
    const av = await call<Body>(api.app, "POST", `${k.base}/kpi-definitions/${a.id}/versions`, {
      session: k.s.kds,
      body: version("b + 1", "b", b.id),
    });
    expect(av.status, JSON.stringify(av.body)).toBe(201);
    const act = await call<Body>(api.app, "POST", `${k.base}/kpi-versions/${av.body.id}/activate`, {
      session: k.s.kds,
      headers: ifMatch(av.body.version),
    });
    expect(act.status, JSON.stringify(act.body)).toBe(200);
    const bv = await call<Body>(api.app, "POST", `${k.base}/kpi-definitions/${b.id}/versions`, {
      session: k.s.kds,
      body: version("a * 2", "a", a.id),
    });
    expectCode(bv, 422, "kpi_formula.circular");
    const sarPlusCount = await check({
      expression: "revenue + lines",
      variables: [
        { name: "revenue", kind: "currency", currency: "SAR", period: "none", value: "10" },
        { name: "lines", kind: "count", unit: "lines", period: "none", value: "3" },
      ],
    });
    expect(sarPlusCount.status, JSON.stringify(sarPlusCount.body)).toBe(422);
  });

  it("REQ-S08-004: a function outside the whitelist or a JavaScript payload is rejected at parse time", async () => {
    const v = [{ name: "x", kind: "number", period: "none", value: "1" }];
    for (const expression of [
      'eval("1")',
      "Function('return 1')()",
      "x.constructor.constructor('return process')()",
      "require('child_process')",
      "x; process.exit(1)",
      "(() => 1)()",
      "fetch(x)",
      "x + `${1}`",
    ]) {
      const r = await check({ expression, variables: v });
      expect(r.status, `${expression}: ${JSON.stringify(r.body)}`).toBe(422);
      expect(String(r.body.code), expression).toMatch(/^formula\./);
    }
    // A whitelisted expression is accepted and evaluated with decimals.
    const ok = await check({ expression: "x * 2", variables: v });
    expect([ok.status, canon(ok.body.result)]).toEqual([200, "2"]);
  });

  it("REQ-S16-025: 0.1 + 0.2 SAR sums to exactly 0.30; 100000 x 0.02 x 50 SAR equals exactly 100000.00", async () => {
    const sum = await check({
      expression: "a + b",
      variables: [
        { name: "a", kind: "currency", currency: "SAR", period: "none", value: "0.1" },
        { name: "b", kind: "currency", currency: "SAR", period: "none", value: "0.2" },
      ],
    });
    expect([sum.status, canon(sum.body.result), sum.body.resultCurrency]).toEqual([200, "0.3", "SAR"]);
    // 0.1 + 0.2 alone cannot tell decimals from binary floats once a result is rounded to money scale. Beyond 2^53
    // precision it can: a float sum of 900719925474099.1 + 0.2 is 900719925474099.25; the decimal sum is exact.
    const big = await check({
      expression: "a + b",
      variables: [
        { name: "a", kind: "currency", currency: "SAR", period: "none", value: "900719925474099.1" },
        { name: "b", kind: "currency", currency: "SAR", period: "none", value: "0.2" },
      ],
    });
    expect([big.status, canon(big.body.result)]).toEqual([200, "900719925474099.3"]);
    const benefit = await check({
      expression: "customers * uplift * arpu",
      variables: [
        { name: "customers", kind: "count", unit: "customers", period: "none", value: "100000" },
        { name: "uplift", kind: "fraction", period: "none", value: "0.02" },
        { name: "arpu", kind: "currency", currency: "SAR", period: "none", value: "50" },
      ],
    });
    expect([benefit.status, canon(benefit.body.result), benefit.body.resultCurrency]).toEqual([200, "100000", "SAR"]);
    // Stored money: two validated benefit values of 0.1 and 0.2 SAR total exactly 0.3 SAR.
    const bw = await seedBenefitWorld(api, w);
    for (const amount of ["0.1", "0.2"]) {
      const ben = await measuredBenefit(api, bw);
      const ev = await evidenceItem(api, bw);
      const m = await call<Body>(api.app, "POST", `${bw.base}/benefits/${ben.id}/measurements`, {
        session: bw.s.bo,
        body: { periodStart: "2036-01-01", periodEnd: "2036-01-31", amount, evidenceIds: [ev], submit: true },
      });
      expect(m.status, JSON.stringify(m.body)).toBe(201);
      const { queueFinanceValidation } = await import("../../../apps/worker/src/handlers/benefits.ts");
      await queueFinanceValidation(
        api.db,
        await envelopeOf(api, m.body.id, "benefit.evidence_submitted"),
        `qa-${m.body.id}`,
      );
      const item = await api.db
        .selectFrom("finance_validation")
        .select(["id", "version"])
        .where("benefit_measurement_id", "=", m.body.id)
        .executeTakeFirstOrThrow();
      const d = await call<Body>(api.app, "POST", `${bw.base}/finance-validations/${item.id}/decision`, {
        session: bw.s.fin,
        headers: ifMatch(item.version),
        body: { decision: "approved", items: SIX_ACCEPTED, approvedAmount: amount },
      });
      expect(d.status, JSON.stringify(d.body)).toBe(200);
    }
    const t = await get200(api, bw.s.auditor, `${bw.base}/benefit-totals`);
    const sar = (t.currencies as Body[]).find((c) => c.currency === "SAR");
    const validated = (sar.lines as Body[]).find((l) => l.valueClass === "revenue_uplift" && l.state === "validated");
    expect(canon(validated.total.amount)).toBe("0.3");
    expect(validated.total.amount).toMatch(/^0\.30*$/);
  });

  it("REQ-S08-006: a benefit value drills to the formula version and input actual versions; a formula change keeps the old reference", async () => {
    const kpi = await ownedKpi(api, k, DIRECT_FLOW, { unitKind: "count", unitLabel: "customers" });
    const b = asBenefitWorld(k, w, kpi.id);
    const formula = await revenueFormula(api, b);
    const ben = await measuredBenefit(api, b, {
      formula,
      extra: { measurementKpiDefinitionId: kpi.id, measurementKpiVariable: "eligible_customers" },
    });
    const actual = await accepted(kpi.id, { reportingPeriodId: feb.id, value: "100000" });
    const [run] = await runsOf(actual.id);
    const env = await envelopeOf(api, run!.id, "kpi.values_recalculated");
    expect(env, "the accept run emits kpi.values_recalculated").toBeDefined();
    await recalculatePending(api.db, env, `qa-a05-${run!.id}`);
    const list = await get200(api, b.s.auditor, `${b.base}/benefits/${ben.id}/measurements`);
    const pending = (list.items as Body[]).find((m) => m.calculationRunId === run!.id);
    expect(pending, JSON.stringify(list.items)).toBeDefined();
    const m = await get200(api, b.s.auditor, `${b.base}/benefit-measurements/${pending.id}`);
    expect(m.formulaVersionId).toBe(formula.versionId);
    const input = (m.inputs as Body[]).find((i) => i.variableName === "eligible_customers");
    expect([input.kpiActualId, input.kpiValueNo, canon(input.value)]).toEqual([actual.id, 1, "100000"]);
    // (0.12 - 0.10) x 100000 x 50 = 100000 SAR.
    expect(canon(m.amount)).toBe("100000");
    // A new formula version leaves the old result bound to version 1.
    const formulaNow = await get200(api, b.s.tl, `/api/v1/benefit-formulas/${formula.id}`);
    const v2 = await call<Body>(api.app, "POST", `/api/v1/benefit-formulas/${formula.id}/versions`, {
      session: b.s.tl,
      headers: ifMatch(formulaNow.version),
      body: {
        expression: "(target_attach_rate - baseline_attach_rate) * eligible_customers * arpu",
        variables: [
          { name: "baseline_attach_rate", kind: "fraction", period: "none", value: "0.10" },
          { name: "target_attach_rate", kind: "fraction", period: "none", value: "0.13" },
          { name: "eligible_customers", kind: "count", unit: "customers", period: "year", value: "100000" },
          { name: "arpu", kind: "currency", currency: "SAR", unit: "per customer", period: "year", value: "50" },
        ],
        changeNote: "Synthetic: revised target attach rate",
      },
    });
    expect(v2.status, JSON.stringify(v2.body)).toBe(201);
    const again = await get200(api, b.s.auditor, `${b.base}/benefit-measurements/${pending.id}`);
    expect(again.formulaVersionId).toBe(formula.versionId);
  });
});

// ------------------------------------------------------------------------------------------------ execution and time

describe("A05: decimal SAR budgets, working-day slip, critical path and business dates", () => {
  it("REQ-S09-007: budget/actual/forecast use decimal SAR; forecast slip vs approved date is shown in working days", async () => {
    const x = await seedExecutionWorld(api, w);
    await ensureDefaultCalendar(api, w);
    const ini = await insertExecInitiative(api.db, x, "INI-91");
    for (const [label, budget, actual, forecast] of [
      ["Synthetic licences", "0.1", "0.05", "0.15"],
      ["Synthetic services", "0.2", "0.25", "0.15"],
    ] as const) {
      const r = await call<Body>(api.app, "POST", `/api/v1/initiatives/${ini}/budget-lines`, {
        session: x.s.fin,
        body: { label, budgetAmount: budget, actualAmount: actual, forecastAmount: forecast },
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body.currency).toBe("SAR");
    }
    // Approved Thursday 2041-01-03, forecast Thursday 2041-01-17: 14 calendar days, 10 Sunday-Thursday working days.
    const ms = await call<Body>(api.app, "POST", `/api/v1/initiatives/${ini}/milestones`, {
      session: x.s.tl,
      body: { title: "Synthetic go-live", forecastDate: "2041-01-03" },
    });
    expect(ms.status, JSON.stringify(ms.body)).toBe(201);
    const ap = await call<Body>(api.app, "POST", `/api/v1/milestones/${ms.body.id}/approve-date`, {
      session: x.s.tl,
      headers: ifMatch(ms.body.version),
      body: { approvedDate: "2041-01-03", reason: "Synthetic baseline" },
    });
    expect(ap.status, JSON.stringify(ap.body)).toBe(200);
    const mv = await call<Body>(api.app, "PATCH", `/api/v1/milestones/${ms.body.id}`, {
      session: x.s.tl,
      headers: ifMatch(ap.body.version),
      body: { forecastDate: "2041-01-17" },
    });
    expect(mv.status, JSON.stringify(mv.body)).toBe(200);
    const e = await get200(api, x.s.auditor, `/api/v1/initiatives/${ini}/execution`);
    const sar = (e.budgetTotals as Body[]).find((t) => t.currency === "SAR");
    expect([canon(sar.budget.amount), canon(sar.actual.amount), canon(sar.forecast.amount)]).toEqual([
      "0.3",
      "0.3",
      "0.3",
    ]);
    const m = (e.milestones as Body[]).find((i) => i.milestoneId === ms.body.id);
    expect([m.calendarVarianceDays, m.slipWorkingDays], JSON.stringify(m)).toEqual([
      14,
      { status: "known", value: 10, reason: null },
    ]);
  });

  it("REQ-S09-009: the fixture network's critical path is the expected chain; with a missing duration no path is claimed", async () => {
    const x = await seedExecutionWorld(api, w);
    await ensureDefaultCalendar(api, w);
    const send = (m: string, u: string, o?: Body) => call<Body>(api.app, m, u, o);
    // A(3) -> B(7) -> D(2); A -> C(4) -> D. Longest chain A-B-D = 12 working days; C has total float 3.
    const [a, b, c, d] = [
      await insertExecInitiative(api.db, x, "INI-11"),
      await insertExecInitiative(api.db, x, "INI-12"),
      await insertExecInitiative(api.db, x, "INI-13"),
      await insertExecInitiative(api.db, x, "INI-14"),
    ];
    for (const [from, to] of [
      [a, b],
      [b, d],
      [a, c],
      [c, d],
    ] as const)
      await newDependency(send, x, from, to);
    for (const [id, days] of [
      [a, 3],
      [b, 7],
      [c, 4],
    ] as const)
      await setDuration(send, x, id, days);
    // D's duration is missing: nothing is claimed critical.
    let net = await get200(api, x.s.auditor, `/api/v1/transformations/${x.transformationId}/schedule-network`);
    expect([net.status, net.reason, net.criticalPaths]).toEqual(["not_computable", "missing_durations", []]);
    expect((net.missingDurations as Body[]).map((m) => m.initiativeId)).toEqual([d]);
    expect((net.nodes as Body[]).filter((n) => n.critical === true)).toEqual([]);
    await setDuration(send, x, d, 2);
    net = await get200(api, x.s.auditor, `/api/v1/transformations/${x.transformationId}/schedule-network`);
    expect([net.status, net.projectDurationWorkingDays]).toEqual(["computed", 12]);
    expect(net.criticalPaths).toEqual([[a, b, d]]);
    const node = (id: string) => (net.nodes as Body[]).find((n) => n.initiativeId === id);
    expect([node(c).critical, node(c).totalFloat]).toEqual([false, 3]);
  });

  it("REQ-S15-008: an actual for period 2026-10 keeps observation period, a Riyadh business date and a UTC event timestamp", async () => {
    const kpi = await ownedKpi(api, k, DIRECT_FLOW);
    const a = await accepted(kpi.id, { reportingPeriodId: oct.id, value: "3", dataAsOf: "2026-10-31" });
    expect([a.periodLabel, a.periodStart, a.periodEnd]).toEqual(["2026-10", "2026-10-01", "2026-10-31"]);
    const v = a.values[0];
    expect(v.enteredAt).toMatch(/(Z|[+-]00:00)$/);
    expect(v.businessDate).toBe(businessDateOf(new Date(v.enteredAt), "Asia/Riyadh"));
    // The acceptance example (entered 2026-11-02 23:30 Asia/Riyadh = 20:30 UTC) through the database's business-date
    // function and the shared library: business date 2026-11-02, while 00:30 the next Riyadh day is 2026-11-03.
    const db = await sql<{ d: string; n: string }>`
      SELECT p4_business_date('2026-11-02T20:30:00Z'::timestamptz, 'Asia/Riyadh')::text AS d,
             p4_business_date('2026-11-02T21:30:00Z'::timestamptz, 'Asia/Riyadh')::text AS n`.execute(api.db);
    expect([db.rows[0]!.d, db.rows[0]!.n]).toEqual(["2026-11-02", "2026-11-03"]);
    expect(businessDateOf("2026-11-02T20:30:00Z", "Asia/Riyadh")).toBe("2026-11-02");
  });
});

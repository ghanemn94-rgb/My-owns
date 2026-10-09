// A05 acceptance examples of the KPI library (ADR-0028 "Verification"; T-DG4-KBE-A). Each `describe` quotes the
// binding acceptance text of its requirement row (docs/delivery/requirements.csv) and proves it literally, through the
// public `@mth/shared/calc` barrel. All values are synthetic fixtures.
import { describe, expect, it } from "vitest";
import {
  computeChange,
  cumulativeValue,
  evaluateMeasure,
  evaluateRag,
  expectedToDate,
  formatPointChange,
  formatRelativeChange,
  KPI_RULES_VERSION,
  periodValue,
  comparePeriods,
  computeTrend,
  rollUp,
  validateKpiFormula,
  type ReportingPeriodInfo,
  type RollUpInput,
  type ScopeValue,
} from "../calc.ts";

const month = (id: string, start: string, end: string): ReportingPeriodInfo => ({
  id,
  frequency: "monthly",
  periodStart: start,
  periodEnd: end,
  basis: "calendar",
  weekCount: null,
});

describe("REQ-S07-002 — A05: higher-better 80 vs expected 90 is adverse; lower-better 80 vs 90 is favourable; band 5-10 with 12 is outside; binary milestone not achieved by due date is adverse", () => {
  it("higher-better 80 vs expected 90 is adverse (s = 10)", () => {
    const m = evaluateMeasure({ measureType: "higher_is_better", actual: "80", expected: "90" });
    expect(m).toMatchObject({ deviation: "adverse", shortfall: "10" });
  });
  it("lower-better 80 vs 90 is favourable (s = −10)", () => {
    const m = evaluateMeasure({ measureType: "lower_is_better", actual: "80", expected: "90" });
    expect(m).toMatchObject({ deviation: "favourable", shortfall: "-10" });
  });
  it("band 5-10 with 12 is outside (s = 2, adverse, above)", () => {
    const m = evaluateMeasure({ measureType: "acceptable_band", actual: "12", bandLower: "5", bandUpper: "10" });
    expect(m).toMatchObject({ deviation: "adverse", shortfall: "2", bandPosition: "above" });
    const rag = evaluateRag({
      measureType: "acceptable_band",
      actual: { status: "ok", value: "12", reason: null },
      bandLower: "5",
      bandUpper: "10",
      thresholds: null,
    });
    expect(rag.explanationKey).toBe("kpi.rag.outside_band");
    expect(rag.calculatedRag).toBe("red"); // d = 2 / (10 − 5) = 0.4 > 0.10 default red
  });
  it("binary milestone not achieved by due date is adverse", () => {
    const m = evaluateMeasure({
      measureType: "binary_milestone",
      achieved: false,
      achievedOn: null,
      dueDate: "2026-09-30",
      businessDate: "2026-10-01",
    });
    expect(m.deviation).toBe("adverse");
    const rag = evaluateRag({
      measureType: "binary_milestone",
      actual: { status: "ok", achieved: false, achievedOn: null },
      dueDate: "2026-09-30",
      businessDate: "2026-10-01",
      thresholds: null,
    });
    expect(rag).toMatchObject({ calculatedRag: "red", explanationKey: "kpi.rag.milestone_overdue" });
  });
});

describe("REQ-S07-004 — A05: a rise from 0.10 to 0.12 is shown as +2.0 pp and +20%; cumulative YTD equals the sum of period flows for a flow KPI", () => {
  it("0.10 → 0.12 is +2.0 pp and +20%", () => {
    const c = computeChange({ from: "0.10", to: "0.12", unitKind: "percentage" });
    expect(c.absolute).toEqual({ value: "2", label: "pp" });
    expect(c.relative.result).toEqual({ status: "ok", value: "0.2", reason: null });
    expect(c.relative.label).toBe("percent");
    expect(formatPointChange(c.absolute.value)).toBe("+2.0 pp");
    expect(formatRelativeChange(c.relative.result)).toBe("+20%");
    // Arabic rendering keeps the two labels distinct as well.
    expect(formatPointChange(c.absolute.value, { locale: "ar" })).toBe("+2.0 نقطة مئوية");
    expect(formatRelativeChange(c.relative.result, { locale: "ar" })).toBe("+20٪");
  });
  it("cumulative YTD equals the sum of period flows for a flow KPI", () => {
    const periods = [
      month("jan", "2026-01-01", "2026-01-31"),
      month("feb", "2026-02-01", "2026-02-28"),
      month("mar", "2026-03-01", "2026-03-31"),
    ];
    const values = {
      jan: { kind: "value", value: "1200.50" },
      feb: { kind: "value", value: "980.25" },
      mar: { kind: "value", value: "1310" },
    } as const;
    const cum = cumulativeValue({ valueNature: "flow", current: periods[2]!, periods, values, ytdStartMonth: 1 });
    const sumOfPeriods = ["jan", "feb", "mar"]
      .map((id) => periodValue("flow", values[id as keyof typeof values]).value!)
      .reduce((a, b) => addDec(a, b), "0");
    expect(cum?.result).toEqual({ status: "ok", value: "3490.75", reason: null });
    expect(cum?.result.value).toBe(sumOfPeriods);
  });
});

/** Decimal addition through the library itself (no float): Σ via a flow cumulative of two synthetic periods. */
function addDec(a: string, b: string): string {
  const p = [month("x", "2026-01-01", "2026-01-31"), month("y", "2026-02-01", "2026-02-28")];
  return cumulativeValue({
    valueNature: "flow",
    current: p[1]!,
    periods: p,
    values: { x: { kind: "value", value: a }, y: { kind: "value", value: b } },
    ytdStartMonth: 1,
  })!.result.value!;
}

describe("REQ-S07-005 — A05: a zero denominator returns 'Not computable' (no division error, not 0); a percentage change from a negative baseline is flagged; comparing a 4-week to a 5-week period is flagged 'Not comparable'", () => {
  it("a zero denominator returns Not computable, no error, not 0", () => {
    let r: ReturnType<typeof periodValue> | undefined;
    expect(() => {
      r = periodValue("ratio", { kind: "ratio", numerator: "5", denominator: "0" });
    }).not.toThrow();
    expect(r).toEqual({ status: "not_computable", value: null, reason: "kpi.zero_denominator" });
    expect(r!.value).not.toBe("0");
  });
  it("a percentage change from a negative baseline is flagged", () => {
    const c = computeChange({ from: "-200", to: "-150", unitKind: "currency" });
    expect(c.relative.flag).toBe("negative_baseline");
    expect(c.relative.result.value).toBe("0.25"); // (−150 − −200) / |−200|
  });
  it("comparing a 4-week to a 5-week period is flagged Not comparable", () => {
    const w4: ReportingPeriodInfo = {
      id: "p4w",
      frequency: "monthly",
      periodStart: "2026-01-04",
      periodEnd: "2026-01-31",
      basis: "weeks",
      weekCount: 4,
    };
    const w5: ReportingPeriodInfo = {
      id: "p5w",
      frequency: "monthly",
      periodStart: "2026-02-01",
      periodEnd: "2026-03-07",
      basis: "weeks",
      weekCount: 5,
    };
    expect(comparePeriods(w5, w4)).toEqual({ comparable: false, reason: "week_count" });
    const t = computeTrend({
      measureType: "higher_is_better",
      current: { status: "ok", value: "120", reason: null },
      previous: { status: "ok", value: "100", reason: null },
      currentPeriod: w5,
      previousPeriod: w4,
    });
    expect(t).toEqual({ trend: "not_comparable", comparisonFlag: "not_comparable" });
  });
});

describe("REQ-S07-010 — A05: two BU ratios 1/10 and 9/10 roll up to 0.50 (weighted), not the mean of percentages; summing SAR with USD without conversion is rejected", () => {
  const base = (inputs: ScopeValue[], over: Partial<RollUpInput> = {}): RollUpInput => ({
    rule: "weighted_ratio",
    valueNature: "ratio",
    stockAdditiveAcrossScopes: false,
    unitKind: "percentage",
    unitLabel: null,
    currency: null,
    periodId: "q1",
    basis: "period",
    previouslyReportingScopes: [],
    inputs,
    ...over,
  });
  const bu = (scopeId: string, entry: ScopeValue["entry"], over: Partial<ScopeValue> = {}): ScopeValue => ({
    scopeId,
    periodId: "q1",
    basis: "period",
    unitKind: "percentage",
    unitLabel: null,
    currency: null,
    entry,
    ...over,
  });
  it("1/10 and 9/10 roll up to 0.50", () => {
    const out = rollUp(
      base([
        bu("bu-a", { kind: "ratio", numerator: "1", denominator: "10" }),
        bu("bu-b", { kind: "ratio", numerator: "9", denominator: "10" }),
      ]),
    );
    expect(out.ok && out.kind === "value" && out.result).toEqual({ status: "ok", value: "0.5", reason: null });
  });
  it("…and is the weighted ratio, not the mean of percentages, when the denominators differ", () => {
    // Skewed case: 1/10 (10 %) and 90/100 (90 %): the mean of percentages is 50 %, the weighted ratio 91/110.
    const out = rollUp(
      base([
        bu("bu-a", { kind: "ratio", numerator: "1", denominator: "10" }),
        bu("bu-b", { kind: "ratio", numerator: "90", denominator: "100" }),
      ]),
    );
    expect(out.ok && out.kind === "value" && out.result.value?.startsWith("0.827272727272727272")).toBe(true);
    expect(out.ok && out.kind === "value" && out.result.value).not.toBe("0.5");
  });
  it("summing SAR with USD without conversion is rejected", () => {
    const sar = { unitKind: "currency" as const, currency: "SAR" };
    const out = rollUp({
      ...base([], { rule: "sum", valueNature: "flow", ...sar }),
      inputs: [
        bu("bu-a", { kind: "value", value: "1000" }, sar),
        bu("bu-b", { kind: "value", value: "250" }, { unitKind: "currency", currency: "USD" }),
      ],
    });
    expect(out).toMatchObject({
      ok: false,
      code: "kpi.aggregation_unit_mismatch",
      params: { given: "USD", kpiUnit: "SAR" },
    });
  });
});

describe("REQ-S07-011 (units half) — A05: … adding SAR to a count is rejected", () => {
  it("SAR + count is refused with the engine's formula.kind_mismatch", () => {
    const sar = { unitKind: "currency", unitLabel: null, currency: "SAR", frequency: "monthly" } as const;
    const v = validateKpiFormula(
      "revenue + subscribers",
      [
        { variableName: "revenue", source: sar },
        {
          variableName: "subscribers",
          source: { unitKind: "count", unitLabel: "subscribers", currency: null, frequency: "monthly" },
        },
      ],
      sar,
    );
    expect(v.ok).toBe(false);
    expect(!v.ok && v.errors[0]!.code).toBe("formula.kind_mismatch");
  });
});

describe("ADR-0028 Verification: no actual → Unknown and no zero contribution; all tasks complete + actual below red → Red; a new threshold version → new RAG", () => {
  it("no actual → Unknown RAG, and the scope contributes no zero to the roll-up", () => {
    const rag = evaluateRag({
      measureType: "higher_is_better",
      actual: periodValue("flow", null),
      expected: { status: "ok", value: "100", reason: null },
      trajectoryVersion: 1,
      thresholds: null,
    });
    expect(rag).toMatchObject({ calculatedRag: "unknown", explanationKey: "kpi.rag.no_actual", deviation: "unknown" });
    const out = rollUp({
      rule: "sum",
      valueNature: "flow",
      stockAdditiveAcrossScopes: false,
      unitKind: "count",
      unitLabel: "orders",
      currency: null,
      periodId: "m10",
      basis: "period",
      previouslyReportingScopes: ["bu-a", "bu-b"],
      inputs: [
        {
          scopeId: "bu-a",
          periodId: "m10",
          basis: "period",
          unitKind: "count",
          unitLabel: "orders",
          currency: null,
          entry: { kind: "value", value: "70" },
        },
      ],
    });
    expect(out).toMatchObject({ ok: true, kind: "value", missingScopes: ["bu-b"] });
    expect(out.ok && out.kind === "value" && out.result).toEqual({
      status: "unknown",
      value: null,
      reason: "kpi.scope_missing",
    });
  });
  it("all tasks complete and actual below the red threshold → Red (the evaluator takes no activity input)", () => {
    // The initiative's tasks are all complete in this fixture; the evaluator has no parameter for them (rag.ts header).
    const expected = expectedToDate({
      trajectory: {
        versionNo: 2,
        basis: "period",
        interpolation: "linear",
        points: [
          { date: "2026-01-01", value: "100" },
          { date: "2026-12-31", value: "200" },
        ],
      },
      at: "2026-07-02",
    });
    expect(expected.result.value).toBe("150"); // 100 + 100 × 182/364 days (straight line by day count)
    const rag = evaluateRag({
      measureType: "higher_is_better",
      actual: { status: "ok", value: "120", reason: null },
      expected: expected.result,
      trajectoryVersion: 2,
      thresholds: null,
    });
    // s = 150 − 120 = 30, d = 30/150 = 0.2 > 0.10 (default red)
    expect(rag).toMatchObject({
      calculatedRag: "red",
      explanationKey: "kpi.rag.red_threshold",
      adverseDeviation: "0.2",
    });
  });
  it("a new threshold version → new RAG, and the explanation names it", () => {
    const common = {
      measureType: "higher_is_better" as const,
      actual: { status: "ok" as const, value: "92", reason: null },
      expected: { status: "ok" as const, value: "100", reason: null },
      trajectoryVersion: 1,
    };
    const v1 = evaluateRag({
      ...common,
      thresholds: { id: "t1", versionNo: 1, toleranceMode: "relative", amberThreshold: "0.05", redThreshold: "0.10" },
    });
    const v2 = evaluateRag({
      ...common,
      thresholds: { id: "t2", versionNo: 2, toleranceMode: "relative", amberThreshold: "0.02", redThreshold: "0.05" },
    });
    expect(v1.calculatedRag).toBe("amber");
    expect(v2.calculatedRag).toBe("red");
    expect(v2.explanationParams).toMatchObject({
      thresholdSource: "configured",
      thresholdVersion: 2,
      redThreshold: "0.05",
    });
    expect(v2.thresholdId).toBe("t2");
  });
  it("records the rules version mth-kpi/1.0.0", () => {
    expect(KPI_RULES_VERSION).toBe("mth-kpi/1.0.0");
  });
});

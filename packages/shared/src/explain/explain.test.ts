// Explanation view models (ADR-0061 §8 rows E1, E2, E4, E5; REQ-S15-014; p6-work-split §I/K.2 tests). Worked fixtures:
// every expected number below is computed by hand in its comment, not by the code under test.
import { describe, expect, it } from "vitest";
import { DEFAULT_WEIGHTS_V1, weightedScore, type CriterionWeight } from "../scoring.ts";
import { computeFinancialMetrics } from "../finance/metrics.ts";
import {
  explainBenefitRealized,
  explainFinancialMetrics,
  explainHealthScore,
  explainWeightedScore,
  type BenefitValuesInput,
  type CashFlowsInput,
  type FinancialMetricsInput,
  type HealthCheckInput,
  type HealthSchemeVersionInput,
  type WeightedScoreSheetInput,
} from "./index.ts";
import * as calc from "../calc.ts";

const T = "2026-10-01T09:00:00.000Z";

// ================================================================================================ E1 weighted score

function sheet(
  scores: Record<string, number | null>,
  result: Partial<WeightedScoreSheetInput["result"]>,
): WeightedScoreSheetInput {
  return {
    scores: Object.entries(scores).map(([criterionCode, score]) => ({ criterionCode, score })),
    result: {
      weightSetVersionNo: 1,
      completeness: "complete",
      weightedScore: null,
      weightedScoreDisplay: null,
      display100: null,
      missingCriteria: [],
      computedAt: T,
      ...result,
    },
  };
}

describe("E1 weighted score", () => {
  it("default 25/25/20/15/15: one contribution per criterion, summing exactly to the server's weightedScore", () => {
    // 4×25/100 = 1.0000; 3×25/100 = 0.7500; 5×20/100 = 1.0000; 2×15/100 = 0.3000; 3×15/100 = 0.4500; Σ = 3.5000.
    // 0-100 view: (3.5 − 1) ÷ 4 × 100 = 62.5.
    const s = sheet(
      { strategic_fit: 4, financial_value: 3, customer_impact: 5, feasibility: 2, time_to_value: 3 },
      { weightedScore: "3.5000", weightedScoreDisplay: "3.50", display100: "62.5" },
    );
    const e = explainWeightedScore(s, { versionNo: 1, weights: DEFAULT_WEIGHTS_V1 });
    expect(e.state).toBe("complete");
    expect(e.rows).toEqual([
      { criterionCode: "strategic_fit", score: "4", weightPercent: "25.00", contribution: "1.0000" },
      { criterionCode: "financial_value", score: "3", weightPercent: "25.00", contribution: "0.7500" },
      { criterionCode: "customer_impact", score: "5", weightPercent: "20.00", contribution: "1.0000" },
      { criterionCode: "feasibility", score: "2", weightPercent: "15.00", contribution: "0.3000" },
      { criterionCode: "time_to_value", score: "3", weightPercent: "15.00", contribution: "0.4500" },
    ]);
    expect(e.sum).toBe("3.5000");
    expect(e.weightedScore).toBe("3.5000");
    expect(e.display100).toBe("62.5");
    expect(e.weightSetVersionNo).toBe(1);
    expect(e.computedAt).toBe(T);
    expect(e.messageParams).toEqual({
      weightSetVersionNo: 1,
      criteriaCount: 5,
      missingCount: 0,
      weightedScore: "3.5000",
      display100: "62.5",
    });
  });

  it("a six-criterion set with half-percent weights (30/20/12.5/12.5/15/10)", () => {
    // 5×30 = 150; 4×20 = 80; 3×12.5 = 37.5; 2×12.5 = 25; 1×15 = 15; 4×10 = 40; Σ = 347.5; ÷ 100 = 3.4750.
    const weights: CriterionWeight[] = [
      { criterionCode: "strategic_fit", weightPercent: "30.00" },
      { criterionCode: "financial_value", weightPercent: "20.00" },
      { criterionCode: "customer_impact", weightPercent: "12.50" },
      { criterionCode: "feasibility", weightPercent: "12.50" },
      { criterionCode: "time_to_value", weightPercent: "15.00" },
      { criterionCode: "risk_compliance", weightPercent: "10.00" },
    ];
    const s = sheet(
      {
        strategic_fit: 5,
        financial_value: 4,
        customer_impact: 3,
        feasibility: 2,
        time_to_value: 1,
        risk_compliance: 4,
      },
      { weightSetVersionNo: 3, weightedScore: "3.4750", weightedScoreDisplay: "3.48", display100: "61.88" },
    );
    const e = explainWeightedScore(s, { versionNo: 3, weights });
    expect(e.state).toBe("complete");
    expect(e.rows.map((r) => r.contribution)).toEqual(["1.5000", "0.8000", "0.3750", "0.2500", "0.1500", "0.4000"]);
    expect(e.sum).toBe("3.4750");
    expect(e.weightedScore).toBe("3.4750");
  });

  it("a two-criterion set with 2-decimal weights (33.33/66.67) is exact at 4 decimals, no rounding", () => {
    // 5×33.33/100 = 1.6665; 2×66.67/100 = 1.3334; Σ = 2.9999 (a binary float would give 2.9999000000000002).
    const weights: CriterionWeight[] = [
      { criterionCode: "financial_value", weightPercent: "33.33" },
      { criterionCode: "feasibility", weightPercent: "66.67" },
    ];
    const s = sheet(
      { financial_value: 5, feasibility: 2, strategic_fit: 1 },
      { weightSetVersionNo: 2, weightedScore: "2.9999" },
    );
    const e = explainWeightedScore(s, { versionNo: 2, weights });
    expect(e.state).toBe("complete");
    // A score for a criterion outside the set is ignored.
    expect(e.rows.map((r) => [r.criterionCode, r.contribution])).toEqual([
      ["financial_value", "1.6665"],
      ["feasibility", "1.3334"],
    ]);
    expect(e.sum).toBe("2.9999");
  });

  it("an incomplete score gives no contributions and lists the missing criteria (never 0)", () => {
    const s = sheet(
      { strategic_fit: 4, financial_value: 3, customer_impact: null, time_to_value: 3 },
      { completeness: "incomplete", weightedScore: null, missingCriteria: ["customer_impact", "feasibility"] },
    );
    const e = explainWeightedScore(s, { versionNo: 1, weights: DEFAULT_WEIGHTS_V1 });
    expect(e.state).toBe("incomplete");
    expect(e.missingCriteria).toEqual(["customer_impact", "feasibility"]);
    expect(e.rows.every((r) => r.contribution === null)).toBe(true);
    expect(e.rows.map((r) => r.score)).toEqual(["4", "3", null, null, "3"]);
    expect(e.sum).toBeNull();
    expect(e.weightedScore).toBeNull();
    expect(e.display100).toBeNull();
    expect(e.messageParams.missingCount).toBe(2);
    expect(JSON.stringify(e)).not.toMatch(/"0(\.0+)?"/);
  });

  it("is Unknown, with no rows, when the weight set is missing or of another version", () => {
    const s = sheet(
      { strategic_fit: 4, financial_value: 3, customer_impact: 5, feasibility: 2, time_to_value: 3 },
      { weightedScore: "3.5000" },
    );
    const missing = explainWeightedScore(s, null);
    expect(missing).toMatchObject({ state: "unknown", reason: "explain.weight_set_missing", rows: [], sum: null });
    const other = explainWeightedScore(s, { versionNo: 2, weights: DEFAULT_WEIGHTS_V1 });
    expect(other).toMatchObject({ state: "unknown", reason: "explain.weight_set_version_mismatch", sum: null });
  });

  it("never shows a breakdown that disagrees with the server's value", () => {
    const scores = { strategic_fit: 4, financial_value: 3, customer_impact: 5, feasibility: 2, time_to_value: 3 };
    const w = { versionNo: 1, weights: DEFAULT_WEIGHTS_V1 };
    // A server value one ten-thousandth off.
    expect(explainWeightedScore(sheet(scores, { weightedScore: "3.5001" }), w)).toMatchObject({
      state: "unknown",
      reason: "explain.inputs_inconsistent",
    });
    // The server says complete but a score is missing.
    expect(explainWeightedScore(sheet({ ...scores, feasibility: null }, { weightedScore: "3.5000" }), w)).toMatchObject(
      { state: "unknown", reason: "explain.inputs_inconsistent" },
    );
    // The server says incomplete but all are scored.
    expect(
      explainWeightedScore(
        sheet(scores, { completeness: "incomplete", weightedScore: null, missingCriteria: ["feasibility"] }),
        w,
      ),
    ).toMatchObject({ state: "unknown", reason: "explain.inputs_inconsistent" });
    // A stored score outside 1-5, or a weight set that does not total 100.
    expect(explainWeightedScore(sheet({ ...scores, feasibility: 6 }, { weightedScore: "3.5000" }), w).state).toBe(
      "unknown",
    );
    expect(
      explainWeightedScore(sheet(scores, { weightedScore: "3.5000" }), {
        versionNo: 1,
        weights: [...DEFAULT_WEIGHTS_V1.slice(0, 4), { criterionCode: "time_to_value", weightPercent: "10.00" }],
      }).state,
    ).toBe("unknown");
  });

  it("property: over 2,000 generated sheets the contributions sum to the shared weightedScore exactly", () => {
    // A fixed linear congruential generator: deterministic under load (F-DG4-143).
    let seed = 20261029;
    const next = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const codes = [
      "strategic_fit",
      "financial_value",
      "customer_impact",
      "feasibility",
      "time_to_value",
      "risk_compliance",
    ];
    for (let i = 0; i < 2000; i += 1) {
      const count = 2 + next(5);
      // Weights in hundredths of a percent that total exactly 10000 (100.00 %).
      const cents: number[] = [];
      let left = 10000;
      for (let k = 0; k < count - 1; k += 1) {
        const c = 1 + next(left - (count - 1 - k));
        cents.push(c);
        left -= c;
      }
      cents.push(left);
      const weights = cents.map((c, k) => ({
        criterionCode: codes[k]!,
        weightPercent: `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`,
      }));
      const scores: Record<string, number> = {};
      for (const w of weights) scores[w.criterionCode] = 1 + next(5);
      const expected = weightedScore(scores, weights);
      if (expected.completeness !== "complete") throw new Error("generator");
      const e = explainWeightedScore(sheet(scores, { weightedScore: expected.weightedScore }), {
        versionNo: 1,
        weights,
      });
      expect(e.state).toBe("complete");
      expect(e.sum).toBe(expected.weightedScore);
    }
  });
});

// ================================================================================================ E2 benefit realized

const R1 = "00000000-0000-4000-8000-000000000001";
const R2 = "00000000-0000-4000-8000-000000000002";
const R3 = "00000000-0000-4000-8000-000000000003";
const R4 = "00000000-0000-4000-8000-000000000004";
const R5 = "00000000-0000-4000-8000-000000000005";
const BEN = "00000000-0000-4000-8000-0000000000b1";

type Series = BenefitValuesInput["series"][number];
const known = (amount: string) => ({ status: "known" as const, amount, currency: "SAR", reason: null });
const line = (id: string, start: string, end: string, amount: string | null): Series["lines"][number] => ({
  periodStart: start,
  periodEnd: end,
  amount,
  kpiValue: null,
  recordType: "benefit_measurement",
  recordId: id,
  basis: "validated",
});
const series = (state: string, lines: Series["lines"], total: Series["total"]): Series => ({
  state,
  total,
  count: lines.length,
  lines,
});

function values(over: Partial<Record<string, Series>> = {}): BenefitValuesInput {
  const base: Record<string, Series> = {
    planned: series("planned", [line(R5, "2026-01-01", "2026-12-31", "900000.0000")], known("900000.0000")),
    forecast: series("forecast", [line(R5, "2026-01-01", "2026-12-31", "800000.0000")], known("800000.0000")),
    measured: series("measured", [line(R1, "2026-01-01", "2026-03-31", "100000.0000")], known("100000.0000")),
    // Validated: 100,000.0000 (Q1) + 250,000.5000 (Q2) = 350,000.5000.
    validated: series(
      "validated",
      [line(R1, "2026-01-01", "2026-03-31", "100000.0000"), line(R2, "2026-04-01", "2026-06-30", "250000.5000")],
      known("350000.5000"),
    ),
    sustained: series("sustained", [line(R3, "2025-10-01", "2025-12-31", "50000.0000")], known("50000.0000")),
    submitted: series("submitted", [line(R4, "2026-07-01", "2026-09-30", "75000.0000")], known("75000.0000")),
    rejected: series("rejected", [line(R5, "2026-01-01", "2026-03-31", "1.0000")], known("1.0000")),
    ...over,
  };
  return {
    benefitId: BEN,
    currency: "SAR",
    series: ["planned", "forecast", "measured", "submitted", "validated", "sustained", "rejected"].map((s) => base[s]!),
  };
}

describe("E2 benefit realized value", () => {
  it("keeps validated, sustained and pending apart with their lines, periods and totals", () => {
    const e = explainBenefitRealized(values());
    expect(e.groups.map((g) => [g.key, g.state, g.count])).toEqual([
      ["validated", "validated", 2],
      ["sustained", "sustained", 1],
      ["pending", "submitted", 1],
    ]);
    expect(e.groups[0].total).toEqual({ status: "known", amount: "350000.5000", currency: "SAR" });
    expect(e.groups[1].total).toEqual({ status: "known", amount: "50000.0000", currency: "SAR" });
    expect(e.groups[2].total).toEqual({ status: "known", amount: "75000.0000", currency: "SAR" });
    expect(e.groups[0].lines.map((l) => [l.periodStart, l.periodEnd, l.amount, l.recordId])).toEqual([
      ["2026-01-01", "2026-03-31", { status: "known", amount: "100000.0000", currency: "SAR" }, R1],
      ["2026-04-01", "2026-06-30", { status: "known", amount: "250000.5000", currency: "SAR" }, R2],
    ]);
    expect([e.groups[0].firstPeriodStart, e.groups[0].lastPeriodEnd]).toEqual(["2026-01-01", "2026-06-30"]);
    // Earliest and latest over the three groups: sustained 2025-10-01 … pending 2026-09-30.
    expect([e.firstPeriodStart, e.lastPeriodEnd]).toEqual(["2025-10-01", "2026-09-30"]);
    expect(e.messageParams).toEqual({
      currency: "SAR",
      validatedCount: 2,
      sustainedCount: 1,
      pendingCount: 1,
      firstPeriodStart: "2025-10-01",
      lastPeriodEnd: "2026-09-30",
    });
  });

  it("never adds validated, sustained and pending, and never includes planned, forecast, measured or rejected", () => {
    const e = explainBenefitRealized(values());
    const text = JSON.stringify(e);
    // 350,000.5 + 50,000 = 400,000.5; + 75,000 = 475,000.5; 350,000.5 + 75,000 = 425,000.5; 50,000 + 75,000 = 125,000.
    for (const sum of ["400000.5", "475000.5", "425000.5", "125000"]) expect(text).not.toContain(sum);
    expect(Object.keys(e)).not.toContain("total");
    // Forecast and planned (800,000 / 900,000) and the rejected line are not realized value.
    for (const other of ["800000", "900000", '"1.0000"']) expect(text).not.toContain(other);
    expect(e.groups.flatMap((g) => g.lines).some((l) => l.recordId === R5)).toBe(false);
  });

  it("a line without an amount makes its total Unknown, never 0, and leaves the other groups alone", () => {
    const e = explainBenefitRealized(
      values({
        validated: series(
          "validated",
          [line(R1, "2026-01-01", "2026-03-31", "100000.0000"), line(R2, "2026-04-01", "2026-06-30", null)],
          { status: "unknown", amount: null, currency: "SAR", reason: "benefit.value_amount_missing" },
        ),
      }),
    );
    expect(e.groups[0].total).toEqual({ status: "unknown", reason: "benefit.value_amount_missing" });
    expect(e.groups[0].lines[1]!.amount).toEqual({ status: "unknown", reason: "benefit.value_amount_missing" });
    expect(e.groups[1].total).toEqual({ status: "known", amount: "50000.0000", currency: "SAR" });
    // Even if a server total claimed a number while a line has no amount, the total stays Unknown.
    const claimed = explainBenefitRealized(
      values({
        sustained: series("sustained", [line(R3, "2025-10-01", "2025-12-31", null)], known("0.0000")),
      }),
    );
    expect(claimed.groups[1].total).toEqual({ status: "unknown", reason: "benefit.value_amount_missing" });
  });

  it("a group without lines is the incomplete state no_lines, never 0.0000", () => {
    const e = explainBenefitRealized(values({ submitted: series("submitted", [], known("0.0000")) }));
    expect(e.groups[2].total).toEqual({ status: "no_lines" });
    expect(e.groups[2].count).toBe(0);
    expect([e.groups[2].firstPeriodStart, e.groups[2].lastPeriodEnd]).toEqual([null, null]);
  });

  it("a server total its lines contradict, a wrong count or a missing series is Unknown", () => {
    const wrongTotal = explainBenefitRealized(
      values({ sustained: series("sustained", [line(R3, "2025-10-01", "2025-12-31", "50000.0000")], known("5.0000")) }),
    );
    expect(wrongTotal.groups[1].total).toEqual({ status: "unknown", reason: "explain.inputs_inconsistent" });
    const wrongCount = values();
    const v = wrongCount.series.find((s) => s.state === "validated")!;
    const bad: BenefitValuesInput = {
      ...wrongCount,
      series: wrongCount.series.map((s) => (s === v ? { ...v, count: 3 } : s)),
    };
    expect(explainBenefitRealized(bad).groups[0].total).toEqual({
      status: "unknown",
      reason: "explain.inputs_inconsistent",
    });
    const missing: BenefitValuesInput = { ...values(), series: values().series.filter((s) => s.state !== "sustained") };
    expect(explainBenefitRealized(missing).groups[1].total).toEqual({
      status: "unknown",
      reason: "explain.series_missing",
    });
  });

  it("a non-financial benefit is n/a with its long text, and its KPI actual is its realized value", () => {
    const na = { status: "not_applicable" as const, amount: null, currency: null, reason: null };
    const nonFinancial = values({
      validated: series("validated", [line(R1, "2026-01-01", "2026-03-31", null)], na),
      sustained: series("sustained", [], na),
      submitted: series("submitted", [], na),
    });
    const e = explainBenefitRealized(nonFinancial, { status: "known", value: "87.500000", reason: null });
    expect(e.nonFinancial).toBe(true);
    for (const g of e.groups) expect(g.total).toEqual({ status: "not_applicable", textKey: "benefitsP4.value.naLong" });
    expect(e.groups[0].lines[0]!.amount).toEqual({ status: "not_applicable", textKey: "benefitsP4.value.naLong" });
    expect(e.kpiActual).toEqual({ status: "known", value: "87.500000" });
    const stale = explainBenefitRealized(nonFinancial, { status: "stale", value: null, reason: "kpi.actual_stale" });
    expect(stale.kpiActual).toEqual({ status: "stale", reason: "kpi.actual_stale" });
    expect(explainBenefitRealized(nonFinancial).kpiActual).toBeNull();
    expect(explainBenefitRealized(values()).nonFinancial).toBe(false);
  });
});

// ================================================================================================ E4 financial metrics

const BC = "00000000-0000-4000-8000-0000000000c1";
const flows = (rows: CashFlowsInput["rows"], revision = 2): CashFlowsInput => ({
  businessCaseId: BC,
  currency: "SAR",
  revision,
  rows,
});
const assumptions = (discountRate: string | null, timing: "end_of_period" | "beginning_of_period") => ({
  timing,
  periodBasis: "annual" as const,
  discountRate,
  methodologyNote: "Synthetic demo assumptions",
});
const shown = (over: Partial<FinancialMetricsInput>): FinancialMetricsInput => ({
  businessCaseId: BC,
  status: "shown",
  currency: "SAR",
  npv: null,
  npvReason: null,
  roi: null,
  roiReason: null,
  paybackPeriodIndex: null,
  paybackReason: null,
  assumptions: assumptions("0.1", "end_of_period"),
  cashFlowRevision: 2,
  ...over,
});
// Out 1,000 at t0; in 600 at t1 and t2.
const THREE = [
  { periodIndex: 0, outflow: "1000.0000", inflow: "0.0000" },
  { periodIndex: 1, outflow: "0.0000", inflow: "600.0000" },
  { periodIndex: 2, outflow: "0.0000", inflow: "600.0000" },
];

describe("E4 financial metrics", () => {
  it("end of period at 10%: per-period net, factor and discounted net; NPV 37.57, ROI 0.2, payback at index 2", () => {
    // Factors 1/1.1 = 0.909091, 1/1.21 = 0.826446, 1/1.331 = 0.751315.
    // Discounted: −1000/1.1 = −909.0909…; 600/1.21 = 495.8678…; 600/1.331 = 450.7889…; Σ = 37.5657… → 37.57.
    // ROI = (1,200 − 1,000) ÷ 1,000 = 0.200000. Cumulative: −1,000, −400, +200 → payback at index 2.
    const metrics = shown({ npv: "37.57", roi: "0.200000", paybackPeriodIndex: 2 });
    const e = explainFinancialMetrics(flows(THREE), metrics);
    if (e.state !== "shown") throw new Error(e.state);
    expect(e.rows).toEqual([
      {
        periodIndex: 0,
        outflow: "1000.0000",
        inflow: "0.0000",
        net: "-1000.0000",
        discountExponent: 1,
        discountFactor: "0.909091",
        discountedNet: "-909.09",
        cumulativeNet: "-1000.0000",
        payback: false,
      },
      {
        periodIndex: 1,
        outflow: "0.0000",
        inflow: "600.0000",
        net: "600.0000",
        discountExponent: 2,
        discountFactor: "0.826446",
        discountedNet: "495.87",
        cumulativeNet: "-400.0000",
        payback: false,
      },
      {
        periodIndex: 2,
        outflow: "0.0000",
        inflow: "600.0000",
        net: "600.0000",
        discountExponent: 3,
        discountFactor: "0.751315",
        discountedNet: "450.79",
        cumulativeNet: "200.0000",
        payback: true,
      },
    ]);
    expect([e.totalInflow, e.totalOutflow]).toEqual(["1200.0000", "1000.0000"]);
    expect([e.npv, e.roi, e.paybackPeriodIndex]).toEqual(["37.57", "0.200000", 2]);
    expect(e.npvExact!.startsWith("37.5657")).toBe(true);
    expect(e.messageParams).toEqual({
      currency: "SAR",
      revision: 2,
      periodCount: 3,
      periodBasis: "annual",
      timing: "end_of_period",
      firstExponent: 1,
      discountRate: "0.1",
    });
  });

  it("beginning of period counts the exponent from 0: NPV 41.32", () => {
    // −1000 + 600/1.1 + 600/1.21 = −1000 + 545.4545… + 495.8677… = 41.3223… → 41.32.
    const metrics = shown({
      npv: "41.32",
      roi: "0.200000",
      paybackPeriodIndex: 2,
      assumptions: assumptions("0.1", "beginning_of_period"),
    });
    const e = explainFinancialMetrics(flows(THREE), metrics);
    if (e.state !== "shown") throw new Error(e.state);
    expect(e.rows.map((r) => [r.discountExponent, r.discountFactor, r.discountedNet])).toEqual([
      [0, "1.000000", "-1000.00"],
      [1, "0.909091", "545.45"],
      [2, "0.826446", "495.87"],
    ]);
    expect(e.messageParams.firstExponent).toBe(0);
  });

  it("reproduces computeFinancialMetrics for its fixtures (the view model calls the shared function)", () => {
    const fixtures = [
      { rows: THREE, discountRate: "0.1", timing: "end_of_period" as const },
      { rows: THREE, discountRate: "0.1", timing: "beginning_of_period" as const },
      { rows: THREE, discountRate: "0.075", timing: "end_of_period" as const },
      { rows: THREE, discountRate: "0", timing: "end_of_period" as const },
      { rows: THREE, discountRate: null, timing: "end_of_period" as const },
      {
        rows: [
          { periodIndex: 0, outflow: "1000.0000", inflow: "0.0000" },
          { periodIndex: 1, outflow: "0.0000", inflow: "300.0000" },
        ],
        discountRate: "0.05",
        timing: "end_of_period" as const,
      },
      {
        rows: [{ periodIndex: 0, outflow: "0.0000", inflow: "10.0000" }],
        discountRate: "0.05",
        timing: "end_of_period" as const,
      },
    ];
    for (const f of fixtures) {
      const m = computeFinancialMetrics(f);
      const metrics = shown({
        npv: m.npv,
        npvReason: m.npvReason === "out_of_range" ? "not_shown" : m.npvReason,
        roi: m.roi,
        roiReason: m.roiReason,
        paybackPeriodIndex: m.paybackPeriodIndex,
        paybackReason: m.paybackReason,
        assumptions: assumptions(f.discountRate, f.timing),
      });
      const e = explainFinancialMetrics(flows(f.rows), metrics);
      if (e.state !== "shown") throw new Error(`${e.state} for ${JSON.stringify(f)}`);
      expect([e.npv, e.npvReason, e.npvExact, e.roi, e.roiReason, e.paybackPeriodIndex, e.paybackReason]).toEqual([
        m.npv,
        m.npvReason,
        m.npvExact,
        m.roi,
        m.roiReason,
        m.paybackPeriodIndex,
        m.paybackReason,
      ]);
      expect(e.rows.filter((r) => r.payback).map((r) => r.periodIndex)).toEqual(
        m.paybackPeriodIndex === null ? [] : [m.paybackPeriodIndex],
      );
    }
  });

  it("without a discount rate there is no NPV and no factor (never 0); ROI and payback remain", () => {
    const metrics = shown({
      npvReason: "discount_rate_missing",
      roi: "0.200000",
      paybackPeriodIndex: 2,
      assumptions: assumptions(null, "end_of_period"),
    });
    const e = explainFinancialMetrics(flows(THREE), metrics);
    if (e.state !== "shown") throw new Error(e.state);
    expect([e.npv, e.npvReason, e.npvExact]).toEqual([null, "discount_rate_missing", null]);
    expect(e.rows.every((r) => r.discountFactor === null && r.discountedNet === null)).toBe(true);
    expect(e.roi).toBe("0.200000");
  });

  it("payback 'not reached' and 'not computable' carry their reasons", () => {
    // Out 1,000; in 300: cumulative −1,000, −700, never back at 0. ROI = (300 − 1000)/1000 = −0.700000.
    // NPV at 10% end of period: −1000/1.1 + 300/1.21 = −909.0909… + 247.9338… = −661.1570… → −661.16.
    const ok = explainFinancialMetrics(
      flows([
        { periodIndex: 0, outflow: "1000.0000", inflow: "0.0000" },
        { periodIndex: 1, outflow: "0.0000", inflow: "300.0000" },
      ]),
      shown({ npv: "-661.16", roi: "-0.700000", paybackReason: "not_reached" }),
    );
    if (ok.state !== "shown") throw new Error(ok.state);
    expect([ok.paybackPeriodIndex, ok.paybackReason]).toEqual([null, "not_reached"]);
    expect(ok.rows.some((r) => r.payback)).toBe(false);
    // No outflow: ROI and payback are not computable (a zero denominator is never 0).
    const none = explainFinancialMetrics(
      flows([{ periodIndex: 0, outflow: "0.0000", inflow: "10.0000" }]),
      shown({ npv: "9.09", roiReason: "not_computable", paybackReason: "not_computable" }),
    );
    if (none.state !== "shown") throw new Error(none.state);
    expect([none.roi, none.roiReason, none.paybackReason]).toEqual([null, "not_computable", "not_computable"]);
  });

  it("disabled, incomplete, another revision, another currency or a contradicting server value give no rows", () => {
    const ok = shown({ npv: "37.57", roi: "0.200000", paybackPeriodIndex: 2 });
    expect(explainFinancialMetrics(flows(THREE), { ...ok, status: "disabled" })).toEqual({
      kind: "financial_metrics",
      state: "disabled",
      businessCaseId: BC,
    });
    expect(explainFinancialMetrics(flows(THREE), { ...ok, status: "assumptions_missing" })).toMatchObject({
      state: "incomplete",
      reason: "assumptions_missing",
    });
    expect(explainFinancialMetrics(flows(THREE), { ...ok, status: "cash_flows_missing" })).toMatchObject({
      state: "incomplete",
      reason: "cash_flows_missing",
    });
    expect(explainFinancialMetrics(flows(THREE, 3), ok)).toMatchObject({
      state: "unknown",
      reason: "explain.revision_mismatch",
    });
    expect(explainFinancialMetrics(flows(THREE), { ...ok, currency: "USD" })).toMatchObject({
      state: "unknown",
      reason: "explain.currency_mismatch",
    });
    for (const bad of [{ npv: "37.58" }, { roi: "0.2000001" }, { paybackPeriodIndex: 1 }, { assumptions: null }])
      expect(explainFinancialMetrics(flows(THREE), { ...ok, ...bad })).toMatchObject({
        state: "unknown",
        reason: "explain.inputs_inconsistent",
      });
    // A gap in the period indexes is not a valid set.
    expect(
      explainFinancialMetrics(
        flows([
          { periodIndex: 0, outflow: "1.0000", inflow: "0.0000" },
          { periodIndex: 2, outflow: "0.0000", inflow: "1.0000" },
        ]),
        ok,
      ).state,
    ).toBe("unknown");
  });
});

// ================================================================================================ E5 health score

const HC = "00000000-0000-4000-8000-0000000000d1";
const SV1 = "00000000-0000-4000-8000-0000000000e1";
const SV2 = "00000000-0000-4000-8000-0000000000e2";
const CODES = Array.from({ length: 25 }, (_, i) => `q${String(i + 1).padStart(2, "0")}`);

const SCHEME_V1: HealthSchemeVersionInput = {
  versionId: SV1,
  versionNo: 1,
  scoreBasis: "points",
  questionCount: 25,
  responses: [
    { key: "yes", credit: "1" },
    { key: "no", credit: "0" },
  ],
  bands: [
    { key: "b0152_21_25", minScore: "21", origin: "source" },
    { key: "b0152_16_20", minScore: "16", origin: "source" },
    { key: "b0152_10_15", minScore: "10", origin: "source" },
    { key: "b0152_0_9", minScore: "0", origin: "source" },
  ],
};
const SCHEME_PCT: HealthSchemeVersionInput = {
  versionId: SV2,
  versionNo: 2,
  scoreBasis: "percent_of_applicable",
  questionCount: 25,
  responses: [
    { key: "yes", credit: "1" },
    { key: "no", credit: "0" },
    { key: "partial", credit: "0.5" },
    { key: "na", credit: null },
  ],
  bands: [
    { key: "high", minScore: "75", origin: "admin" },
    { key: "mid", minScore: "50", origin: "admin" },
    { key: "low", minScore: "0", origin: "admin" },
  ],
};

function check(responses: readonly string[], over: Partial<HealthCheckInput> = {}): HealthCheckInput {
  return {
    id: HC,
    schemeVersionId: SV1,
    schemeVersionNo: 1,
    assessmentDate: "2026-10-15",
    completion: { answered: responses.length, total: 25, complete: responses.length === 25 },
    score: null,
    scoreMax: null,
    band: null,
    scoringAssumption: true,
    answers: responses.map((response, i) => ({ questionCode: CODES[i]!, response })),
    ...over,
  };
}
const repeat = (key: string, n: number) => Array.from({ length: n }, () => key);

describe("E5 health check score", () => {
  it("scheme 1: 17 Yes and 8 No score 17 out of 25, band 16-20", () => {
    const answers = [...repeat("yes", 17), ...repeat("no", 8)];
    const band = { key: "b0152_16_20", minScore: "16", rangeLabel: "16–20" };
    const e = explainHealthScore(check(answers, { score: "17", scoreMax: "25", band }), SCHEME_V1);
    if (e.state !== "scored") throw new Error(e.state);
    expect([e.answered, e.total, e.applicable, e.points, e.score, e.scoreMax]).toEqual([25, 25, 25, "17", "17", "25"]);
    expect(e.unanswered).toEqual([]);
    expect(e.responses).toEqual([
      { key: "yes", count: 17, credit: "1", points: "17" },
      { key: "no", count: 8, credit: "0", points: "0" },
    ]);
    expect(e.band).toEqual(band);
    expect(e.scoringAssumption).toBe(true);
    expect(e.messageParams).toEqual({
      answered: 25,
      total: 25,
      applicable: 25,
      points: "17",
      score: "17",
      scoreMax: "25",
      bandRange: "16–20",
      schemeVersionNo: 1,
    });
  });

  it("gives no score and no band while any question is unanswered (incomplete, never 0)", () => {
    const answers = [...repeat("yes", 20), ...repeat("no", 4)];
    const e = explainHealthScore(check(answers), SCHEME_V1);
    expect(e.state).toBe("incomplete");
    if (e.state !== "incomplete") return;
    expect([e.answered, e.total, e.score, e.scoreMax, e.band, e.points]).toEqual([24, 25, null, null, null, null]);
    expect(e.unanswered).toEqual(["q25"]);
    expect(e.messageParams.score).toBeNull();
    // A server that claimed a score for an incomplete assessment is not explained (and the score is not shown).
    const claimed = explainHealthScore(check(answers, { score: "20", scoreMax: "25" }), SCHEME_V1);
    expect(claimed).toMatchObject({ state: "unknown", reason: "explain.inputs_inconsistent" });
    expect(explainHealthScore(check([]), SCHEME_V1)).toMatchObject({ state: "incomplete", answered: 0 });
  });

  it("percent of applicable: 10 Yes, 5 Partial (0.5), 5 No, 5 N/A score 62.50 out of 100", () => {
    // Applicable = 25 − 5 N/A = 20; points = 10 × 1 + 5 × 0.5 = 12.5; score = 100 × 12.5 ÷ 20 = 62.50 → band 'mid'.
    const answers = [...repeat("yes", 10), ...repeat("partial", 5), ...repeat("no", 5), ...repeat("na", 5)];
    const band = { key: "mid", minScore: "50", rangeLabel: "50–74.99" };
    const e = explainHealthScore(
      check(answers, { schemeVersionId: SV2, schemeVersionNo: 2, score: "62.50", scoreMax: "100", band }),
      SCHEME_PCT,
    );
    if (e.state !== "scored") throw new Error(e.state);
    expect([e.applicable, e.points, e.score, e.scoreMax, e.band?.key]).toEqual([20, "12.50", "62.50", "100", "mid"]);
    expect(e.responses).toEqual([
      { key: "yes", count: 10, credit: "1", points: "10" },
      { key: "no", count: 5, credit: "0", points: "0" },
      { key: "partial", count: 5, credit: "0.5", points: "2.50" },
      { key: "na", count: 5, credit: null, points: null },
    ]);
  });

  it("an all-N/A assessment is not computable (no score, never 0)", () => {
    const e = explainHealthScore(check(repeat("na", 25), { schemeVersionId: SV2, schemeVersionNo: 2 }), SCHEME_PCT);
    expect(e).toMatchObject({ state: "not_computable", applicable: 0, score: null, band: null });
  });

  it("is Unknown without the assessment's scheme version or when the server's score differs", () => {
    const answers = [...repeat("yes", 17), ...repeat("no", 8)];
    const band = { key: "b0152_16_20", minScore: "16", rangeLabel: "16–20" };
    const ok = check(answers, { score: "17", scoreMax: "25", band });
    expect(explainHealthScore(ok, null)).toMatchObject({ state: "unknown", reason: "explain.scheme_missing" });
    expect(explainHealthScore(ok, SCHEME_PCT)).toMatchObject({
      state: "unknown",
      reason: "explain.scheme_version_mismatch",
    });
    for (const bad of [
      { score: "18" },
      { scoreMax: "100" },
      { band: { key: "b0152_21_25", minScore: "21", rangeLabel: "21–25" } },
    ])
      expect(explainHealthScore({ ...ok, ...bad }, SCHEME_V1)).toMatchObject({
        state: "unknown",
        reason: "explain.inputs_inconsistent",
      });
    // An answer whose response is not in the scheme, or a duplicate question.
    expect(explainHealthScore(check([...repeat("yes", 24), "partial"]), SCHEME_V1).state).toBe("unknown");
    const dup = check(answers, { score: "17", scoreMax: "25", band });
    const dupAnswers = { ...dup, answers: dup.answers.map((a, i) => (i === 24 ? { ...a, questionCode: "q01" } : a)) };
    expect(explainHealthScore(dupAnswers, SCHEME_V1).state).toBe("unknown");
  });
});

// ================================================================================================ the calc subpath

describe("@mth/shared/calc exports the explanation view models", () => {
  it("re-exports the four functions", () => {
    expect(calc.explainWeightedScore).toBe(explainWeightedScore);
    expect(calc.explainBenefitRealized).toBe(explainBenefitRealized);
    expect(calc.explainFinancialMetrics).toBe(explainFinancialMetrics);
    expect(calc.explainHealthScore).toBe(explainHealthScore);
  });
});

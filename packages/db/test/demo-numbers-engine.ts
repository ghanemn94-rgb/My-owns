// The DG3/DG4 engines applied to the International Roaming dataset's inputs (T-DG5-KBE-H; test support only). The
// dataset modules (packages/db/src/demo/data/**) hold literal numbers, because packages/db may not import the
// calculation engine (ADR-0002 rule 5); these functions recompute each literal exactly as the product computes it, so
// the tests can assert equality: the worker's kpi.recalculate for an accepted ratio actual at the entry scope (period
// and cumulative bases, T-DG4-KBE-C) and the API's benefit measurement and formula preview (ADR-0024 §6, ADR-0030).
import {
  applyFreshness,
  computeTrend,
  computeVariance,
  cumulativeValue,
  evaluateFormula,
  evaluateRag,
  expectedToDate,
  FORMULA_DECIMAL,
  freshness,
  periodValue,
  roundForStorage,
  type KpiResult,
  type PeriodEntry,
  type ReportingPeriodInfo,
} from "@mth/shared/calc";
import {
  DEMO_ACTUALS,
  previousActual,
  type DemoActual,
  type DemoCumulative,
  type DemoEvaluation,
} from "../src/demo/data/actuals.ts";
import type { DemoFormula } from "../src/demo/data/business-cases.ts";
import { DEMO_PERIODS, demoKpi, demoPeriod, type DemoPeriod } from "../src/demo/data/kpis.ts";

const periodInfo = (p: DemoPeriod): ReportingPeriodInfo & { periodEnd: string } => ({
  id: p.id,
  frequency: "monthly",
  periodStart: p.start,
  periodEnd: p.end,
  basis: "calendar",
  weekCount: null,
});

/**
 * The KPI engine's evaluation of an accepted ratio actual at the entry scope on the period basis, as the worker
 * computes it (kpi.recalculate, T-DG4-KBE-C: enteredValue + toEvaluationRow): freshness at the business date, storage
 * rounding, expected-to-date from the approved linear trajectory at the period end (with the version's baseline
 * point), the RAG with the threshold version in force, the variance and the trend against the previous period.
 */
export function engineEvaluation(a: DemoActual): {
  readonly evaluation: DemoEvaluation;
  readonly rounding: Record<string, unknown>;
  readonly explanationParams: Record<string, unknown>;
  readonly thresholdSource: "configured" | "default" | "none";
  readonly thresholdId: string | null;
} {
  const k = demoKpi(a.kpi);
  const p = demoPeriod(a.period);
  const raw = applyFreshness(
    periodValue("ratio", { kind: "ratio", numerator: a.numerator, denominator: a.denominator }),
    freshness({ dataAsOf: a.dataAsOf, staleAfterDays: k.staleAfterDays, businessDate: a.businessDate }),
  );
  if (raw.value === null) throw new Error(`${a.key} has no value`);
  const storage = roundForStorage(raw.value);
  if (!storage.ok) throw new Error(`${a.key} is out of range`);
  const actual = { ...raw, value: storage.stored } as KpiResult;
  const expected = expectedToDate({
    trajectory: {
      id: k.trajectory.id,
      versionNo: 1,
      basis: "period",
      interpolation: "linear",
      points: k.trajectory.points,
    },
    baseline: { date: k.baselineDate, value: k.baselineValue },
    at: p.end,
  });
  const rag = evaluateRag({
    measureType: k.measureType,
    thresholds:
      k.threshold === null
        ? null
        : {
            id: k.threshold.id,
            versionNo: 1,
            toleranceMode: k.threshold.mode,
            amberThreshold: k.threshold.amber,
            redThreshold: k.threshold.red,
          },
    actual,
    expected: expected.result,
    trajectoryVersion: 1,
  });
  if (expected.result.value === null) throw new Error(`${a.key} has no expected value`);
  const v = computeVariance({ actual: storage.stored, expected: expected.result.value, unitKind: k.unitKind });
  const prev = previousActual(a);
  const trend = computeTrend({
    measureType: k.measureType,
    current: actual,
    previous:
      prev === null
        ? null
        : ({
            status: prev.evaluation.valueStatus,
            value: prev.evaluation.value,
            reason: prev.evaluation.valueStatus === "stale" ? "kpi.stale" : null,
          } as KpiResult),
    currentPeriod: periodInfo(p),
    previousPeriod: prev === null ? null : periodInfo(demoPeriod(prev.period)),
    valueBasis: "period",
  });
  const round6 = (x: string): string => {
    const r = roundForStorage(x);
    if (!r.ok) throw new Error(`${a.key} variance out of range`);
    return r.stored;
  };
  if (v.varianceRatio.value === null) throw new Error(`${a.key} has no variance ratio`);
  // The worker's database invariants (0035): a non-ok status forces the same-named RAG and explanation.
  const stale = actual.status === "stale";
  return {
    evaluation: {
      valueStatus: stale ? "stale" : "ok",
      value: storage.stored,
      expected: round6(expected.result.value),
      variance: round6(v.variance),
      varianceRatio: round6(v.varianceRatio.value),
      calculatedRag: stale ? "stale" : (rag.calculatedRag as DemoEvaluation["calculatedRag"]),
      deviation: rag.deviation,
      trend: trend.trend as DemoEvaluation["trend"],
      explanationKey: stale ? "kpi.rag.stale" : rag.explanationKey,
    },
    rounding: storage.rounding as unknown as Record<string, unknown>,
    explanationParams: rag.explanationParams as unknown as Record<string, unknown>,
    thresholdSource: rag.thresholdSource,
    thresholdId: rag.thresholdId,
  };
}

/**
 * The KPI engine's cumulative-basis evaluation of the same slot, as the worker computes it: the YTD window of the
 * organization's monthly periods (cumulativeValue, ytd_start_month 1) over the KPI's accepted actuals, freshness of the
 * slot's own value, storage rounding; the approved trajectory has basis period, so it is not used (expected Unknown,
 * kpi.no_approved_trajectory), the RAG is Unknown or Stale, and the trend compares the previous period's cumulative
 * value.
 */
export function engineCumulative(a: DemoActual): {
  readonly cumulative: DemoCumulative;
  readonly window: readonly string[];
  readonly rounding: Record<string, unknown>;
  readonly explanationParams: Record<string, unknown>;
  readonly thresholdSource: "configured" | "default" | "none";
  readonly thresholdId: string | null;
} {
  const k = demoKpi(a.kpi);
  const p = demoPeriod(a.period);
  const values: Record<string, PeriodEntry> = {};
  for (const x of DEMO_ACTUALS.filter((y) => y.kpi === a.kpi))
    values[demoPeriod(x.period).id] = { kind: "ratio", numerator: x.numerator, denominator: x.denominator };
  const cum = cumulativeValue({
    valueNature: "ratio",
    current: periodInfo(p),
    periods: DEMO_PERIODS.map(periodInfo),
    values,
    ytdStartMonth: 1,
  });
  if (cum === null) throw new Error(`${a.key} has no cumulative value`);
  const raw = applyFreshness(
    cum.result,
    freshness({ dataAsOf: a.dataAsOf, staleAfterDays: k.staleAfterDays, businessDate: a.businessDate }),
  );
  if (raw.value === null) throw new Error(`${a.key} has no cumulative value`);
  const storage = roundForStorage(raw.value);
  if (!storage.ok) throw new Error(`${a.key} cumulative is out of range`);
  const actual = { ...raw, value: storage.stored } as KpiResult;
  const expected = expectedToDate({
    trajectory: null,
    baseline: { date: k.baselineDate, value: k.baselineValue },
    at: p.end,
  });
  const rag = evaluateRag({
    measureType: k.measureType,
    thresholds:
      k.threshold === null
        ? null
        : {
            id: k.threshold.id,
            versionNo: 1,
            toleranceMode: k.threshold.mode,
            amberThreshold: k.threshold.amber,
            redThreshold: k.threshold.red,
          },
    actual,
    expected: expected.result,
    trajectoryVersion: null,
  });
  const prev = previousActual(a);
  const trend = computeTrend({
    measureType: k.measureType,
    current: actual,
    previous:
      prev === null
        ? null
        : ({
            status: prev.cumulative.valueStatus,
            value: prev.cumulative.value,
            reason: prev.cumulative.valueStatus === "stale" ? "kpi.stale" : null,
          } as KpiResult),
    currentPeriod: periodInfo(p),
    previousPeriod: prev === null ? null : periodInfo(demoPeriod(prev.period)),
    valueBasis: "cumulative",
  });
  const stale = actual.status === "stale";
  return {
    cumulative: {
      valueStatus: stale ? "stale" : "ok",
      value: storage.stored,
      calculatedRag: stale ? "stale" : (rag.calculatedRag as DemoCumulative["calculatedRag"]),
      deviation: rag.deviation as "unknown",
      trend: trend.trend as DemoCumulative["trend"],
      explanationKey: stale ? "kpi.rag.stale" : rag.explanationKey,
    },
    window: cum.window,
    rounding: storage.rounding as unknown as Record<string, unknown>,
    explanationParams: rag.explanationParams as unknown as Record<string, unknown>,
    thresholdSource: rag.thresholdSource,
    thresholdId: rag.thresholdId,
  };
}

/** The formula engine's evaluation of a formula version with optional input overrides. */
export function formulaEvaluation(f: DemoFormula, inputs: Readonly<Record<string, string>> = {}) {
  return evaluateFormula(f.expression, f.variables, inputs);
}

/** The formula engine's result (decimal string); throws when the formula does not evaluate. */
export function formulaResult(f: DemoFormula, inputs: Readonly<Record<string, string>> = {}): string {
  const e = formulaEvaluation(f, inputs);
  if (!e.ok || e.result === null) throw new Error(`${f.code} does not evaluate (${e.errorCode ?? "unknown"})`);
  return e.result;
}

/** Money is rounded once to numeric(20,4), ROUND_HALF_UP (the benefits module's money4), canonical. */
export function money4(x: string): string {
  return new FORMULA_DECIMAL(x).toDecimalPlaces(4, FORMULA_DECIMAL.ROUND_HALF_UP).toString();
}

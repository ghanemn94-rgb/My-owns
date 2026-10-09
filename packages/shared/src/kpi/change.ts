// Changes and variances: percentage points vs percent, zero base, negative baseline (ADR-0028 §3, REQ-S07-004,
// REQ-S07-005). Owner: kpi-benefits-engineer (T-DG4-KBE-A).
//
// Percentage KPIs store FRACTIONS (0.12 = 12 %). For x₀ → x₁:
//   point change     (x₁ − x₀) × 100, labelled "pp"         (percentage KPIs only)
//   absolute change  x₁ − x₀ in the KPI's unit, label "unit" (every other unit kind)
//   relative change  (x₁ − x₀) / |x₀|, a fraction, label "percent"; x₀ = 0 → Not computable (kpi.zero_base);
//                    x₀ < 0 → computed with |x₀| and flagged negative_baseline.
// 0.10 → 0.12 is +2.0 pp and +20 %. The two labels are never interchanged.
import { formatDecimal, type DisplayLocale } from "../value.ts";
import { PERCENT_SUFFIX } from "../formula/index.ts";
import {
  dec,
  KD,
  notComputable,
  ok,
  plain,
  type ComparisonFlag,
  type Dec,
  type KpiResult,
  type UnitKind,
} from "./types.ts";

/** Contract KpiStatus.changeLabel. */
export type ChangeLabel = "pp" | "percent" | "unit";

export interface AbsoluteChange {
  /** (x₁ − x₀) × 100 for a percentage KPI (points), else x₁ − x₀ in the KPI's unit. */
  readonly value: string;
  readonly label: "pp" | "unit";
}

export interface RelativeChange {
  /** (x₁ − x₀) / |x₀| as a fraction (0.2 = +20 %), or Not computable with kpi.zero_base. */
  readonly result: KpiResult;
  readonly label: "percent";
  /** zero_base when x₀ = 0, negative_baseline when x₀ < 0, else null. */
  readonly flag: Extract<ComparisonFlag, "zero_base" | "negative_baseline"> | null;
}

export interface Change {
  readonly absolute: AbsoluteChange;
  readonly relative: RelativeChange;
}

/** Relative change (x₁ − x₀) / |x₀| with the zero-base and negative-baseline rules. */
export function relativeChange(from: Dec, to: Dec): RelativeChange {
  if (from.isZero())
    return Object.freeze({ result: notComputable("kpi.zero_base"), label: "percent", flag: "zero_base" });
  return Object.freeze({
    result: ok(to.minus(from).div(from.abs())),
    label: "percent",
    flag: from.isNegative() ? "negative_baseline" : null,
  });
}

/** The change between two values of a KPI (ADR-0028 §3). */
export function computeChange(input: {
  readonly from: string;
  readonly to: string;
  readonly unitKind: UnitKind;
}): Change {
  const x0 = dec(input.from, "from");
  const x1 = dec(input.to, "to");
  const diff = x1.minus(x0);
  const absolute: AbsoluteChange =
    input.unitKind === "percentage"
      ? Object.freeze({ value: plain(diff.times(100)), label: "pp" })
      : Object.freeze({ value: plain(diff), label: "unit" });
  return Object.freeze({ absolute, relative: relativeChange(x0, x1) });
}

export interface Variance {
  /** a − e in the KPI's unit (a fraction for a percentage KPI). */
  readonly variance: string;
  /** The variance in points ((a − e) × 100) for a percentage KPI; null for other units. */
  readonly variancePoints: string | null;
  /** (a − e) / |e|; Not computable (kpi.zero_base) when e = 0. */
  readonly varianceRatio: KpiResult;
  /** "pp" for a percentage KPI's point variance, "unit" otherwise (contract KpiStatus.changeLabel). */
  readonly changeLabel: Extract<ChangeLabel, "pp" | "unit">;
  readonly flag: RelativeChange["flag"];
}

/** variance = a − e and variance_ratio = (a − e) / |e| (ADR-0028 §3). */
export function computeVariance(input: {
  readonly actual: string;
  readonly expected: string;
  readonly unitKind: UnitKind;
}): Variance {
  const a = dec(input.actual, "actual");
  const e = dec(input.expected, "expected");
  const v = a.minus(e);
  const rel = relativeChange(e, a);
  const pct = input.unitKind === "percentage";
  return Object.freeze({
    variance: plain(v),
    variancePoints: pct ? plain(v.times(100)) : null,
    varianceRatio: rel.result,
    changeLabel: pct ? "pp" : "unit",
    flag: rel.flag,
  });
}

// ------------------------------------------------------------------------------------------------ display

export interface ChangeFormatOptions {
  readonly locale?: DisplayLocale;
  readonly digits?: "latn" | "arab";
  /** Fixed fraction digits shown (half-up; display only). Defaults: 1 for points, 0 for percent. */
  readonly fractionDigits?: number;
}

function signed(value: Dec, options: ChangeFormatOptions, defaultDigits: number): string {
  const digits = options.fractionDigits ?? defaultDigits;
  const locale = options.locale ?? "en";
  const text = formatDecimal(plain(value.abs()), {
    locale,
    minFractionDigits: digits,
    maxFractionDigits: digits,
    ...(options.digits ? { digits: options.digits } : {}),
  });
  // formatDecimal returns null only for an invalid string, which plain() never produces.
  const body = text ?? plain(value.abs());
  const rounded = value.abs().toDecimalPlaces(digits, KD.ROUND_HALF_UP);
  if (rounded.isZero()) return body;
  return `${value.isNegative() ? "-" : "+"}${body}`;
}

/** "+2.0 pp" (en) / "+2.0 نقطة مئوية" (ar): a point change as returned by computeChange (already × 100). */
export function formatPointChange(points: string, options: ChangeFormatOptions = {}): string {
  const locale = options.locale ?? "en";
  return `${signed(dec(points, "points"), options, 1)} ${PERCENT_SUFFIX.percentage_points[locale]}`;
}

/**
 * "+20%" (en) / "+20٪" (ar) from a relative change FRACTION (0.2). Not computable → null: the caller shows the
 * reason's label ("Not computable"), never "0%".
 */
export function formatRelativeChange(result: KpiResult, options: ChangeFormatOptions = {}): string | null {
  if (result.value === null) return null;
  const locale = options.locale ?? "en";
  return `${signed(dec(result.value, "relative").times(100), options, 0)}${PERCENT_SUFFIX.percent[locale]}`;
}

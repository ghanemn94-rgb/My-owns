// Shared core of the pure KPI library (ADR-0028). Owner: kpi-benefits-engineer (T-DG4-KBE-A).
//
// Rules of every file under packages/shared/src/kpi:
//  - Pure functions only: no I/O, no clock. "Today" is always a business-date PARAMETER (ADR-0025 §2), "now" a
//    timestamp parameter.
//  - KPI values are decimal STRINGS in and out; all arithmetic runs in decimal.js with the formula engine's
//    FORMULA_DECIMAL configuration (precision 80, ROUND_HALF_UP). A JavaScript number is never a KPI value. Day counts
//    (integers derived from ISO dates) are the only numbers used in arithmetic.
//  - A result is { status, value | null, reason }: Unknown and Not computable carry value null and an i18n reason key,
//    never a bare 0 (REQ-S07-005, REQ-S07-006).
//  - A malformed input (not a decimal string, not an ISO date, thresholds out of order) is a programming error of the
//    caller (the API validates first) and throws KpiInputError. It is never turned into 0 or into a status.
import { FORMULA_DECIMAL, RESULT_COLUMN, type FormulaRounding } from "../formula/index.ts";

export const KD = FORMULA_DECIMAL;
export type Dec = InstanceType<typeof FORMULA_DECIMAL>;

// ------------------------------------------------------------------------------------------------ vocabularies

/** kpi_version.measure_type (0033). */
export const MEASURE_TYPES = ["higher_is_better", "lower_is_better", "acceptable_band", "binary_milestone"] as const;
export type MeasureType = (typeof MEASURE_TYPES)[number];

/** kpi_version.value_nature (0033). */
export const VALUE_NATURES = ["flow", "stock", "ratio", "milestone"] as const;
export type ValueNature = (typeof VALUE_NATURES)[number];

/** kpi_version.unit_kind (0033). */
export const UNIT_KINDS = ["currency", "percentage", "count", "ratio", "duration", "score", "other"] as const;
export type UnitKind = (typeof UNIT_KINDS)[number];

/** kpi_version.frequency / reporting_period.frequency (0033). */
export const FREQUENCIES = ["daily", "weekly", "monthly", "quarterly", "annual", "ad_hoc"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

/** kpi_version.aggregation_rule (0033). There is deliberately no "average" rule (REQ-S07-010). */
export const AGGREGATION_RULES = ["sum", "last_value", "weighted_ratio", "custom_formula", "none"] as const;
export type AggregationRule = (typeof AGGREGATION_RULES)[number];

/** kpi_evaluation.value_basis (0035). */
export const VALUE_BASES = ["period", "cumulative"] as const;
export type ValueBasis = (typeof VALUE_BASES)[number];

/** kpi_evaluation.value_status (0035; contract KpiValueStatus). */
export const VALUE_STATUSES = ["ok", "unknown", "stale", "not_computable"] as const;
export type KpiValueStatus = (typeof VALUE_STATUSES)[number];

/** kpi_evaluation.calculated_rag (0035; contract KpiRag). */
export const KPI_RAGS = ["green", "amber", "red", "unknown", "stale", "not_computable"] as const;
export type KpiRag = (typeof KPI_RAGS)[number];

/** kpi_evaluation.deviation (0035). */
export const DEVIATIONS = ["favourable", "within", "adverse", "unknown"] as const;
export type Deviation = (typeof DEVIATIONS)[number];

/** kpi_evaluation.comparison_flag (0035). */
export const COMPARISON_FLAGS = ["negative_baseline", "not_comparable", "zero_base"] as const;
export type ComparisonFlag = (typeof COMPARISON_FLAGS)[number];

/** kpi_evaluation.trend (0035). */
export const TRENDS = ["improving", "worsening", "flat", "not_comparable", "unknown"] as const;
export type Trend = (typeof TRENDS)[number];

/**
 * Value reasons (kpi_evaluation.value_reason, contract KpiReasonCode `^kpi\.[a-z_]{1,60}$`). The first twelve are the
 * ADR-0028 §6 table. The last two are expected-to-date reasons (contract `KpiStatus.expectedReason`): the ADR names
 * them by their explanation keys `kpi.rag.no_approved_trajectory` / `kpi.rag.before_trajectory`, which the reason
 * pattern refuses (a second dot), so the reason drops the `rag.` segment. `kpi.value_out_of_range` is the
 * Not-computable reason of a calculated value that does not fit numeric(24,6): a sum, a roll-up, an interpolation or an
 * engine `formula.result_out_of_range` (ADR-0028 names none; the library never truncates).
 */
export const KPI_REASON_CODES = [
  "kpi.no_accepted_actual",
  "kpi.value_not_available",
  "kpi.cumulative_incomplete",
  "kpi.scope_missing",
  "kpi.formula_input_unknown",
  "kpi.no_active_version",
  "kpi.stale",
  "kpi.zero_denominator",
  "kpi.zero_base",
  "kpi.stock_not_additive",
  "kpi.no_rollup",
  "kpi.formula_division_by_zero",
  "kpi.value_out_of_range",
  "kpi.no_approved_trajectory",
  "kpi.before_trajectory",
] as const;
export type KpiReasonCode = (typeof KPI_REASON_CODES)[number];

/** The ADR-0028 §6 explanation keys (kpi_evaluation.explanation_key). */
export const KPI_EXPLANATION_KEYS = [
  "kpi.rag.on_or_better_than_trajectory",
  "kpi.rag.amber_band",
  "kpi.rag.red_threshold",
  "kpi.rag.inside_band",
  "kpi.rag.outside_band",
  "kpi.rag.milestone_achieved",
  "kpi.rag.milestone_not_yet_due",
  "kpi.rag.milestone_overdue",
  "kpi.rag.no_actual",
  "kpi.rag.no_approved_trajectory",
  "kpi.rag.before_trajectory",
  "kpi.rag.stale",
  "kpi.rag.not_computable",
] as const;
export type KpiExplanationKey = (typeof KPI_EXPLANATION_KEYS)[number];

// ------------------------------------------------------------------------------------------------ results

/** A known value. */
export interface KpiOk {
  readonly status: "ok";
  /** Canonical decimal string (no exponent, no trailing zeros), at calculation precision (not yet storage-rounded). */
  readonly value: string;
  readonly reason: null;
}
/** A value that exists but is older than the staleness window: the number is kept and labelled Stale. */
export interface KpiStale {
  readonly status: "stale";
  readonly value: string;
  readonly reason: "kpi.stale";
}
/** No value: Unknown or Not computable, always with a reason, never 0. */
export interface KpiNoValue {
  readonly status: "unknown" | "not_computable";
  readonly value: null;
  readonly reason: KpiReasonCode;
}
export type KpiResult = KpiOk | KpiStale | KpiNoValue;

export function ok(value: Dec): KpiOk {
  return Object.freeze({ status: "ok", value: plain(value), reason: null });
}
export function unknown(reason: KpiReasonCode): KpiNoValue {
  return Object.freeze({ status: "unknown", value: null, reason });
}
export function notComputable(reason: KpiReasonCode): KpiNoValue {
  return Object.freeze({ status: "not_computable", value: null, reason });
}
/** True when the result carries a number (ok or stale). */
export function hasValue(r: KpiResult): r is KpiOk | KpiStale {
  return r.value !== null;
}

// ------------------------------------------------------------------------------------------------ input errors

/** A caller's programming error (malformed decimal, date or parameter). Never a KPI status. */
export class KpiInputError extends TypeError {
  override readonly name = "KpiInputError";
  /** The offending input's path (e.g. "trajectory.points[1].date"). */
  readonly field: string;
  constructor(field: string, message: string) {
    super(`${field}: ${message}`);
    this.field = field;
  }
}

// ------------------------------------------------------------------------------------------------ decimals

/** A plain decimal string: optional minus, digits, optional fraction. No exponent, no "+", no spaces. */
const DECIMAL_TEXT = /^-?[0-9]+(\.[0-9]+)?$/;
/** Generous length cap (numeric(24,6) needs at most 26 characters; ratios at precision 80 more). */
const MAX_DECIMAL_TEXT = 200;

/** Parses a decimal string strictly; throws KpiInputError for anything else (a number, "", "1e3", "NaN", " 1"). */
export function dec(input: unknown, field: string): Dec {
  if (typeof input !== "string") throw new KpiInputError(field, "must be a decimal string");
  if (input.length > MAX_DECIMAL_TEXT || !DECIMAL_TEXT.test(input)) {
    throw new KpiInputError(field, `is not a plain decimal string (${JSON.stringify(input.slice(0, 40))})`);
  }
  return new KD(input);
}

/** Canonical plain text of a decimal: "-0" never appears, no exponent, trailing zeros removed. */
export function plain(d: Dec): string {
  return d.isZero() ? "0" : d.toFixed();
}

// ------------------------------------------------------------------------------------------------ storage rounding

/** The ADR-0024 §6 item 11 rounding record, reused for kpi_evaluation.rounding (ADR-0028 Context). */
export type KpiRounding = FormulaRounding;

export type StorageResult =
  | { readonly ok: true; readonly stored: string; readonly rounding: KpiRounding }
  | { readonly ok: false; readonly reason: "kpi.value_out_of_range"; readonly rounding: KpiRounding };

/**
 * Rounds a calculated value once, for storage in numeric(24,6) (ROUND_HALF_UP), and returns the rounding record.
 * `inexactIntermediate` states that an earlier division was not exact at precision 80 (e.g. 1/3 in an interpolation).
 * A value that does not fit numeric(24,6) is refused, never truncated.
 */
export function roundForStorage(value: string, inexactIntermediate = false): StorageResult {
  const exact = dec(value, "value");
  const stored = exact.toDecimalPlaces(RESULT_COLUMN.scale, KD.ROUND_HALF_UP);
  const base = {
    column: "numeric(24,6)" as const,
    scale: 6 as const,
    mode: "ROUND_HALF_UP" as const,
    precision: 80 as const,
    inexactIntermediate,
  };
  if (stored.abs().gte(new KD(10).pow(RESULT_COLUMN.precision - RESULT_COLUMN.scale))) {
    return Object.freeze({
      ok: false,
      reason: "kpi.value_out_of_range",
      rounding: Object.freeze({ ...base, exact: plain(exact), stored: null, rounded: false }),
    });
  }
  return Object.freeze({
    ok: true,
    stored: plain(stored),
    rounding: Object.freeze({
      ...base,
      exact: plain(exact),
      stored: stored.isZero() ? "0.000000" : stored.toFixed(RESULT_COLUMN.scale),
      rounded: !stored.eq(exact),
    }),
  });
}

/**
 * Exactness oracle for divisions: the precision-80 quotient multiplied back WITHOUT rounding. (Multiplying back at
 * precision 80 would round 900/91 × 91 back to 900 and wrongly report an exact division.) 400 significant digits hold
 * the exact product of an 80-digit quotient and any divisor up to 320 digits, far above numeric(24,6) operands.
 */
const EXACT = FORMULA_DECIMAL.clone({ precision: 400 });

/** True when the division a/b is exact at the library precision (sets a rounding record's `inexactIntermediate`). */
export function divisionIsExact(numerator: Dec, denominator: Dec): boolean {
  const q = numerator.div(denominator);
  return new EXACT(q).times(new EXACT(denominator)).eq(new EXACT(numerator));
}

// ------------------------------------------------------------------------------------------------ dates

const ISO_DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
const MS_PER_DAY = 86_400_000;

/** Days since 1970-01-01 of an ISO business date ("2026-10-09"); throws KpiInputError for an invalid date. */
export function dayNumber(date: unknown, field: string): number {
  if (typeof date !== "string") throw new KpiInputError(field, "must be an ISO date string (YYYY-MM-DD)");
  const m = ISO_DATE.exec(date);
  if (m === null) throw new KpiInputError(field, `is not an ISO date (${JSON.stringify(date.slice(0, 20))})`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    throw new KpiInputError(field, `is not a calendar date (${date})`);
  }
  return ms / MS_PER_DAY;
}

/** Year and month (1–12) of a valid ISO date. */
export function yearMonth(date: string, field: string): { year: number; month: number } {
  dayNumber(date, field);
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) };
}

/** ISO date of a day number. */
export function isoOfDay(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Parses an ISO timestamp ("2026-10-09T08:00:00Z" or with an offset) to epoch milliseconds; throws when invalid. */
export function instant(value: unknown, field: string): number {
  if (typeof value !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+(Z|[+-][0-9]{2}:[0-9]{2})$/.test(value)) {
    throw new KpiInputError(field, "must be an ISO 8601 timestamp with a zone (…Z or ±hh:mm)");
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new KpiInputError(field, `is not a valid timestamp (${value})`);
  return ms;
}

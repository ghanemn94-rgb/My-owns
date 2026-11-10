// E2 explanation view model: a benefit's realized value (ADR-0061 §8 row E2; ADR-0030 §6 T14 Realized; REQ-S15-014,
// REQ-S08-001). Owner: kpi-benefits-engineer (T-DG6-KBE-B; p6-work-split §I/K.2).
//
// Pure: it takes `getBenefitValues` (BenefitValues) and, when the page has it, `getBenefit` → `realized`
// (BenefitRealized), and returns the panel's three groups and message parameters:
//  - validated  = the lines of the `validated` series (Finance-validated measurements);
//  - sustained  = the lines of the `sustained` series;
//  - pending    = the lines of the `submitted` series (awaiting Finance validation).
// Each group keeps its own lines (period, amount, record, basis), count, total and first/last period. The three totals
// are NEVER added together: there is deliberately no combined total in this model. Planned, forecast, measured and
// rejected lines, and any scenario, are not realized value and never appear here.
//
// Totals are the server's (`series[].total`); nothing is recomputed for display. The model only refuses to show a
// total that its own lines contradict:
//  - a group without lines has no value yet: `no_lines` (the designed incomplete state), never the server's "0.0000";
//  - a line without an amount makes its group's total Unknown (`benefit.value_amount_missing`), never 0;
//  - a known server total that is not the exact decimal sum of its lines, or a count that is not the number of lines,
//    makes the total Unknown (`explain.inputs_inconsistent`);
//  - a non-financial benefit without an approved valuation method is n/a with its long text (`benefitsP4.value.naLong`),
//    never 0. Its realized value is "the latest accepted actual of its agreed KPI" (`realized.kpiActual`), shown with
//    its own status (Unknown and Stale are never 0).
import { Decimal } from "decimal.js";

const D = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -80, toExpPos: 80 });
const DECIMAL_TEXT = /^-?[0-9]+(\.[0-9]+)?$/;

/** The i18n key of the long n/a text (ADR-0061 §8 "Decimal and Unknown"). */
export const BENEFIT_NA_LONG_KEY = "benefitsP4.value.naLong" as const;

/** Contract BenefitAmount (structural). */
export interface ExplainBenefitAmountInput {
  readonly status: "known" | "unknown" | "not_applicable";
  readonly amount: string | null;
  readonly currency: string | null;
  readonly reason: string | null;
}

/** The fields of `getBenefitValues` (contract BenefitValues) the panel uses. */
export interface BenefitValuesInput {
  readonly benefitId: string;
  readonly currency: string;
  readonly series: readonly {
    readonly state: string;
    readonly total: ExplainBenefitAmountInput;
    readonly count: number;
    readonly lines: readonly {
      readonly periodStart: string | null;
      readonly periodEnd: string | null;
      readonly amount: string | null;
      readonly kpiValue: string | null;
      readonly recordType: "benefit_plan_value" | "benefit_measurement";
      readonly recordId: string;
      readonly basis: "validated" | "provisional" | null;
    }[];
  }[];
}

/** The `getBenefit` → `realized.kpiActual` field (contract BenefitKpiActual, structural). */
export interface BenefitKpiActualInput {
  readonly status: "known" | "unknown" | "stale" | "not_applicable";
  readonly value: string | null;
  readonly reason: string | null;
}

export type RealizedGroupKey = "validated" | "sustained" | "pending";
/** The value state each group reads (pending = submitted, awaiting Finance validation). */
export const REALIZED_GROUP_STATES: Readonly<Record<RealizedGroupKey, "validated" | "sustained" | "submitted">> =
  Object.freeze({ validated: "validated", sustained: "sustained", pending: "submitted" });
export const REALIZED_GROUP_KEYS: readonly RealizedGroupKey[] = Object.freeze(["validated", "sustained", "pending"]);

/**
 * A displayed amount: known (the server's decimal string), Unknown with a reason, n/a, or `no_lines` (the group has no
 * value yet: the designed incomplete state of ADR-0061 §8, never "0.0000"). Never a 0 stand-in.
 */
export type ExplainAmount =
  | { readonly status: "known"; readonly amount: string; readonly currency: string | null }
  | { readonly status: "no_lines" }
  | { readonly status: "unknown"; readonly reason: string }
  | { readonly status: "not_applicable"; readonly textKey: typeof BENEFIT_NA_LONG_KEY };

export interface RealizedLine {
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
  readonly amount: ExplainAmount;
  readonly recordType: "benefit_plan_value" | "benefit_measurement";
  readonly recordId: string;
  readonly basis: "validated" | "provisional" | null;
}

export interface RealizedGroup {
  readonly key: RealizedGroupKey;
  readonly state: "validated" | "sustained" | "submitted";
  readonly lines: readonly RealizedLine[];
  readonly count: number;
  readonly total: ExplainAmount;
  /** The earliest `periodStart` of the group's lines, or null without dated lines. */
  readonly firstPeriodStart: string | null;
  /** The latest `periodEnd` of the group's lines, or null without dated lines. */
  readonly lastPeriodEnd: string | null;
}

export type RealizedKpiActual =
  | { readonly status: "known"; readonly value: string }
  | { readonly status: "unknown" | "stale" | "not_applicable"; readonly reason: string | null };

export interface BenefitRealizedMessageParams {
  readonly currency: string;
  readonly validatedCount: number;
  readonly sustainedCount: number;
  readonly pendingCount: number;
  readonly firstPeriodStart: string | null;
  readonly lastPeriodEnd: string | null;
}

export interface BenefitRealizedExplanation {
  readonly kind: "benefit_realized";
  readonly benefitId: string;
  readonly currency: string;
  /** validated, sustained, pending, in that order. Their totals are never added together. */
  readonly groups: readonly [RealizedGroup, RealizedGroup, RealizedGroup];
  /** True when the benefit has no monetary value (every group is n/a): the KPI actual is its realized value. */
  readonly nonFinancial: boolean;
  /** `getBenefit` → `realized.kpiActual`, or null when the page did not pass it. */
  readonly kpiActual: RealizedKpiActual | null;
  /** The earliest and latest line periods over the three groups. */
  readonly firstPeriodStart: string | null;
  readonly lastPeriodEnd: string | null;
  readonly messageParams: BenefitRealizedMessageParams;
}

function minDate(values: readonly (string | null)[]): string | null {
  let best: string | null = null;
  // ISO business dates (YYYY-MM-DD) order lexicographically.
  for (const v of values) if (v !== null && (best === null || v < best)) best = v;
  return best;
}

function maxDate(values: readonly (string | null)[]): string | null {
  let best: string | null = null;
  for (const v of values) if (v !== null && (best === null || v > best)) best = v;
  return best;
}

function lineAmount(amount: string | null, currency: string, na: boolean): ExplainAmount {
  if (na) return { status: "not_applicable", textKey: BENEFIT_NA_LONG_KEY };
  if (amount === null || !DECIMAL_TEXT.test(amount))
    return { status: "unknown", reason: "benefit.value_amount_missing" };
  return { status: "known", amount, currency };
}

function groupOf(values: BenefitValuesInput, key: RealizedGroupKey): RealizedGroup {
  const state = REALIZED_GROUP_STATES[key];
  const series = values.series.find((s) => s.state === state);
  if (series === undefined)
    return {
      key,
      state,
      lines: [],
      count: 0,
      total: { status: "unknown", reason: "explain.series_missing" },
      firstPeriodStart: null,
      lastPeriodEnd: null,
    };
  const na = series.total.status === "not_applicable";
  const lines: RealizedLine[] = series.lines.map((l) => ({
    periodStart: l.periodStart,
    periodEnd: l.periodEnd,
    amount: lineAmount(l.amount, values.currency, na),
    recordType: l.recordType,
    recordId: l.recordId,
    basis: l.basis,
  }));
  return {
    key,
    state,
    lines,
    count: series.count,
    total: totalOf(series, values.currency),
    firstPeriodStart: minDate(series.lines.map((l) => l.periodStart)),
    lastPeriodEnd: maxDate(series.lines.map((l) => l.periodEnd)),
  };
}

/** The group total: the server's, unless its own lines contradict it (see the header). */
function totalOf(series: BenefitValuesInput["series"][number], currency: string): ExplainAmount {
  if (series.total.status === "not_applicable") return { status: "not_applicable", textKey: BENEFIT_NA_LONG_KEY };
  if (series.count === 0 && series.lines.length === 0) return { status: "no_lines" };
  if (series.lines.some((l) => l.amount === null)) return { status: "unknown", reason: "benefit.value_amount_missing" };
  if (series.total.status === "unknown")
    return { status: "unknown", reason: series.total.reason ?? "benefit.value_amount_missing" };
  const amount = series.total.amount;
  if (amount === null || !DECIMAL_TEXT.test(amount) || series.count !== series.lines.length)
    return { status: "unknown", reason: "explain.inputs_inconsistent" };
  let sum = new D(0);
  for (const l of series.lines) {
    if (!DECIMAL_TEXT.test(l.amount!)) return { status: "unknown", reason: "explain.inputs_inconsistent" };
    sum = sum.plus(new D(l.amount!));
  }
  if (!sum.eq(new D(amount))) return { status: "unknown", reason: "explain.inputs_inconsistent" };
  return { status: "known", amount, currency: series.total.currency ?? currency };
}

function kpiActualOf(input: BenefitKpiActualInput | null | undefined): RealizedKpiActual | null {
  if (input === null || input === undefined) return null;
  if (input.status === "known") {
    if (input.value === null || !DECIMAL_TEXT.test(input.value))
      return { status: "unknown", reason: input.reason ?? "explain.inputs_inconsistent" };
    return { status: "known", value: input.value };
  }
  return { status: input.status, reason: input.reason };
}

/**
 * The E2 panel of one benefit. `kpiActual` is `getBenefit` → `realized.kpiActual` when the page loads it (it is the
 * realized value of a non-financial benefit).
 */
export function explainBenefitRealized(
  values: BenefitValuesInput,
  kpiActual?: BenefitKpiActualInput | null,
): BenefitRealizedExplanation {
  const groups = [groupOf(values, "validated"), groupOf(values, "sustained"), groupOf(values, "pending")] as const;
  const allLines = groups.flatMap((g) => g.lines);
  const firstPeriodStart = minDate(allLines.map((l) => l.periodStart));
  const lastPeriodEnd = maxDate(allLines.map((l) => l.periodEnd));
  return {
    kind: "benefit_realized",
    benefitId: values.benefitId,
    currency: values.currency,
    groups,
    nonFinancial: groups.every((g) => g.total.status === "not_applicable"),
    kpiActual: kpiActualOf(kpiActual),
    firstPeriodStart,
    lastPeriodEnd,
    messageParams: {
      currency: values.currency,
      validatedCount: groups[0].count,
      sustainedCount: groups[1].count,
      pendingCount: groups[2].count,
      firstPeriodStart,
      lastPeriodEnd,
    },
  };
}

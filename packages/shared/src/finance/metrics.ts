// The optional NPV / ROI / payback extension (M0174, REQ-S08-019; ADR-0047 §5, §9). Owner: kpi-benefits-engineer
// (T-DG5-KBE-F). Pure functions over Finance-entered cash flows; decimal.js only, never a JavaScript number for an
// amount or a rate. An extension, not a playbook requirement: the playbook prescribes no NPV, ROI or payback.
//
// Definitions (ADR-0047 §5), with Net_t = inflow_t - outflow_t for period index t = 0..n-1:
//  - NPV = Σ Net_t / (1 + r)^e_t, e_t = t for `beginning_of_period` and e_t = t + 1 for `end_of_period` (Excel's
//    NPV() convention). Computed at precision 40 and rounded ONCE to 2 decimals, ROUND_HALF_UP. No NPV without a
//    discount rate: `null` with `discount_rate_missing`, never 0.
//  - ROI = (Σ inflow - Σ outflow) / Σ outflow, undiscounted, a decimal fraction (0.2 = 20 %) rounded once to 6
//    decimals, ROUND_HALF_UP. Not computable when Σ outflow = 0 (a zero denominator is never 0 or infinity).
//  - Payback = the smallest period index t at which the cumulative undiscounted net is >= 0, provided some earlier
//    cumulative net was < 0. "Not reached" when that never happens. "Not computable" when there is no outflow, and,
//    as its generalization, when the cumulative net is never negative (there is nothing to pay back).
//
// Value bases are never mixed (D-117, D-119, D-122): the cash flows are entered explicitly in one currency and are
// never derived from benefit values; the functions here take no currency because every row is in the set's currency.
import { Decimal } from "decimal.js";

/** The computation clone of ADR-0047 §5: precision 40, ROUND_HALF_UP. */
export const FINANCE_DECIMAL = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -9_000_000_000_000_000,
  toExpPos: 9_000_000_000_000_000,
});
type Dec = InstanceType<typeof FINANCE_DECIMAL>;

export const FINANCIAL_TIMINGS = ["end_of_period", "beginning_of_period"] as const;
export type FinancialTiming = (typeof FINANCIAL_TIMINGS)[number];
export const FINANCIAL_PERIOD_BASES = ["annual", "quarterly", "monthly"] as const;
export type FinancialPeriodBasis = (typeof FINANCIAL_PERIOD_BASES)[number];
export const FINANCIAL_METHODOLOGIES = ["discounted_net_cash_flow"] as const;
export type FinancialMethodology = (typeof FINANCIAL_METHODOLOGIES)[number];

/** ADR-0047 §5 limits: period indexes 0..120, so 1..121 rows; amounts numeric(20,4) >= 0; rate numeric(9,6) in [0, 1]. */
export const CASH_FLOW_LIMITS = Object.freeze({
  maxRows: 121,
  maxPeriodIndex: 120,
  amountScale: 4,
  amountIntegerDigits: 16,
});
export const DISCOUNT_RATE_LIMITS = Object.freeze({ min: "0", max: "1", scale: 6 });
/** The contract's Decimal holds at most 18 integer digits; a metric beyond it is not representable. */
const CONTRACT_INTEGER_DIGITS = 18;

export interface CashFlowInput {
  readonly periodIndex: number;
  /** Decimal string, >= 0, at most 4 fraction digits (numeric(20,4)). */
  readonly outflow: string;
  /** Decimal string, >= 0, at most 4 fraction digits (numeric(20,4)). */
  readonly inflow: string;
}

const UNSIGNED_TEXT = /^([0-9]+)(?:\.([0-9]+))?$/;

/** Integer and (trailing-zero-trimmed) fraction digit counts of an unsigned decimal string; null when not one. */
function digitsOf(value: string): { int: number; frac: number } | null {
  const m = UNSIGNED_TEXT.exec(value);
  if (!m) return null;
  return {
    int: m[1]!.replace(/^0+(?=[0-9])/, "").replace(/^0$/, "").length,
    frac: (m[2] ?? "").replace(/0+$/, "").length,
  };
}

/** True for a non-negative amount that fits numeric(20,4) exactly (no silent rounding). */
export function isCashFlowAmount(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const d = digitsOf(value);
  return d !== null && d.int <= CASH_FLOW_LIMITS.amountIntegerDigits && d.frac <= CASH_FLOW_LIMITS.amountScale;
}

/** True for a discount rate that is a decimal fraction in [0, 1] with at most 6 fraction digits (numeric(9,6)). */
export function isDiscountRate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const d = digitsOf(value);
  if (d === null || d.frac > DISCOUNT_RATE_LIMITS.scale) return false;
  const v = new FINANCE_DECIMAL(value);
  return v.gte(0) && v.lte(1);
}

export type CashFlowCheck =
  | { readonly ok: true; readonly rows: readonly CashFlowInput[] }
  | { readonly ok: false; readonly reason: "periods_invalid" | "amount_invalid"; readonly index: number };

/**
 * The ADR-0047 §5 set rules: 1..121 rows, one per period index 0..n-1 with no gap and no duplicate (any order on input;
 * returned sorted by index), and every amount a non-negative numeric(20,4) decimal string.
 */
export function checkCashFlows(rows: readonly CashFlowInput[]): CashFlowCheck {
  if (rows.length < 1 || rows.length > CASH_FLOW_LIMITS.maxRows)
    return { ok: false, reason: "periods_invalid", index: 0 };
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i]!;
    if (!isCashFlowAmount(r.outflow) || !isCashFlowAmount(r.inflow))
      return { ok: false, reason: "amount_invalid", index: i };
  }
  const sorted = [...rows].sort((a, b) => a.periodIndex - b.periodIndex);
  for (let i = 0; i < sorted.length; i += 1) {
    const p = sorted[i]!.periodIndex;
    if (!Number.isInteger(p) || p !== i) return { ok: false, reason: "periods_invalid", index: i };
  }
  return { ok: true, rows: sorted };
}

/** Plain notation with exactly `scale` fraction digits; a zero is never "-0.00". */
function fixed(d: Dec, scale: number): string {
  const r = d.toDecimalPlaces(scale, Decimal.ROUND_HALF_UP);
  return r.isZero() ? (0).toFixed(scale) : r.toFixed(scale);
}

/** True when the rounded value fits the contract's Decimal (at most 18 integer digits). */
function representable(d: Dec): boolean {
  return d.abs().lt(new FINANCE_DECIMAL(10).pow(CONTRACT_INTEGER_DIGITS));
}

function sums(rows: readonly CashFlowInput[]) {
  let inflow = new FINANCE_DECIMAL(0);
  let outflow = new FINANCE_DECIMAL(0);
  for (const r of rows) {
    inflow = inflow.plus(r.inflow);
    outflow = outflow.plus(r.outflow);
  }
  return { inflow, outflow };
}

export type NpvResult =
  | { readonly value: string; readonly exact: string; readonly reason: null }
  | { readonly value: null; readonly exact: null; readonly reason: "discount_rate_missing" | "out_of_range" };

/**
 * NPV of a checked set (checkCashFlows) at `discountRate` per period. `exact` is the precision-40 sum before the one
 * rounding (lineage). A null rate is `discount_rate_missing`, never 0.
 */
export function netPresentValue(
  rows: readonly CashFlowInput[],
  discountRate: string | null,
  timing: FinancialTiming,
): NpvResult {
  if (discountRate === null) return { value: null, exact: null, reason: "discount_rate_missing" };
  if (!isDiscountRate(discountRate)) throw new RangeError("discount rate outside [0, 1] or not numeric(9,6)");
  const factor = new FINANCE_DECIMAL(1).plus(discountRate);
  const shift = timing === "end_of_period" ? 1 : 0;
  let total = new FINANCE_DECIMAL(0);
  for (const r of rows) {
    const net = new FINANCE_DECIMAL(r.inflow).minus(r.outflow);
    total = total.plus(net.div(factor.pow(r.periodIndex + shift)));
  }
  if (!representable(total.toDecimalPlaces(2, Decimal.ROUND_HALF_UP)))
    return { value: null, exact: null, reason: "out_of_range" };
  return { value: fixed(total, 2), exact: total.isZero() ? "0" : total.toFixed(), reason: null };
}

export type RoiResult =
  | { readonly value: string; readonly reason: null }
  | { readonly value: null; readonly reason: "not_computable" };

/** ROI = (Σ inflow - Σ outflow) / Σ outflow, 6 decimals; not computable when Σ outflow = 0 or beyond the contract. */
export function returnOnInvestment(rows: readonly CashFlowInput[]): RoiResult {
  const { inflow, outflow } = sums(rows);
  if (outflow.isZero()) return { value: null, reason: "not_computable" };
  const roi = inflow.minus(outflow).div(outflow);
  if (!representable(roi.toDecimalPlaces(6, Decimal.ROUND_HALF_UP))) return { value: null, reason: "not_computable" };
  return { value: fixed(roi, 6), reason: null };
}

export type PaybackResult =
  | { readonly periodIndex: number; readonly reason: null }
  | { readonly periodIndex: null; readonly reason: "not_reached" | "not_computable" };

/** The payback period index of a checked set (see the header for the three outcomes). */
export function paybackPeriod(rows: readonly CashFlowInput[]): PaybackResult {
  if (sums(rows).outflow.isZero()) return { periodIndex: null, reason: "not_computable" };
  let cumulative = new FINANCE_DECIMAL(0);
  let underwater = false;
  for (const r of rows) {
    cumulative = cumulative.plus(r.inflow).minus(r.outflow);
    if (cumulative.lt(0)) underwater = true;
    else if (underwater) return { periodIndex: r.periodIndex, reason: null };
  }
  return underwater ? { periodIndex: null, reason: "not_reached" } : { periodIndex: null, reason: "not_computable" };
}

export interface FinancialMetricValues {
  readonly npv: string | null;
  /** NPV before its one rounding (precision 40), or null. */
  readonly npvExact: string | null;
  readonly npvReason: "discount_rate_missing" | "out_of_range" | null;
  readonly roi: string | null;
  readonly roiReason: "not_computable" | null;
  readonly paybackPeriodIndex: number | null;
  readonly paybackReason: "not_reached" | "not_computable" | null;
}

/**
 * The three metrics of one cash-flow set under the given assumptions. The rows must satisfy checkCashFlows (a
 * RangeError otherwise: the API validates before it stores, so an invalid stored set is a programming error).
 */
export function computeFinancialMetrics(input: {
  readonly rows: readonly CashFlowInput[];
  readonly discountRate: string | null;
  readonly timing: FinancialTiming;
}): FinancialMetricValues {
  const checked = checkCashFlows(input.rows);
  if (!checked.ok) throw new RangeError(`cash flows ${checked.reason} at ${checked.index}`);
  const npv = netPresentValue(checked.rows, input.discountRate, input.timing);
  const roi = returnOnInvestment(checked.rows);
  const payback = paybackPeriod(checked.rows);
  return {
    npv: npv.value,
    npvExact: npv.exact,
    npvReason: npv.reason,
    roi: roi.value,
    roiReason: roi.reason,
    paybackPeriodIndex: payback.periodIndex,
    paybackReason: payback.reason,
  };
}

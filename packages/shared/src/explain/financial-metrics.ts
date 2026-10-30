// E4 explanation view model: NPV, ROI and payback of a business case (ADR-0061 §8 row E4; ADR-0047 §5; REQ-S15-014,
// REQ-S08-019, the optional extension). Owner: kpi-benefits-engineer (T-DG6-KBE-B; p6-work-split §I/K.2).
//
// Pure: it takes `getBusinessCaseCashFlows` (BusinessCaseCashFlows) and `getBusinessCaseFinancialMetrics`
// (FinancialMetrics, which carries the assumptions) and returns the panel's per-period rows and message parameters.
//  - The three metrics come from the shared `computeFinancialMetrics` of `../finance/metrics.ts` (no second NPV, ROI or
//    payback implementation), and must equal the server's values; any difference, or a cash-flow revision that is not
//    the one the metrics were computed on, makes the panel Unknown (`explain.inputs_inconsistent`,
//    `explain.revision_mismatch`) instead of a breakdown that explains another calculation.
//  - Each row: period index, outflow, inflow, net = inflow − outflow (exact, 4 decimals), the discount exponent
//    (t for beginning-of-period timing, t + 1 for end-of-period), the discount factor 1 ÷ (1 + r)^e (display, 6
//    decimals, ROUND_HALF_UP), the discounted net (display, 2 decimals) and the cumulative undiscounted net (exact, 4
//    decimals), plus the payback marker on the payback row. Without a discount rate the factor and discounted net are
//    null (there is no NPV, never 0). The NPV itself is the precision-40 sum rounded ONCE (ADR-0047 §5); rounded
//    display rows need not add up to it, so the panel shows `npvExact` as lineage.
//  - Status other than `shown` gives no rows: `disabled` (the extension is off: nothing is shown) or `incomplete`
//    (assumptions or cash flows missing).
// decimal.js only (FINANCE_DECIMAL, precision 40); amounts and rates are decimal strings.
import {
  FINANCE_DECIMAL,
  checkCashFlows,
  computeFinancialMetrics,
  type FinancialMetricValues,
  type FinancialPeriodBasis,
  type FinancialTiming,
} from "../finance/metrics.ts";

const DECIMAL_TEXT = /^-?[0-9]+(\.[0-9]+)?$/;

/** The fields of `getBusinessCaseCashFlows` (contract BusinessCaseCashFlows) the panel uses. */
export interface CashFlowsInput {
  readonly businessCaseId: string;
  readonly currency: string;
  readonly revision: number;
  readonly rows: readonly { readonly periodIndex: number; readonly outflow: string; readonly inflow: string }[];
}

/** The fields of `getBusinessCaseFinancialMetrics` (contract FinancialMetrics) the panel uses. */
export interface FinancialMetricsInput {
  readonly businessCaseId: string;
  readonly status: "shown" | "disabled" | "assumptions_missing" | "cash_flows_missing";
  readonly currency: string;
  readonly npv: string | null;
  readonly npvReason: "discount_rate_missing" | "not_shown" | null;
  readonly roi: string | null;
  readonly roiReason: "not_computable" | "not_shown" | null;
  readonly paybackPeriodIndex: number | null;
  readonly paybackReason: "not_reached" | "not_computable" | "not_shown" | null;
  readonly assumptions: {
    readonly timing: FinancialTiming;
    readonly periodBasis: FinancialPeriodBasis;
    readonly discountRate: string | null;
    readonly methodologyNote: string;
  } | null;
  readonly cashFlowRevision: number | null;
}

export interface FinancialMetricsRow {
  readonly periodIndex: number;
  readonly outflow: string;
  readonly inflow: string;
  /** inflow − outflow, exact, 4 fraction digits. */
  readonly net: string;
  /** The power of (1 + r): periodIndex (beginning of period) or periodIndex + 1 (end of period). */
  readonly discountExponent: number;
  /** 1 ÷ (1 + r)^e, 6 fraction digits (display); null without a discount rate. */
  readonly discountFactor: string | null;
  /** net ÷ (1 + r)^e, 2 fraction digits (display); null without a discount rate. */
  readonly discountedNet: string | null;
  /** The cumulative undiscounted net up to and including this period, exact, 4 fraction digits. */
  readonly cumulativeNet: string;
  /** True on the payback row only. */
  readonly payback: boolean;
}

export interface FinancialMetricsMessageParams {
  readonly currency: string;
  readonly revision: number;
  readonly periodCount: number;
  readonly periodBasis: FinancialPeriodBasis;
  readonly timing: FinancialTiming;
  /** 0 for beginning-of-period timing, 1 for end-of-period. */
  readonly firstExponent: 0 | 1;
  readonly discountRate: string | null;
}

export type FinancialMetricsUnknownReason =
  | "explain.revision_mismatch"
  | "explain.currency_mismatch"
  | "explain.inputs_inconsistent";

export type FinancialMetricsExplanation =
  | { readonly kind: "financial_metrics"; readonly state: "disabled"; readonly businessCaseId: string }
  | {
      readonly kind: "financial_metrics";
      readonly state: "incomplete";
      readonly businessCaseId: string;
      readonly reason: "assumptions_missing" | "cash_flows_missing";
    }
  | {
      readonly kind: "financial_metrics";
      readonly state: "unknown";
      readonly businessCaseId: string;
      readonly reason: FinancialMetricsUnknownReason;
    }
  | {
      readonly kind: "financial_metrics";
      readonly state: "shown";
      readonly businessCaseId: string;
      readonly currency: string;
      readonly revision: number;
      readonly rows: readonly FinancialMetricsRow[];
      /** Σ inflow and Σ outflow, exact, 4 fraction digits (the ROI inputs). */
      readonly totalInflow: string;
      readonly totalOutflow: string;
      /** The server's metrics, each with its reason when absent (never 0). */
      readonly npv: string | null;
      readonly npvReason: FinancialMetricsInput["npvReason"];
      /** NPV at precision 40 before its one rounding (lineage), or null. */
      readonly npvExact: string | null;
      readonly roi: string | null;
      readonly roiReason: FinancialMetricsInput["roiReason"];
      readonly paybackPeriodIndex: number | null;
      readonly paybackReason: FinancialMetricsInput["paybackReason"];
      readonly messageParams: FinancialMetricsMessageParams;
    };

function fixed(d: InstanceType<typeof FINANCE_DECIMAL>, scale: number): string {
  const r = d.toDecimalPlaces(scale, FINANCE_DECIMAL.ROUND_HALF_UP);
  return r.isZero() ? (0).toFixed(scale) : r.toFixed(scale);
}

function sameDecimal(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return DECIMAL_TEXT.test(a) && DECIMAL_TEXT.test(b) && new FINANCE_DECIMAL(a).eq(new FINANCE_DECIMAL(b));
}

/** True when the server's metrics are those of `computeFinancialMetrics` (with the API's out_of_range → not_shown). */
function matchesServer(m: FinancialMetricValues, server: FinancialMetricsInput): boolean {
  const npvReason = m.npvReason === "out_of_range" ? "not_shown" : m.npvReason;
  return (
    sameDecimal(m.npv, server.npv) &&
    npvReason === server.npvReason &&
    sameDecimal(m.roi, server.roi) &&
    m.roiReason === server.roiReason &&
    m.paybackPeriodIndex === server.paybackPeriodIndex &&
    m.paybackReason === server.paybackReason
  );
}

/** The E4 panel of one business case. */
export function explainFinancialMetrics(
  cashFlows: CashFlowsInput,
  metrics: FinancialMetricsInput,
): FinancialMetricsExplanation {
  const businessCaseId = metrics.businessCaseId;
  const base = { kind: "financial_metrics", businessCaseId } as const;
  if (metrics.status === "disabled") return { ...base, state: "disabled" };
  if (metrics.status === "assumptions_missing" || metrics.status === "cash_flows_missing")
    return { ...base, state: "incomplete", reason: metrics.status };
  const unknown = (reason: FinancialMetricsUnknownReason): FinancialMetricsExplanation => ({
    ...base,
    state: "unknown",
    reason,
  });
  const assumptions = metrics.assumptions;
  if (assumptions === null || cashFlows.businessCaseId !== businessCaseId)
    return unknown("explain.inputs_inconsistent");
  if (metrics.cashFlowRevision !== cashFlows.revision) return unknown("explain.revision_mismatch");
  if (metrics.currency.trim() !== cashFlows.currency.trim()) return unknown("explain.currency_mismatch");

  const input = cashFlows.rows.map((r) => ({ periodIndex: r.periodIndex, outflow: r.outflow, inflow: r.inflow }));
  const checked = checkCashFlows(input);
  if (!checked.ok) return unknown("explain.inputs_inconsistent");
  let computed: FinancialMetricValues;
  try {
    computed = computeFinancialMetrics({
      rows: checked.rows,
      discountRate: assumptions.discountRate,
      timing: assumptions.timing,
    });
  } catch {
    return unknown("explain.inputs_inconsistent");
  }
  if (!matchesServer(computed, metrics)) return unknown("explain.inputs_inconsistent");

  const shift = assumptions.timing === "end_of_period" ? 1 : 0;
  const factorBase = assumptions.discountRate === null ? null : new FINANCE_DECIMAL(1).plus(assumptions.discountRate);
  let cumulative = new FINANCE_DECIMAL(0);
  let inflow = new FINANCE_DECIMAL(0);
  let outflow = new FINANCE_DECIMAL(0);
  const rows: FinancialMetricsRow[] = checked.rows.map((r) => {
    const net = new FINANCE_DECIMAL(r.inflow).minus(r.outflow);
    cumulative = cumulative.plus(net);
    inflow = inflow.plus(r.inflow);
    outflow = outflow.plus(r.outflow);
    const exponent = r.periodIndex + shift;
    const power = factorBase === null ? null : factorBase.pow(exponent);
    return {
      periodIndex: r.periodIndex,
      outflow: r.outflow,
      inflow: r.inflow,
      net: fixed(net, 4),
      discountExponent: exponent,
      discountFactor: power === null ? null : fixed(new FINANCE_DECIMAL(1).div(power), 6),
      discountedNet: power === null ? null : fixed(net.div(power), 2),
      cumulativeNet: fixed(cumulative, 4),
      payback: computed.paybackPeriodIndex === r.periodIndex,
    };
  });
  return {
    ...base,
    state: "shown",
    currency: cashFlows.currency.trim(),
    revision: cashFlows.revision,
    rows,
    totalInflow: fixed(inflow, 4),
    totalOutflow: fixed(outflow, 4),
    npv: metrics.npv,
    npvReason: metrics.npvReason,
    npvExact: computed.npvExact,
    roi: metrics.roi,
    roiReason: metrics.roiReason,
    paybackPeriodIndex: metrics.paybackPeriodIndex,
    paybackReason: metrics.paybackReason,
    messageParams: {
      currency: cashFlows.currency.trim(),
      revision: cashFlows.revision,
      periodCount: rows.length,
      periodBasis: assumptions.periodBasis,
      timing: assumptions.timing,
      firstExponent: shift,
      discountRate: assumptions.discountRate,
    },
  };
}

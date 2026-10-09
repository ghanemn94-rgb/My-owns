// Value statuses, staleness, overrides, displayed vs calculated RAG and trend (ADR-0028 §6; REQ-S07-005, REQ-S07-006,
// REQ-S07-008, REQ-S07-009 display rule). Owner: kpi-benefits-engineer (T-DG4-KBE-A).
//
//  - A slot's value: no active version → Unknown (kpi.no_active_version); no accepted actual → Unknown
//    (kpi.no_accepted_actual); "not available" → Unknown (kpi.value_not_available); a zero denominator → Not computable;
//    a value whose data_as_of is more than dq_stale_after_days before today's business date → Stale (kpi.stale), the
//    number kept and labelled.
//  - Read-time: staleness is re-checked against today's business date (a stored ok evaluation can display as Stale); an
//    override is in force while status = 'active' and now < expires_at. calculatedRag is always returned; displayedRag
//    is the override in force, else calculatedRag, so after expiry the calculated RAG displays.
//  - Unknown, Stale and Not computable are "grey" RAGs: never shown as green or 0.
import { comparePeriods, periodValue, type MaybeEntry, type ReportingPeriodInfo } from "./periods.ts";
import { bandShortfall, parseBand } from "./measures.ts";
import {
  dayNumber,
  dec,
  instant,
  KpiInputError,
  unknown,
  type ComparisonFlag,
  type KpiExplanationKey,
  type KpiRag,
  type KpiReasonCode,
  type KpiResult,
  type KpiValueStatus,
  type Trend,
  type ValueBasis,
  type ValueNature,
} from "./types.ts";

// ------------------------------------------------------------------------------------------------ freshness

export interface Freshness {
  readonly status: "fresh" | "stale" | "unknown";
  readonly dataAsOf: string | null;
  readonly staleAfterDays: number | null;
}

/**
 * Freshness of a value (contract KpiStatus.freshness): stale when data_as_of is MORE than staleAfterDays before the
 * business date (exactly staleAfterDays days old is still fresh); unknown without a data_as_of.
 */
export function freshness(input: {
  readonly dataAsOf: string | null;
  readonly staleAfterDays: number;
  readonly businessDate: string;
}): Freshness {
  const n = input.staleAfterDays;
  if (!Number.isInteger(n) || n < 1 || n > 3660)
    throw new KpiInputError("staleAfterDays", "must be an integer from 1 to 3660");
  const today = dayNumber(input.businessDate, "businessDate");
  if (input.dataAsOf === null) return Object.freeze({ status: "unknown", dataAsOf: null, staleAfterDays: n });
  const asOf = dayNumber(input.dataAsOf, "dataAsOf");
  return Object.freeze({ status: today - asOf > n ? "stale" : "fresh", dataAsOf: input.dataAsOf, staleAfterDays: n });
}

/** Applies a freshness to a result: an ok value that is stale becomes Stale (kpi.stale), keeping its number. */
export function applyFreshness(result: KpiResult, f: Freshness): KpiResult {
  if (result.status === "ok" && f.status === "stale")
    return Object.freeze({ status: "stale", value: result.value, reason: "kpi.stale" });
  return result;
}

/** The period value of a slot with every §6 status rule applied. */
export function slotValue(input: {
  readonly hasActiveVersion: boolean;
  readonly valueNature: ValueNature;
  /** The slot's accepted entry; null/undefined = no accepted actual. */
  readonly entry: MaybeEntry;
  readonly dataAsOf: string | null;
  readonly staleAfterDays: number;
  readonly businessDate: string;
}): KpiResult {
  if (!input.hasActiveVersion) return unknown("kpi.no_active_version");
  const value = periodValue(input.valueNature, input.entry);
  return applyFreshness(value, freshness(input));
}

// ------------------------------------------------------------------------------------------------ read-time staleness

/** The stored parts of a kpi_evaluation that read-time rules can change. */
export interface StoredEvaluation {
  readonly value: string | null;
  readonly valueStatus: KpiValueStatus;
  readonly valueReason: KpiReasonCode | null;
  readonly calculatedRag: KpiRag;
  readonly explanationKey: KpiExplanationKey;
  readonly dataAsOf: string | null;
}

/**
 * Re-checks staleness against TODAY's business date (ADR-0028 §6 read-time rule; never stored): a stored ok evaluation
 * whose data has aged past the window reads as Stale, with RAG stale and the kpi.rag.stale explanation.
 */
export function withReadTimeStaleness(
  stored: StoredEvaluation,
  staleAfterDays: number,
  businessDate: string,
): StoredEvaluation & { readonly freshness: Freshness } {
  const f = freshness({ dataAsOf: stored.dataAsOf, staleAfterDays, businessDate });
  if (stored.valueStatus === "ok" && f.status === "stale") {
    return Object.freeze({
      ...stored,
      valueStatus: "stale",
      valueReason: "kpi.stale",
      calculatedRag: "stale",
      explanationKey: "kpi.rag.stale",
      freshness: f,
    });
  }
  return Object.freeze({ ...stored, freshness: f });
}

// ------------------------------------------------------------------------------------------------ overrides

export interface RagOverrideState {
  readonly status: "active" | "revoked";
  /** ISO timestamp with zone. */
  readonly expiresAt: string;
}

/** An override is in force while status = 'active' and now < expiresAt (strictly). */
export function overrideInForce(override: RagOverrideState | null, now: string): boolean {
  if (override === null) return false;
  const t = instant(now, "now");
  return override.status === "active" && t < instant(override.expiresAt, "override.expiresAt");
}

export interface DisplayedRag<O> {
  readonly calculatedRag: KpiRag;
  readonly displayedRag: KpiRag;
  /** The override in force, or null (an expired or revoked override is not shown as in force). */
  readonly override: O | null;
}

/** displayedRag = the override's RAG while in force, else calculatedRag; calculatedRag is always present. */
export function displayedRag<O extends RagOverrideState & { readonly rag: "green" | "amber" | "red" }>(
  calculatedRag: KpiRag,
  override: O | null,
  now: string,
): DisplayedRag<O> {
  const inForce = overrideInForce(override, now);
  return Object.freeze({
    calculatedRag,
    displayedRag: inForce ? override!.rag : calculatedRag,
    override: inForce ? override : null,
  });
}

/** Unknown, Stale and Not computable render grey with their label, never green or 0. */
export function isGreyRag(rag: KpiRag): rag is "unknown" | "stale" | "not_computable" {
  return rag === "unknown" || rag === "stale" || rag === "not_computable";
}

// ------------------------------------------------------------------------------------------------ trend

export type TrendInput =
  | {
      readonly measureType: "higher_is_better" | "lower_is_better";
      readonly current: KpiResult;
      readonly previous: KpiResult | null;
    }
  | {
      readonly measureType: "acceptable_band";
      readonly current: KpiResult;
      readonly previous: KpiResult | null;
      readonly bandLower: string;
      readonly bandUpper: string;
    }
  | {
      readonly measureType: "binary_milestone";
      /** Achieved flags of the two periods; null = no accepted value. */
      readonly current: boolean | null;
      readonly previous: boolean | null;
    };

export interface TrendResult {
  readonly trend: Trend;
  /** not_comparable when the two periods are not comparable (data-quality finding not_comparable, info). */
  readonly comparisonFlag: Extract<ComparisonFlag, "not_comparable"> | null;
}

/**
 * The trend of a slot against the previous period of the same frequency, judged by the measure type (ADR-0028 §6):
 * incomparable periods (e.g. 4 weeks vs 5 weeks) → not_comparable; a missing value or previous period → unknown;
 * higher-is-better up = improving; lower-is-better down = improving; band: closer to the band = improving;
 * milestone: becoming achieved = improving, losing it = worsening.
 */
export function computeTrend(
  input: TrendInput & {
    readonly currentPeriod: ReportingPeriodInfo;
    readonly previousPeriod: ReportingPeriodInfo | null;
    readonly valueBasis?: ValueBasis;
  },
): TrendResult {
  const res = (trend: Trend, flag: TrendResult["comparisonFlag"] = null): TrendResult =>
    Object.freeze({ trend, comparisonFlag: flag });
  if (input.previousPeriod === null) return res("unknown");
  const bases = input.valueBasis ? { a: input.valueBasis, b: input.valueBasis } : undefined;
  if (!comparePeriods(input.currentPeriod, input.previousPeriod, bases).comparable)
    return res("not_comparable", "not_comparable");

  if (input.measureType === "binary_milestone") {
    if (input.current === null || input.previous === null) return res("unknown");
    if (input.current === input.previous) return res("flat");
    return res(input.current ? "improving" : "worsening");
  }
  const cur = input.current;
  const prev = input.previous;
  if (prev === null || cur.value === null || prev.value === null) return res("unknown");
  const c = dec(cur.value, "current");
  const p = dec(prev.value, "previous");
  let better: number; // > 0 improving, < 0 worsening
  switch (input.measureType) {
    case "higher_is_better":
      better = c.comparedTo(p);
      break;
    case "lower_is_better":
      better = p.comparedTo(c);
      break;
    case "acceptable_band": {
      const { lower, upper } = parseBand(input.bandLower, input.bandUpper);
      better = bandShortfall(p, lower, upper).shortfall.comparedTo(bandShortfall(c, lower, upper).shortfall);
      break;
    }
  }
  return res(better > 0 ? "improving" : better < 0 ? "worsening" : "flat");
}

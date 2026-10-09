// Reporting periods: comparability, year-to-date windows, period and cumulative values (ADR-0028 §2, §6;
// REQ-S07-004, REQ-S07-005). Owner: kpi-benefits-engineer (T-DG4-KBE-A).
//
// Period value per value nature: flow/stock = the entered value; ratio = numerator / denominator (denominator 0 →
// Not computable, kpi.zero_denominator); "not available" → Unknown (kpi.value_not_available); no accepted actual →
// Unknown (kpi.no_accepted_actual).
// Cumulative (YTD from kpi_version.ytd_start_month, the periods of the KPI's frequency up to and including this one):
//   flow → Σ period values (cumulative YTD equals the sum of period flows); stock → the latest period value;
//   ratio → Σ numerators / Σ denominators; milestone → not evaluated (null).
//   Any period of the window without an accepted value → Unknown (kpi.cumulative_incomplete), never a partial sum.
import {
  dayNumber,
  dec,
  KD,
  KpiInputError,
  notComputable,
  ok,
  unknown,
  yearMonth,
  type Dec,
  type Frequency,
  type KpiResult,
  type ValueBasis,
  type ValueNature,
} from "./types.ts";

/** The fields of reporting_period (0033) the calculation needs. */
export interface ReportingPeriodInfo {
  readonly id: string;
  readonly frequency: Frequency;
  /** ISO date, first day of the observation period (ADR-0025 §2). */
  readonly periodStart: string;
  /** ISO date, last day (inclusive). */
  readonly periodEnd: string;
  readonly basis: "calendar" | "weeks";
  /** Weeks of a week-based period (1–53); null for a calendar period (CHECK reporting_period_weeks). */
  readonly weekCount: number | null;
}

// ------------------------------------------------------------------------------------------------ comparability

export type IncomparableReason = "frequency" | "period_basis" | "week_count" | "value_basis";

export type Comparability =
  | { readonly comparable: true; readonly reason: null }
  | { readonly comparable: false; readonly reason: IncomparableReason };

/**
 * Two periods are comparable when they have the same frequency and the same basis and, for week-based periods, the
 * same week_count (ADR-0028 §6). When the two values' bases (period / cumulative) are given, they must match too.
 * A 4-week period against a 5-week period is not comparable (REQ-S07-005).
 */
export function comparePeriods(
  a: ReportingPeriodInfo,
  b: ReportingPeriodInfo,
  valueBases?: { readonly a: ValueBasis; readonly b: ValueBasis },
): Comparability {
  checkPeriod(a, "a");
  checkPeriod(b, "b");
  const no = (reason: IncomparableReason): Comparability => Object.freeze({ comparable: false, reason });
  if (a.frequency !== b.frequency) return no("frequency");
  if (a.basis !== b.basis) return no("period_basis");
  if (a.basis === "weeks" && a.weekCount !== b.weekCount) return no("week_count");
  if (valueBases !== undefined && valueBases.a !== valueBases.b) return no("value_basis");
  return Object.freeze({ comparable: true, reason: null });
}

/** Validates the period invariants the database guarantees (0033), so a fixture error is caught, not computed. */
export function checkPeriod(p: ReportingPeriodInfo, field: string): void {
  const start = dayNumber(p.periodStart, `${field}.periodStart`);
  const end = dayNumber(p.periodEnd, `${field}.periodEnd`);
  if (end < start) throw new KpiInputError(`${field}.periodEnd`, "must not be before periodStart");
  if ((p.basis === "weeks") !== (p.weekCount !== null)) {
    throw new KpiInputError(`${field}.weekCount`, "is required for a week-based period and refused for a calendar one");
  }
  if (p.weekCount !== null) {
    if (!Number.isInteger(p.weekCount) || p.weekCount < 1 || p.weekCount > 53) {
      throw new KpiInputError(`${field}.weekCount`, "must be an integer from 1 to 53");
    }
    if (end - start + 1 !== p.weekCount * 7) {
      throw new KpiInputError(`${field}.weekCount`, "a week-based period lasts exactly weekCount × 7 days");
    }
  }
}

// ------------------------------------------------------------------------------------------------ period values

/** The accepted value of one period (kpi_actual_value of the slot's accepted value number). */
export type PeriodEntry =
  | { readonly kind: "value"; readonly value: string }
  | { readonly kind: "ratio"; readonly numerator: string; readonly denominator: string }
  | { readonly kind: "not_available"; readonly missingReason?: string | null };

/** null / undefined = no accepted actual for the period. */
export type MaybeEntry = PeriodEntry | null | undefined;

function entryParts(nature: ValueNature, entry: PeriodEntry, field: string): { value: Dec } | { num: Dec; den: Dec } {
  if (nature === "milestone") throw new KpiInputError("valueNature", "a milestone has no numeric period value");
  if (entry.kind === "not_available") throw new KpiInputError(field, "internal: not_available has no parts");
  if (nature === "ratio") {
    if (entry.kind !== "ratio") throw new KpiInputError(field, "a ratio KPI needs a numerator and a denominator");
    return { num: dec(entry.numerator, `${field}.numerator`), den: dec(entry.denominator, `${field}.denominator`) };
  }
  if (entry.kind !== "value")
    throw new KpiInputError(field, `a ${nature} KPI needs a value, not a numerator/denominator`);
  return { value: dec(entry.value, `${field}.value`) };
}

/** The period-basis value of one period (ADR-0028 §2, §6). */
export function periodValue(nature: ValueNature, entry: MaybeEntry): KpiResult {
  if (entry === null || entry === undefined) return unknown("kpi.no_accepted_actual");
  if (entry.kind === "not_available") return unknown("kpi.value_not_available");
  const parts = entryParts(nature, entry, "entry");
  if ("value" in parts) return ok(parts.value);
  if (parts.den.isZero()) return notComputable("kpi.zero_denominator");
  return ok(parts.num.div(parts.den));
}

// ------------------------------------------------------------------------------------------------ YTD

/** First day (ISO) of the year-to-date window that contains a date, for a YTD start month (1–12). */
export function ytdStart(date: string, ytdStartMonth: number): string {
  if (!Number.isInteger(ytdStartMonth) || ytdStartMonth < 1 || ytdStartMonth > 12) {
    throw new KpiInputError("ytdStartMonth", "must be an integer from 1 to 12");
  }
  const { year, month } = yearMonth(date, "date");
  const y = month >= ytdStartMonth ? year : year - 1;
  return `${String(y).padStart(4, "0")}-${String(ytdStartMonth).padStart(2, "0")}-01`;
}

/**
 * The YTD window of `current`: the periods of the same frequency whose start lies from the YTD start (of the current
 * period's start) up to and including the current period, ordered by start. `current` is always included.
 */
export function ytdWindow(
  periods: readonly ReportingPeriodInfo[],
  current: ReportingPeriodInfo,
  ytdStartMonth: number,
): readonly ReportingPeriodInfo[] {
  checkPeriod(current, "current");
  const from = dayNumber(ytdStart(current.periodStart, ytdStartMonth), "ytdStart");
  const to = dayNumber(current.periodStart, "current.periodStart");
  const byId = new Map<string, ReportingPeriodInfo>();
  periods.forEach((p, i) => {
    checkPeriod(p, `periods[${i}]`);
    if (p.frequency !== current.frequency) return;
    const s = dayNumber(p.periodStart, `periods[${i}].periodStart`);
    if (s >= from && s <= to) byId.set(p.id, p);
  });
  byId.set(current.id, current);
  return Object.freeze(
    [...byId.values()].sort((a, b) => dayNumber(a.periodStart, "a") - dayNumber(b.periodStart, "b")),
  );
}

export interface CumulativeValue {
  readonly result: KpiResult;
  /** The window's period ids, in order (lineage `inputs`). */
  readonly window: readonly string[];
  /** Period ids of the window without an accepted value (empty unless kpi.cumulative_incomplete). */
  readonly missing: readonly string[];
}

/**
 * The cumulative (YTD) value of a KPI for `current` (ADR-0028 §2). `values` maps a period id to its accepted entry.
 * Returns null for a milestone KPI: milestones have no cumulative evaluation.
 */
export function cumulativeValue(input: {
  readonly valueNature: ValueNature;
  readonly current: ReportingPeriodInfo;
  /** All reporting periods of the organization known to the caller (other frequencies are ignored). */
  readonly periods: readonly ReportingPeriodInfo[];
  readonly values: Readonly<Record<string, PeriodEntry | null | undefined>>;
  readonly ytdStartMonth: number;
}): CumulativeValue | null {
  if (input.valueNature === "milestone") return null;
  const window = ytdWindow(input.periods, input.current, input.ytdStartMonth);
  const ids = Object.freeze(window.map((p) => p.id));
  const missing = ids.filter((id) => {
    const e = Object.hasOwn(input.values, id) ? input.values[id] : undefined;
    return e === null || e === undefined || e.kind === "not_available";
  });
  if (missing.length > 0) {
    return Object.freeze({
      result: unknown("kpi.cumulative_incomplete"),
      window: ids,
      missing: Object.freeze(missing),
    });
  }
  const parts = ids.map((id) => entryParts(input.valueNature, input.values[id] as PeriodEntry, `values.${id}`));
  let result: KpiResult;
  switch (input.valueNature) {
    case "flow":
      result = ok(parts.reduce<Dec>((sum, p) => sum.plus((p as { value: Dec }).value), new KD(0)));
      break;
    case "stock":
      result = ok((parts[parts.length - 1] as { value: Dec }).value);
      break;
    case "ratio": {
      const num = parts.reduce<Dec>((s, p) => s.plus((p as { num: Dec }).num), new KD(0));
      const den = parts.reduce<Dec>((s, p) => s.plus((p as { den: Dec }).den), new KD(0));
      result = den.isZero() ? notComputable("kpi.zero_denominator") : ok(num.div(den));
      break;
    }
  }
  return Object.freeze({ result, window: ids, missing: Object.freeze([]) });
}

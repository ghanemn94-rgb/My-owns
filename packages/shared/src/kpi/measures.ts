// Measure types and the adverse deviation (ADR-0028 §1, REQ-S07-002). Owner: kpi-benefits-engineer (T-DG4-KBE-A).
//
//   higher_is_better   s = e − a
//   lower_is_better    s = a − e
//   acceptable_band    s = L − a below the band, a − U above it, 0 inside (bounds included)
//   binary_milestone   no shortfall; favourable / within / adverse from achieved, achieved_on, due date, business date
//
// s > 0 is adverse, s = 0 within, s < 0 favourable (a band is never favourable: inside is "within").
// An Unknown input (no actual, no expectation) gives deviation "unknown" and shortfall null: never 0.
import { dayNumber, dec, KpiInputError, plain, type Dec, type Deviation } from "./types.ts";

export interface DirectionalMeasureInput {
  readonly measureType: "higher_is_better" | "lower_is_better";
  /** The actual `a`, or null when there is none (Unknown). */
  readonly actual: string | null;
  /** The expected-to-date `e` (ADR-0028 §4), or null when there is none (Unknown). */
  readonly expected: string | null;
}
export interface BandMeasureInput {
  readonly measureType: "acceptable_band";
  readonly actual: string | null;
  /** kpi_version.band_lower `L`. */
  readonly bandLower: string;
  /** kpi_version.band_upper `U` (L ≤ U). */
  readonly bandUpper: string;
}
export interface MilestoneMeasureInput {
  readonly measureType: "binary_milestone";
  /** kpi_actual_value.milestone_achieved; null when there is no accepted actual (Unknown). */
  readonly achieved: boolean | null;
  /** kpi_actual_value.achieved_on (ISO date) when achieved. */
  readonly achievedOn: string | null;
  /** kpi_version.milestone_due_date `D`. */
  readonly dueDate: string;
  /** Today's business date in the organization's time zone (a parameter: the library reads no clock). */
  readonly businessDate: string;
}
export type MeasureInput = DirectionalMeasureInput | BandMeasureInput | MilestoneMeasureInput;

/** Where a band actual lies. */
export type BandPosition = "below" | "inside" | "above";

/** Why a milestone has its deviation (drives the explanation key in rag.ts). */
export type MilestoneState = "achieved_on_time" | "achieved_late" | "overdue" | "not_yet_due";

export interface MeasureEvaluation {
  readonly deviation: Deviation;
  /** The shortfall `s` in the KPI's unit, or null (milestones, Unknown inputs). */
  readonly shortfall: string | null;
  /** Bands only: the actual's position. */
  readonly bandPosition: BandPosition | null;
  /** Milestones only. */
  readonly milestoneState: MilestoneState | null;
  /** When deviation is "unknown": which input was missing. */
  readonly unknownInput: "actual" | "expected" | "achieved_on" | null;
}

const UNKNOWN_ACTUAL: MeasureEvaluation = Object.freeze({
  deviation: "unknown",
  shortfall: null,
  bandPosition: null,
  milestoneState: null,
  unknownInput: "actual",
});

/** Deviation from the sign of a shortfall. */
export function deviationOfShortfall(s: Dec): Exclude<Deviation, "unknown"> {
  if (s.isZero()) return "within";
  return s.isPositive() ? "adverse" : "favourable";
}

/** The shortfall s of a higher- or lower-is-better measure (ADR-0028 §1). */
export function directionalShortfall(
  measureType: "higher_is_better" | "lower_is_better",
  actual: Dec,
  expected: Dec,
): Dec {
  return measureType === "higher_is_better" ? expected.minus(actual) : actual.minus(expected);
}

/** The band shortfall and position (bounds are inside). */
export function bandShortfall(actual: Dec, lower: Dec, upper: Dec): { shortfall: Dec; position: BandPosition } {
  if (actual.lt(lower)) return { shortfall: lower.minus(actual), position: "below" };
  if (actual.gt(upper)) return { shortfall: actual.minus(upper), position: "above" };
  return { shortfall: actual.minus(actual), position: "inside" };
}

/** Checks a band's bounds (L ≤ U, the 0033 CHECK kpi_version_band); throws KpiInputError otherwise. */
export function parseBand(bandLower: string, bandUpper: string): { lower: Dec; upper: Dec } {
  const lower = dec(bandLower, "bandLower");
  const upper = dec(bandUpper, "bandUpper");
  if (lower.gt(upper)) throw new KpiInputError("bandLower", "must not exceed bandUpper");
  return { lower, upper };
}

/** Evaluates the deviation of one value against its expectation, per measure type (ADR-0028 §1). */
export function evaluateMeasure(input: MeasureInput): MeasureEvaluation {
  switch (input.measureType) {
    case "higher_is_better":
    case "lower_is_better": {
      if (input.actual === null) return UNKNOWN_ACTUAL;
      const a = dec(input.actual, "actual");
      if (input.expected === null) {
        return Object.freeze({ ...UNKNOWN_ACTUAL, unknownInput: "expected" });
      }
      const e = dec(input.expected, "expected");
      const s = directionalShortfall(input.measureType, a, e);
      return Object.freeze({
        deviation: deviationOfShortfall(s),
        shortfall: plain(s),
        bandPosition: null,
        milestoneState: null,
        unknownInput: null,
      });
    }
    case "acceptable_band": {
      const { lower, upper } = parseBand(input.bandLower, input.bandUpper);
      if (input.actual === null) return UNKNOWN_ACTUAL;
      const { shortfall, position } = bandShortfall(dec(input.actual, "actual"), lower, upper);
      return Object.freeze({
        deviation: position === "inside" ? "within" : "adverse",
        shortfall: plain(shortfall),
        bandPosition: position,
        milestoneState: null,
        unknownInput: null,
      });
    }
    case "binary_milestone":
      return evaluateMilestone(input);
    default: {
      const never: never = input;
      throw new KpiInputError(
        "measureType",
        `unknown measure type ${JSON.stringify((never as MeasureInput).measureType)}`,
      );
    }
  }
}

function evaluateMilestone(input: MilestoneMeasureInput): MeasureEvaluation {
  const due = dayNumber(input.dueDate, "dueDate");
  const today = dayNumber(input.businessDate, "businessDate");
  const result = (
    deviation: Deviation,
    milestoneState: MilestoneState | null,
    unknownInput: MeasureEvaluation["unknownInput"] = null,
  ) => Object.freeze({ deviation, shortfall: null, bandPosition: null, milestoneState, unknownInput });
  if (input.achieved === null) return UNKNOWN_ACTUAL;
  if (input.achieved) {
    // Achieved but without its date: on time or late cannot be told, so Unknown (never assumed on time / green).
    if (input.achievedOn === null) return result("unknown", null, "achieved_on");
    const on = dayNumber(input.achievedOn, "achievedOn");
    return on <= due ? result("favourable", "achieved_on_time") : result("adverse", "achieved_late");
  }
  if (input.achievedOn !== null) throw new KpiInputError("achievedOn", "is only allowed when achieved is true");
  return today > due ? result("adverse", "overdue") : result("within", "not_yet_due");
}

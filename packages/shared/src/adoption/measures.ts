// The two record-fed adoption measures (ADR-0033 §6, §12; REQ-PB-072, REQ-S11-002; T-DG4-KBE-F). Pure: the records are
// injected, nothing is read from a database or a clock. Exposed through `@mth/shared/calc`.
//
//  - training completion for a stakeholder group and a reporting period
//        = records completed with completed_on in the period
//        ÷ records of the group that are not withdrawn and were created on or before the period end;
//    denominator 0 → Unknown (adoption.no_training_records), never 0.
//  - observed proficiency for a group and a period
//        = observed subjects whose LATEST non-withdrawn observation with observed_on in the period is `proficient`
//        ÷ observed subjects with such an observation;
//    no observation in the period → Unknown (adoption.no_proficiency_observations), never 0, and never derived from
//    training: completion and proficiency are separate inputs, so 100 % completion leaves proficiency Unknown.
//  - A subject is its user id, or its trimmed, case-folded label.
//  - A target other than a stakeholder group aggregates over groups by the weighted-ratio rule: numerators and
//    denominators are summed, never averaged.
//  - Values are decimal fractions (0.75 = 75 %; ADR-0028 §3) as canonical decimal strings, rounded half-up to 6
//    fractional digits. No binary float is used.
import { KD } from "../kpi/types.ts";

/** Fractional digits of a record-fed measure value (ADR-0033 §6). */
export const ADOPTION_MEASURE_DIGITS = 6;

export const ADOPTION_NO_TRAINING_RECORDS = "adoption.no_training_records";
export const ADOPTION_NO_PROFICIENCY_OBSERVATIONS = "adoption.no_proficiency_observations";

export type AdoptionMeasureReason = typeof ADOPTION_NO_TRAINING_RECORDS | typeof ADOPTION_NO_PROFICIENCY_OBSERVATIONS;

/** A closed date range of ISO business dates (YYYY-MM-DD), both inclusive. */
export interface MeasurePeriod {
  readonly start: string;
  readonly end: string;
}

export interface TrainingRecordInput {
  readonly status: "enrolled" | "completed" | "no_show" | "withdrawn";
  /** YYYY-MM-DD; exactly when completed. */
  readonly completedOn: string | null;
  /** The business date the record was created on (YYYY-MM-DD). */
  readonly createdOn: string;
}

export interface ProficiencyObservationInput {
  readonly status: "submitted" | "reviewed" | "withdrawn";
  readonly subjectUserId: string | null;
  readonly subjectLabel: string | null;
  /** YYYY-MM-DD. */
  readonly observedOn: string;
  readonly result: "proficient" | "not_yet_proficient";
  /** A total order among observations of the same day (e.g. created_at then id); larger = later. */
  readonly order: string;
}

/** A numerator and a denominator (counts). */
export interface MeasureCounts {
  readonly numerator: number;
  readonly denominator: number;
}

/** A record-fed measure: ok with a decimal fraction, or Unknown with its reason and value null (never 0). */
export type RecordMeasure =
  | {
      readonly valueStatus: "ok";
      readonly value: string;
      readonly valueReason: null;
      readonly numerator: number;
      readonly denominator: number;
    }
  | {
      readonly valueStatus: "unknown";
      readonly value: null;
      readonly valueReason: AdoptionMeasureReason;
      readonly numerator: number;
      readonly denominator: number;
    };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function assertDate(d: string, what: string): void {
  if (!DATE.test(d)) throw new RangeError(`${what} must be a YYYY-MM-DD date, got ${JSON.stringify(d)}`);
}

function assertPeriod(p: MeasurePeriod): void {
  assertDate(p.start, "period.start");
  assertDate(p.end, "period.end");
  if (p.start > p.end) throw new RangeError("period.start must not be after period.end");
}

const within = (d: string, p: MeasurePeriod) => d >= p.start && d <= p.end;

/** The subject key of an observation: the user id, else the trimmed, case-folded label; null when neither. */
export function subjectKeyOf(o: Pick<ProficiencyObservationInput, "subjectUserId" | "subjectLabel">): string | null {
  if (o.subjectUserId !== null) return `user:${o.subjectUserId}`;
  if (o.subjectLabel === null) return null;
  const label = o.subjectLabel.trim().toLocaleLowerCase("en-US");
  return label.length === 0 ? null : `label:${label}`;
}

/** Training completion counts of one group for one period (ADR-0033 §6). The numerator is a subset of the denominator. */
export function trainingCompletionCounts(
  records: readonly TrainingRecordInput[],
  period: MeasurePeriod,
): MeasureCounts {
  assertPeriod(period);
  let numerator = 0;
  let denominator = 0;
  for (const r of records) {
    assertDate(r.createdOn, "createdOn");
    if (r.status === "withdrawn" || r.createdOn > period.end) continue;
    denominator += 1;
    if (r.status === "completed") {
      if (r.completedOn === null) throw new RangeError("a completed training record has a completedOn date");
      assertDate(r.completedOn, "completedOn");
      if (within(r.completedOn, period)) numerator += 1;
    }
  }
  return { numerator, denominator };
}

/**
 * The latest non-withdrawn observation with observed_on in the period, per subject (observed_on, then `order`).
 * Observations without a subject are ignored (the database requires one for an observation).
 */
export function latestObservationPerSubject(
  observations: readonly ProficiencyObservationInput[],
  period: MeasurePeriod,
): ReadonlyMap<string, ProficiencyObservationInput> {
  assertPeriod(period);
  const latest = new Map<string, ProficiencyObservationInput>();
  for (const o of observations) {
    assertDate(o.observedOn, "observedOn");
    if (o.status === "withdrawn" || !within(o.observedOn, period)) continue;
    const key = subjectKeyOf(o);
    if (key === null) continue;
    const prior = latest.get(key);
    if (
      prior === undefined ||
      o.observedOn > prior.observedOn ||
      (o.observedOn === prior.observedOn && o.order > prior.order)
    )
      latest.set(key, o);
  }
  return latest;
}

/** Observed proficiency counts of one group for one period (ADR-0033 §6). */
export function observedProficiencyCounts(
  observations: readonly ProficiencyObservationInput[],
  period: MeasurePeriod,
): MeasureCounts {
  const latest = latestObservationPerSubject(observations, period);
  let numerator = 0;
  for (const o of latest.values()) if (o.result === "proficient") numerator += 1;
  return { numerator, denominator: latest.size };
}

/** The weighted-ratio aggregation: numerators and denominators summed, never averaged. */
export function sumCounts(parts: readonly MeasureCounts[]): MeasureCounts {
  let numerator = 0;
  let denominator = 0;
  for (const p of parts) {
    if (!Number.isSafeInteger(p.numerator) || !Number.isSafeInteger(p.denominator) || p.numerator < 0)
      throw new RangeError("counts must be non-negative integers");
    if (p.numerator > p.denominator) throw new RangeError("a numerator cannot exceed its denominator");
    numerator += p.numerator;
    denominator += p.denominator;
  }
  return { numerator, denominator };
}

/** numerator ÷ denominator as a fraction rounded half-up to 6 digits; Unknown with `reason` when the denominator is 0. */
export function ratioMeasure(counts: MeasureCounts, reason: AdoptionMeasureReason): RecordMeasure {
  const { numerator, denominator } = sumCounts([counts]);
  if (denominator === 0) return { valueStatus: "unknown", value: null, valueReason: reason, numerator, denominator };
  const value = new KD(numerator)
    .div(new KD(denominator))
    .toDecimalPlaces(ADOPTION_MEASURE_DIGITS, KD.ROUND_HALF_UP)
    .toFixed(ADOPTION_MEASURE_DIGITS);
  return { valueStatus: "ok", value, valueReason: null, numerator, denominator };
}

/** Training completion over one or more groups' records (one array per group), weighted-ratio aggregated. */
export function trainingCompletion(
  groups: readonly (readonly TrainingRecordInput[])[],
  period: MeasurePeriod,
): RecordMeasure {
  return ratioMeasure(sumCounts(groups.map((g) => trainingCompletionCounts(g, period))), ADOPTION_NO_TRAINING_RECORDS);
}

/** Observed proficiency over one or more groups' observations (one array per group), weighted-ratio aggregated. */
export function observedProficiency(
  groups: readonly (readonly ProficiencyObservationInput[])[],
  period: MeasurePeriod,
): RecordMeasure {
  return ratioMeasure(
    sumCounts(groups.map((g) => observedProficiencyCounts(g, period))),
    ADOPTION_NO_PROFICIENCY_OBSERVATIONS,
  );
}

/**
 * ADR-0033 §4 step 2: an evaluation is below trajectory exactly when its deviation is adverse and its calculated RAG is
 * amber or red (the gap is beyond the configured threshold). Green, Unknown, Stale and Not computable never are: an
 * Unknown period is not counted as below trajectory.
 */
export function isBelowTrajectory(calculatedRag: string, deviation: string): boolean {
  return deviation === "adverse" && (calculatedRag === "amber" || calculatedRag === "red");
}

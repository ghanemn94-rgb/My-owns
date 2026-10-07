// T06 prioritization arithmetic (ADR-0022 §1–§3, §7). Owner: kpi-benefits-engineer (T-DG3-KBE-A).
//
// Pure functions shared by the API (portfolio/prioritization, BE-D) and the web (FE-B), so both compute the same value:
//  - Weights are percent DECIMAL STRINGS with at most 2 fraction digits ("25", "25.00", "12.5"); a set totals exactly
//    100 (95 and 105 are refused with `prioritization.weights_total`).
//  - Scores are integers 1–5. They are accepted as a decimal string ("4") or as a JavaScript integer (the contract's
//    `integer`, PostgreSQL `smallint`). A score is converted to decimal.js at once; no arithmetic ever runs on a
//    JavaScript number. 0, 6, 2.5 and "4.0" are refused.
//  - weighted = Σ(score × weight) / 100 in decimal.js. With integer scores and weights of 2 decimals the result has at
//    most 4 fraction digits, so it is EXACT and stored in numeric(7,4) without rounding ("3.3000").
//  - A missing score makes the result 'incomplete' with weightedScore null and the missing criteria listed: never 0.
//  - Display: 2 fraction digits, ROUND_HALF_UP ("3.30"). The 0–100 view (weighted − 1) / 4 × 100 is display-only, at
//    most 2 fraction digits with trailing zeros removed ("57.5"), always shown with its conversion label.
import { Decimal } from "decimal.js";
import { formatDecimal, type DisplayLocale } from "./value.ts";

const D = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -80, toExpPos: 80 });
type Dec = InstanceType<typeof D>;

// ------------------------------------------------------------------------------------------------ criteria

/** The closed criterion set (DB CHECK in 0021): the five B0076 criteria and the B0077 risk/compliance extension. */
export const CRITERION_CODES = [
  "strategic_fit",
  "financial_value",
  "customer_impact",
  "feasibility",
  "time_to_value",
  "risk_compliance",
] as const;
export type CriterionCode = (typeof CRITERION_CODES)[number];

export function isCriterionCode(value: unknown): value is CriterionCode {
  return typeof value === "string" && (CRITERION_CODES as readonly string[]).includes(value);
}

export interface CriterionWeight {
  readonly criterionCode: string;
  /** Percent as a decimal string with at most 2 fraction digits (25.00 = 25%). */
  readonly weightPercent: string;
}

/** Version 1, seeded per transformation at the source defaults (B0076): 25/25/20/15/15. */
export const DEFAULT_WEIGHTS_V1: readonly { readonly criterionCode: CriterionCode; readonly weightPercent: string }[] =
  Object.freeze([
    Object.freeze({ criterionCode: "strategic_fit", weightPercent: "25.00" }),
    Object.freeze({ criterionCode: "financial_value", weightPercent: "25.00" }),
    Object.freeze({ criterionCode: "customer_impact", weightPercent: "20.00" }),
    Object.freeze({ criterionCode: "feasibility", weightPercent: "15.00" }),
    Object.freeze({ criterionCode: "time_to_value", weightPercent: "15.00" }),
  ] as const);

export const MIN_CRITERIA_PER_SET = 2;
export const MAX_CRITERIA_PER_SET = 6;

// ------------------------------------------------------------------------------------------------ weight-set validation

/**
 * Machine codes (i18n keys). `prioritization.weights_total` is the ADR-0022 §1 code (API 422, pointer /weights,
 * detail 'Weights must total 100% (got 95.00%)'). The others mirror the contract schema and the DB CHECKs
 * (`weight_percent > 0 AND <= 100`, numeric(5,2), the closed criterion set, unique per set, 2–6 criteria), so a caller
 * that skipped schema validation still never reaches the database with an invalid set.
 */
export type WeightSetProblemCode =
  | "prioritization.weights_total"
  | "prioritization.weight_format"
  | "prioritization.weight_range"
  | "prioritization.unknown_criterion"
  | "prioritization.duplicate_criterion"
  | "prioritization.criteria_count";

export interface WeightSetProblem {
  readonly code: WeightSetProblemCode;
  /** JSON pointer into the request body, e.g. "/weights" or "/weights/2/weightPercent". */
  readonly pointer: string;
  /** English detail (the API's problem `detail`); the web translates `code`. */
  readonly detail: string;
}

export type WeightSetValidation =
  | { readonly ok: true; readonly total: string }
  | { readonly ok: false; readonly problems: readonly WeightSetProblem[] };

/** Percent with at most 2 fraction digits, 0–100 (the contract pattern of WeightSetWeight.weightPercent). */
const WEIGHT_PATTERN = /^[0-9]{1,3}(\.[0-9]{1,2})?$/;

/**
 * Validates a weight set (ADR-0022 §1). Returns every problem found; the total check runs only when every weight is a
 * well-formed decimal, and reports the exact total with 2 decimals ('Weights must total 100% (got 95.00%)').
 */
export function validateWeightSet(weights: readonly CriterionWeight[]): WeightSetValidation {
  const problems: WeightSetProblem[] = [];
  if (!Array.isArray(weights)) {
    return {
      ok: false,
      problems: [{ code: "prioritization.criteria_count", pointer: "/weights", detail: "Weights must be a list" }],
    };
  }
  if (weights.length < MIN_CRITERIA_PER_SET || weights.length > MAX_CRITERIA_PER_SET) {
    problems.push({
      code: "prioritization.criteria_count",
      pointer: "/weights",
      detail: `A weight set has ${MIN_CRITERIA_PER_SET} to ${MAX_CRITERIA_PER_SET} criteria (got ${weights.length})`,
    });
  }
  const seen = new Set<string>();
  let total = new D(0);
  let allParsed = true;
  weights.forEach((w, i) => {
    const code: unknown = w?.criterionCode;
    if (!isCriterionCode(code)) {
      problems.push({
        code: "prioritization.unknown_criterion",
        pointer: `/weights/${i}/criterionCode`,
        detail: `Unknown criterion: ${typeof code === "string" ? code : String(typeof code)}`,
      });
    } else if (seen.has(code)) {
      problems.push({
        code: "prioritization.duplicate_criterion",
        pointer: `/weights/${i}/criterionCode`,
        detail: `Criterion listed twice: ${code}`,
      });
    } else {
      seen.add(code);
    }
    const raw: unknown = w?.weightPercent;
    if (typeof raw !== "string" || !WEIGHT_PATTERN.test(raw)) {
      allParsed = false;
      problems.push({
        code: "prioritization.weight_format",
        pointer: `/weights/${i}/weightPercent`,
        detail: "A weight is a percent decimal string with at most 2 fraction digits",
      });
      return;
    }
    const value = new D(raw);
    if (value.lte(0) || value.gt(100)) {
      problems.push({
        code: "prioritization.weight_range",
        pointer: `/weights/${i}/weightPercent`,
        detail: `A weight is greater than 0 and at most 100 (got ${value.toFixed(2)}%)`,
      });
    }
    total = total.plus(value);
  });
  if (allParsed && !total.eq(100)) {
    problems.push({
      code: "prioritization.weights_total",
      pointer: "/weights",
      detail: `Weights must total 100% (got ${total.toFixed(2)}%)`,
    });
  }
  return problems.length === 0 ? { ok: true, total: total.toFixed(2) } : { ok: false, problems };
}

/** The exact total of well-formed weights with 2 decimals ("100.00"). Throws ScoringInputError on a malformed weight. */
export function weightTotal(weights: readonly CriterionWeight[]): string {
  let total = new D(0);
  for (const w of weights) total = total.plus(parseWeight(w.weightPercent));
  return total.toFixed(2);
}

// ------------------------------------------------------------------------------------------------ scores

export type ScoreInput = string | number;

export type ScoringInputCode = "prioritization.score_range" | "prioritization.weight_format" | WeightSetProblemCode;

/** A programming error: the caller passed an invalid score or weight set (the API refuses these with 400/422 first). */
export class ScoringInputError extends Error {
  readonly code: ScoringInputCode;
  readonly pointer: string;
  constructor(code: ScoringInputCode, pointer: string, detail: string) {
    super(detail);
    this.name = "ScoringInputError";
    this.code = code;
    this.pointer = pointer;
  }
}

/** True for an integer score 1–5 given as "1".."5" or as a JavaScript integer 1..5. */
export function isValidScore(value: unknown): value is ScoreInput {
  return scoreToDecimal(value) !== null;
}

function scoreToDecimal(value: unknown): Dec | null {
  if (typeof value === "string") return /^[1-5]$/.test(value) ? new D(value) : null;
  if (typeof value === "number") {
    // Only an exact small integer is accepted; it is converted to its decimal digit string, never used in arithmetic.
    return Number.isInteger(value) && value >= 1 && value <= 5 ? new D(String(value)) : null;
  }
  return null;
}

function parseWeight(raw: unknown): Dec {
  if (typeof raw !== "string" || !WEIGHT_PATTERN.test(raw)) {
    throw new ScoringInputError(
      "prioritization.weight_format",
      "/weightPercent",
      "A weight is a percent decimal string with at most 2 fraction digits",
    );
  }
  return new D(raw);
}

// ------------------------------------------------------------------------------------------------ weighted score

export type Completeness = "complete" | "incomplete";

export interface ScoreInputRecord {
  /** The score as a canonical decimal string ("5"), or null when the criterion has no score. */
  readonly score: string | null;
  /** The weight with exactly 2 fraction digits ("25.00"). */
  readonly weightPercent: string;
}

export type WeightedScoreResult =
  | {
      readonly completeness: "complete";
      /** Exact numeric(7,4) string, e.g. "3.3000". */
      readonly weightedScore: string;
      readonly missingCriteria: readonly [];
      /** The `initiative_score_result.inputs` object: {criterion: {score, weightPercent}} in weight-set order. */
      readonly inputs: Readonly<Record<string, ScoreInputRecord>>;
    }
  | {
      readonly completeness: "incomplete";
      readonly weightedScore: null;
      /** Criteria of the set without a score, in weight-set order. Never empty. */
      readonly missingCriteria: readonly CriterionCode[];
      readonly inputs: Readonly<Record<string, ScoreInputRecord>>;
    };

/** Scores per criterion code. null/undefined (or an absent key) means "not scored". */
export type ScoreMap = Readonly<Partial<Record<string, ScoreInput | null | undefined>>>;

function scoreOf(scores: ScoreMap, code: string): ScoreInput | null | undefined {
  return Object.prototype.hasOwnProperty.call(scores, code) ? scores[code] : undefined;
}

/**
 * The weighted score of ADR-0022 §2: Σ(score_c × weight_c) / 100 over the criteria of the weight set. Scores for
 * criteria outside the set are ignored (scores exist per criterion, independent of the set). Throws ScoringInputError
 * when the weight set is invalid or a present score is not an integer 1–5.
 */
export function weightedScore(scores: ScoreMap, weights: readonly CriterionWeight[]): WeightedScoreResult {
  const validation = validateWeightSet(weights);
  if (!validation.ok) {
    const first = validation.problems[0]!;
    throw new ScoringInputError(first.code, first.pointer, first.detail);
  }
  const inputs: Record<string, ScoreInputRecord> = Object.create(null) as Record<string, ScoreInputRecord>;
  const missing: CriterionCode[] = [];
  let sum = new D(0);
  for (const w of weights) {
    const code = w.criterionCode as CriterionCode;
    const weight = new D(w.weightPercent);
    const raw = scoreOf(scores, code);
    if (raw === null || raw === undefined) {
      missing.push(code);
      inputs[code] = { score: null, weightPercent: weight.toFixed(2) };
      continue;
    }
    const score = scoreToDecimal(raw);
    if (score === null) {
      throw new ScoringInputError(
        "prioritization.score_range",
        `/scores/${code}`,
        `A score is an integer from 1 to 5 (criterion ${code})`,
      );
    }
    inputs[code] = { score: score.toFixed(0), weightPercent: weight.toFixed(2) };
    sum = sum.plus(score.times(weight));
  }
  const frozenInputs = Object.freeze({ ...inputs });
  if (missing.length > 0) {
    return {
      completeness: "incomplete",
      weightedScore: null,
      missingCriteria: Object.freeze(missing),
      inputs: frozenInputs,
    };
  }
  const result = sum.div(100);
  // Integer scores × weights with 2 decimals / 100 have at most 4 decimals: the stored value is exact.
  if (result.decimalPlaces() > 4) {
    throw new ScoringInputError(
      "prioritization.weight_format",
      "/weights",
      "Weighted score is not exact at 4 decimals",
    );
  }
  return {
    completeness: "complete",
    weightedScore: result.toFixed(4),
    missingCriteria: Object.freeze([]) as readonly [],
    inputs: frozenInputs,
  };
}

// ------------------------------------------------------------------------------------------------ display

export interface ScoreDisplayOptions {
  readonly locale?: DisplayLocale;
  readonly digits?: "latn" | "arab";
}

function storedScore(value: string): Dec | null {
  if (typeof value !== "string" || !/^-?[0-9]+(\.[0-9]+)?$/.test(value)) return null;
  return new D(value);
}

/**
 * The weighted score for display: exactly 2 fraction digits, ROUND_HALF_UP, locale digits ("3.3000" → "3.30").
 * null (incomplete) stays null: the caller renders 'incomplete' (i18n key `prioritization.incomplete`), never 0.
 */
export function weightedScoreDisplay(value: string | null, options: ScoreDisplayOptions = {}): string | null {
  if (value === null || storedScore(value) === null) return null;
  return formatDecimal(value, {
    locale: options.locale ?? "en",
    minFractionDigits: 2,
    maxFractionDigits: 2,
    ...(options.digits ? { digits: options.digits } : {}),
  });
}

/** The conversion string the API returns with every 0–100 value (contract ScoreResult.conversion). */
export const DISPLAY100_CONVERSION = "(score-1)/4*100" as const;
/** i18n key of the label the 0–100 view always shows. */
export const DISPLAY100_LABEL_KEY = "prioritization.conversion_label" as const;
/** English label (ADR-0022 §3). */
export const DISPLAY100_LABEL_EN = "0–100 view = (weighted score − 1) ÷ 4 × 100" as const;
/** Arabic label (ADR-0022 §3, provisional translation). */
export const DISPLAY100_LABEL_AR = "عرض 0–100 = (النتيجة المرجحة − 1) ÷ 4 × 100" as const;

/**
 * The 0–100 view of ADR-0022 §3: (weighted − 1) / 4 × 100, at most 2 fraction digits (ROUND_HALF_UP), trailing zeros
 * removed, as a plain decimal string ("3.30" → "57.5", "1.0000" → "0", "5.0000" → "100"). Never stored. null stays null.
 */
export function display100(weighted: string | null): string | null {
  if (weighted === null) return null;
  const w = storedScore(weighted);
  if (w === null) return null;
  const v = w.minus(1).div(4).times(100).toDecimalPlaces(2, D.ROUND_HALF_UP);
  return v.isZero() ? "0" : v.toFixed();
}

/** display100 formatted with locale digits (at most 2 fraction digits, trailing zeros removed). */
export function display100Formatted(weighted: string | null, options: ScoreDisplayOptions = {}): string | null {
  const v = display100(weighted);
  if (v === null) return null;
  return formatDecimal(v, {
    locale: options.locale ?? "en",
    minFractionDigits: 0,
    maxFractionDigits: 2,
    ...(options.digits ? { digits: options.digits } : {}),
  });
}

/** The read-only ScoreResult fields the API returns (contract `ScoreResult`, without weightSetVersionNo/computedAt). */
export interface ScoreResultView {
  readonly completeness: Completeness;
  readonly weightedScore: string | null;
  readonly weightedScoreDisplay: string | null;
  readonly display100: string | null;
  readonly conversion: typeof DISPLAY100_CONVERSION;
  readonly missingCriteria: readonly CriterionCode[];
}

export function scoreResultView(result: {
  readonly completeness: Completeness;
  readonly weightedScore: string | null;
  readonly missingCriteria: readonly string[];
}): ScoreResultView {
  const complete = result.completeness === "complete" && result.weightedScore !== null;
  return {
    completeness: complete ? "complete" : "incomplete",
    weightedScore: complete ? result.weightedScore : null,
    weightedScoreDisplay: complete ? weightedScoreDisplay(result.weightedScore) : null,
    display100: complete ? display100(result.weightedScore) : null,
    conversion: DISPLAY100_CONVERSION,
    missingCriteria: result.missingCriteria.filter(isCriterionCode),
  };
}

// ------------------------------------------------------------------------------------------------ comparison axes

/** ADR-0022 §7 axis criteria: value = financial value + customer impact; feasibility = feasibility + time to value. */
export const VALUE_AXIS_CRITERIA = ["financial_value", "customer_impact"] as const;
export const FEASIBILITY_AXIS_CRITERIA = ["feasibility", "time_to_value"] as const;

/**
 * A comparison axis (ADR-0022 §7): (s_a × w_a + s_b × w_b) / (w_a + w_b) over the axis criteria that are in the weight
 * set. The quotient may be inexact (e.g. weights 25 and 20), so it is computed at 80 significant digits and rounded
 * once to 4 fraction digits (ROUND_HALF_UP, the numeric(7,4) scale of the weighted score). Returns null (Unknown) when
 * no axis criterion is in the set or any of them has no score: never 0.
 */
export function axisScore(
  scores: ScoreMap,
  weights: readonly CriterionWeight[],
  criteria: readonly CriterionCode[],
): string | null {
  let num = new D(0);
  let den = new D(0);
  for (const code of criteria) {
    const w = weights.find((x) => x.criterionCode === code);
    if (!w) continue;
    const weight = parseWeight(w.weightPercent);
    const raw = scoreOf(scores, code);
    if (raw === null || raw === undefined) return null;
    const score = scoreToDecimal(raw);
    if (score === null) {
      throw new ScoringInputError(
        "prioritization.score_range",
        `/scores/${code}`,
        `A score is an integer from 1 to 5 (criterion ${code})`,
      );
    }
    num = num.plus(score.times(weight));
    den = den.plus(weight);
  }
  if (den.isZero()) return null;
  return num.div(den).toDecimalPlaces(4, D.ROUND_HALF_UP).toFixed(4);
}

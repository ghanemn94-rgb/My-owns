// The 25-question Transformation Health Check: pure score, band, completion and scheme rules (ADR-0048 §5, §6, §10;
// REQ-S14-001, REQ-S14-002, REQ-S14-003, REQ-PB-092; p5-work-split §H.3; T-DG5-KBE-G).
//
// These functions mirror the two database functions of `0086` exactly, in decimal.js (never a binary float):
//  - `healthSchemeProblem` mirrors `p5_health_scheme_problem(version)`: the publish rule of a scoring scheme, checked in
//    the same order and answering the same constraint name (or null when the scheme may be published);
//  - `healthAssessmentResult` mirrors `p5_health_assessment_result(assessment)`: the score, the maximum and the band of
//    an assessment from its answers and its scheme (all null while incomplete or not computable).
// The database recomputes the score at submission and refuses any other value (`health_assessment_score_matches`), so
// any drift between the two is a refused submission, never a silently different score. The property tests
// (scoring.test.ts) and the API integration test (1,000 generated answer sets against PostgreSQL) hold them together.
//
// Scheme v1 (Yes = 1, No = 0, the count of Yes out of 25) is an IMPLEMENTATION ASSUMPTION (M0262, D-010): the
// playbook gives 25 checkboxes and "Score: ____ / 25" only (B0150). Incomplete is never zero: while any question is
// unanswered the score and the band are null (M0262 "Unanswered items make the assessment incomplete"). A health-check
// score is an assessment, not a business approval of anything.
import { Decimal } from "decimal.js";

/** B0150 has exactly 25 questions (`q01`-`q25`). */
export const HEALTH_QUESTION_COUNT = 25;
/** The four response keys a scheme may use (the 0086 element guard's list). */
export const HEALTH_RESPONSE_KEYS = ["yes", "no", "partial", "na"] as const;
export type HealthResponseKey = (typeof HEALTH_RESPONSE_KEYS)[number];
/** The two score bases of a scheme's definition. */
export const HEALTH_SCORE_BASES = ["points", "percent_of_applicable"] as const;
export type HealthScoreBasis = (typeof HEALTH_SCORE_BASES)[number];
/** The four B0152 source band keys (the 0086 element guard's list). */
export const HEALTH_SOURCE_BAND_KEYS = ["b0152_21_25", "b0152_16_20", "b0152_10_15", "b0152_0_9"] as const;
/** The question codes `q01`-`q25`, in B0150 order. */
export const HEALTH_QUESTION_CODES: readonly string[] = Object.freeze(
  Array.from({ length: HEALTH_QUESTION_COUNT }, (_, i) => `q${String(i + 1).padStart(2, "0")}`),
);

/**
 * The constraint names `p5_health_scheme_problem` answers (and the publish guard raises), in its order of checking.
 */
export const HEALTH_SCHEME_PROBLEMS = [
  "health_scheme_definition",
  "health_scheme_yes_no_required",
  "health_scheme_credit",
  "health_scheme_na_needs_percent",
  "health_scheme_bands_invalid",
  "health_scheme_own_bands_required",
] as const;
export type HealthSchemeProblem = (typeof HEALTH_SCHEME_PROBLEMS)[number];

/** One `health_response` element of a scheme version, as stored (attributes are raw JSON values). */
export interface HealthResponseElement {
  readonly key: string;
  /** The raw `credit` attribute: a decimal string, null (na), or absent (undefined). */
  readonly credit: unknown;
  readonly removed?: boolean;
}

/** One `health_band` element of a scheme version, as stored. */
export interface HealthBandElement {
  readonly key: string;
  readonly origin: "source" | "admin";
  /** The raw `minScore` attribute: a decimal string. */
  readonly minScore: unknown;
  readonly removed?: boolean;
}

/** A scheme version: its definition and its element rows (removed rows are ignored, as the database does). */
export interface HealthSchemeInput {
  readonly definition: unknown;
  readonly responses: readonly HealthResponseElement[];
  readonly bands: readonly HealthBandElement[];
}

const MIN_SCORE_PATTERN = /^[0-9]{1,3}(\.[0-9]{1,2})?$/;
const ZERO_PATTERN = /^0+(\.0+)?$/;
const PARTIAL_CREDIT_PATTERN = /^0\.[0-9]{1,2}$/;

/**
 * The text PostgreSQL's `->>` gives for a JSON value: a string is itself, a number or boolean its literal, null or
 * absent NULL (here null). Objects and arrays give their JSON text, which never matches a decimal pattern.
 */
function jsonText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

/** The `definition` member `name` as `->>` text (null when the definition is not an object). */
function definitionText(definition: unknown, name: string): string | null {
  if (definition === null || typeof definition !== "object" || Array.isArray(definition)) return null;
  return jsonText(new Map(Object.entries(definition)).get(name));
}

/** The score basis of a valid definition, or null. */
export function healthScoreBasisOf(definition: unknown): HealthScoreBasis | null {
  const basis = definitionText(definition, "scoreBasis");
  return basis === "points" || basis === "percent_of_applicable" ? basis : null;
}

/** The maximum score of a basis: 25 points, or 100 (percent of the applicable questions). */
export function healthScoreMax(basis: HealthScoreBasis): Decimal {
  return new Decimal(basis === "points" ? HEALTH_QUESTION_COUNT : 100);
}

/**
 * The publish rule of a health-check scoring scheme (ADR-0048 §6), exactly as `p5_health_scheme_problem`:
 *  1. the definition has `scoreBasis` points | percent_of_applicable and `questionCount` 25;
 *  2. responses `yes` (credit "1") and `no` (credit "0") are present;
 *  3. a `partial` credit is a decimal strictly between 0 and 1 ("0.xx"), and `na` has an explicit null credit;
 *  4. `na` needs `percent_of_applicable`;
 *  5. at least one band, one at 0, every minScore a decimal string not above the maximum, and all distinct;
 *  6. a scheme with `partial` or `na` keeps none of the four source bands (M0262: "do not silently reuse the original
 *     interpretation bands").
 * Returns the first failing rule's constraint name, or null when the scheme may be published.
 */
export function healthSchemeProblem(scheme: HealthSchemeInput): HealthSchemeProblem | null {
  const basis = definitionText(scheme.definition, "scoreBasis");
  if (
    basis === null ||
    (basis !== "points" && basis !== "percent_of_applicable") ||
    definitionText(scheme.definition, "questionCount") !== String(HEALTH_QUESTION_COUNT)
  )
    return "health_scheme_definition";
  const max = healthScoreMax(basis);
  const responses = scheme.responses.filter((r) => r.removed !== true);
  const bands = scheme.bands.filter((b) => b.removed !== true);
  const hasCredit = (key: string, credit: string) =>
    responses.some((r) => r.key === key && jsonText(r.credit) === credit);
  if (!hasCredit("yes", "1") || !hasCredit("no", "0")) return "health_scheme_yes_no_required";
  const hasNa = responses.some((r) => r.key === "na");
  const hasPartial = responses.some((r) => r.key === "partial");
  const creditInvalid = responses.some((r) => {
    if (r.key === "partial")
      return !(
        typeof r.credit === "string" &&
        PARTIAL_CREDIT_PATTERN.test(r.credit) &&
        new Decimal(r.credit).greaterThan(0)
      );
    // jsonb_typeof(credit) IS DISTINCT FROM 'null': an absent credit is not an explicit null.
    if (r.key === "na") return r.credit !== null;
    return false;
  });
  if (creditInvalid) return "health_scheme_credit";
  if (hasNa && basis !== "percent_of_applicable") return "health_scheme_na_needs_percent";
  const minTexts = bands.map((b) => jsonText(b.minScore));
  const hasZero = minTexts.some((t) => t !== null && ZERO_PATTERN.test(t));
  const outOfRange = minTexts.some((t) => !(t !== null && MIN_SCORE_PATTERN.test(t) && new Decimal(t).lte(max)));
  if (!hasZero || outOfRange) return "health_scheme_bands_invalid";
  // count(*) <> count(DISTINCT minScore::numeric): "16" and "16.0" are the same starting score.
  const distinct = new Set(minTexts.map((t) => new Decimal(t ?? "0").toFixed(2)));
  if (distinct.size !== bands.length) return "health_scheme_bands_invalid";
  if ((hasNa || hasPartial) && bands.some((b) => b.origin === "source")) return "health_scheme_own_bands_required";
  return null;
}

/** The completion of an assessment (REQ-S14-002): complete only with all 25 answered. */
export interface HealthCompletion {
  readonly answered: number;
  readonly total: number;
  readonly complete: boolean;
}

/** The score of an assessment: all null while incomplete or not computable (never 0). */
export interface HealthAssessmentResult {
  readonly completion: HealthCompletion;
  /** True when the 25 are answered and at least one is applicable (an all-N/A assessment is not computable). */
  readonly computable: boolean;
  /** The score as a decimal string ("17", "62.50"); null while incomplete or not computable. */
  readonly score: string | null;
  /** 25 (points) or 100 (percent of the applicable questions); null with the score. */
  readonly scoreMax: string | null;
  /** The key of the band with the highest minScore not above the score; null with the score, or below every band. */
  readonly bandKey: string | null;
  /** The number of answers whose response carries a credit (not N/A); counts are integers. */
  readonly applicable: number;
}

/** The completion of `answered` answers out of the 25 questions. */
export function healthCompletion(answered: number): HealthCompletion {
  return { answered, total: HEALTH_QUESTION_COUNT, complete: answered >= HEALTH_QUESTION_COUNT };
}

/**
 * A decimal score in its API form: two decimals, with a whole score shown without ".00" ("17", "62.50"; ADR-0048
 * §10). The database stores numeric(7,2); both forms compare equal as numbers.
 */
export function formatHealthScore(score: Decimal): string {
  const fixed = score.toFixed(2, Decimal.ROUND_HALF_UP);
  return fixed.endsWith(".00") ? fixed.slice(0, -3) : fixed;
}

/** The band of `score`: the non-removed band with the highest minScore not above it, or null. */
export function healthBandFor<B extends HealthBandElement>(score: Decimal, bands: readonly B[]): B | null {
  let best: { band: B; min: Decimal } | null = null;
  for (const band of bands) {
    if (band.removed === true) continue;
    const t = jsonText(band.minScore);
    if (t === null || !MIN_SCORE_PATTERN.test(t)) continue;
    const min = new Decimal(t);
    if (min.greaterThan(score)) continue;
    if (best === null || min.greaterThan(best.min)) best = { band, min };
  }
  return best === null ? null : best.band;
}

/**
 * The score, maximum and band of an assessment, exactly as `p5_health_assessment_result`:
 *  - each answer's credit is the credit of the scheme's non-removed response with that key (null for N/A, or for a
 *    key the scheme no longer has);
 *  - with fewer than 25 answers, or no applicable answer, everything is null (incomplete / not computable);
 *  - `points` (or any basis other than `percent_of_applicable`, as in the database's ELSE): score = round(Σ credit, 2)
 *    out of 25; `percent_of_applicable`: score = round(100 × Σ credit / applicable, 2) out of 100 (half away from 0);
 *  - the band is the one with the highest minScore not above the score.
 * `answers` holds one response key per answered question (the database's unique (assessment, question) key).
 */
export function healthAssessmentResult(scheme: HealthSchemeInput, answers: readonly string[]): HealthAssessmentResult {
  const credits = new Map<string, Decimal | null>();
  for (const r of scheme.responses) {
    if (r.removed === true) continue;
    const t = jsonText(r.credit);
    credits.set(r.key, t === null ? null : new Decimal(t));
  }
  let applicable = 0;
  let total = new Decimal(0);
  for (const key of answers) {
    const credit = credits.get(key) ?? null;
    if (credit === null) continue;
    applicable += 1;
    total = total.plus(credit);
  }
  const completion = healthCompletion(answers.length);
  if (answers.length < HEALTH_QUESTION_COUNT || applicable === 0)
    return { completion, computable: false, score: null, scoreMax: null, bandKey: null, applicable };
  const percent = definitionText(scheme.definition, "scoreBasis") !== "points";
  const raw = percent ? total.times(100).dividedBy(applicable) : total;
  const score = raw.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const band = healthBandFor(score, scheme.bands);
  return {
    completion,
    computable: true,
    score: formatHealthScore(score),
    scoreMax: percent ? "100" : String(HEALTH_QUESTION_COUNT),
    bandKey: band === null ? null : band.key,
    applicable,
  };
}

/** True when `response` is one of the scheme's non-removed response keys (`health_assessment_answer_response_allowed`). */
export function healthResponseAllowed(scheme: HealthSchemeInput, response: string): boolean {
  return scheme.responses.some((r) => r.removed !== true && r.key === response);
}

/** True for the seeded v1 shape: Yes = 1, No = 0 only, points out of 25 (the M0262 implementation assumption). */
export function isYesNoPointsScheme(scheme: HealthSchemeInput): boolean {
  const keys = scheme.responses.filter((r) => r.removed !== true).map((r) => r.key);
  return (
    healthScoreBasisOf(scheme.definition) === "points" &&
    keys.length === 2 &&
    keys.includes("yes") &&
    keys.includes("no")
  );
}

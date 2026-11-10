// E5 explanation view model: the Transformation Health Check score and band (ADR-0061 §8 row E5; ADR-0048 §5-§6,
// §10; REQ-S15-014, REQ-S14-001, REQ-S14-002). Owner: kpi-benefits-engineer (T-DG6-KBE-B; p6-work-split §I/K.2).
//
// Pure: it takes `getHealthCheck` (HealthCheck) and the scheme version of the assessment (HealthCheckScheme, from the
// scheme list the page loads) and returns the panel's counts and message parameters:
//  - answered of 25, the unanswered question codes, the applicable count (answers whose response carries a credit,
//    i.e. not N/A) and, per response key of the scheme, its count, credit and points (count × credit);
//  - the points (Σ credit) and, from the server, the score, its maximum and the band.
// While any question is unanswered there is no score and no band: the state is `incomplete`, never 0. A complete
// assessment with no applicable answer is `not_computable`. The score is reproduced with the shared
// `healthAssessmentResult` of `../health/scoring.ts` (the mirror of the database function; no second implementation)
// and must equal the server's score, maximum and band; otherwise, or when the scheme is not the assessment's version,
// the panel is Unknown with a reason. The scoring scheme is an implementation assumption (`scoringAssumption`).
// A health-check score is an assessment, not a business approval of anything.
import { Decimal } from "decimal.js";
import {
  HEALTH_QUESTION_CODES,
  HEALTH_QUESTION_COUNT,
  formatHealthScore,
  healthAssessmentResult,
  type HealthScoreBasis,
  type HealthSchemeInput,
} from "../health/scoring.ts";

const DECIMAL_TEXT = /^-?[0-9]+(\.[0-9]+)?$/;

/** The fields of `getHealthCheck` (contract HealthCheck) the panel uses. */
export interface HealthCheckInput {
  readonly id: string;
  readonly schemeVersionId: string;
  readonly schemeVersionNo: number;
  readonly assessmentDate: string;
  readonly completion: { readonly answered: number; readonly total: number; readonly complete: boolean };
  readonly score: string | null;
  readonly scoreMax: string | null;
  readonly band: { readonly key: string; readonly minScore: string; readonly rangeLabel: string } | null;
  readonly scoringAssumption: boolean;
  readonly answers: readonly { readonly questionCode: string; readonly response: string }[];
}

/** The fields of the assessment's scheme version (contract HealthCheckScheme) the panel uses. */
export interface HealthSchemeVersionInput {
  readonly versionId: string;
  readonly versionNo: number;
  readonly scoreBasis: HealthScoreBasis;
  readonly questionCount: number;
  readonly responses: readonly { readonly key: string; readonly credit: string | null }[];
  readonly bands: readonly { readonly key: string; readonly minScore: string; readonly origin: "source" | "admin" }[];
}

export interface HealthResponseCount {
  readonly key: string;
  readonly count: number;
  /** The scheme's credit ("1", "0", "0.5"), or null for N/A (not applicable: no points, not counted as applicable). */
  readonly credit: string | null;
  /** count × credit with the score's format ("3", "1.50"), or null for N/A. */
  readonly points: string | null;
}

export interface HealthScoreMessageParams {
  readonly answered: number;
  readonly total: number;
  readonly applicable: number;
  readonly points: string | null;
  readonly score: string | null;
  readonly scoreMax: string | null;
  readonly bandRange: string | null;
  readonly schemeVersionNo: number;
}

export type HealthScoreUnknownReason =
  | "explain.scheme_missing"
  | "explain.scheme_version_mismatch"
  | "explain.inputs_inconsistent";

interface HealthScoreCommon {
  readonly kind: "health_score";
  readonly assessmentId: string;
  readonly assessmentDate: string;
  readonly schemeVersionNo: number;
  readonly scoringAssumption: boolean;
  readonly answered: number;
  readonly total: number;
  /** The question codes without an answer, in B0150 order. */
  readonly unanswered: readonly string[];
}

export type HealthScoreExplanation =
  | (HealthScoreCommon & {
      readonly state: "unknown";
      readonly reason: HealthScoreUnknownReason;
      readonly messageParams: HealthScoreMessageParams;
    })
  | (HealthScoreCommon & {
      readonly state: "incomplete" | "not_computable";
      readonly scoreBasis: HealthScoreBasis;
      readonly applicable: number;
      readonly responses: readonly HealthResponseCount[];
      readonly points: null;
      readonly score: null;
      readonly scoreMax: null;
      readonly band: null;
      readonly messageParams: HealthScoreMessageParams;
    })
  | (HealthScoreCommon & {
      readonly state: "scored";
      readonly scoreBasis: HealthScoreBasis;
      readonly applicable: number;
      readonly responses: readonly HealthResponseCount[];
      /** Σ credit of the answers ("17", "11.50"). */
      readonly points: string;
      readonly score: string;
      readonly scoreMax: string;
      readonly band: { readonly key: string; readonly minScore: string; readonly rangeLabel: string } | null;
      readonly messageParams: HealthScoreMessageParams;
    });

function sameDecimal(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return DECIMAL_TEXT.test(a) && DECIMAL_TEXT.test(b) && new Decimal(a).eq(new Decimal(b));
}

function schemeInputOf(scheme: HealthSchemeVersionInput): HealthSchemeInput {
  return {
    definition: { scoreBasis: scheme.scoreBasis, questionCount: scheme.questionCount },
    responses: scheme.responses.map((r) => ({ key: r.key, credit: r.credit })),
    bands: scheme.bands.map((b) => ({ key: b.key, origin: b.origin, minScore: b.minScore })),
  };
}

/** The E5 panel of one assessment. `scheme` is the assessment's scheme version (null when it was not loaded). */
export function explainHealthScore(
  check: HealthCheckInput,
  scheme: HealthSchemeVersionInput | null,
): HealthScoreExplanation {
  const answeredCodes = new Set(check.answers.map((a) => a.questionCode));
  const unanswered = HEALTH_QUESTION_CODES.filter((c) => !answeredCodes.has(c));
  const answered = check.answers.length;
  const common: HealthScoreCommon = {
    kind: "health_score",
    assessmentId: check.id,
    assessmentDate: check.assessmentDate,
    schemeVersionNo: check.schemeVersionNo,
    scoringAssumption: check.scoringAssumption,
    answered,
    total: HEALTH_QUESTION_COUNT,
    unanswered,
  };
  const params = (over: Partial<HealthScoreMessageParams>): HealthScoreMessageParams => ({
    answered,
    total: HEALTH_QUESTION_COUNT,
    applicable: 0,
    points: null,
    score: null,
    scoreMax: null,
    bandRange: null,
    schemeVersionNo: check.schemeVersionNo,
    ...over,
  });
  const unknown = (reason: HealthScoreUnknownReason): HealthScoreExplanation => ({
    ...common,
    state: "unknown",
    reason,
    messageParams: params({}),
  });
  if (scheme === null) return unknown("explain.scheme_missing");
  if (scheme.versionId !== check.schemeVersionId || scheme.versionNo !== check.schemeVersionNo)
    return unknown("explain.scheme_version_mismatch");
  // One answer per question (the database's unique key) and the server's completion must agree with the answers.
  if (
    answeredCodes.size !== answered ||
    check.completion.answered !== answered ||
    check.completion.complete !== answered >= HEALTH_QUESTION_COUNT
  )
    return unknown("explain.inputs_inconsistent");

  const credits = new Map<string, string | null>(scheme.responses.map((r) => [r.key, r.credit]));
  if (check.answers.some((a) => !credits.has(a.response))) return unknown("explain.inputs_inconsistent");
  let applicable = 0;
  let points = new Decimal(0);
  const responses: HealthResponseCount[] = scheme.responses.map((r) => {
    const count = check.answers.filter((a) => a.response === r.key).length;
    if (r.credit === null) return { key: r.key, count, credit: null, points: null };
    const p = new Decimal(r.credit).times(count);
    applicable += count;
    points = points.plus(p);
    return { key: r.key, count, credit: r.credit, points: formatHealthScore(p) };
  });

  const shared = healthAssessmentResult(
    schemeInputOf(scheme),
    check.answers.map((a) => a.response),
  );
  if (!shared.computable) {
    // Incomplete or all N/A: the server must show no score and no band either (never 0).
    if (check.score !== null || check.scoreMax !== null || check.band !== null)
      return unknown("explain.inputs_inconsistent");
    return {
      ...common,
      state: shared.completion.complete ? "not_computable" : "incomplete",
      scoreBasis: scheme.scoreBasis,
      applicable,
      responses,
      points: null,
      score: null,
      scoreMax: null,
      band: null,
      messageParams: params({ applicable }),
    };
  }
  if (
    check.score === null ||
    check.scoreMax === null ||
    !sameDecimal(shared.score, check.score) ||
    !sameDecimal(shared.scoreMax, check.scoreMax) ||
    (check.band?.key ?? null) !== shared.bandKey
  )
    return unknown("explain.inputs_inconsistent");
  const pointsText = formatHealthScore(points);
  return {
    ...common,
    state: "scored",
    scoreBasis: scheme.scoreBasis,
    applicable,
    responses,
    points: pointsText,
    score: check.score,
    scoreMax: check.scoreMax,
    band: check.band,
    messageParams: params({
      applicable,
      points: pointsText,
      score: check.score,
      scoreMax: check.scoreMax,
      bandRange: check.band?.rangeLabel ?? null,
    }),
  };
}

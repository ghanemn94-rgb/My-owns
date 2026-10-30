// E1 explanation view model: the weighted score of an initiative (ADR-0061 §8 row E1; ADR-0022 §2-§3; REQ-S15-014).
// Owner: kpi-benefits-engineer (T-DG6-KBE-B; p6-work-split §I/K.2).
//
// Pure: it takes the two operation responses the panel already loads, `getInitiativeScores` (InitiativeScoreSheet) and
// the active weight set (WeightSet), and returns the panel's rows and message parameters, so the web never computes a
// business number (§I/K.11 item 5):
//  - one row per criterion of the weight set, in weight-set order, with its score (1-5), its weight (percent) and its
//    contribution = score × weight ÷ 100, an exact decimal string with 4 fraction digits (integer score × a weight of
//    at most 2 decimals ÷ 100 never needs more, ADR-0022 §2);
//  - the contributions' sum, which is checked against the server's `result.weightedScore` and against the shared
//    `weightedScore()` of `../scoring.ts` (no second implementation of the rule): a panel never shows a breakdown that
//    disagrees with the value it explains, it shows Unknown with a reason instead;
//  - a missing score gives NO contributions at all (incomplete is never 0) and lists the missing criteria;
//  - a weight set whose version is not the result's `weightSetVersionNo` is Unknown (the breakdown would explain a
//    different calculation).
// decimal.js only; a criterion score arrives as the contract's integer and is converted to its digit string at once.
import { Decimal } from "decimal.js";
import {
  isCriterionCode,
  validateWeightSet,
  weightedScore,
  type CriterionCode,
  type CriterionWeight,
  type ScoreMap,
} from "../scoring.ts";

const D = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -80, toExpPos: 80 });

/** The fields of `getInitiativeScores` (contract InitiativeScoreSheet) the panel uses. */
export interface WeightedScoreSheetInput {
  readonly scores: readonly { readonly criterionCode: string; readonly score: number | null }[];
  readonly result: {
    readonly weightSetVersionNo: number;
    readonly completeness: "complete" | "incomplete";
    readonly weightedScore: string | null;
    readonly weightedScoreDisplay: string | null;
    readonly display100: string | null;
    readonly missingCriteria: readonly string[];
    readonly computedAt: string | null;
  };
}

/** The fields of the active weight set (contract WeightSet) the panel uses. */
export interface WeightedScoreWeightSetInput {
  readonly versionNo: number;
  readonly weights: readonly CriterionWeight[];
}

/** One input row of the panel. */
export interface WeightedScoreRow {
  readonly criterionCode: CriterionCode;
  /** The score as a digit string "1".."5", or null when the criterion has no score. */
  readonly score: string | null;
  /** The weight with exactly 2 fraction digits ("25.00"). */
  readonly weightPercent: string;
  /** score × weight ÷ 100 with 4 fraction digits ("1.2500"); null on every row while the score is incomplete. */
  readonly contribution: string | null;
}

export type WeightedScoreUnknownReason =
  | "explain.weight_set_missing"
  | "explain.weight_set_version_mismatch"
  | "explain.inputs_inconsistent";

/** Message parameters of the panel's words (i18n `explanations.*`); numbers are decimal strings or integers. */
export interface WeightedScoreMessageParams {
  readonly weightSetVersionNo: number;
  readonly criteriaCount: number;
  readonly missingCount: number;
  readonly weightedScore: string | null;
  readonly display100: string | null;
}

export type WeightedScoreExplanation =
  | {
      readonly kind: "weighted_score";
      readonly state: "complete";
      readonly rows: readonly WeightedScoreRow[];
      /** Σ contributions, 4 fraction digits; equal to `weightedScore`. */
      readonly sum: string;
      /** The server's `result.weightedScore` ("3.3000"). */
      readonly weightedScore: string;
      readonly weightedScoreDisplay: string | null;
      readonly display100: string | null;
      readonly missingCriteria: readonly [];
      readonly weightSetVersionNo: number;
      readonly computedAt: string | null;
      readonly messageParams: WeightedScoreMessageParams;
    }
  | {
      readonly kind: "weighted_score";
      readonly state: "incomplete";
      /** Scores and weights only: `contribution` is null on every row. */
      readonly rows: readonly WeightedScoreRow[];
      readonly sum: null;
      readonly weightedScore: null;
      readonly weightedScoreDisplay: null;
      readonly display100: null;
      /** The criteria without a score, in weight-set order. Never empty. */
      readonly missingCriteria: readonly CriterionCode[];
      readonly weightSetVersionNo: number;
      readonly computedAt: string | null;
      readonly messageParams: WeightedScoreMessageParams;
    }
  | {
      readonly kind: "weighted_score";
      readonly state: "unknown";
      readonly reason: WeightedScoreUnknownReason;
      readonly rows: readonly [];
      readonly sum: null;
      readonly weightedScore: null;
      readonly weightedScoreDisplay: null;
      readonly display100: null;
      readonly missingCriteria: readonly CriterionCode[];
      readonly weightSetVersionNo: number;
      readonly computedAt: string | null;
      readonly messageParams: WeightedScoreMessageParams;
    };

function unknown(
  sheet: WeightedScoreSheetInput,
  reason: WeightedScoreUnknownReason,
  criteriaCount: number,
): WeightedScoreExplanation {
  const missing = sheet.result.missingCriteria.filter(isCriterionCode);
  return {
    kind: "weighted_score",
    state: "unknown",
    reason,
    rows: [],
    sum: null,
    weightedScore: null,
    weightedScoreDisplay: null,
    display100: null,
    missingCriteria: missing,
    weightSetVersionNo: sheet.result.weightSetVersionNo,
    computedAt: sheet.result.computedAt,
    messageParams: {
      weightSetVersionNo: sheet.result.weightSetVersionNo,
      criteriaCount,
      missingCount: missing.length,
      weightedScore: null,
      display100: null,
    },
  };
}

/** The score per criterion of the sheet (a criterion appears once per initiative; the last row wins defensively). */
function scoreMapOf(sheet: WeightedScoreSheetInput): ScoreMap {
  const map: Record<string, number | null> = Object.create(null) as Record<string, number | null>;
  for (const s of sheet.scores) map[s.criterionCode] = s.score;
  return map;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * The E1 panel of one initiative. `weightSet` is the active set the page loads (`null` when it could not be loaded:
 * Unknown, never a breakdown against a guessed set).
 */
export function explainWeightedScore(
  sheet: WeightedScoreSheetInput,
  weightSet: WeightedScoreWeightSetInput | null,
): WeightedScoreExplanation {
  if (weightSet === null) return unknown(sheet, "explain.weight_set_missing", 0);
  const criteriaCount = weightSet.weights.length;
  if (weightSet.versionNo !== sheet.result.weightSetVersionNo)
    return unknown(sheet, "explain.weight_set_version_mismatch", criteriaCount);
  if (!validateWeightSet(weightSet.weights).ok) return unknown(sheet, "explain.inputs_inconsistent", criteriaCount);

  const scores = scoreMapOf(sheet);
  let shared: ReturnType<typeof weightedScore>;
  try {
    shared = weightedScore(scores, weightSet.weights);
  } catch {
    // A stored score outside 1-5 is a programming error upstream; the panel does not explain it.
    return unknown(sheet, "explain.inputs_inconsistent", criteriaCount);
  }

  const server = sheet.result;
  if (shared.completeness !== server.completeness) return unknown(sheet, "explain.inputs_inconsistent", criteriaCount);

  if (shared.completeness === "incomplete") {
    if (server.weightedScore !== null || !sameList(shared.missingCriteria, server.missingCriteria))
      return unknown(sheet, "explain.inputs_inconsistent", criteriaCount);
    const rows: WeightedScoreRow[] = weightSet.weights.map((w) => {
      const input = shared.inputs[w.criterionCode]!;
      return {
        criterionCode: w.criterionCode as CriterionCode,
        score: input.score,
        weightPercent: input.weightPercent,
        contribution: null,
      };
    });
    return {
      kind: "weighted_score",
      state: "incomplete",
      rows,
      sum: null,
      weightedScore: null,
      weightedScoreDisplay: null,
      display100: null,
      missingCriteria: shared.missingCriteria,
      weightSetVersionNo: server.weightSetVersionNo,
      computedAt: server.computedAt,
      messageParams: {
        weightSetVersionNo: server.weightSetVersionNo,
        criteriaCount,
        missingCount: shared.missingCriteria.length,
        weightedScore: null,
        display100: null,
      },
    };
  }

  let sum = new D(0);
  const rows: WeightedScoreRow[] = weightSet.weights.map((w) => {
    const input = shared.inputs[w.criterionCode]!;
    // input.score is non-null on a complete result (weightedScore() lists every missing score).
    const contribution = new D(input.score!).times(new D(input.weightPercent)).div(100);
    sum = sum.plus(contribution);
    return {
      criterionCode: w.criterionCode as CriterionCode,
      score: input.score,
      weightPercent: input.weightPercent,
      contribution: contribution.toFixed(4),
    };
  });
  const sumText = sum.toFixed(4);
  // The breakdown must reproduce both the shared rule and the server's stored value exactly (no rounding: 4 decimals
  // are exact, ADR-0022 §2). Any difference means the inputs do not belong to this result.
  if (
    server.weightedScore === null ||
    !/^-?[0-9]+(\.[0-9]+)?$/.test(server.weightedScore) ||
    !sum.eq(new D(server.weightedScore)) ||
    sumText !== shared.weightedScore
  )
    return unknown(sheet, "explain.inputs_inconsistent", criteriaCount);
  return {
    kind: "weighted_score",
    state: "complete",
    rows,
    sum: sumText,
    weightedScore: server.weightedScore,
    weightedScoreDisplay: server.weightedScoreDisplay,
    display100: server.display100,
    missingCriteria: [],
    weightSetVersionNo: server.weightSetVersionNo,
    computedAt: server.computedAt,
    messageParams: {
      weightSetVersionNo: server.weightSetVersionNo,
      criteriaCount,
      missingCount: 0,
      weightedScore: server.weightedScore,
      display100: server.display100,
    },
  };
}

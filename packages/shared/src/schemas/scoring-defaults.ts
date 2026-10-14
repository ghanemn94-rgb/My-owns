// P5 slice A zod mirrors of the T06 default weights and rubric (REQ-PB-093; ADR-0040 §5, ADR-0039 §2/§12;
// p5-work-split §A.6; T-DG5-KBE-A). Contract schemas: ScoringWeight, ScoringRubricLevel, ScoringRubric,
// ScoringDefaults, ScoringDefaultsPut (docs/api/openapi.yaml 1.4.0-p5).
//
// Weights are decimal strings (never floats) with at most two decimals, > 0 and <= 100 (400 validation.weight_percent).
// A draft may be saved with any total; the 100 % rule over 2-6 criteria is applied at publish (422
// config_version.weights_total). A rubric level's descriptor is free text (1-500, the shared rules) or null; a null
// descriptor is rendered "No descriptor defined", never invented.
import { z } from "zod";
import { freeText, uuid, version } from "./common.ts";
import { weightPercent } from "./studio.ts";

/** The six T06 criteria (B0076 and the optional risk/compliance criterion of B0077), in the canonical order. */
export const SCORING_DEFAULT_CRITERIA = [
  "strategic_fit",
  "financial_value",
  "customer_impact",
  "feasibility",
  "time_to_value",
  "risk_compliance",
] as const;
export type ScoringDefaultCriterion = (typeof SCORING_DEFAULT_CRITERIA)[number];
export const scoringDefaultCriterion = z.enum(SCORING_DEFAULT_CRITERIA);

/** Contract `ScoringWeight`: one criterion's default weight (a decimal percent string). */
export const scoringWeight = z.strictObject({
  criterionCode: scoringDefaultCriterion,
  weightPercent,
});
export type ScoringWeight = z.infer<typeof scoringWeight>;

const descriptor = freeText(1, 500).nullable();

/** Contract `ScoringRubricLevel`: one of the five 1-5 levels; null descriptors are never invented. */
export const scoringRubricLevel = z.strictObject({
  score: z.number().int().min(1).max(5),
  descriptorEn: descriptor,
  descriptorAr: descriptor,
});
export type ScoringRubricLevel = z.infer<typeof scoringRubricLevel>;

/** Contract `ScoringRubric`: exactly five levels, scored 1, 2, 3, 4, 5 in that order. */
export const scoringRubric = z.strictObject({
  criterionCode: scoringDefaultCriterion,
  levels: z
    .array(scoringRubricLevel)
    .length(5)
    .refine((l) => l.every((x, i) => x.score === i + 1), "validation.pattern"),
});
export type ScoringRubric = z.infer<typeof scoringRubric>;

const uniqueCriteria = (items: readonly { readonly criterionCode: string }[]): boolean =>
  new Set(items.map((i) => i.criterionCode)).size === items.length;

/**
 * Contract `ScoringDefaultsPut`: the full set of default weights (2-6 distinct criteria; a criterion left out is
 * removed from the draft) and the rubrics to set (each listed criterion's five levels are replaced; a rubric not listed
 * keeps its current descriptors).
 */
export const scoringDefaultsPut = z.strictObject({
  weights: z.array(scoringWeight).min(2).max(6).refine(uniqueCriteria, "validation.unique_items"),
  rubrics: z.array(scoringRubric).max(6).refine(uniqueCriteria, "validation.unique_items"),
});
export type ScoringDefaultsPut = z.infer<typeof scoringDefaultsPut>;

/** Contract `ScoringDefaults`: the weights and rubric of one scoring_defaults version. */
export const scoringDefaults = z.strictObject({
  versionId: uuid,
  versionNo: z.number().int().min(1),
  status: z.enum(["draft", "published", "retired"]),
  isNewestPublished: z.boolean(),
  weights: z.array(scoringWeight),
  /** The decimal sum of the weights with two decimals (never rounded); 100.00 is required to publish. */
  weightTotal: z.string(),
  rubrics: z.array(scoringRubric),
  version,
});
export type ScoringDefaults = z.infer<typeof scoringDefaults>;

/** `getScoringDefaults` query: a given version, else the newest published version of `scoring-defaults`. */
export const scoringDefaultsQuery = z.strictObject({ versionId: uuid.optional() });

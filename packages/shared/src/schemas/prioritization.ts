// P3 prioritization mirrors (T06; ADR-0022; docs/architecture/p3-work-split.md §2 BE-D). Moved here from the BE-D route
// files (portfolio/prioritization.ts, scores.ts, rankings.ts, overrides.ts) by T-DG3-ARCH-03, so the API (request and
// response validation, the contract seam) and the web (FE-B forms and tables) import ONE definition from
// `@mth/shared/schemas`. They mirror the docs/api/openapi.yaml components of the `prioritization`-tag operations:
// CriterionCode, WeightSet*, ScoreResult, InitiativeScore*, RankingEntry, RankingSnapshot*, RankingChange,
// RankingOverride*, ApprovalDecision, PrioritizationItem and PrioritizationView, plus the getPrioritization query.
//
// Number formats (ADR-0019, ADR-0022 §1-§3): weights, weighted scores, axes and the 0-100 view are exact DECIMAL
// STRINGS, never JSON numbers ("25", "12.5", "3.3000", "57.5"); an unknown score is null, never 0. The one integer is
// a single criterion score, 1-5, which the frozen contract types as `integer` (6, 0, 2.5 and "4" are 400). The
// arithmetic lives in `@mth/shared/calc` (scoring.ts), never here.
//
// Ranking proposes an order; it never selects and never funds (REQ-S09-003). Weight-set approval and override
// decisions are business approvals inside the product (ADR-0021 §6) and nothing here touches DG0-DG7.
import { z } from "zod";
import { CRITERION_CODES } from "../scoring.ts";
import { freeText, hasInvalidCharacter, timestamp, uuid, version } from "./common.ts";
import { initiative, initiativeStatus, scheduleFlag } from "./portfolio.ts";

const nullableUuid = uuid.nullable();
const nullableTimestamp = timestamp.nullable();
const stamps = { version, createdAt: timestamp, createdBy: uuid, updatedAt: timestamp, updatedBy: uuid };
/** A stored weighted score / axis: numeric(7,4) as text, one integer digit 1-5 and four fraction digits ("3.3000"). */
const weightedScoreText = z.string().regex(/^[1-5]\.[0-9]{4}$/);

// ------------------------------------------------------------------------------------------------ criteria and weights

/** Contract `CriterionCode`: the five B0076 criteria plus the B0077 risk/compliance extension. */
export const criterionCode = z.enum(CRITERION_CODES);

const WEIGHT_PATTERN = /^(100(\.0{1,2})?|[0-9]{1,2}(\.[0-9]{1,2})?)$/;
/** Contract `WeightSetWeight`. "0" passes the pattern and is refused with 422 prioritization.weight_range (§2a). */
export const weightSetWeight = z.strictObject({ criterionCode, weightPercent: z.string().regex(WEIGHT_PATTERN) });
/** Contract `WeightSetCreate` (strict). */
export const weightSetCreate = z.strictObject({
  weights: z.array(weightSetWeight).min(2).max(6),
  rationale: freeText(1, 4000),
});
export type WeightSetCreate = z.infer<typeof weightSetCreate>;
/** Contract `WeightSet`. */
export const weightSet = z.strictObject({
  id: uuid,
  organizationId: uuid,
  transformationId: uuid,
  versionNo: z.number().int().min(1),
  status: z.enum(["proposed", "active", "superseded", "withdrawn"]),
  approvalBasis: z.enum(["source_default", "approved"]).nullable(),
  rationale: z.string().min(1).max(4000).nullable(),
  weights: z.array(weightSetWeight).min(2).max(6),
  approvedBy: uuid.nullable(),
  approvedAt: timestamp.nullable(),
  activatedAt: timestamp.nullable(),
  supersededAt: timestamp.nullable(),
  version,
  createdAt: timestamp,
  createdBy: uuid,
  updatedAt: timestamp,
  updatedBy: uuid,
});
export type WeightSet = z.infer<typeof weightSet>;
export const weightSetList = z.strictObject({ items: z.array(weightSet) });

// ------------------------------------------------------------------------------------------------ scores

/** Contract `integer, minimum 1, maximum 5`: 6, 0, 2.5 and "4" are 400 (ADR-0022 §2). */
const scoreValue = z.number().int().min(1).max(5);

/** Contract `InitiativeScoreCreate` (strict: a `weightedScore` property is 400). */
export const initiativeScoreCreate = z.strictObject({
  criterionCode,
  score: scoreValue,
  note: freeText(1, 2000).optional(),
});
export type InitiativeScoreCreate = z.infer<typeof initiativeScoreCreate>;
/** Contract `InitiativeScoreUpdate` (strict). */
export const initiativeScoreUpdate = z.strictObject({
  score: scoreValue.nullable(),
  note: freeText(1, 2000).nullable().optional(),
});
export type InitiativeScoreUpdate = z.infer<typeof initiativeScoreUpdate>;

/** Contract `ScoreResult` (read-only). `weightedScore` null = incomplete (Unknown), never 0. */
export const scoreResult = z.strictObject({
  weightSetVersionNo: z.number().int().min(1),
  completeness: z.enum(["complete", "incomplete"]),
  weightedScore: weightedScoreText.nullable(),
  weightedScoreDisplay: z.string().nullable(),
  display100: z.string().nullable(),
  conversion: z.literal("(score-1)/4*100"),
  missingCriteria: z.array(criterionCode),
  computedAt: nullableTimestamp,
});
export type ScoreResult = z.infer<typeof scoreResult>;

/** Contract `InitiativeScore`. */
export const initiativeScore = z.strictObject({
  id: uuid,
  organizationId: uuid,
  transformationId: uuid,
  initiativeId: uuid,
  criterionCode,
  score: z.number().int().min(1).max(5).nullable(),
  note: freeText(1, 2000).nullable(),
  scoredBy: nullableUuid,
  scoredAt: nullableTimestamp,
  ...stamps,
});
export type InitiativeScore = z.infer<typeof initiativeScore>;

/** Contract `InitiativeScoreSheet`. */
export const initiativeScoreSheet = z.strictObject({
  initiativeId: uuid,
  scores: z.array(initiativeScore),
  result: scoreResult,
});
export type InitiativeScoreSheet = z.infer<typeof initiativeScoreSheet>;

// ------------------------------------------------------------------------------------------------ rankings

export const RANKING_CAUSES = ["new", "score", "weight", "override", "relative", "removed"] as const;
export type RankingCause = (typeof RANKING_CAUSES)[number];

/** Contract `RankingEntry`. */
export const rankingEntry = z.strictObject({
  initiativeId: uuid,
  rank: z.number().int().min(1).nullable(),
  previousRank: z.number().int().min(1).nullable(),
  weightedScore: weightedScoreText.nullable(),
  completeness: z.enum(["complete", "incomplete", "removed"]),
  causes: z.array(z.enum(RANKING_CAUSES)),
  causeLabels: z.array(z.string()),
  causeDetail: z.record(z.string(), z.unknown()),
  overrideId: uuid.nullable(),
});
export type RankingEntry = z.infer<typeof rankingEntry>;
/** Contract `RankingSnapshot`. */
export const rankingSnapshot = z.strictObject({
  id: uuid,
  transformationId: uuid,
  snapshotNo: z.number().int().min(1),
  weightSetId: uuid,
  weightSetVersionNo: z.number().int().min(1),
  status: z.enum(["current", "superseded"]),
  note: z.string().min(1).max(2000).nullable(),
  proposedBy: uuid,
  proposedAt: timestamp,
  supersededAt: timestamp.nullable(),
  version,
});
export type RankingSnapshot = z.infer<typeof rankingSnapshot>;
export const rankingSnapshotView = z.strictObject({ snapshot: rankingSnapshot, entries: z.array(rankingEntry) });
export type RankingSnapshotView = z.infer<typeof rankingSnapshotView>;
export const rankingSnapshotPage = z.strictObject({
  items: z.array(rankingSnapshot),
  nextCursor: z.string().nullable(),
});
export const rankingChange = z.strictObject({
  snapshotNo: z.number().int().min(1),
  proposedAt: timestamp,
  entry: rankingEntry,
});
export type RankingChange = z.infer<typeof rankingChange>;
export const rankingHistoryPage = z.strictObject({ items: z.array(rankingChange), nextCursor: z.string().nullable() });

// ------------------------------------------------------------------------------------------------ overrides

/**
 * The override reason at the schema level: 3-2000 characters (missing, empty or shorter -> 400 at /reason) and no NUL
 * or lone surrogate (400 validation.invalid_character). Blank text is NOT refused here: it is the business rule 422
 * prioritization.override_reason_required (ADR-0022 §5), checked by the API with the shared `hasText`.
 */
const overrideReason = z
  .string()
  .min(3)
  .max(2000)
  .refine((v) => !hasInvalidCharacter(v), "validation.invalid_character");

/** Contract `RankingOverrideCreate` (strict). */
export const rankingOverrideCreate = z.strictObject({
  initiativeId: uuid,
  overrideRank: z.number().int().min(1).max(2_147_483_647),
  reason: overrideReason,
});
export type RankingOverrideCreate = z.infer<typeof rankingOverrideCreate>;
/**
 * Contract `ApprovalDecision` (the override decision body). `onBehalfOfUserId` is in the contract, but a P3 business
 * approval is decided in person: the API refuses it with 422 prioritization.on_behalf_not_supported (ADR-0021 §6).
 */
export const approvalDecision = z.strictObject({
  result: z.enum(["approved", "rejected"]),
  note: freeText(1, 2000).optional(),
  onBehalfOfUserId: uuid.optional(),
});
export type ApprovalDecision = z.infer<typeof approvalDecision>;
/** Contract `RankingOverride`. */
export const rankingOverride = z.strictObject({
  id: uuid,
  organizationId: uuid,
  transformationId: uuid,
  initiativeId: uuid,
  overrideRank: z.number().int().min(1),
  reason: z.string().min(3).max(2000),
  status: z.enum(["proposed", "approved", "rejected", "revoked"]),
  proposedBy: uuid,
  decidedBy: uuid.nullable(),
  decidedAt: timestamp.nullable(),
  decisionNote: z.string().min(1).max(2000).nullable(),
  revokedBy: uuid.nullable(),
  revokedAt: timestamp.nullable(),
  revokeReason: z.string().min(3).max(1000).nullable(),
  ...stamps,
});
export type RankingOverride = z.infer<typeof rankingOverride>;
export const rankingOverridePage = z.strictObject({
  items: z.array(rankingOverride),
  nextCursor: z.string().nullable(),
});

// ------------------------------------------------------------------------------------------------ the view

/** Contract `PrioritizationItem`. Selection and funding are separate columns (REQ-S09-003). Axes null = Unknown. */
export const prioritizationItem = z.strictObject({
  initiative,
  result: scoreResult,
  rank: z.number().int().min(1).nullable(),
  valueAxis: weightedScoreText.nullable(),
  feasibilityAxis: weightedScoreText.nullable(),
  selection: z.enum(["not_selected", "selected"]),
  funding: z.enum(["not_applicable", "unfunded", "funded", "revoked"]),
  flags: z.array(scheduleFlag),
});
export type PrioritizationItem = z.infer<typeof prioritizationItem>;
/** Contract `PrioritizationView`. */
export const prioritizationView = z.strictObject({
  transformationId: uuid,
  weightSet,
  conversionLabel: z.string(),
  items: z.array(prioritizationItem),
});
export type PrioritizationView = z.infer<typeof prioritizationView>;

/** The query of `getPrioritization` (all filters optional; above 500 eligible initiatives the API answers 422). */
export const prioritizationQuery = z.strictObject({
  status: initiativeStatus.optional(),
  waveId: z.uuid().optional(),
  completeness: z.enum(["complete", "incomplete"]).optional(),
  funding: z.enum(["not_applicable", "unfunded", "funded", "revoked"]).optional(),
  flag: z
    .string()
    .regex(/^[a-z][a-z0-9_.]*$/)
    .max(64)
    .optional(),
});
export type PrioritizationQuery = z.infer<typeof prioritizationQuery>;

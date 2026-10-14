// zod mirrors of the P5 slice A review, publish, rollback and review-policy operations (docs/api/openapi.yaml tag
// `studio`: submitConfigReview, listConfigReviews, decideConfigReview, withdrawConfigReview, publishConfigVersion,
// rollbackConfigVersion, listConfigReviewPolicies, updateConfigReviewPolicy; ADR-0039 §5, §7, §9, §13; REQ-S06-007,
// REQ-S06-009, REQ-S06-010; p5-work-split §A.4; T-DG5-BE-B3). The OpenAPI file is the source of truth; the contract
// test parses every success body with these. publishConfigVersion and rollbackConfigVersion answer with the
// `configVersion` mirror of studio.ts.
// A configuration review is not a business approval: approving a Studio change grants and records no G1-G6 decision.
import { z } from "zod";
import { freeText, page, timestamp, uuid } from "./common.ts";

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

// ------------------------------------------------------------------------------------------------ review requests

export const CONFIG_REVIEW_STATUSES = ["pending", "approved", "changes_requested", "withdrawn"] as const;
export type ConfigReviewStatus = (typeof CONFIG_REVIEW_STATUSES)[number];

/** submitConfigReview body (`ConfigReviewSubmit`). */
export const configReviewSubmit = z.strictObject({ note: freeText(1, 4000).optional() });
export type ConfigReviewSubmit = z.infer<typeof configReviewSubmit>;

/** The configured review of exactly one content hash (`ConfigReviewRequest`). */
export const configReviewRequest = z.strictObject({
  id: uuid,
  versionId: uuid,
  contentSha256: sha256,
  reviewerRoleCode: z.string(),
  status: z.enum(CONFIG_REVIEW_STATUSES),
  requestNote: z.string().min(1).max(4000).nullable(),
  revisionProposalId: uuid.nullable(),
  requestedBy: uuid,
  requestedAt: timestamp,
  decidedBy: uuid.nullable(),
  decidedAt: timestamp.nullable(),
  decisionNote: z.string().min(1).max(4000).nullable(),
  version: z.number().int().min(1),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type ConfigReviewRequest = z.infer<typeof configReviewRequest>;
export const configReviewRequestPage = page(configReviewRequest);

/**
 * decideConfigReview body (`ConfigReviewDecision`). The note is required when changes are requested; the API answers
 * 400 `validation.required` at `/note` when it is missing (the 0062 CHECK `config_review_request_changes_noted`).
 */
export const configReviewDecision = z.strictObject({
  outcome: z.enum(["approve", "request_changes"]),
  note: freeText(1, 4000).optional(),
});
export type ConfigReviewDecision = z.infer<typeof configReviewDecision>;

// ------------------------------------------------------------------------------------------------ rollback

/** rollbackConfigVersion body (`ConfigRollbackRequest`): the reason is the rollback draft's change summary. */
export const configRollbackRequest = z.strictObject({ reason: freeText(3, 4000) });
export type ConfigRollbackRequest = z.infer<typeof configRollbackRequest>;

// ------------------------------------------------------------------------------------------------ review policies

/** The policy rows: the six configuration kinds and the S12-018 `benefit_formula` routing row (`ConfigKindPath`). */
export const CONFIG_REVIEW_POLICY_KINDS = [
  "methodology",
  "scoring_defaults",
  "form_schema",
  "procedure",
  "automation_rule_set",
  "health_check_scheme",
  "benefit_formula",
] as const;
export type ConfigReviewPolicyKind = (typeof CONFIG_REVIEW_POLICY_KINDS)[number];
export const configReviewPolicyKind = z.enum(CONFIG_REVIEW_POLICY_KINDS);

/** One kind's review requirement and reviewer role (`ConfigReviewPolicy`). */
export const configReviewPolicy = z.strictObject({
  configKind: z.string(),
  reviewRequired: z.boolean(),
  reviewerRoleCode: z.string(),
  version: z.number().int().min(1),
  updatedAt: timestamp,
  updatedBy: uuid.nullable(),
});
export type ConfigReviewPolicy = z.infer<typeof configReviewPolicy>;
export const configReviewPolicyList = z.strictObject({ items: z.array(configReviewPolicy) });

/** updateConfigReviewPolicy body (`ConfigReviewPolicyUpdate`): at least one member. */
export const configReviewPolicyUpdate = z
  .strictObject({
    reviewRequired: z.boolean().optional(),
    reviewerRoleCode: z
      .string()
      .regex(/^[A-Z_]{2,32}$/)
      .optional(),
  })
  .refine((v) => v.reviewRequired !== undefined || v.reviewerRoleCode !== undefined, "validation.empty_update");
export type ConfigReviewPolicyUpdate = z.infer<typeof configReviewPolicyUpdate>;

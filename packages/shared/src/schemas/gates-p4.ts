// P4 slice H mirrors of BE-K (backend-workflow-engineer, T-DG4-BE-K; p4-work-split §H H.1; ADR-0035 §2, §5, §6, §7;
// OpenAPI 1.3.0-p4 GateScaleScope, ScaleScope*, ScaleTransition*, RiskDisposition*). REQ-S03-004, REQ-S04-007,
// REQ-PB-020, REQ-S12-010. BE-K2 appends its gate-review and gate-exception shapes below (p4-work-split §H H.2).
//
// - A G5 approval records the approved scale scope: every item names one initiative AND one business unit, so a scope
//   is never unrestricted (M0124); conditions carry an owner and a due date.
// - A scale transition is allowed only inside the latest approved G5 scope (422 gate.g5_not_approved /
//   scale.outside_approved_scope otherwise).
// - A risk disposition is immutable; its approval is a canonical approval of type risk_disposition, decided by a person
//   other than the proposer (approval.decide). Nothing here approves anything, and nothing touches DG0-DG7.
import { z } from "zod";
import { freeText, page, timestamp, uuid, version } from "./common.ts";
import { businessDate } from "./kpi.ts";

const nullableUuid = uuid.nullable();

// ------------------------------------------------------------------------------------------------ G5 scale scope

export const scaleScopeItemCreate = z.strictObject({
  initiativeId: uuid,
  businessUnitId: uuid,
  note: freeText(1, 1000).optional(),
});
export type ScaleScopeItemCreate = z.infer<typeof scaleScopeItemCreate>;

export const gateConditionCreate = z.strictObject({
  text: freeText(3, 2000),
  ownerUserId: uuid,
  dueDate: businessDate,
});
export type GateConditionCreate = z.infer<typeof gateConditionCreate>;

/** GateDecisionCreate.scaleScope (D-089 seam 2): 1-100 unique (initiative, business unit) items, 0-20 conditions. */
export const gateScaleScope = z
  .strictObject({
    items: z.array(scaleScopeItemCreate).min(1).max(100),
    conditions: z.array(gateConditionCreate).min(0).max(20).optional(),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.items.forEach((i, n) => {
      const key = `${i.initiativeId}:${i.businessUnitId}`;
      if (seen.has(key))
        ctx.addIssue({ code: "custom", message: "validation.duplicate_scope_item", path: ["items", n] });
      seen.add(key);
    });
  });
export type GateScaleScope = z.infer<typeof gateScaleScope>;

export const scaleScopeItem = z.strictObject({
  id: uuid,
  initiativeId: uuid,
  businessUnitId: uuid,
  note: z.string().min(1).max(1000).nullable(),
});
export type ScaleScopeItem = z.infer<typeof scaleScopeItem>;

export const gateCondition = z.strictObject({
  id: uuid,
  ordinal: z.number().int().min(1).max(20),
  text: z.string().min(3).max(2000),
  ownerUserId: uuid,
  dueDate: businessDate,
});
export type GateCondition = z.infer<typeof gateCondition>;

export const scaleScope = z.strictObject({
  approved: z.boolean(),
  gateDecisionId: nullableUuid,
  decidedAt: timestamp.nullable(),
  items: z.array(scaleScopeItem),
  conditions: z.array(gateCondition),
});
export type ScaleScope = z.infer<typeof scaleScope>;

// ------------------------------------------------------------------------------------------------ scale transitions

export const scaleTransition = z.strictObject({
  id: uuid,
  transformationId: uuid,
  initiativeId: uuid,
  businessUnitId: uuid,
  gateDecisionId: uuid,
  note: z.string().min(1).max(2000).nullable(),
  transitionedBy: uuid,
  transitionedAt: timestamp,
});
export type ScaleTransition = z.infer<typeof scaleTransition>;
export const scaleTransitionPage = page(scaleTransition);

export const scaleTransitionCreate = z.strictObject({
  initiativeId: uuid,
  businessUnitId: uuid,
  note: freeText(1, 2000).optional(),
});
export type ScaleTransitionCreate = z.infer<typeof scaleTransitionCreate>;

// ------------------------------------------------------------------------------------------------ risk dispositions

export const RISK_DISPOSITIONS = ["accept", "transfer", "carry_into_bau"] as const;
export const RISK_DISPOSITION_APPROVAL_STATUSES = [
  "pending",
  "changes_requested",
  "deferred",
  "approved",
  "rejected",
  "withdrawn",
] as const;

export const riskDisposition = z.strictObject({
  id: uuid,
  transformationId: uuid,
  raidEntryId: uuid,
  disposition: z.enum(RISK_DISPOSITIONS),
  rationale: z.string().min(3).max(4000),
  residualOwnerUserId: uuid,
  approvalId: nullableUuid,
  approvalStatus: z.enum(RISK_DISPOSITION_APPROVAL_STATUSES).nullable(),
  version,
  createdAt: timestamp,
  createdBy: uuid,
});
export type RiskDisposition = z.infer<typeof riskDisposition>;
export const riskDispositionPage = page(riskDisposition);

export const riskDispositionCreate = z.strictObject({
  raidEntryId: uuid,
  disposition: z.enum(RISK_DISPOSITIONS),
  rationale: freeText(3, 4000),
  residualOwnerUserId: uuid,
});
export type RiskDispositionCreate = z.infer<typeof riskDispositionCreate>;

// ------------------------------------------------------------------------------------------------ BE-K2: gate reviews
// T-DG4-BE-K2 (p4-work-split §H H.2; ADR-0035 §3, §4, §11; OpenAPI GateCriterionRow*, GateCriterionReview*,
// GateException*). REQ-S04-009, REQ-S04-010, REQ-S04-012, REQ-S04-013. A criterion review is a reviewer's finding and
// recommendation; it is not the gate's business decision, which stays with the configured approver (DG2 decision).

const criterionKey = z.string().regex(/^g[1-6]\.[a-z_]{1,48}$/);
const gateCodeP4 = z.string().regex(/^G[1-6]$/);

export const GATE_CRITERION_RECOMMENDATIONS = ["meets", "meets_with_conditions", "does_not_meet"] as const;

/** GateCriterionReviewCreate: openCondition is required with meets_with_conditions (422 at the service, not 400). */
export const gateCriterionReviewCreate = z.strictObject({
  finding: freeText(1, 4000),
  openCondition: freeText(1, 2000).optional(),
  riskNote: freeText(1, 2000).optional(),
  raidEntryId: uuid.optional(),
  recommendation: z.enum(GATE_CRITERION_RECOMMENDATIONS),
  rationale: freeText(3, 4000),
});
export type GateCriterionReviewCreate = z.infer<typeof gateCriterionReviewCreate>;

export const gateCriterionReview = z.strictObject({
  id: uuid,
  gateSubmissionId: uuid,
  criterionKey,
  reviewNo: z.number().int().min(1),
  reviewerUserId: uuid,
  finding: z.string().min(1).max(4000),
  openCondition: z.string().min(1).max(2000).nullable(),
  riskNote: z.string().min(1).max(2000).nullable(),
  raidEntryId: nullableUuid,
  recommendation: z.enum(GATE_CRITERION_RECOMMENDATIONS),
  rationale: z.string().min(3).max(4000),
  reviewedAt: timestamp,
});
export type GateCriterionReview = z.infer<typeof gateCriterionReview>;
export const gateCriterionReviewPage = page(gateCriterionReview);

// ------------------------------------------------------------------------------------------------ BE-K2: exceptions

export const GATE_EXCEPTION_STATUSES = ["pending", "accepted", "rejected", "withdrawn", "revoked"] as const;

/** GateExceptionCreate: all five REQ-S04-013 fields are required, so a missing expiry or compensating action is 400. */
export const gateExceptionCreate = z.strictObject({
  gateCode: gateCodeP4,
  criterionKey,
  reason: freeText(3, 4000),
  scope: freeText(3, 2000),
  compensatingAction: freeText(3, 4000),
  compensatingOwnerUserId: uuid,
  expiresOn: businessDate,
});
export type GateExceptionCreate = z.infer<typeof gateExceptionCreate>;

export const gateExceptionDecision = z.strictObject({
  outcome: z.enum(["accepted", "rejected"]),
  note: freeText(3, 2000),
  onBehalfOfUserId: uuid.optional(),
});
export type GateExceptionDecision = z.infer<typeof gateExceptionDecision>;

export const gateExceptionRevoke = z.strictObject({ reason: freeText(3, 1000) });
export type GateExceptionRevoke = z.infer<typeof gateExceptionRevoke>;

export const gateException = z.strictObject({
  id: uuid,
  transformationId: uuid,
  gateInstanceId: uuid,
  gateCode: gateCodeP4,
  criterionKey,
  reason: z.string().min(3).max(4000),
  scope: z.string().min(3).max(2000),
  compensatingAction: z.string().min(3).max(4000),
  compensatingOwnerUserId: uuid,
  expiresOn: businessDate,
  status: z.enum(GATE_EXCEPTION_STATUSES),
  /** Computed for today's business date in the transformation's timezone: accepted and today <= expiresOn. */
  covering: z.boolean(),
  requestedBy: uuid,
  requestedAt: timestamp,
  decidedBy: nullableUuid,
  decidedOnBehalfOf: nullableUuid,
  decidedAt: timestamp.nullable(),
  decisionNote: z.string().min(1).max(2000).nullable(),
  revokedBy: nullableUuid,
  revokedAt: timestamp.nullable(),
  revokeReason: z.string().min(1).max(1000).nullable(),
  expiryNotifiedAt: timestamp.nullable(),
  version,
  createdAt: timestamp,
  createdBy: nullableUuid,
  updatedAt: timestamp,
  updatedBy: nullableUuid,
});
export type GateException = z.infer<typeof gateException>;
export const gateExceptionPage = page(gateException);

/** One row of the gate criteria review table (the nine M0124 fields; the six review fields null = "not reviewed"). */
export const gateCriterionRow = z.strictObject({
  criterionKey,
  ordinal: z.number().int().min(1),
  mandatory: z.boolean(),
  criterionLabelEn: z.string().min(1).max(200),
  criterionLabelAr: z.string().min(1).max(200),
  requiredEvidenceEn: z.string().min(1).max(1000),
  requiredEvidenceAr: z.string().min(1).max(1000),
  completeness: z.enum(["complete", "incomplete"]),
  reviewerUserId: nullableUuid,
  finding: z.string().min(1).max(4000).nullable(),
  openCondition: z.string().min(1).max(2000).nullable(),
  risk: z.strictObject({ note: z.string().nullable(), raidEntryId: nullableUuid }).nullable(),
  decision: z.enum(GATE_CRITERION_RECOMMENDATIONS).nullable(),
  rationale: z.string().min(1).max(4000).nullable(),
  reviewCount: z.number().int().min(0),
  exception: gateException.nullable(),
});
export type GateCriterionRow = z.infer<typeof gateCriterionRow>;

export const gateCriterionRowList = z.strictObject({
  gateCode: gateCodeP4,
  submissionNo: z.number().int().min(1),
  snapshotSha256: z.string().regex(/^[0-9a-f]{64}$/),
  gateStatus: z.enum(["draft", "submitted", "under_review", "changes_requested", "approved", "rejected", "deferred"]),
  items: z.array(gateCriterionRow),
});
export type GateCriterionRowList = z.infer<typeof gateCriterionRowList>;

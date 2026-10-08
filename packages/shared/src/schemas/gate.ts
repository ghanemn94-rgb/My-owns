// P2 product-gate mirrors (backend-workflow-engineer; ADR-0015 §2). G1-G6 are BUSINESS approvals inside the product,
// decided by people; they are unrelated to the engineering delivery gates DG0-DG7 and never imply them.
// Mirrors docs/api/openapi.yaml GateInstance, GateInheritedApproval, GateSubmission*, GateDecision*,
// GateCriterionEvaluation, GateView, GateList, GateApproverConfig.
import { z } from "zod";
import { freeText, roleCode, timestamp, uuid, version } from "./common.ts";
import { businessDate } from "./kpi.ts";
import { gateDefinition, warning } from "./methodology.ts";

const nullableUuid = uuid.nullable();

export const GATE_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "changes_requested",
  "approved",
  "rejected",
  "deferred",
] as const;
export const GATE_OUTCOMES = ["approved", "rejected", "changes_requested", "deferred"] as const;
export const APPROVER_BASES = ["configured_user", "configured_role", "default_role"] as const;

/** ADR-0021 §5 (F-DG3-120): the dispensation status as the gate annotation shows it (`pending` → pending_verification). */
export const INHERITED_APPROVAL_STATUSES = ["pending_verification", "accepted", "rejected", "revoked"] as const;

/**
 * Mirrors GateInheritedApproval: the Modular inherited approval recorded for a gate. An annotation only; it never
 * changes the gate's status and never approves the gate.
 */
export const gateInheritedApproval = z.strictObject({
  dispensationId: uuid,
  status: z.enum(INHERITED_APPROVAL_STATUSES),
  counts: z.boolean(),
  approvingBody: z.string().min(1).max(300),
  approvedOn: businessDate,
});
export type GateInheritedApproval = z.infer<typeof gateInheritedApproval>;

export const gateInstance = z.strictObject({
  id: uuid,
  organizationId: uuid,
  transformationId: uuid,
  gateCode: z.string(),
  status: z.enum(GATE_STATUSES),
  approverRoleCode: z.string(),
  approverUserId: nullableUuid,
  currentSubmissionId: nullableUuid,
  latestSubmissionNo: z.number().int().min(0),
  approvedAt: timestamp.nullable(),
  version,
  createdAt: timestamp,
  createdBy: uuid,
  updatedAt: timestamp,
  updatedBy: uuid,
  inheritedApproval: gateInheritedApproval.nullable(),
});
export type GateInstance = z.infer<typeof gateInstance>;

export const gateSubmission = z.strictObject({
  id: uuid,
  organizationId: uuid,
  transformationId: uuid,
  gateInstanceId: uuid,
  gateCode: z.string(),
  submissionNo: z.number().int().min(1),
  status: z.enum(["pending", "superseded", "decided", "withdrawn"]),
  submittedBy: uuid,
  submittedAt: timestamp,
  submissionNote: freeText(1, 4000).nullable(),
  approverRoleCode: z.string(),
  approverUserId: nullableUuid,
  dueDate: businessDate.nullable(),
  charterId: nullableUuid,
  charterVersionNo: z.number().int().nullable(),
  snapshot: z.record(z.string(), z.unknown()),
  snapshotSha256: z.string().regex(/^[0-9a-f]{64}$/),
  supersededAt: timestamp.nullable(),
  supersededBySubmissionId: nullableUuid,
  version,
  createdAt: timestamp,
  createdBy: uuid,
  updatedAt: timestamp,
  updatedBy: uuid,
});
export type GateSubmission = z.infer<typeof gateSubmission>;
export const gateSubmissionPage = z.strictObject({ items: z.array(gateSubmission), nextCursor: z.string().nullable() });

export const gateSubmissionCriterion = z.strictObject({
  id: uuid,
  organizationId: uuid,
  transformationId: uuid,
  gateSubmissionId: uuid,
  criterionKey: z.string(),
  ordinal: z.number().int().min(1).max(20),
  mandatory: z.boolean(),
  completeness: z.enum(["complete", "incomplete"]),
  detail: z.record(z.string(), z.unknown()),
  evaluatedAt: timestamp,
});

/**
 * P3 (REQ-PB-022, B0032; ADR-0021 §8): leadership agreement on the problem, the baseline and the material value pools.
 * Required, all `true`, for an approved G1 decision; absent otherwise. Mirrors GateAgreements.
 */
export const gateAgreements = z.strictObject({
  problem: z.literal(true),
  baseline: z.literal(true),
  materialValuePools: z.literal(true),
});
export type GateAgreements = z.infer<typeof gateAgreements>;
/** The agreement codes as stored (gate_decision_agreement.agreement_code), in the order of GateAgreements. */
export const GATE_AGREEMENT_CODES = ["problem", "baseline", "material_value_pools"] as const;
export const gateAgreementRecord = z.strictObject({
  agreementCode: z.enum(GATE_AGREEMENT_CODES),
  confirmedBy: uuid,
  confirmedAt: timestamp,
});
export type GateAgreementRecord = z.infer<typeof gateAgreementRecord>;

export const gateDecision = z.strictObject({
  id: uuid,
  organizationId: uuid,
  transformationId: uuid,
  gateSubmissionId: uuid,
  decisionId: uuid,
  decisionKind: z.enum(["gate"]),
  gateCode: z.string(),
  submissionNo: z.number().int().min(1),
  outcome: z.enum(GATE_OUTCOMES),
  rationale: freeText(3, 8000),
  comments: freeText(1, 8000).nullable(),
  decidedBy: uuid,
  onBehalfOfUserId: nullableUuid,
  decidedAt: timestamp,
  approverBasis: z.enum(APPROVER_BASES),
  approverRoleCode: z.string(),
  // P3 (ADR-0021 §8): the three B0032 confirmations of an approved G1 decision; absent or empty otherwise.
  agreements: z.array(gateAgreementRecord).optional(),
});
export type GateDecision = z.infer<typeof gateDecision>;

/** Live evaluation of one required output; unverified evidence never completes a criterion that needs verification. */
export const gateCriterionEvaluation = z.strictObject({
  key: z.string().regex(/^g[1-6]\.[a-z_]{1,48}$/),
  ordinal: z.number().int().min(1).max(20),
  labelEn: z.string(),
  labelAr: z.string(),
  mandatory: z.boolean(),
  requiresVerifiedEvidence: z.boolean(),
  completeness: z.enum(["complete", "incomplete"]),
  missing: z.array(warning),
  unverifiedEvidenceIds: z.array(uuid),
});
export type GateCriterionEvaluation = z.infer<typeof gateCriterionEvaluation>;

export const gateView = z.strictObject({
  gate: gateInstance,
  definition: gateDefinition,
  criteria: z.array(gateCriterionEvaluation),
  currentSubmission: gateSubmission.nullable(),
  submissionEnabled: z.boolean(),
  canSubmit: z.boolean(),
  canDecide: z.boolean(),
});
export const gateList = z.strictObject({ items: z.array(gateView).length(6) });

export const gateSubmissionView = z.strictObject({
  submission: gateSubmission,
  criteria: z.array(gateSubmissionCriterion),
  decision: gateDecision.nullable(),
});

export const gateApproverConfig = z.strictObject({
  approverRoleCode: roleCode,
  approverUserId: nullableUuid.optional(),
});
export const gateSubmissionCreate = z.strictObject({
  submissionNote: freeText(1, 4000).optional(),
  dueDate: businessDate.optional(),
});

export const gateDecisionCreate = z.strictObject({
  submissionNo: z.number().int().min(1),
  outcome: z.enum(GATE_OUTCOMES),
  rationale: freeText(3, 8000),
  comments: freeText(1, 8000).optional(),
  onBehalfOfUserId: uuid.optional(),
  agreements: gateAgreements.optional(),
});

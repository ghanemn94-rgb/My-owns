// P2 product-gate mirrors (backend-workflow-engineer; ADR-0015 §2). G1-G6 are BUSINESS approvals inside the product,
// decided by people; they are unrelated to the engineering delivery gates DG0-DG7 and never imply them.
// Mirrors docs/api/openapi.yaml GateInstance, GateSubmission*, GateDecision*, GateCriterionEvaluation, GateView,
// GateList, GateApproverConfig.
import { z } from "zod";
import { roleCode, timestamp, uuid, version } from "./common.ts";
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
  submissionNote: z.string().min(1).max(4000).nullable(),
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
  rationale: z.string().min(3).max(8000),
  comments: z.string().min(1).max(8000).nullable(),
  decidedBy: uuid,
  onBehalfOfUserId: nullableUuid,
  decidedAt: timestamp,
  approverBasis: z.enum(APPROVER_BASES),
  approverRoleCode: z.string(),
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
  submissionNote: z.string().min(1).max(4000).optional(),
  dueDate: businessDate.optional(),
});
export const gateDecisionCreate = z.strictObject({
  submissionNo: z.number().int().min(1),
  outcome: z.enum(GATE_OUTCOMES),
  rationale: z.string().min(3).max(8000),
  comments: z.string().min(1).max(8000).optional(),
  onBehalfOfUserId: uuid.optional(),
});

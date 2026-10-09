// zod mirrors of the P4 approvals tag (docs/api/openapi.yaml; ADR-0026 §4, §6; REQ-S10-014, REQ-S10-016..019;
// T-DG4-BE-B). These are BUSINESS approvals inside the product, decided by named people; no job or seed decides one,
// and nothing here relates to the engineering gates DG0-DG7. A blank rationale is a 422 business rule
// (approval.rationale_required), so the request schema only refuses characters that cannot be stored (S-1).
import { z } from "zod";
import { freeText, INVALID_CHARACTER_CODE, hasInvalidCharacter, timestamp, uuid, version } from "./common.ts";
import { partyCode } from "./groups.ts";
import { businessDate } from "./kpi.ts";

export const approvalStatus = z.enum(["pending", "changes_requested", "deferred", "approved", "rejected", "withdrawn"]);
export const approvalOutcome = z.enum(["approve", "reject", "request_changes", "defer"]);
export const approvalSlaType = z.enum(["working_days", "next_steerco_or_urgent", "release_plan"]);
export const approvalDueUnknownReason = z.enum([
  "no_steerco_scheduled",
  "no_release_date",
  "calendar_not_configured",
  "no_sla",
]);
export const approvalRoutingError = z.enum(["no_next_authority", "party_unmapped", "party_not_approver"]);

export const approvalParty = z.strictObject({ partyCode, userId: uuid.nullable(), groupId: uuid.nullable() });
export type ApprovalParty = z.infer<typeof approvalParty>;

export const approvalDecisionEntry = z.strictObject({
  id: uuid,
  roundNo: z.number().int().min(1),
  outcome: approvalOutcome,
  rationale: z.string(),
  comments: z.string().nullable(),
  subjectVersion: version,
  decidedBy: uuid,
  onBehalfOfUserId: uuid.nullable(),
  decidedAt: timestamp,
  businessDate,
  deferUntil: businessDate.nullable(),
});
export type ApprovalDecisionEntry = z.infer<typeof approvalDecisionEntry>;

export const approvalEscalation = z.strictObject({
  id: uuid,
  roundNo: z.number().int().min(1),
  dueDate: businessDate,
  level: z.number().int().min(1).max(5),
  fromPartyCode: partyCode,
  toPartyCode: z.string().nullable(),
  toUserId: uuid.nullable(),
  toGroupId: uuid.nullable(),
  routingError: approvalRoutingError.nullable(),
  escalatedAt: timestamp,
});
export type ApprovalEscalation = z.infer<typeof approvalEscalation>;

export const approval = z.strictObject({
  id: uuid,
  transformationId: uuid,
  approvalType: z.string(),
  subjectType: z.string(),
  subjectId: uuid,
  subjectVersion: version,
  roundNo: z.number().int().min(1),
  decisionRightId: uuid.nullable(),
  title: z.string(),
  requestNote: z.string().nullable(),
  requestedBy: uuid,
  requestedAt: timestamp,
  requestBusinessDate: businessDate,
  assignee: approvalParty,
  slaType: approvalSlaType.nullable(),
  urgentReason: z.string().nullable(),
  /** null = Unknown (see dueUnknownReason); never shown as a date or as on time. */
  dueDate: businessDate.nullable(),
  dueUnknownReason: approvalDueUnknownReason.nullable(),
  calendarId: uuid.nullable(),
  status: approvalStatus,
  escalationLevel: z.number().int().min(0).max(5),
  escalatedTo: approvalParty.nullable(),
  decidedBy: uuid.nullable(),
  decidedOnBehalfOf: uuid.nullable(),
  decidedAt: timestamp.nullable(),
  decisions: z.array(approvalDecisionEntry),
  escalations: z.array(approvalEscalation),
  version,
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type Approval = z.infer<typeof approval>;
export const approvalPage = z.strictObject({ items: z.array(approval), nextCursor: z.string().nullable() });

export const approvalRequestCreate = z.strictObject({
  approvalType: z.enum(["decision_request"]),
  subjectId: uuid,
  subjectVersion: version,
  decisionRightId: uuid,
  title: freeText(1, 300),
  requestNote: freeText(1, 4000).optional(),
  urgent: z.boolean().default(false),
  urgentReason: freeText(1, 2000).optional(),
  releaseMilestoneId: uuid.optional(),
});
export type ApprovalRequestCreate = z.infer<typeof approvalRequestCreate>;

export const approvalDecisionCreate = z.strictObject({
  outcome: approvalOutcome,
  /** Required; blank text is 422 approval.rationale_required (the API's `hasText` check). */
  rationale: z
    .string()
    .max(8000)
    .refine((v) => !hasInvalidCharacter(v), INVALID_CHARACTER_CODE),
  comments: freeText(1, 8000).optional(),
  subjectVersion: version,
  deferUntil: businessDate.optional(),
  onBehalfOfUserId: uuid.optional(),
});
export type ApprovalDecisionCreate = z.infer<typeof approvalDecisionCreate>;

export const approvalResubmit = z.strictObject({ subjectVersion: version, requestNote: freeText(1, 4000).optional() });
export type ApprovalResubmit = z.infer<typeof approvalResubmit>;

export const approvalDecisionRecord = z.strictObject({
  source: z.enum(["approval", "gate_decision", "funding_decision"]),
  recordId: uuid,
  approvalKind: z.string(),
  subjectType: z.string(),
  subjectId: uuid,
  subjectVersion: z.number().int().nullable(),
  outcome: z.enum(["approved", "rejected", "changes_requested", "deferred", "revoked"]),
  rationale: z.string(),
  decidedBy: uuid,
  onBehalfOfUserId: uuid.nullable(),
  decidedAt: timestamp,
});
export type ApprovalDecisionRecord = z.infer<typeof approvalDecisionRecord>;
export const approvalDecisionRecordPage = z.strictObject({
  items: z.array(approvalDecisionRecord),
  nextCursor: z.string().nullable(),
});

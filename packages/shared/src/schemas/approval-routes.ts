// Sequential and parallel approval routes and the tracked conditions of a conditional approval (ADR-0044 §3, §4;
// REQ-S10-015, REQ-S04-011; OpenAPI tags `approval-routes`, `gate-conditions`; T-DG5-BE-K): the request bodies and the
// response mirrors the contract test parses every success body with. The OpenAPI file is the source of truth.
// A route step and a condition closure are human actions inside the product (business approvals and their follow-up);
// nothing here decides anything, and nothing touches the engineering gates DG0-DG7.
import { z } from "zod";
import { freeText, roleCode, timestamp, uuid, version } from "./common.ts";

const businessDate = z.iso.date();

// ------------------------------------------------------------------------------------------------ approval routes

export const APPROVAL_ROUTE_MODES = ["sequential", "parallel"] as const;
export const APPROVAL_ROUTE_STEP_STATUSES = [
  "waiting",
  "active",
  "approved",
  "rejected",
  "changes_requested",
  "cancelled",
] as const;
export type ApprovalRouteStepStatus = (typeof APPROVAL_ROUTE_STEP_STATUSES)[number];
export const APPROVAL_ROUTE_STEP_OUTCOMES = ["approve", "reject", "request_changes"] as const;

/** One resolved route of a published methodology version (`ApprovalRouteDefinition`). */
export const approvalRouteDefinition = z.strictObject({
  routeKey: z.string(),
  mode: z.enum(["any", "sequential", "parallel"]),
  roleCodes: z.array(roleCode).min(1).max(6),
  source: z.enum(["approver_route", "procedure"]),
  labelEn: z.string().nullable(),
  labelAr: z.string().nullable(),
});
export type ApprovalRouteDefinition = z.infer<typeof approvalRouteDefinition>;

export const approvalRouteDefinitionList = z.strictObject({
  methodologyVersionId: uuid,
  items: z.array(approvalRouteDefinition),
});
export type ApprovalRouteDefinitionList = z.infer<typeof approvalRouteDefinitionList>;

/** One step of an approval round (`ApprovalRouteStep`). */
export const approvalRouteStep = z.strictObject({
  stepNo: z.number().int().min(1).max(6),
  roundNo: z.number().int().min(1),
  approverRoleCode: roleCode,
  assigneeUserId: uuid.nullable(),
  status: z.enum(APPROVAL_ROUTE_STEP_STATUSES),
  activatedAt: timestamp.nullable(),
  decidedBy: uuid.nullable(),
  decidedOnBehalfOf: uuid.nullable(),
  decidedAt: timestamp.nullable(),
  decisionNote: z.string().nullable(),
});
export type ApprovalRouteStep = z.infer<typeof approvalRouteStep>;

/** The route of one approval (`ApprovalRoute`); routed = false is a DG4 single-step approval without steps. */
export const approvalRoute = z.strictObject({
  approvalId: uuid,
  routed: z.boolean(),
  routeKey: z.string().nullable(),
  mode: z.enum(APPROVAL_ROUTE_MODES).nullable(),
  currentRoundNo: z.number().int().min(1),
  steps: z.array(approvalRouteStep),
  approvalStatus: z.string(),
  approvalVersion: version,
});
export type ApprovalRoute = z.infer<typeof approvalRoute>;

/** The body of POST /approvals/{approvalId}/route/steps/{stepNo}/decision (`ApprovalRouteStepDecision`). */
export const approvalRouteStepDecision = z.strictObject({
  outcome: z.enum(APPROVAL_ROUTE_STEP_OUTCOMES),
  note: freeText(3, 4000).optional(),
});
export type ApprovalRouteStepDecisionBody = z.infer<typeof approvalRouteStepDecision>;

// ------------------------------------------------------------------------------------------------ gate conditions

export const GATE_CONDITION_STATUSES = ["open", "overdue", "closed"] as const;
export type GateConditionStatus = (typeof GATE_CONDITION_STATUSES)[number];

/** One condition of a conditional approval with its derived status, closure and escalation (`TrackedGateCondition`). */
export const trackedGateCondition = z.strictObject({
  id: uuid,
  gateDecisionId: uuid,
  gateCode: z.string(),
  ordinal: z.number().int(),
  conditionText: z.string(),
  ownerUserId: uuid,
  dueDate: businessDate,
  status: z.enum(GATE_CONDITION_STATUSES),
  closedAt: timestamp.nullable(),
  closedBy: uuid.nullable(),
  closureNote: z.string().nullable(),
  evidenceId: uuid.nullable(),
  escalatedAt: timestamp.nullable(),
  escalatedToUserId: uuid.nullable(),
});
export type TrackedGateCondition = z.infer<typeof trackedGateCondition>;

export const trackedGateConditionPage = z.strictObject({
  items: z.array(trackedGateCondition),
  nextCursor: z.string().nullable(),
});

/** The body of POST /transformations/{id}/gate-conditions/{conditionId}/close (`GateConditionClose`). */
export const gateConditionClose = z.strictObject({
  note: freeText(3, 2000),
  evidenceId: uuid.optional(),
});
export type GateConditionCloseBody = z.infer<typeof gateConditionClose>;

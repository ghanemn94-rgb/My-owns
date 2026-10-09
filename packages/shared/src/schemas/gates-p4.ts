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

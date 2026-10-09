// zod mirrors of the P4 T11 decision rights, T12 RACI, governance matrices and Transform readiness (OpenAPI tags
// "decision-rights" and "raci"; ADR-0026 §5, §7, §9; REQ-PB-008, REQ-PB-065, REQ-PB-066, REQ-PB-067, REQ-S10-007,
// REQ-S10-009; T-DG4-BE-C). The seeded T11/T12 rows are the playbook's (B0099, B0101), English verbatim, Arabic
// PROVISIONAL. A matrix approval is a BUSINESS approval inside the product, decided by the Sponsor-mapped person; nothing
// here relates to the engineering gates DG0-DG7.
import { z } from "zod";
import { freeText, timestamp, uuid, version } from "./common.ts";
import { partyCode } from "./groups.ts";
import { businessDate } from "./kpi.ts";

export const slaType = z.enum(["working_days", "next_steerco_or_urgent", "release_plan"]);
export type SlaType = z.infer<typeof slaType>;
export const raciValue = z.enum(["A", "R", "C", "I", "A/R"]);
export const RACI_VALUES: readonly string[] = raciValue.options;
export const governanceMatrixKind = z.enum(["decision_rights", "raci"]);
export type GovernanceMatrixKind = z.infer<typeof governanceMatrixKind>;
/** The T12 columns of B0101 in source order (Sponsor, Transformation Lead, Business Owner, Workstream Lead, Finance, Tech/Data). */
export const RACI_TEMPLATE_PARTIES = ["SP", "TL", "BO", "WL", "FIN", "TD"] as const;
/** The four seeded T11 rows of B0099. */
export const SEEDED_DECISION_RIGHT_KEYS = [
  "business_scope_change",
  "funding_reallocation",
  "target_state_design",
  "go_live_scale",
] as const;

/** A free-text label (OpenAPI LocalizedLabel, 1..300; the shared S-1 rules). */
const label = freeText(1, 300);
const workingDays = z.number().int();
const partyList = z.array(partyCode).max(10);
const escalationChain = z.array(partyCode).min(1).max(5);

export const decisionRightTemplate = z.strictObject({
  key: z.string(),
  ordinal: z.number().int().min(1),
  sourceDecisionEn: z.string(),
  sourceRecommendEn: z.string(),
  sourceApproveEn: z.string(),
  sourceConsultEn: z.string(),
  sourceInformEn: z.string(),
  sourceSlaEn: z.string(),
  decisionAr: z.string(),
  recommendAr: z.string(),
  approveAr: z.string(),
  consultAr: z.string(),
  informAr: z.string(),
  slaAr: z.string(),
  recommendParties: z.array(partyCode),
  approvePartyCode: partyCode,
  consultParties: z.array(partyCode),
  informParties: z.array(partyCode),
  slaType,
  slaWorkingDays: z.number().int().nullable(),
  escalationChain: z.array(partyCode),
  sourceRef: z.string(),
});
export type DecisionRightTemplate = z.infer<typeof decisionRightTemplate>;
export const decisionRightTemplateList = z.strictObject({ items: z.array(decisionRightTemplate) });

export const decisionRight = z.strictObject({
  id: uuid,
  transformationId: uuid,
  templateKey: z.string().nullable(),
  ordinal: z.number().int().min(1).max(999),
  decisionEn: z.string().min(1).max(300),
  decisionAr: z.string().min(1).max(300),
  recommendLabel: z.string().min(1).max(300),
  approveLabel: z.string().min(1).max(300),
  consultLabel: z.string().min(1).max(300),
  informLabel: z.string().min(1).max(300),
  slaLabel: z.string().min(1).max(300),
  recommendParties: z.array(partyCode),
  approvePartyCode: partyCode,
  consultParties: z.array(partyCode),
  informParties: z.array(partyCode),
  slaType,
  slaWorkingDays: z.number().int().nullable(),
  urgentWorkingDays: z.number().int().nullable(),
  escalationChain,
  status: z.enum(["active", "retired"]),
  version,
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type DecisionRight = z.infer<typeof decisionRight>;
export const decisionRightPage = z.strictObject({ items: z.array(decisionRight), nextCursor: z.string().nullable() });

export const decisionRightCreate = z.strictObject({
  ordinal: z.number().int().min(1).max(999).optional(),
  decisionEn: label,
  decisionAr: label,
  recommendLabel: label,
  approveLabel: label,
  consultLabel: label,
  informLabel: label,
  slaLabel: label,
  recommendParties: partyList.optional(),
  approvePartyCode: partyCode,
  consultParties: partyList.optional(),
  informParties: partyList.optional(),
  slaType,
  /** 1..250 for working_days only (422 decision_right.sla_invalid otherwise; a business rule, not a 400). */
  slaWorkingDays: workingDays.optional(),
  /** 1..250 on next_steerco_or_urgent only (the urgent route). */
  urgentWorkingDays: workingDays.optional(),
  escalationChain,
});
export type DecisionRightCreate = z.infer<typeof decisionRightCreate>;

export const decisionRightUpdate = z
  .strictObject({
    ordinal: z.number().int().min(1).max(999).optional(),
    decisionEn: label.optional(),
    decisionAr: label.optional(),
    recommendLabel: label.optional(),
    approveLabel: label.optional(),
    consultLabel: label.optional(),
    informLabel: label.optional(),
    slaLabel: label.optional(),
    recommendParties: partyList.optional(),
    approvePartyCode: partyCode.optional(),
    consultParties: partyList.optional(),
    informParties: partyList.optional(),
    slaType: slaType.optional(),
    slaWorkingDays: workingDays.nullable().optional(),
    urgentWorkingDays: workingDays.nullable().optional(),
    escalationChain: escalationChain.optional(),
    status: z.enum(["active", "retired"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "validation.empty_patch");
export type DecisionRightUpdate = z.infer<typeof decisionRightUpdate>;

export const dueDateUnknownReason = z.enum(["no_steerco_scheduled", "no_release_date", "calendar_not_configured"]);
export const dueDatePreview = z.strictObject({
  decisionRightId: uuid,
  slaType,
  raisedOn: businessDate,
  /** null = Unknown (see unknownReason); never a guessed date. */
  dueDate: businessDate.nullable(),
  unknownReason: dueDateUnknownReason.nullable(),
  calendarId: uuid.nullable(),
  calendarVersion: z.number().int().nullable(),
});
export type DueDatePreview = z.infer<typeof dueDatePreview>;
export const dueDatePreviewQuery = z.strictObject({
  raisedOn: businessDate,
  urgent: z.stringbool({ truthy: ["true"], falsy: ["false"] }).default(false),
  releaseMilestoneId: uuid.optional(),
});

/** A cell: A, R, C, I, A/R or null. Any other short value (e.g. X) is the 422 business rule raci.invalid_value. */
export const raciCell = z.strictObject({ partyCode, value: z.string().max(3).nullable() });
export type RaciCell = z.infer<typeof raciCell>;
const raciCells = z
  .array(raciCell)
  .min(1)
  .max(20)
  .refine((cells) => new Set(cells.map((c) => c.partyCode)).size === cells.length, "validation.duplicate_party");

export const raciTemplate = z.strictObject({
  parties: z.array(partyCode),
  deliverables: z.array(
    z.strictObject({
      key: z.string(),
      ordinal: z.number().int().min(1),
      sourceDeliverableEn: z.string(),
      deliverableAr: z.string(),
      sourceRef: z.string(),
      cells: z.array(raciCell),
    }),
  ),
});
export type RaciTemplate = z.infer<typeof raciTemplate>;

export const raciDeliverable = z.strictObject({
  id: uuid,
  transformationId: uuid,
  templateKey: z.string().nullable(),
  ordinal: z.number().int().min(1).max(999),
  labelEn: z.string().min(1).max(300),
  labelAr: z.string().min(1).max(300),
  accountabilityException: z.string().nullable(),
  status: z.enum(["active", "retired"]),
  cells: z.array(raciCell),
  version,
  updatedAt: timestamp,
});
export type RaciDeliverable = z.infer<typeof raciDeliverable>;

export const raciDeliverableCreate = z.strictObject({
  ordinal: z.number().int().min(1).max(999).optional(),
  labelEn: label,
  labelAr: label,
  accountabilityException: freeText(10, 2000).optional(),
  cells: raciCells,
});
export type RaciDeliverableCreate = z.infer<typeof raciDeliverableCreate>;

export const raciDeliverableUpdate = z
  .strictObject({
    ordinal: z.number().int().min(1).max(999).optional(),
    labelEn: label.optional(),
    labelAr: label.optional(),
    accountabilityException: freeText(10, 2000).nullable().optional(),
    status: z.enum(["active", "retired"]).optional(),
    cells: raciCells.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "validation.empty_patch");
export type RaciDeliverableUpdate = z.infer<typeof raciDeliverableUpdate>;

export const governanceMatrix = z.strictObject({
  id: uuid,
  transformationId: uuid,
  kind: governanceMatrixKind,
  status: z.enum(["draft", "in_approval", "approved"]),
  approvedVersion: z.number().int().nullable(),
  approvedAt: timestamp.nullable(),
  approvedBy: uuid.nullable(),
  openApprovalId: uuid.nullable(),
  version,
  updatedAt: timestamp,
});
export type GovernanceMatrix = z.infer<typeof governanceMatrix>;
export const governanceMatrixList = z.strictObject({ items: z.array(governanceMatrix) });

export const raci = z.strictObject({
  transformationId: uuid,
  matrix: governanceMatrix,
  parties: z.array(partyCode),
  deliverables: z.array(raciDeliverable),
});
export type Raci = z.infer<typeof raci>;

export const governanceMatrixSubmit = z.strictObject({
  title: freeText(1, 300),
  requestNote: freeText(1, 4000).optional(),
});
export type GovernanceMatrixSubmit = z.infer<typeof governanceMatrixSubmit>;

export const transformReadinessCheckCode = z.enum([
  "charter_decision_rights",
  "t11_seeded_decisions",
  "t11_approvers_mapped",
  "t12_accountable",
]);
export const transformReadiness = z.strictObject({
  transformationId: uuid,
  phase: z.literal("transform"),
  status: z.enum(["ready", "not_ready"]),
  checks: z.array(
    z.strictObject({ code: transformReadinessCheckCode, passed: z.boolean(), missing: z.array(z.string()) }),
  ),
});
export type TransformReadiness = z.infer<typeof transformReadiness>;

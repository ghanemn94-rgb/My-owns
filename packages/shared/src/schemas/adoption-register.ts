// P4 slice F mirrors of the T13 Stakeholder & Adoption Plan, champions, adoption interventions, impacted-team
// involvement and champion constraints (backend-workflow-engineer, T-DG4-BE-H; ADR-0033 §4, §7, §9, §10; OpenAPI
// 1.3.0-p4 StakeholderGroup*, AdoptionPlan*, StakeholderChampion*, AdoptionIntervention*, StakeholderInvolvement*,
// ChampionConstraint*, AdoptionReason). REQ-PB-070, REQ-PB-073, REQ-S11-001, REQ-S16-020 (StakeholderGroup,
// AdoptionIntervention).
//
// - The T13 value lists are closed (B0107): Impact and Influence H/M/L, Current stance Support/Neutral/Resist,
//   Intervention Comms/training/involvement/incentive. A value outside them is 400 with the ADR-0033 §10 code at its
//   pointer; the enums below carry the code as their message, and the API replaces it with the exact English text.
// - Free text goes through the shared `freeText` rules (S-1). Nothing here is a business approval.
import { z } from "zod";
import { freeText, page, timestamp, uuid, version } from "./common.ts";
import { businessDate } from "./kpi.ts";

const nullableUuid = uuid.nullable();
const nullableTimestamp = timestamp.nullable();

/** ADR-0033 §10 codes of the closed T13 value lists (S-11). */
export const STAKEHOLDER_STANCE_INVALID_CODE = "stakeholder_group.stance_invalid";
export const STAKEHOLDER_IMPACT_INVALID_CODE = "stakeholder_group.impact_invalid";
export const STAKEHOLDER_INTERVENTION_INVALID_CODE = "stakeholder_group.intervention_invalid";

export const STAKEHOLDER_LEVELS = ["H", "M", "L"] as const;
export const STAKEHOLDER_STANCES = ["support", "neutral", "resist"] as const;
export const STAKEHOLDER_INTERVENTION_TYPES = ["comms", "training", "involvement", "incentive"] as const;
export const ADOPTION_INTERVENTION_TYPES = [...STAKEHOLDER_INTERVENTION_TYPES, "corrective"] as const;
export const ADOPTION_INTERVENTION_STATUSES = ["planned", "in_progress", "done", "cancelled"] as const;
export const ADOPTION_INTERVENTION_ORIGINS = ["manual", "below_trajectory"] as const;
export const CHAMPION_CONSTRAINT_STATUSES = ["open", "addressed", "withdrawn"] as const;

export const stakeholderLevel = z.enum(STAKEHOLDER_LEVELS, { error: STAKEHOLDER_IMPACT_INVALID_CODE });
export const stakeholderStance = z.enum(STAKEHOLDER_STANCES, { error: STAKEHOLDER_STANCE_INVALID_CODE });
export const stakeholderInterventionType = z.enum(STAKEHOLDER_INTERVENTION_TYPES, {
  error: STAKEHOLDER_INTERVENTION_INVALID_CODE,
});

const interventionTypes = z
  .array(stakeholderInterventionType)
  .min(1)
  .max(4)
  .refine((v) => new Set(v).size === v.length, "validation.unique_items");

/** OpenAPI `AdoptionReason` (3-1000 characters, shared free-text rules). */
export const adoptionReason = z.strictObject({ reason: freeText(3, 1000) });
export type AdoptionReason = z.infer<typeof adoptionReason>;

// ------------------------------------------------------------------------------------------------ stakeholder groups

/** OpenAPI `StakeholderGroup`: one T13 row (B0107) with influence and impact as two separate columns (M0215). */
export const stakeholderGroup = z.strictObject({
  id: uuid,
  transformationId: uuid,
  code: z.string().regex(/^SG-[0-9]{2,6}$/),
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(4000).nullable(),
  influence: z.enum(STAKEHOLDER_LEVELS).nullable(),
  impact: z.enum(STAKEHOLDER_LEVELS),
  currentStance: z.enum(STAKEHOLDER_STANCES),
  requiredBehavior: z.string().min(1).max(2000),
  interventionTypes: z.array(z.enum(STAKEHOLDER_INTERVENTION_TYPES)).min(1).max(4),
  interventionPlan: z.string().min(1).max(8000).nullable(),
  ownerUserId: uuid,
  adoptionKpiDefinitionId: nullableUuid,
  headcount: z.number().int().min(1).max(10_000_000).nullable(),
  championCount: z.number().int().min(0),
  openInterventionCount: z.number().int().min(0),
  status: z.enum(["active", "archived"]),
  archivedAt: nullableTimestamp,
  archiveReason: z.string().min(1).max(1000).nullable(),
  version,
  createdAt: timestamp,
  createdBy: nullableUuid,
  updatedAt: timestamp,
  updatedBy: nullableUuid,
});
export type StakeholderGroup = z.infer<typeof stakeholderGroup>;
export const stakeholderGroupPage = page(stakeholderGroup);

const headcount = z.number().int().min(1).max(10_000_000);

/** OpenAPI `StakeholderGroupCreate`. */
export const stakeholderGroupCreate = z.strictObject({
  name: freeText(1, 200),
  description: freeText(1, 4000).nullable().optional(),
  influence: stakeholderLevel.nullable().optional(),
  impact: stakeholderLevel,
  currentStance: stakeholderStance,
  requiredBehavior: freeText(1, 2000),
  interventionTypes,
  interventionPlan: freeText(1, 8000).nullable().optional(),
  ownerUserId: uuid,
  adoptionKpiDefinitionId: nullableUuid.optional(),
  headcount: headcount.nullable().optional(),
});
export type StakeholderGroupCreate = z.infer<typeof stakeholderGroupCreate>;

/** OpenAPI `StakeholderGroupUpdate` (minProperties 1). */
export const stakeholderGroupUpdate = z
  .strictObject({
    name: freeText(1, 200).optional(),
    description: freeText(1, 4000).nullable().optional(),
    influence: stakeholderLevel.nullable().optional(),
    impact: stakeholderLevel.optional(),
    currentStance: stakeholderStance.optional(),
    requiredBehavior: freeText(1, 2000).optional(),
    interventionTypes: interventionTypes.optional(),
    interventionPlan: freeText(1, 8000).nullable().optional(),
    ownerUserId: uuid.optional(),
    adoptionKpiDefinitionId: nullableUuid.optional(),
    headcount: headcount.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length >= 1, "validation.min_properties");
export type StakeholderGroupUpdate = z.infer<typeof stakeholderGroupUpdate>;

/** OpenAPI `AdoptionPlanRow`: the seven B0107 columns plus influence and counts. */
export const adoptionPlanRow = z.strictObject({
  stakeholderGroupId: uuid,
  code: z.string(),
  stakeholder: z.string(),
  impact: z.enum(STAKEHOLDER_LEVELS),
  influence: z.enum(STAKEHOLDER_LEVELS).nullable(),
  currentStance: z.enum(STAKEHOLDER_STANCES),
  requiredBehavior: z.string(),
  intervention: z.array(z.enum(STAKEHOLDER_INTERVENTION_TYPES)),
  ownerUserId: uuid,
  adoptionKpiDefinitionId: nullableUuid,
  adoptionKpiName: z.string().nullable(),
  championCount: z.number().int().min(0),
  openInterventionCount: z.number().int().min(0),
  openChampionConstraintCount: z.number().int().min(0),
});
export type AdoptionPlanRow = z.infer<typeof adoptionPlanRow>;

/** OpenAPI `AdoptionPlan`: Template 13 of a transformation. */
export const adoptionPlan = z.strictObject({ transformationId: uuid, rows: z.array(adoptionPlanRow) });
export type AdoptionPlan = z.infer<typeof adoptionPlan>;

// ------------------------------------------------------------------------------------------------ champions

/** OpenAPI `StakeholderChampion`. */
export const stakeholderChampion = z.strictObject({
  id: uuid,
  transformationId: uuid,
  stakeholderGroupId: uuid,
  userId: uuid,
  note: z.string().min(1).max(1000).nullable(),
  status: z.enum(["active", "removed"]),
  removedAt: nullableTimestamp,
  removedBy: nullableUuid,
  version,
  createdAt: timestamp,
  createdBy: nullableUuid,
  updatedAt: timestamp,
  updatedBy: nullableUuid,
});
export type StakeholderChampion = z.infer<typeof stakeholderChampion>;
export const stakeholderChampionPage = page(stakeholderChampion);

/** OpenAPI `StakeholderChampionCreate`. */
export const stakeholderChampionCreate = z.strictObject({
  userId: uuid,
  note: freeText(1, 1000).nullable().optional(),
});
export type StakeholderChampionCreate = z.infer<typeof stakeholderChampionCreate>;

// ------------------------------------------------------------------------------------------------ interventions

/**
 * OpenAPI `AdoptionIntervention`. A worker (below-trajectory) intervention without a resolved owner shows
 * `ownerStatus: "unassigned"`; a null due date is Unknown with `dueUnknownReason` (ADR-0033 §4, §12).
 */
export const adoptionIntervention = z.strictObject({
  id: uuid,
  transformationId: uuid,
  code: z.string(),
  stakeholderGroupId: nullableUuid,
  interventionType: z.enum(ADOPTION_INTERVENTION_TYPES),
  title: z.string().min(1).max(500),
  description: z.string().min(1).max(8000).nullable(),
  ownerUserId: nullableUuid,
  ownerStatus: z.enum(["assigned", "unassigned"]),
  dueDate: businessDate.nullable(),
  dueUnknownReason: z.enum(["calendar_not_configured"]).nullable(),
  status: z.enum(ADOPTION_INTERVENTION_STATUSES),
  origin: z.enum(ADOPTION_INTERVENTION_ORIGINS),
  metricLinkId: nullableUuid,
  kpiEvaluationId: nullableUuid,
  reportingPeriodId: nullableUuid,
  scopeKind: z.enum(["transformation", "business_unit", "initiative"]).nullable(),
  scopeId: nullableUuid,
  outcomeNote: z.string().min(1).max(2000).nullable(),
  completedAt: nullableTimestamp,
  completedBy: nullableUuid,
  createdSource: z.enum(["api", "worker"]),
  version,
  createdAt: timestamp,
  createdBy: nullableUuid,
  updatedAt: timestamp,
  updatedBy: nullableUuid,
});
export type AdoptionIntervention = z.infer<typeof adoptionIntervention>;
export const adoptionInterventionPage = page(adoptionIntervention);

/** OpenAPI `AdoptionInterventionCreate`: a person's plan, with owner and due date (never `corrective`). */
export const adoptionInterventionCreate = z.strictObject({
  stakeholderGroupId: nullableUuid.optional(),
  interventionType: z.enum(STAKEHOLDER_INTERVENTION_TYPES),
  title: freeText(1, 500),
  description: freeText(1, 8000).nullable().optional(),
  ownerUserId: uuid,
  dueDate: businessDate,
});
export type AdoptionInterventionCreate = z.infer<typeof adoptionInterventionCreate>;

/** OpenAPI `AdoptionInterventionUpdate` (minProperties 1). */
export const adoptionInterventionUpdate = z
  .strictObject({
    title: freeText(1, 500).optional(),
    description: freeText(1, 8000).nullable().optional(),
    ownerUserId: uuid.optional(),
    dueDate: businessDate.optional(),
    status: z.enum(["in_progress", "done", "cancelled"]).optional(),
    outcomeNote: freeText(3, 2000).optional(),
  })
  .refine((v) => Object.keys(v).length >= 1, "validation.min_properties");
export type AdoptionInterventionUpdate = z.infer<typeof adoptionInterventionUpdate>;

// ------------------------------------------------------------------------------------------------ involvement

/**
 * OpenAPI `StakeholderInvolvement`: one append-only row. `withdrawn` is true for an original row that a withdrawal
 * names, and for the withdrawal row itself (neither counts as involvement any more; the history stays listed).
 */
export const stakeholderInvolvement = z.strictObject({
  id: uuid,
  transformationId: uuid,
  stakeholderGroupId: uuid,
  involvementKind: z.enum(["workshop", "decision"]),
  workshopId: nullableUuid,
  decisionId: nullableUuid,
  note: z.string().min(1).max(2000).nullable(),
  withdrawsInvolvementId: nullableUuid,
  withdrawn: z.boolean(),
  createdAt: timestamp,
  createdBy: uuid,
});
export type StakeholderInvolvement = z.infer<typeof stakeholderInvolvement>;
export const stakeholderInvolvementPage = page(stakeholderInvolvement);

/** OpenAPI `StakeholderInvolvementCreate`: exactly one of workshopId and decisionId (checked by the API, 422). */
export const stakeholderInvolvementCreate = z.strictObject({
  stakeholderGroupId: uuid,
  workshopId: uuid.optional(),
  decisionId: uuid.optional(),
  note: freeText(1, 2000).optional(),
});
export type StakeholderInvolvementCreate = z.infer<typeof stakeholderInvolvementCreate>;

// ------------------------------------------------------------------------------------------------ champion constraints

/** OpenAPI `ChampionConstraint`: a champion's constraint on a T04 design decision (REQ-PB-073). */
export const championConstraint = z.strictObject({
  id: uuid,
  transformationId: uuid,
  championId: uuid,
  stakeholderGroupId: uuid,
  decisionId: uuid,
  decisionCode: z.string(),
  constraintText: z.string().min(3).max(4000),
  status: z.enum(CHAMPION_CONSTRAINT_STATUSES),
  responseText: z.string().min(1).max(4000).nullable(),
  resolvedAt: nullableTimestamp,
  resolvedBy: nullableUuid,
  version,
  createdAt: timestamp,
  createdBy: nullableUuid,
  updatedAt: timestamp,
  updatedBy: nullableUuid,
});
export type ChampionConstraint = z.infer<typeof championConstraint>;
export const championConstraintPage = page(championConstraint);

/** OpenAPI `ChampionConstraintCreate`. */
export const championConstraintCreate = z.strictObject({
  championId: uuid,
  decisionId: uuid,
  constraintText: freeText(3, 4000),
});
export type ChampionConstraintCreate = z.infer<typeof championConstraintCreate>;

/** OpenAPI `ChampionConstraintResolve`: responseText exactly when the outcome is `addressed`. */
export const championConstraintResolve = z
  .strictObject({
    outcome: z.enum(["addressed", "withdrawn"]),
    responseText: freeText(3, 4000).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.outcome === "addressed" && v.responseText === undefined)
      ctx.addIssue({ code: "custom", path: ["responseText"], message: "validation.required" });
    if (v.outcome === "withdrawn" && v.responseText !== undefined)
      ctx.addIssue({ code: "custom", path: ["responseText"], message: "validation.not_applicable" });
  });
export type ChampionConstraintResolve = z.infer<typeof championConstraintResolve>;

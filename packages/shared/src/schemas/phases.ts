// P4 slice H mirrors of BE-L2 (backend-workflow-engineer, T-DG4-BE-L2; p4-work-split §H H.4; ADR-0035 §1, §7 item 3,
// §8, §11; OpenAPI 1.3.0-p4 PhaseDefinition*, PhaseWorkspace*, PhaseStep*, PhaseStepEvidence*). REQ-PB-014, REQ-S04-001.
//
// - The six phases are a read-only catalogue (phase_definition, 0051): source* texts are verbatim from the playbook
//   (B0021 name, purpose and key outputs; the phase titles and "Objective:" sentences); Arabic is provisional.
// - A phase step of a transformation with no row yet is shown with version 0, status not_started and a null owner
//   (rendered "Unknown"), never as complete.
// - Steps never move a product gate: G1-G6 are business approvals decided by people; nothing here touches DG0-DG7.
import { z } from "zod";
import { freeText, phase, timestamp, uuid, version } from "./common.ts";

const nullableUuid = uuid.nullable();

/** `<phase>.<name>` (phase_step_definition.key CHECK; OpenAPI StepKey). */
export const phaseStepKey = z.string().regex(/^(diagnose|define|design|mobilize|transform|realize)\.[a-z_]{1,48}$/);

export const PHASE_STEP_STATUSES = ["not_started", "in_progress", "in_review", "complete", "returned"] as const;
export const phaseStepStatus = z.enum(PHASE_STEP_STATUSES);
export type PhaseStepStatus = z.infer<typeof phaseStepStatus>;

/** The completion rules of ADR-0035 §1 (phase_step_definition.completion_rule CHECK). */
export const PHASE_COMPLETION_RULES = [
  "evidence_linked",
  "meeting_held",
  "kpi_actual_accepted",
  "raid_register_present",
  "benefit_validated",
  "corrective_cases_owned",
  "handover_accepted",
  "improvement_backlog_present",
] as const;
export const phaseCompletionRule = z.enum(PHASE_COMPLETION_RULES);
export type PhaseCompletionRule = z.infer<typeof phaseCompletionRule>;

export const GATE_INSTANCE_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "changes_requested",
  "approved",
  "rejected",
  "deferred",
] as const;

// ------------------------------------------------------------------------------------------------ catalogue

export const phaseDefinition = z.strictObject({
  code: phase,
  ordinal: z.number().int().min(1).max(6),
  gateCode: z.string().regex(/^G[1-6]$/),
  sourceNameEn: z.string().min(1).max(50),
  nameAr: z.string().min(1).max(100),
  sourceTitleEn: z.string().min(1).max(200),
  titleAr: z.string().min(1).max(200),
  sourcePurposeEn: z.string().min(1).max(200),
  purposeAr: z.string().min(1).max(200),
  sourceKeyOutputsEn: z.string().min(1).max(500),
  keyOutputsAr: z.string().min(1).max(500),
  sourceObjectiveEn: z.string().min(1).max(1000),
  objectiveAr: z.string().min(1).max(1000),
  sourceRef: z.string().min(1).max(100),
  arProvisional: z.boolean(),
});
export type PhaseDefinition = z.infer<typeof phaseDefinition>;

export const phaseDefinitionList = z.strictObject({ items: z.array(phaseDefinition).length(6) });
export type PhaseDefinitionList = z.infer<typeof phaseDefinitionList>;

// ------------------------------------------------------------------------------------------------ steps

/** `{rule, met, facts}` frozen at review request and again at acceptance (phase_step.completion_check). */
export const phaseCompletionCheck = z.record(z.string(), z.unknown());

export const phaseStep = z.strictObject({
  transformationId: uuid,
  stepKey: phaseStepKey,
  phase,
  ordinal: z.number().int().min(1).max(10),
  sourceProcedureEn: z.string().min(1).max(500),
  procedureAr: z.string().min(1).max(500),
  requiredEvidenceEn: z.string().min(1).max(500),
  requiredEvidenceAr: z.string().min(1).max(500),
  defaultOwnerRoleCode: z.string().min(1).max(32),
  reviewerRoleCode: z.string().min(1).max(32),
  completionRule: phaseCompletionRule,
  /** Null while the step has no row (version 0). */
  id: nullableUuid,
  /** Null = Unknown (no owner assigned). */
  ownerUserId: nullableUuid,
  status: phaseStepStatus,
  enabledByGateDecisionId: nullableUuid,
  reviewRequestedBy: nullableUuid,
  reviewRequestedAt: timestamp.nullable(),
  completionCheck: phaseCompletionCheck.nullable(),
  reviewedBy: nullableUuid,
  reviewedAt: timestamp.nullable(),
  reviewOutcome: z.enum(["accepted", "returned"]).nullable(),
  reviewNote: z.string().min(1).max(2000).nullable(),
  completedAt: timestamp.nullable(),
  version: z.number().int().min(0),
});
export type PhaseStep = z.infer<typeof phaseStep>;

export const phaseStepPage = z.strictObject({ items: z.array(phaseStep), nextCursor: z.string().nullable() });
export type PhaseStepPage = z.infer<typeof phaseStepPage>;

/** PATCH body: assign the owner and/or start the step (not_started -> in_progress). At least one member. */
export const phaseStepUpdate = z
  .strictObject({
    ownerUserId: uuid.optional(),
    start: z.literal(true).optional(),
  })
  .refine((v) => v.ownerUserId !== undefined || v.start !== undefined, {
    message: "validation.min_properties",
  });
export type PhaseStepUpdate = z.infer<typeof phaseStepUpdate>;

/** Review body: accept, or return with a note (400 phase_step.return_note_required without one; checked by the API). */
export const phaseStepReview = z.strictObject({
  outcome: z.enum(["accepted", "returned"]),
  note: freeText(1, 2000).optional(),
});
export type PhaseStepReview = z.infer<typeof phaseStepReview>;

// ------------------------------------------------------------------------------------------------ workspace

export const phaseWorkspacePhase = z.strictObject({
  phase: phaseDefinition,
  isCurrent: z.boolean(),
  gateStatus: z.enum(GATE_INSTANCE_STATUSES),
  steps: z.array(phaseStep),
  reviewQueueCount: z.number().int().min(0),
});
export type PhaseWorkspacePhase = z.infer<typeof phaseWorkspacePhase>;

export const phaseWorkspace = z.strictObject({
  transformationId: uuid,
  currentPhase: phase,
  phases: z.array(phaseWorkspacePhase).length(6),
});
export type PhaseWorkspace = z.infer<typeof phaseWorkspace>;

// ------------------------------------------------------------------------------------------------ step evidence

export const phaseStepEvidence = z.strictObject({
  id: uuid,
  transformationId: uuid,
  phaseStepId: uuid,
  evidenceId: uuid,
  status: z.enum(["active", "removed"]),
  removedBy: nullableUuid,
  removedAt: timestamp.nullable(),
  version,
  createdAt: timestamp,
  createdBy: nullableUuid,
  updatedAt: timestamp,
  updatedBy: nullableUuid,
});
export type PhaseStepEvidence = z.infer<typeof phaseStepEvidence>;

export const phaseStepEvidencePage = z.strictObject({
  items: z.array(phaseStepEvidence),
  nextCursor: z.string().nullable(),
});
export type PhaseStepEvidencePage = z.infer<typeof phaseStepEvidencePage>;

export const phaseStepEvidenceLink = z.strictObject({ evidenceId: uuid });
export type PhaseStepEvidenceLink = z.infer<typeof phaseStepEvidenceLink>;

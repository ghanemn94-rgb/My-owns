// P3 portfolio-tag mirrors (backend-workflow-engineer, T-DG3-BE-A; ADR-0021, ADR-0023; docs/architecture/p3-work-split.md
// §2 BE-A). Mirrors the docs/api/openapi.yaml components used by the `portfolio`-tag operations: Initiative*, the
// initiative links (gap, outcome contribution, decision), Deliverable*, Milestone*, PortfolioSelection*,
// FundingDecision*, GateDispensation*, TransformationReadiness (GateReadiness, DiagnosticAreaCoverage),
// OutcomeHierarchy, ScheduleFlag, SelectionRequest, TransitionNote and AcceptanceDecision. Other tasks import these.
//
// Amounts are exact decimal strings (`decimal`), never JSON numbers; Unknown is null, never 0 (ADR-0019). Free text
// goes through `freeText` (visible content, no NUL, no lone surrogates). Product gates G1-G6 are business approvals
// inside the product; a dispensation never creates a gate decision and nothing here touches DG0-DG7.
import { z } from "zod";
import { currency, freeText, roleCode, timestamp, uuid, version } from "./common.ts";
import { northStar, outcome } from "./direction.ts";
import { GATE_STATUSES } from "./gate.ts";
import { businessDate, decimal } from "./kpi.ts";
import { warning } from "./methodology.ts";

const nullableUuid = uuid.nullable();
const nullableDate = businessDate.nullable();
const nullableTimestamp = timestamp.nullable();
const removeReason = freeText(3, 1000).nullable();
const stamps = { version, createdAt: timestamp, createdBy: uuid, updatedAt: timestamp, updatedBy: uuid };
const atLeastOne = <T extends z.ZodRawShape>(shape: T) =>
  z.strictObject(shape).refine((v) => Object.keys(v).length >= 1, "validation.min_properties");

// ------------------------------------------------------------------------------------------------ shared pieces

/** ADR-0023 §5-§6 schedule/capacity flag: a warning, never a rejection. */
export const scheduleFlag = z.strictObject({
  code: z.string().regex(/^[a-z][a-z0-9_.]*$/),
  message: z.string(),
  dependencyId: uuid.optional(),
  initiativeId: uuid.optional(),
});
export type ScheduleFlag = z.infer<typeof scheduleFlag>;

export const transitionNote = z.strictObject({ note: freeText(1, 2000).optional() });
export type TransitionNote = z.infer<typeof transitionNote>;

export const selectionRequest = z.strictObject({ rationale: freeText(3, 4000), onBehalfOfUserId: uuid.optional() });
export type SelectionRequest = z.infer<typeof selectionRequest>;

export const acceptanceDecision = z.strictObject({
  result: z.enum(["accepted", "rejected"]),
  note: freeText(1, 2000).optional(),
  onBehalfOfUserId: uuid.optional(),
});
export type AcceptanceDecision = z.infer<typeof acceptanceDecision>;

// ------------------------------------------------------------------------------------------------ initiative (T05)

export const INITIATIVE_STATUSES = [
  "draft",
  "submitted",
  "ranked",
  "selected",
  "funded",
  "launched",
  "completed",
  "cancelled",
] as const;
export const initiativeStatus = z.enum(INITIATIVE_STATUSES);
export type InitiativeStatus = z.infer<typeof initiativeStatus>;

export const FUNDING_STATES = ["not_applicable", "unfunded", "funded", "revoked"] as const;
export const fundingState = z.enum(FUNDING_STATES);
export type FundingState = z.infer<typeof fundingState>;

const initiativeFields = {
  name: freeText(1, 300),
  executiveOwnerUserId: nullableUuid,
  workstreamLeadUserId: nullableUuid,
  problemStatement: freeText(1, 8000).nullable(),
  objective: freeText(1, 4000).nullable(),
  scopeIn: freeText(1, 8000).nullable(),
  scopeOut: freeText(1, 8000).nullable(),
  financialBenefitSummary: freeText(1, 4000).nullable(),
  customerBenefitSummary: freeText(1, 4000).nullable(),
  risksSummary: freeText(1, 4000).nullable(),
  waveId: nullableUuid,
  plannedStart: nullableDate,
  plannedEnd: nullableDate,
};

export const initiative = z.strictObject({
  id: uuid,
  organizationId: uuid,
  transformationId: uuid,
  code: z.string().regex(/^INI-[0-9]{2,6}$/),
  ...initiativeFields,
  status: initiativeStatus,
  fundingState,
  displayStatus: z.string(),
  launchedAt: nullableTimestamp,
  launchedBy: nullableUuid,
  cancelledAt: nullableTimestamp,
  cancelledBy: nullableUuid,
  cancelReason: freeText(3, 1000).nullable(),
  warnings: z.array(warning),
  flags: z.array(scheduleFlag),
  ...stamps,
});
export type Initiative = z.infer<typeof initiative>;
export const initiativePage = z.strictObject({ items: z.array(initiative), nextCursor: z.string().nullable() });

const optionalInitiativeFields = z.object(initiativeFields).partial().shape;
export const initiativeCreate = z.strictObject({
  transformationId: uuid,
  ...optionalInitiativeFields,
  name: initiativeFields.name,
});
export type InitiativeCreate = z.infer<typeof initiativeCreate>;
export const initiativeUpdate = atLeastOne(optionalInitiativeFields);
export type InitiativeUpdate = z.infer<typeof initiativeUpdate>;

// ------------------------------------------------------------------------------------------------ initiative links

const linkStatus = z.enum(["active", "removed"]);
const linkStamps = { status: linkStatus, removedAt: nullableTimestamp, removedBy: nullableUuid, removeReason };

export const GAP_LINK_TARGET_TYPES = ["tom_gap", "diagnostic_finding"] as const;
export const initiativeGapLink = z.strictObject({
  id: uuid,
  organizationId: uuid,
  transformationId: uuid,
  initiativeId: uuid,
  targetType: z.enum(GAP_LINK_TARGET_TYPES),
  tomGapId: nullableUuid,
  diagnosticFindingId: nullableUuid,
  note: freeText(1, 2000).nullable(),
  ...linkStamps,
  ...stamps,
});
export type InitiativeGapLink = z.infer<typeof initiativeGapLink>;
export const initiativeGapLinkList = z.strictObject({ items: z.array(initiativeGapLink) });
/** `targetType` is a pattern-checked string: a TOM record type other than the two allowed is a 422 rule (REQ-PB-040). */
export const initiativeGapLinkCreate = z.strictObject({
  targetType: z.string().regex(/^[a-z][a-z_]{1,47}$/),
  targetId: uuid,
  note: freeText(1, 2000).optional(),
});
export type InitiativeGapLinkCreate = z.infer<typeof initiativeGapLinkCreate>;

export const initiativeOutcomeContribution = z.strictObject({
  id: uuid,
  organizationId: uuid,
  transformationId: uuid,
  initiativeId: uuid,
  outcomeId: uuid,
  outcomeKpiId: nullableUuid,
  contributionStatement: freeText(1, 2000),
  expectedKpiMovement: freeText(1, 500).nullable(),
  ...linkStamps,
  ...stamps,
});
export type InitiativeOutcomeContribution = z.infer<typeof initiativeOutcomeContribution>;
export const initiativeOutcomeContributionList = z.strictObject({ items: z.array(initiativeOutcomeContribution) });
export const initiativeOutcomeContributionCreate = z.strictObject({
  outcomeId: uuid,
  outcomeKpiId: nullableUuid.optional(),
  contributionStatement: freeText(1, 2000),
  expectedKpiMovement: freeText(1, 500).nullable().optional(),
});
export type InitiativeOutcomeContributionCreate = z.infer<typeof initiativeOutcomeContributionCreate>;

export const initiativeDecisionLink = z.strictObject({
  id: uuid,
  organizationId: uuid,
  transformationId: uuid,
  initiativeId: uuid,
  decisionId: uuid,
  ...linkStamps,
  ...stamps,
});
export type InitiativeDecisionLink = z.infer<typeof initiativeDecisionLink>;
export const initiativeDecisionLinkList = z.strictObject({ items: z.array(initiativeDecisionLink) });
export const initiativeDecisionLinkCreate = z.strictObject({ decisionId: uuid });
export type InitiativeDecisionLinkCreate = z.infer<typeof initiativeDecisionLinkCreate>;

// ------------------------------------------------------------------------------------------------ deliverables

const deliverableFields = {
  title: freeText(1, 300),
  description: freeText(1, 4000).nullable(),
  ownerUserId: nullableUuid,
  dueDate: nullableDate,
  ordinal: z.number().int().min(1).max(999),
};
export const deliverable = z.strictObject({
  id: uuid,
  organizationId: uuid,
  transformationId: uuid,
  initiativeId: uuid,
  ...deliverableFields,
  acceptanceStatus: z.enum(["pending", "submitted", "accepted", "rejected"]),
  submittedBy: nullableUuid,
  submittedAt: nullableTimestamp,
  decidedBy: nullableUuid,
  decidedAt: nullableTimestamp,
  acceptanceNote: freeText(1, 2000).nullable(),
  status: z.enum(["active", "archived"]),
  archivedAt: nullableTimestamp,
  archivedBy: nullableUuid,
  archiveReason: freeText(3, 1000).nullable(),
  ...stamps,
});
export type Deliverable = z.infer<typeof deliverable>;
export const deliverableList = z.strictObject({ items: z.array(deliverable), countWarning: warning.nullable() });
const optionalDeliverableFields = z.object(deliverableFields).partial().shape;
export const deliverableCreate = z.strictObject({ ...optionalDeliverableFields, title: deliverableFields.title });
export type DeliverableCreate = z.infer<typeof deliverableCreate>;
export const deliverableUpdate = atLeastOne({
  ...optionalDeliverableFields,
  archiveReason: freeText(3, 1000).optional(),
});
export type DeliverableUpdate = z.infer<typeof deliverableUpdate>;

// ------------------------------------------------------------------------------------------------ milestones

export const milestone = z.strictObject({
  id: uuid,
  organizationId: uuid,
  transformationId: uuid,
  initiativeId: uuid,
  waveId: nullableUuid,
  title: freeText(1, 300),
  description: freeText(1, 4000).nullable(),
  ownerUserId: nullableUuid,
  approvedDate: nullableDate,
  approvedBy: nullableUuid,
  approvedAt: nullableTimestamp,
  approvalReason: freeText(3, 1000).nullable(),
  forecastDate: nullableDate,
  actualDate: nullableDate,
  varianceDays: z.number().int().nullable(),
  status: z.enum(["planned", "achieved", "missed", "cancelled"]),
  ...stamps,
});
export type Milestone = z.infer<typeof milestone>;
export const milestoneList = z.strictObject({ items: z.array(milestone) });
export const milestoneCreate = z.strictObject({
  title: freeText(1, 300),
  description: freeText(1, 4000).nullable().optional(),
  ownerUserId: nullableUuid.optional(),
  waveId: nullableUuid.optional(),
  forecastDate: nullableDate.optional(),
});
export type MilestoneCreate = z.infer<typeof milestoneCreate>;

// ------------------------------------------------------------------------------------------------ selection, funding

export const portfolioSelection = z.strictObject({
  id: uuid,
  organizationId: uuid,
  transformationId: uuid,
  initiativeId: uuid,
  action: z.enum(["selected", "deselected"]),
  rationale: freeText(3, 4000),
  rankingSnapshotId: nullableUuid,
  decidedBy: uuid,
  onBehalfOfUserId: nullableUuid,
  decidedAt: timestamp,
});
export type PortfolioSelection = z.infer<typeof portfolioSelection>;
export const portfolioSelectionPage = z.strictObject({
  items: z.array(portfolioSelection),
  nextCursor: z.string().nullable(),
});

export const FUNDING_OUTCOMES = ["approved", "rejected", "deferred", "revoked"] as const;
export const fundingDecision = z.strictObject({
  id: uuid,
  organizationId: uuid,
  transformationId: uuid,
  initiativeId: uuid,
  decisionId: uuid,
  decisionCode: z.string().regex(/^DEC-[0-9]{2,6}$/),
  outcome: z.enum(FUNDING_OUTCOMES),
  amount: decimal.nullable(),
  currency,
  fundingSource: freeText(1, 300).nullable(),
  conditions: freeText(1, 4000).nullable(),
  rationale: freeText(3, 8000),
  businessCaseId: nullableUuid,
  approverRoleCode: roleCode,
  decidedBy: uuid,
  onBehalfOfUserId: nullableUuid,
  decidedAt: timestamp,
});
export type FundingDecision = z.infer<typeof fundingDecision>;
export const fundingDecisionPage = z.strictObject({
  items: z.array(fundingDecision),
  nextCursor: z.string().nullable(),
});
export const fundingDecisionCreate = z.strictObject({
  initiativeId: uuid,
  outcome: z.enum(FUNDING_OUTCOMES),
  amount: decimal.nullable().optional(),
  currency,
  fundingSource: freeText(1, 300).optional(),
  conditions: freeText(1, 4000).optional(),
  rationale: freeText(3, 8000),
  businessCaseId: uuid.optional(),
  onBehalfOfUserId: uuid.optional(),
});
export type FundingDecisionCreate = z.infer<typeof fundingDecisionCreate>;

// ------------------------------------------------------------------------------------------------ dispensations

export const DISPENSATION_KINDS = ["inherited_approval", "waiver"] as const;
export const DISPENSATION_GATES = ["G1", "G2", "G3"] as const;
export const DISPENSATION_STATUSES = ["pending", "accepted", "rejected", "revoked"] as const;

export const gateDispensation = z.strictObject({
  id: uuid,
  organizationId: uuid,
  transformationId: uuid,
  kind: z.enum(DISPENSATION_KINDS),
  gateCode: z.enum(DISPENSATION_GATES),
  initiativeId: nullableUuid,
  reason: freeText(3, 4000).nullable(),
  approvingBody: freeText(1, 300).nullable(),
  approvedOn: nullableDate,
  evidenceId: nullableUuid,
  evidenceVerified: z.boolean().nullable(),
  expiresOn: nullableDate,
  status: z.enum(DISPENSATION_STATUSES),
  counts: z.boolean(),
  recordedBy: uuid,
  decidedBy: nullableUuid,
  decidedAt: nullableTimestamp,
  decisionNote: freeText(1, 2000).nullable(),
  revokedBy: nullableUuid,
  revokedAt: nullableTimestamp,
  revokeReason: freeText(3, 1000).nullable(),
  ...stamps,
});
export type GateDispensation = z.infer<typeof gateDispensation>;
export const gateDispensationPage = z.strictObject({
  items: z.array(gateDispensation),
  nextCursor: z.string().nullable(),
});
export const gateDispensationCreate = z.strictObject({
  kind: z.enum(DISPENSATION_KINDS),
  gateCode: z.enum(DISPENSATION_GATES),
  initiativeId: uuid.optional(),
  reason: freeText(3, 4000).optional(),
  approvingBody: freeText(1, 300).optional(),
  approvedOn: businessDate.optional(),
  evidenceId: uuid.optional(),
  expiresOn: businessDate.optional(),
});
export type GateDispensationCreate = z.infer<typeof gateDispensationCreate>;

// ------------------------------------------------------------------------------------------------ readiness (§9)

/** The B0012 areas, in the playbook's order (ADR-0021 §9). */
export const DIAGNOSTIC_AREAS = ["economics", "customer", "operations", "capability", "technology"] as const;
export const diagnosticArea = z.enum(DIAGNOSTIC_AREAS);
export type DiagnosticArea = z.infer<typeof diagnosticArea>;

export const diagnosticAreaCoverage = z.strictObject({
  area: diagnosticArea,
  covered: z.boolean(),
  dimensions: z.array(z.string()),
  missing: z.array(z.string()),
});
export type DiagnosticAreaCoverage = z.infer<typeof diagnosticAreaCoverage>;

export const gateReadiness = z.strictObject({
  gateCode: z.enum(["G1", "G2", "G3", "G4"]),
  status: z.enum(GATE_STATUSES),
  dispensations: z.array(gateDispensation),
});
export type GateReadiness = z.infer<typeof gateReadiness>;

export const transformationReadiness = z.strictObject({
  transformationId: uuid,
  mode: z.enum(["end_to_end", "modular"]),
  entryPhase: z.string().nullable(),
  currentPhase: z.string(),
  gates: z.array(gateReadiness),
  diagnostic: z.array(diagnosticAreaCoverage).length(5),
  missingDiagnosticAreas: z.array(diagnosticArea),
  sequencing: z.strictObject({
    canSubmitInitiatives: z.boolean(),
    canLaunchInitiatives: z.boolean(),
    blockers: z.array(warning),
  }),
});
export type TransformationReadiness = z.infer<typeof transformationReadiness>;

// ------------------------------------------------------------------------------------------------ hierarchy (B0048)

export const outcomeHierarchy = z.strictObject({
  northStar: northStar.nullable(),
  outcomes: z.array(
    z.strictObject({
      outcome,
      kpis: z.array(
        z.strictObject({
          outcomeKpiId: uuid,
          kpiDefinitionId: uuid,
          targetValue: decimal.nullable(),
          targetDate: businessDate,
          contributions: z.array(initiativeOutcomeContribution),
        }),
      ),
      contributions: z.array(initiativeOutcomeContribution),
    }),
  ),
});
export type OutcomeHierarchy = z.infer<typeof outcomeHierarchy>;

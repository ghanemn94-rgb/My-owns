import { z } from 'zod';
import { CRITERION_STATUSES, GATE_ASSESSMENT_STATUSES, ROLE_KEYS, STATUS_DIMENSION_KEYS, WAIVER_STATUSES, DECISION_STATUSES, DECISION_AUTHORITY_OUTCOMES, REASSESSMENT_REASONS } from '@hub/domain';
import { defineRoute, registerRoutes } from './route';
import { Uuid, IsoDate, ProjectParams, ExpectedVersion, Text, RequiredText, idParams, NoSort, ServerMessageSchema } from './common';

/**
 * Business gates G0–G7 (spec §3): definitions, criteria, assessment cycles, waivers, status dimensions.
 * Status changes are explicit commands; the server re-evaluates criteria/evidence/prerequisites/decision on every
 * command and never uses task completion as an input (REQ-LCY-011).
 */

const GateStatus = z.enum(GATE_ASSESSMENT_STATUSES);
const CriterionStatusSchema = z.enum(CRITERION_STATUSES);
const Role = z.enum(ROLE_KEYS);

export const GateBlockerDto = z.object({
  kind: z.enum(['criterion', 'prerequisite', 'evidence_conflict', 'decision']),
  ref: z.string(),
  /** English sentence (kept for compatibility); clients render `messageI18n` in the active locale. */
  message: z.string(),
  messageI18n: z.array(ServerMessageSchema),
});

export const GateEvaluationDto = z.object({
  ready: z.boolean(),
  hasWaivers: z.boolean(),
  blockers: z.array(GateBlockerDto),
  counts: z.object({
    total: z.number().int(),
    mandatory: z.number().int(),
    met: z.number().int(),
    waived: z.number().int(),
    notApplicable: z.number().int(),
    unmet: z.number().int(),
    blockingUnmet: z.number().int(),
  }),
});

export const ReassessmentFlagDto = z.object({
  needsReassessment: z.boolean(),
  requestedAt: z.string().nullable(),
  /** `reason`: conflicting evidence (AT-14), evidence rejected as defective, or superseded evidence relied upon (DOM-P2-05). */
  criteria: z.array(z.object({ criterionId: Uuid, key: z.string(), evidenceLinkIds: z.array(Uuid), reason: z.enum(REASSESSMENT_REASONS) })),
  escalationId: Uuid.nullable(),
  /** Upstream gates whose approval is flagged (downstream gates are flagged for review, never reverted). */
  upstreamGateKeys: z.array(z.string()),
});

export const GateAssessmentDto = z.object({
  id: Uuid,
  cycle: z.number().int(),
  status: GateStatus,
  isCurrent: z.boolean(),
  version: z.number().int(),
  submittedBy: Uuid.nullable(),
  submittedAt: z.string().nullable(),
  decidedBy: Uuid.nullable(),
  decidedAt: z.string().nullable(),
  decisionId: Uuid.nullable(),
  decisionNote: z.string().nullable(),
  reopenedReason: z.string().nullable(),
  supersedesAssessmentId: Uuid.nullable(),
  createdAt: z.string(),
  reassessment: ReassessmentFlagDto,
});

export const LinkedDecisionDto = z.object({
  id: Uuid,
  code: z.string(),
  title: z.string(),
  status: z.enum(DECISION_STATUSES),
  authorityOutcome: z.enum(DECISION_AUTHORITY_OUTCOMES),
  gateKey: z.string().nullable(),
  isDemo: z.boolean(),
  /** Whether the decision can back a gate approval (AT-04); null blocker when it can. */
  blocker: z.string().nullable(),
  /** The blocker as translatable codes (empty when there is no blocker). */
  blockerI18n: z.array(ServerMessageSchema),
});

export const GateSummaryDto = z.object({
  id: Uuid,
  key: z.string(),
  name: z.string(),
  nameAr: z.string().nullable(),
  purpose: z.string().nullable(),
  /** Arabic purpose from the pinned template version (null when the template has none or the purpose differs from it). */
  purposeAr: z.string().nullable(),
  sortOrder: z.number().int(),
  prerequisiteGateKeys: z.array(z.string()),
  ownerRole: Role,
  reviewerRole: Role,
  approverRole: Role,
  version: z.number().int(),
  assessment: GateAssessmentDto,
  /** Live evaluation (criteria + evidence + prerequisites) — never task completion. */
  evaluation: GateEvaluationDto,
  prerequisites: z.array(z.object({ gateKey: z.string(), status: z.union([GateStatus, z.literal('none')]) })),
  /** Decision backing for the current cycle (null when none is linked or it is not visible to the caller). */
  decision: LinkedDecisionDto.nullable(),
  /** Blockers = evaluation blockers + decision blocker when the cycle is ready for decision. */
  blockers: z.array(GateBlockerDto),
  rag: z.enum(['green', 'amber', 'red']),
  /** Earlier assessment cycles (preserved, never modified). */
  history: z.array(GateAssessmentDto),
});

export const CriterionDto = z.object({
  id: Uuid,
  key: z.string(),
  description: z.string(),
  descriptionAr: z.string().nullable(),
  mandatory: z.boolean(),
  blocking: z.boolean(),
  waivable: z.boolean(),
  waiverAuthorityRole: Role.nullable(),
  waivabilityBasis: z.string().nullable(),
  evidenceRequired: z.boolean(),
  evidenceType: z.string().nullable(),
  ownerRole: Role,
  reviewerRole: Role,
  applicability: z.string(),
  version: z.number().int(),
  evidence: z.object({ active: z.number().int(), conflicting: z.number().int() }),
  assessment: z.object({
    /** Null for a criterion added after the cycle started (its row is created by the first command). */
    id: Uuid.nullable(),
    status: CriterionStatusSchema,
    note: z.string().nullable(),
    assessedBy: Uuid.nullable(),
    assessedAt: z.string().nullable(),
    waiverId: Uuid.nullable(),
    waiverEffective: z.boolean(),
    notApplicable: z.object({
      basis: z.string().nullable(),
      proposedBy: Uuid.nullable(),
      proposedAt: z.string().nullable(),
      determinedBy: Uuid.nullable(),
      determinedRole: Role.nullable(),
      determinedAt: z.string().nullable(),
      approved: z.boolean(),
    }),
    version: z.number().int(),
  }),
});

export const WaiverDto = z.object({
  id: Uuid,
  targetType: z.string(),
  targetId: Uuid,
  targetKey: z.string().nullable(),
  gateKey: z.string().nullable(),
  basis: z.string(),
  impact: z.string(),
  conditions: z.string().nullable(),
  expiresOn: z.string().nullable(),
  status: z.enum(WAIVER_STATUSES),
  authorityRole: Role.nullable(),
  requestedBy: Uuid,
  decidedBy: Uuid.nullable(),
  decidedAt: z.string().nullable(),
  decisionNote: z.string().nullable(),
  effective: z.boolean(),
  isDemo: z.boolean(),
  createdAt: z.string(),
  version: z.number().int(),
});

export const GateCycleDto = GateAssessmentDto.extend({
  criteria: z.array(z.object({ criterionId: Uuid, key: z.string(), status: CriterionStatusSchema, waiverId: Uuid.nullable() })),
  /** Evaluation snapshot stored with the cycle (e.g. at decision time). */
  evaluationSnapshot: z.record(z.string(), z.unknown()).nullable(),
});

export const GateDetailDto = GateSummaryDto.extend({
  criteria: z.array(CriterionDto),
  waivers: z.array(WaiverDto),
  /** Governance decisions raised for this gate (gate_key) or linked to a cycle — visible ones only. */
  decisions: z.array(LinkedDecisionDto),
  cycles: z.array(GateCycleDto),
});

export const AssessmentCommandResult = z.object({
  assessmentId: Uuid,
  cycle: z.number().int(),
  status: GateStatus,
  version: z.number().int(),
  evaluation: GateEvaluationDto,
});

export const CriterionCommandResult = z.object({
  criterionAssessmentId: Uuid,
  status: CriterionStatusSchema,
  version: z.number().int(),
  gateEvaluation: GateEvaluationDto,
});

export const StatusDimensionDto = z.object({
  id: Uuid,
  key: z.enum(STATUS_DIMENSION_KEYS),
  state: z.string(),
  /** English explanation (kept for compatibility); clients render `explanationI18n` in the active locale. */
  explanation: z.string().nullable(),
  /** The explanation as translatable codes + parameters; empty for rows computed before QA-P1-14 (show `explanation`). */
  explanationI18n: z.array(ServerMessageSchema),
  counts: z.record(z.string(), z.number()).nullable(),
  computedAt: z.string(),
  version: z.number().int(),
});

export const StatusDimensionsDto = z.object({
  items: z.array(StatusDimensionDto),
  /** Never true merely because one dimension is complete (AT-06). */
  carveOutComplete: z.boolean(),
});

const GateParams = idParams('gateId');
const CriterionParams = GateParams.extend({ criterionId: Uuid });
const WaiverParams = idParams('waiverId');
const Cmd = z.object({ expectedVersion: ExpectedVersion, note: Text(4000).optional() });

export const gatesRoutes = registerRoutes({
  listGates: defineRoute({
    id: 'gates.listGates',
    method: 'GET',
    path: '/api/v1/projects/:projectId/gates',
    summary: 'Business gates with current assessment, live evaluation, blockers and prior cycles',
    tags: ['gates'],
    access: 'gates.gate.read',
    params: ProjectParams,
    response: z.object({ items: z.array(GateSummaryDto) }),
  }),
  getGate: defineRoute({
    id: 'gates.getGate',
    method: 'GET',
    path: '/api/v1/projects/:projectId/gates/:gateId',
    summary: 'Gate detail: criteria, evidence counts, waivers, linked decisions and all assessment cycles',
    tags: ['gates'],
    access: 'gates.gate.read',
    params: GateParams,
    response: GateDetailDto,
  }),
  startAssessment: defineRoute({
    id: 'gates.startAssessment',
    method: 'POST',
    path: '/api/v1/projects/:projectId/gates/:gateId/assessment/start',
    summary: 'Start (or restart after reopen) the current assessment cycle',
    tags: ['gates'],
    access: 'gates.assessment.submit',
    command: true,
    params: GateParams,
    body: Cmd,
    response: AssessmentCommandResult,
  }),
  markReady: defineRoute({
    id: 'gates.markReady',
    method: 'POST',
    path: '/api/v1/projects/:projectId/gates/:gateId/assessment/mark-ready',
    summary: 'Submit the cycle for decision — only when the server evaluation is ready',
    tags: ['gates'],
    access: 'gates.assessment.submit',
    command: true,
    params: GateParams,
    body: Cmd,
    response: AssessmentCommandResult,
  }),
  backToAssessment: defineRoute({
    id: 'gates.backToAssessment',
    method: 'POST',
    path: '/api/v1/projects/:projectId/gates/:gateId/assessment/back-to-assessment',
    summary: 'Return a ready cycle to assessment (criteria changed)',
    tags: ['gates'],
    access: 'gates.assessment.submit',
    command: true,
    params: GateParams,
    body: Cmd,
    response: AssessmentCommandResult,
  }),
  linkDecision: defineRoute({
    id: 'gates.linkDecision',
    method: 'POST',
    path: '/api/v1/projects/:projectId/gates/:gateId/assessment/link-decision',
    summary: 'Link the governance decision that will back the gate decision (shown as a blocker until final — AT-04)',
    tags: ['gates'],
    access: 'gates.assessment.submit',
    command: true,
    params: GateParams,
    body: z.object({ expectedVersion: ExpectedVersion, decisionId: Uuid }),
    response: AssessmentCommandResult,
  }),
  decide: defineRoute({
    id: 'gates.decide',
    method: 'POST',
    path: '/api/v1/projects/:projectId/gates/:gateId/assessment/decide',
    summary: 'Record the gate decision (approve / approve with exceptions / reject); re-evaluated at decision time',
    tags: ['gates'],
    access: 'gates.assessment.decide',
    command: true,
    params: GateParams,
    body: z.object({
      expectedVersion: ExpectedVersion,
      outcome: z.enum(['approve', 'approve_with_exceptions', 'reject']),
      /** Governance decision backing an approval (required for approvals unless already linked). */
      decisionId: Uuid.optional(),
      note: RequiredText(4000),
    }),
    response: AssessmentCommandResult,
  }),
  reopen: defineRoute({
    id: 'gates.reopen',
    method: 'POST',
    path: '/api/v1/projects/:projectId/gates/:gateId/assessment/reopen',
    summary: 'Controlled reopen: creates a new cycle; the decided cycle and its decision are preserved (AT-14)',
    tags: ['gates'],
    access: 'gates.assessment.reopen',
    command: true,
    params: GateParams,
    body: z.object({ expectedVersion: ExpectedVersion, reason: RequiredText(4000), resetCriterionIds: z.array(Uuid).max(50).optional() }),
    response: AssessmentCommandResult,
  }),
  submitEvidence: defineRoute({
    id: 'gates.submitEvidence',
    method: 'POST',
    path: '/api/v1/projects/:projectId/gates/:gateId/criteria/:criterionId/submit-evidence',
    summary: 'Mark a criterion as evidence submitted (requires active evidence linked through the documents module)',
    tags: ['gates'],
    access: 'gates.evidence.attach',
    command: true,
    params: CriterionParams,
    body: Cmd,
    response: CriterionCommandResult,
  }),
  reviewCriterion: defineRoute({
    id: 'gates.reviewCriterion',
    method: 'POST',
    path: '/api/v1/projects/:projectId/gates/:gateId/criteria/:criterionId/review',
    summary: 'Reviewer accepts (met) or returns (unmet) a criterion; met requires active, non-conflicting evidence',
    tags: ['gates'],
    access: 'gates.assessment.review',
    command: true,
    params: CriterionParams,
    body: z.object({ expectedVersion: ExpectedVersion, outcome: z.enum(['met', 'unmet']), note: Text(4000).optional() }),
    response: CriterionCommandResult,
  }),
  proposeNotApplicable: defineRoute({
    id: 'gates.proposeNotApplicable',
    method: 'POST',
    path: '/api/v1/projects/:projectId/gates/:gateId/criteria/:criterionId/propose-not-applicable',
    summary: 'Propose that a criterion is not applicable (needs a specialist determination to count)',
    tags: ['gates'],
    access: 'gates.evidence.attach',
    command: true,
    params: CriterionParams,
    body: z.object({ expectedVersion: ExpectedVersion, basis: RequiredText(4000) }),
    response: CriterionCommandResult,
  }),
  determineNotApplicable: defineRoute({
    id: 'gates.determineNotApplicable',
    method: 'POST',
    path: '/api/v1/projects/:projectId/gates/:gateId/criteria/:criterionId/determine-not-applicable',
    summary: 'Criterion reviewer approves or rejects a not-applicable proposal (not the proposer)',
    tags: ['gates'],
    access: 'gates.assessment.review',
    command: true,
    params: CriterionParams,
    body: z.object({ expectedVersion: ExpectedVersion, approve: z.boolean(), note: Text(4000).optional() }),
    response: CriterionCommandResult,
  }),
  updateCriterionNote: defineRoute({
    id: 'gates.updateCriterionNote',
    method: 'PATCH',
    path: '/api/v1/projects/:projectId/gates/:gateId/criteria/:criterionId/assessment',
    summary: 'Update the working note of the current criterion assessment (no status change)',
    tags: ['gates'],
    access: 'gates.evidence.attach',
    params: CriterionParams,
    body: z.object({ expectedVersion: ExpectedVersion, note: Text(4000) }),
    response: z.object({ criterionAssessmentId: Uuid, version: z.number().int() }),
  }),
  setWaivability: defineRoute({
    id: 'gates.setWaivability',
    method: 'POST',
    path: '/api/v1/projects/:projectId/gates/:gateId/criteria/:criterionId/waivability',
    summary: 'Specialist determination of waivability and waiver authority (versioned, audited; default non-waivable)',
    tags: ['gates'],
    access: 'gates.criterion.set_waivability',
    command: true,
    params: CriterionParams,
    body: z.object({ expectedVersion: ExpectedVersion, waivable: z.boolean(), waiverAuthorityRole: Role.nullable().optional(), waivabilityBasis: RequiredText(4000) }),
    response: z.object({ criterionId: Uuid, waivable: z.boolean(), waiverAuthorityRole: Role.nullable(), version: z.number().int() }),
  }),
  requestWaiver: defineRoute({
    id: 'gates.requestWaiver',
    method: 'POST',
    path: '/api/v1/projects/:projectId/gates/:gateId/criteria/:criterionId/waivers',
    summary: 'Request a waiver with basis, impact, conditions and expiry (non-waivable criteria are rejected and logged — AT-13)',
    tags: ['gates'],
    access: 'gates.waiver.request',
    command: true,
    params: CriterionParams,
    body: z.object({ basis: RequiredText(4000), impact: RequiredText(4000), conditions: Text(4000).optional(), expiresOn: IsoDate.optional() }),
    response: WaiverDto,
  }),
  listWaivers: defineRoute({
    id: 'gates.listWaivers',
    method: 'GET',
    path: '/api/v1/projects/:projectId/gate-waivers',
    summary: 'Gate criterion waivers (exceptions register)',
    tags: ['gates'],
    access: 'gates.gate.read',
    params: ProjectParams,
    query: z.object({ status: z.enum(WAIVER_STATUSES).optional(), sort: NoSort }),
    response: z.object({ items: z.array(WaiverDto) }),
  }),
  approveWaiver: defineRoute({
    id: 'gates.approveWaiver',
    method: 'POST',
    path: '/api/v1/projects/:projectId/gate-waivers/:waiverId/approve',
    summary: 'Approve a waiver (waiver authority role, not the requester; criterion must be waivable)',
    tags: ['gates'],
    access: 'gates.waiver.approve',
    command: true,
    params: WaiverParams,
    body: Cmd,
    response: WaiverDto,
  }),
  rejectWaiver: defineRoute({
    id: 'gates.rejectWaiver',
    method: 'POST',
    path: '/api/v1/projects/:projectId/gate-waivers/:waiverId/reject',
    summary: 'Reject a waiver request',
    tags: ['gates'],
    access: 'gates.waiver.approve',
    command: true,
    params: WaiverParams,
    body: z.object({ expectedVersion: ExpectedVersion, note: RequiredText(4000) }),
    response: WaiverDto,
  }),
  getStatusDimensions: defineRoute({
    id: 'gates.getStatusDimensions',
    method: 'GET',
    path: '/api/v1/projects/:projectId/status-dimensions',
    summary: 'Independent status dimensions (incorporation, perimeter transfer, operational readiness, JV)',
    tags: ['gates'],
    access: 'portfolio.project.read',
    params: ProjectParams,
    response: StatusDimensionsDto,
  }),
  recomputeStatusDimensions: defineRoute({
    id: 'gates.recomputeStatusDimensions',
    method: 'POST',
    path: '/api/v1/projects/:projectId/status-dimensions/recompute',
    summary: 'Recompute the status dimensions from registers and evidence now (normally done by the worker)',
    tags: ['gates'],
    access: 'gates.definition.manage',
    command: true,
    params: ProjectParams,
    response: StatusDimensionsDto,
  }),
});

export type GateSummary = z.infer<typeof GateSummaryDto>;
export type GateDetail = z.infer<typeof GateDetailDto>;
export type Waiver = z.infer<typeof WaiverDto>;
export type StatusDimensions = z.infer<typeof StatusDimensionsDto>;

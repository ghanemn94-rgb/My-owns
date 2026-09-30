import { z } from 'zod';
import {
  CUTOVER_STATUSES,
  DECISION_AUTHORITY_OUTCOMES,
  DECISION_STATUSES,
  ESCALATION_STATUSES,
  GO_NO_GO,
  READINESS_AREAS,
  READINESS_STATUSES,
  ROLE_KEYS,
  TSA_STATUSES,
  WAIVER_STATUSES,
  APPROVAL_REQUEST_STATUSES,
} from '@hub/domain';
import { defineRoute, registerRoutes } from './route';
import { ClassificationSchema, ExpectedVersion, IsoDate, IsoInstant, MoneySchema, PageQuery, ProjectParams, RequiredText, Text, Uuid, paged } from './common';

/**
 * Day-1 readiness checks, cutover plans / go-no-go and TSA services (spec §7.3, §7.4; AT-09, AT-10; REQ-RDY-*,
 * REQ-TSA-*, REQ-LCY-014). Status changes are explicit commands; PATCH routes change descriptive fields only. The server
 * re-evaluates blockers and prerequisites on every go/no-go; the platform documents work and never controls devices.
 */

const Role = z.enum(ROLE_KEYS);
const Area = z.enum(READINESS_AREAS);
const RStatus = z.enum(READINESS_STATUSES);
const CStatus = z.enum(CUTOVER_STATUSES);
const TStatus = z.enum(TSA_STATUSES);
const Evidence = z.object({ active: z.number().int(), conflicting: z.number().int() });
const Cmd = z.object({ expectedVersion: ExpectedVersion, note: Text(4000).optional() });
const CmdWithNote = z.object({ expectedVersion: ExpectedVersion, note: RequiredText(4000) });
const VersionResult = z.object({ id: Uuid, version: z.number().int() });
const listOf = <T extends z.ZodTypeAny>(t: T) => z.object({ items: z.array(t) });
/** Display names of the users referenced in the response (so the UI never shows bare ids). */
export const PeopleDto = z.record(z.string(), z.string());
const BoolQuery = z.enum(['true', 'false']).optional();

const CheckParams = ProjectParams.extend({ checkId: Uuid });
const WaiverParams = ProjectParams.extend({ waiverId: Uuid });
const PlanParams = ProjectParams.extend({ planId: Uuid });
const TsaParams = ProjectParams.extend({ tsaServiceId: Uuid });

// ---------------------------------------------------------------------------------------------------------------
// DTOs

export const ReadinessTestRunDto = z.object({
  id: Uuid,
  seq: z.number().int(),
  result: RStatus,
  note: z.string().nullable(),
  recordedBy: Uuid,
  recordedAt: z.string(),
});

export const ReadinessCheckDto = z.object({
  id: Uuid,
  code: z.string(),
  area: Area,
  title: z.string(),
  titleAr: z.string().nullable(),
  siteId: Uuid.nullable(),
  workstreamId: Uuid.nullable(),
  cutoverPlanId: Uuid.nullable(),
  ownerUserId: Uuid.nullable(),
  templateKey: z.string().nullable(),
  mandatory: z.boolean(),
  blocker: z.boolean(),
  waivable: z.boolean(),
  waiverAuthorityRole: Role.nullable(),
  waivabilityBasis: z.string().nullable(),
  waivabilityDeterminedBy: Uuid.nullable(),
  waivabilityDeterminedAt: z.string().nullable(),
  waiverId: Uuid.nullable(),
  /** The waiver is approved and unexpired (a bare "waived" status never clears a blocker — D-02). */
  waiverEffective: z.boolean(),
  status: RStatus,
  signoffRole: Role.nullable(),
  signedOffBy: Uuid.nullable(),
  signedOffAt: z.string().nullable(),
  signoffNote: z.string().nullable(),
  testResult: z.string().nullable(),
  failureContingency: z.string().nullable(),
  dueDate: z.string().nullable(),
  latestTest: ReadinessTestRunDto.nullable(),
  evidence: Evidence,
  isDemo: z.boolean(),
  createdAt: z.string(),
  createdBy: Uuid.nullable(),
  version: z.number().int(),
});

export const ReadinessWaiverDto = z.object({
  id: Uuid,
  checkId: Uuid,
  checkCode: z.string().nullable(),
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

export const ReadinessCheckDetailDto = ReadinessCheckDto.extend({
  /** Every test run, oldest first (append-only: a failure stays visible after a later pass). */
  testRuns: z.array(ReadinessTestRunDto),
  waivers: z.array(ReadinessWaiverDto),
  people: PeopleDto,
});

const CheckCommandResult = z.object({ id: Uuid, status: RStatus, version: z.number().int() });

export const GoBlockerDto = z.object({ id: Uuid, title: z.string(), status: RStatus, blocker: z.boolean() });
export const GoEvaluationDto = z.object({
  allowed: z.boolean(),
  blockers: z.array(GoBlockerDto),
  /** Missing §7.4 prerequisites (runbook, window, service impact, owner, communications, testing, rollback, decision). */
  missing: z.array(z.string()),
});

export const CutoverPrerequisitesDto = z.object({
  hasRunbook: z.boolean(),
  hasRollbackPlan: z.boolean(),
  communicationsApproved: z.boolean(),
  hasWindow: z.boolean(),
  hasServiceImpact: z.boolean(),
  hasAccountableOwner: z.boolean(),
  testingDone: z.boolean(),
  hasApprovedGoDecision: z.boolean(),
});

export const CutoverPlanDto = z.object({
  id: Uuid,
  code: z.string(),
  title: z.string(),
  siteId: Uuid.nullable(),
  workstreamId: Uuid.nullable(),
  status: CStatus,
  goNoGo: z.enum(GO_NO_GO),
  windowStart: z.string().nullable(),
  windowEnd: z.string().nullable(),
  accountableUserId: Uuid.nullable(),
  goDecisionId: Uuid.nullable(),
  submittedForDecisionBy: Uuid.nullable(),
  postTransitionAccepted: z.boolean(),
  isDemo: z.boolean(),
  createdAt: z.string(),
  version: z.number().int(),
});

export const CutoverCheckDto = z.object({
  id: Uuid,
  code: z.string(),
  area: Area,
  title: z.string(),
  mandatory: z.boolean(),
  blocker: z.boolean(),
  status: RStatus,
  waivable: z.boolean(),
  waiverEffective: z.boolean(),
  /** Contingency runbook for this check's failure (AT-09). */
  failureContingency: z.string().nullable(),
  latestTest: ReadinessTestRunDto.nullable(),
});

export const CutoverDecisionRecordDto = z.object({
  id: Uuid,
  kind: z.string(),
  fromStatus: CStatus.nullable(),
  toStatus: CStatus.nullable(),
  actorUserId: Uuid,
  rationale: z.string().nullable(),
  goDecisionId: Uuid.nullable(),
  evaluation: z.object({ blockers: z.array(GoBlockerDto), missing: z.array(z.string()) }).nullable(),
  createdAt: z.string(),
});

export const LinkedDecisionSummaryDto = z.object({
  id: Uuid,
  code: z.string(),
  status: z.enum(DECISION_STATUSES),
  authorityOutcome: z.enum(DECISION_AUTHORITY_OUTCOMES),
  decisionTypeKey: z.string().nullable(),
  /** Why the decision does not (yet) authorize the action; null when it does. */
  issue: z.string().nullable(),
});

export const CutoverPlanDetailDto = CutoverPlanDto.extend({
  runbookDocumentId: Uuid.nullable(),
  runbookSummary: z.string().nullable(),
  serviceImpact: z.string().nullable(),
  communicationsApproved: z.boolean(),
  communicationsApprovalRef: z.string().nullable(),
  testingSummary: z.string().nullable(),
  rehearsalDone: z.boolean(),
  contingencyPlan: z.string().nullable(),
  rollbackPlan: z.string().nullable(),
  goNoGoDecidedBy: Uuid.nullable(),
  goNoGoDecidedAt: z.string().nullable(),
  goNoGoRationale: z.string().nullable(),
  submittedForDecisionAt: z.string().nullable(),
  executedBy: Uuid.nullable(),
  executedAt: z.string().nullable(),
  executionNote: z.string().nullable(),
  postTransitionAcceptedBy: Uuid.nullable(),
  postTransitionAcceptedAt: z.string().nullable(),
  postTransitionAcceptanceNote: z.string().nullable(),
  prerequisites: CutoverPrerequisitesDto,
  /** Live server evaluation of the GO rule (same rule the go/no-go command enforces). */
  goEvaluation: GoEvaluationDto,
  /** Readiness checks gating this plan, with their contingency (AT-09). */
  checks: z.array(CutoverCheckDto),
  /** Linked governance go/no-go decision — null when none is linked or the caller cannot see it. */
  goDecision: LinkedDecisionSummaryDto.nullable(),
  /** Go/no-go decision history, oldest first (AT-09). */
  decisionHistory: z.array(CutoverDecisionRecordDto),
  acceptanceEvidence: Evidence,
  people: PeopleDto,
});

const CutoverCommandResult = z.object({ id: Uuid, status: CStatus, goNoGo: z.enum(GO_NO_GO), version: z.number().int() });

export const TsaExpiryDto = z.object({ kind: z.enum(['ok', 'expiring', 'expired_unresolved', 'exit_acceptance_pending']), days: z.number().int().nullable() });

export const TsaServiceDto = z.object({
  id: Uuid,
  code: z.string(),
  name: z.string(),
  status: TStatus,
  ownerUserId: Uuid.nullable(),
  workstreamId: Uuid.nullable(),
  providerEntityId: Uuid.nullable(),
  recipientEntityId: Uuid.nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  replacementService: z.string().nullable(),
  replacementAccepted: z.boolean(),
  isEnduringArrangement: z.boolean(),
  escalationId: Uuid.nullable(),
  classification: ClassificationSchema,
  /** End date ≠ exit (AT-10): expiry assessment in the project timezone. */
  expiry: TsaExpiryDto,
  isDemo: z.boolean(),
  createdAt: z.string(),
  version: z.number().int(),
});

export const TsaEscalationDto = z.object({
  id: Uuid,
  code: z.string(),
  status: z.enum(ESCALATION_STATUSES),
  requestedAction: z.string(),
  decisionDeadline: z.string().nullable(),
  options: z.array(z.object({ title: z.string(), impact: z.string().optional() })),
  target: z.string().nullable(),
});

export const TsaServiceDetailDto = TsaServiceDto.extend({
  agreementId: Uuid.nullable(),
  scope: z.string().nullable(),
  dependentServices: z.string().nullable(),
  sla: z.string().nullable(),
  metricMethod: z.string().nullable(),
  /** Charge basis and amount are shown to holders of finance.record.read only (redacted = true otherwise). */
  chargeBasis: z.string().nullable(),
  charge: MoneySchema.nullable(),
  chargeRedacted: z.boolean(),
  extensionTerms: z.string().nullable(),
  terminationTerms: z.string().nullable(),
  replacementPlan: z.string().nullable(),
  replacementDueDate: z.string().nullable(),
  replacementAcceptedBy: Uuid.nullable(),
  replacementAcceptedAt: z.string().nullable(),
  replacementFailedAt: z.string().nullable(),
  replacementFailureNote: z.string().nullable(),
  exitMilestones: z.array(z.object({ title: z.string(), dueDate: z.string().optional(), done: z.boolean().optional() })),
  acceptanceEvidenceNote: z.string().nullable(),
  residualRisks: z.string().nullable(),
  approvalDecisionId: Uuid.nullable(),
  extensionDecisionId: Uuid.nullable(),
  proposedEndDate: z.string().nullable(),
  extensionRequestedBy: Uuid.nullable(),
  extensionRequestedAt: z.string().nullable(),
  continuityPlan: z.string().nullable(),
  exitApprovalRequestId: Uuid.nullable(),
  exitApprovalStatus: z.enum(APPROVAL_REQUEST_STATUSES).nullable(),
  exitApprovalRequestedBy: Uuid.nullable(),
  exitApprovedBy: Uuid.nullable(),
  exitApprovedAt: z.string().nullable(),
  evidence: Evidence,
  /** Escalation raised for this TSA (expiry / replacement failure) — null when none or not visible to the caller. */
  escalation: TsaEscalationDto.nullable(),
  extensionDecision: LinkedDecisionSummaryDto.nullable(),
  /** State-machine commands currently allowed (guards are still checked by each command). */
  allowedCommands: z.array(z.string()),
  people: PeopleDto,
});

const TsaCommandResult = z.object({ id: Uuid, status: TStatus, version: z.number().int() });

export const ReadinessSummaryDto = z.object({
  checks: z.object({
    total: z.number().int(),
    byStatus: z.record(z.string(), z.number().int()),
    openBlockers: z.number().int(),
    failedBlockers: z.number().int(),
    /** Required Day-1 areas without any check (REQ-RDY-002). */
    uncoveredAreas: z.array(Area),
  }),
  cutover: z.object({ total: z.number().int(), byStatus: z.record(z.string(), z.number().int()) }),
  tsas: z.object({
    total: z.number().int(),
    byStatus: z.record(z.string(), z.number().int()),
    expiringSoon: z.number().int(),
    expiredUnresolved: z.number().int(),
    enduringArrangements: z.number().int(),
  }),
});

// ---------------------------------------------------------------------------------------------------------------
// Bodies

const MilestoneInput = z.object({ title: RequiredText(300), dueDate: IsoDate.optional(), done: z.boolean().optional() });

const checkDescriptive = {
  title: RequiredText(300),
  titleAr: Text(300).nullable().optional(),
  siteId: Uuid.nullable().optional(),
  workstreamId: Uuid.nullable().optional(),
  cutoverPlanId: Uuid.nullable().optional(),
  ownerUserId: Uuid.nullable().optional(),
  testResult: Text(4000).nullable().optional(),
  failureContingency: Text(8000).nullable().optional(),
  dueDate: IsoDate.nullable().optional(),
};

export const CreateReadinessCheckBody = z.object({
  area: Area,
  ...checkDescriptive,
  /** Initial criticality set by the author; lowering it later is a specialist determination. */
  mandatory: z.boolean().default(true),
  blocker: z.boolean().default(false),
  /** Specialist role that signs the check off (REQ-RDY-001). */
  signoffRole: Role.nullable().optional(),
}).strict(); // unknown fields (e.g. status, waivable) are a 400 (QA-P1-12)

export const UpdateReadinessCheckBody = z
  .object({
    expectedVersion: ExpectedVersion,
    ...checkDescriptive,
    title: RequiredText(300).optional(),
  })
  .strict();

const planDescriptive = {
  title: RequiredText(300),
  siteId: Uuid.nullable().optional(),
  workstreamId: Uuid.nullable().optional(),
  runbookDocumentId: Uuid.nullable().optional(),
  runbookSummary: Text(8000).nullable().optional(),
  windowStart: IsoInstant.nullable().optional(),
  windowEnd: IsoInstant.nullable().optional(),
  serviceImpact: Text(8000).nullable().optional(),
  accountableUserId: Uuid.nullable().optional(),
  testingSummary: Text(8000).nullable().optional(),
  contingencyPlan: Text(8000).nullable().optional(),
  rollbackPlan: Text(8000).nullable().optional(),
};

export const CreateCutoverPlanBody = z.object(planDescriptive).strict();
export const UpdateCutoverPlanBody = z.object({ expectedVersion: ExpectedVersion, ...planDescriptive, title: RequiredText(300).optional() }).strict();

const tsaDescriptive = {
  name: RequiredText(300),
  agreementId: Uuid.nullable().optional(),
  providerEntityId: Uuid.nullable().optional(),
  recipientEntityId: Uuid.nullable().optional(),
  scope: Text(8000).nullable().optional(),
  dependentServices: Text(8000).nullable().optional(),
  sla: Text(4000).nullable().optional(),
  metricMethod: Text(4000).nullable().optional(),
  chargeBasis: Text(4000).nullable().optional(),
  charge: MoneySchema.nullable().optional(),
  startDate: IsoDate.nullable().optional(),
  endDate: IsoDate.nullable().optional(),
  extensionTerms: Text(4000).nullable().optional(),
  terminationTerms: Text(4000).nullable().optional(),
  ownerUserId: Uuid.nullable().optional(),
  workstreamId: Uuid.nullable().optional(),
  replacementService: Text(4000).nullable().optional(),
  replacementPlan: Text(8000).nullable().optional(),
  replacementDueDate: IsoDate.nullable().optional(),
  exitMilestones: z.array(MilestoneInput).max(50).optional(),
  residualRisks: Text(8000).nullable().optional(),
  isEnduringArrangement: z.boolean().optional(),
  classification: ClassificationSchema.optional(),
};

export const CreateTsaServiceBody = z.object(tsaDescriptive).strict();
export const UpdateTsaServiceBody = z.object({ expectedVersion: ExpectedVersion, ...tsaDescriptive, name: RequiredText(300).optional() }).strict();

// ---------------------------------------------------------------------------------------------------------------
// Routes

const P = '/api/v1/projects/:projectId';
const tags = ['readiness'];

export const readinessRoutes = registerRoutes({
  // ---- Summary ---------------------------------------------------------------------------------------------
  getReadinessSummary: defineRoute({
    id: 'readiness.getSummary',
    method: 'GET',
    path: `${P}/readiness/summary`,
    summary: 'Day-1 & TSA Center summary: checks by status, open/failed blockers, uncovered areas, cutover and TSA counts (caller scope only)',
    tags,
    access: 'readiness.register.read',
    params: ProjectParams,
    response: ReadinessSummaryDto,
  }),

  // ---- Readiness checks --------------------------------------------------------------------------------------
  listReadinessChecks: defineRoute({
    id: 'readiness.listChecks',
    method: 'GET',
    path: `${P}/readiness-checks`,
    summary: 'Site/workstream Day-1 readiness checks (filtered to the caller’s workstream reach)',
    tags,
    access: 'readiness.register.read',
    params: ProjectParams,
    query: PageQuery.extend({
      area: Area.optional(),
      status: RStatus.optional(),
      siteId: Uuid.optional(),
      workstreamId: Uuid.optional(),
      cutoverPlanId: Uuid.optional(),
      blocker: BoolQuery,
    }),
    response: paged(ReadinessCheckDto).extend({ people: PeopleDto }),
  }),
  getReadinessCheck: defineRoute({
    id: 'readiness.getCheck',
    method: 'GET',
    path: `${P}/readiness-checks/:checkId`,
    summary: 'Readiness check with its full test history and waivers',
    tags,
    access: 'readiness.register.read',
    params: CheckParams,
    response: ReadinessCheckDetailDto,
  }),
  createReadinessCheck: defineRoute({
    id: 'readiness.createCheck',
    method: 'POST',
    path: `${P}/readiness-checks`,
    summary: 'Create a readiness check (non-waivable by default; waivability is a specialist determination)',
    tags,
    access: 'readiness.check.manage',
    params: ProjectParams,
    body: CreateReadinessCheckBody,
    response: VersionResult.extend({ code: z.string() }),
  }),
  instantiateChecklist: defineRoute({
    id: 'readiness.instantiateChecklist',
    method: 'POST',
    path: `${P}/readiness-checks/from-template`,
    summary: 'Create the project template’s default Day-1 checklist for a site/workstream (idempotent per template check and site)',
    tags,
    access: 'readiness.check.manage',
    command: true,
    params: ProjectParams,
    body: z.object({
      siteId: Uuid.nullable().optional(),
      workstreamId: Uuid.nullable().optional(),
      cutoverPlanId: Uuid.nullable().optional(),
      areas: z.array(Area).max(20).optional(),
    }),
    response: z.object({ created: z.number().int(), existing: z.number().int(), areas: z.array(Area), uncoveredAreas: z.array(Area) }),
  }),
  updateReadinessCheck: defineRoute({
    id: 'readiness.updateCheck',
    method: 'PATCH',
    path: `${P}/readiness-checks/:checkId`,
    summary: 'Edit descriptive fields of a readiness check (never its status, criticality, waivability or sign-off)',
    tags,
    access: 'readiness.check.manage',
    params: CheckParams,
    body: UpdateReadinessCheckBody,
    response: VersionResult,
  }),
  determineReadinessCheck: defineRoute({
    id: 'readiness.determineCheck',
    method: 'POST',
    path: `${P}/readiness-checks/:checkId/determination`,
    summary: 'Specialist determination of criticality and waivability (assigned sign-off role; not the author)',
    tags,
    access: 'readiness.check.signoff',
    command: true,
    params: CheckParams,
    body: z.object({
      expectedVersion: ExpectedVersion,
      mandatory: z.boolean(),
      blocker: z.boolean(),
      waivable: z.boolean(),
      waiverAuthorityRole: Role.nullable(),
      basis: RequiredText(4000),
    }),
    response: VersionResult,
  }),
  recordReadinessTest: defineRoute({
    id: 'readiness.recordTest',
    method: 'POST',
    path: `${P}/readiness-checks/:checkId/test-runs`,
    summary: 'Append a test run (failed → check failed; a failed blocker blocks GO — AT-09). Runs are never edited',
    tags,
    access: 'readiness.check.manage',
    command: true,
    params: CheckParams,
    body: z.object({ expectedVersion: ExpectedVersion, result: z.enum(['passed', 'failed']), note: Text(4000).optional() }),
    response: CheckCommandResult.extend({ testRunId: Uuid, seq: z.number().int() }),
  }),
  signOffReadinessCheck: defineRoute({
    id: 'readiness.signOffCheck',
    method: 'POST',
    path: `${P}/readiness-checks/:checkId/sign-off`,
    summary: 'Specialist sign-off (passed, with evidence) or not-applicable determination (with basis) — REQ-RDY-001',
    tags,
    access: 'readiness.check.signoff',
    command: true,
    params: CheckParams,
    body: z.object({ expectedVersion: ExpectedVersion, outcome: z.enum(['passed', 'not_applicable']), note: Text(4000).optional() }),
    response: CheckCommandResult,
  }),
  reopenReadinessCheck: defineRoute({
    id: 'readiness.reopenCheck',
    method: 'POST',
    path: `${P}/readiness-checks/:checkId/reopen`,
    summary: 'Specialist reopens a passed / not-applicable / waived check (history preserved)',
    tags,
    access: 'readiness.check.signoff',
    command: true,
    params: CheckParams,
    body: CmdWithNote,
    response: CheckCommandResult,
  }),
  requestReadinessWaiver: defineRoute({
    id: 'readiness.requestWaiver',
    method: 'POST',
    path: `${P}/readiness-checks/:checkId/waivers`,
    summary: 'Request a waiver with basis and impact (non-waivable checks are refused and logged — AT-13)',
    tags,
    access: 'gates.waiver.request',
    command: true,
    params: CheckParams,
    body: z.object({ basis: RequiredText(4000), impact: RequiredText(4000), conditions: Text(4000).optional(), expiresOn: IsoDate.optional() }),
    response: ReadinessWaiverDto,
  }),
  listReadinessWaivers: defineRoute({
    id: 'readiness.listWaivers',
    method: 'GET',
    path: `${P}/readiness-waivers`,
    summary: 'Waivers of readiness checks (basis, impact, authority, approval)',
    tags,
    access: 'readiness.register.read',
    params: ProjectParams,
    query: z.object({ status: z.enum(WAIVER_STATUSES).optional() }),
    response: listOf(ReadinessWaiverDto).extend({ people: PeopleDto }),
  }),
  approveReadinessWaiver: defineRoute({
    id: 'readiness.approveWaiver',
    method: 'POST',
    path: `${P}/readiness-waivers/:waiverId/approve`,
    summary: 'Approve a readiness waiver: holder of the specialist-set waiver authority role, not the requester (N-02)',
    tags,
    access: 'gates.waiver.approve',
    command: true,
    params: WaiverParams,
    body: Cmd,
    response: ReadinessWaiverDto,
  }),
  rejectReadinessWaiver: defineRoute({
    id: 'readiness.rejectWaiver',
    method: 'POST',
    path: `${P}/readiness-waivers/:waiverId/reject`,
    summary: 'Reject a readiness waiver (reason required)',
    tags,
    access: 'gates.waiver.approve',
    command: true,
    params: WaiverParams,
    body: CmdWithNote,
    response: ReadinessWaiverDto,
  }),

  // ---- Cutover plans / go-no-go -------------------------------------------------------------------------------
  listCutoverPlans: defineRoute({
    id: 'readiness.listCutoverPlans',
    method: 'GET',
    path: `${P}/cutover-plans`,
    summary: 'Cutover / transition plans',
    tags,
    access: 'readiness.register.read',
    params: ProjectParams,
    query: PageQuery.extend({ status: CStatus.optional(), siteId: Uuid.optional() }),
    response: paged(CutoverPlanDto).extend({ people: PeopleDto }),
  }),
  getCutoverPlan: defineRoute({
    id: 'readiness.getCutoverPlan',
    method: 'GET',
    path: `${P}/cutover-plans/:planId`,
    summary: 'Cutover plan with §7.4 prerequisites, live GO evaluation, gating checks + contingency, and decision history (AT-09)',
    tags,
    access: 'readiness.register.read',
    params: PlanParams,
    response: CutoverPlanDetailDto,
  }),
  createCutoverPlan: defineRoute({
    id: 'readiness.createCutoverPlan',
    method: 'POST',
    path: `${P}/cutover-plans`,
    summary: 'Create a cutover plan (runbook, window, service impact, owner, testing, contingency/rollback)',
    tags,
    access: 'readiness.cutover.manage',
    params: ProjectParams,
    body: CreateCutoverPlanBody,
    response: VersionResult.extend({ code: z.string() }),
  }),
  updateCutoverPlan: defineRoute({
    id: 'readiness.updateCutoverPlan',
    method: 'PATCH',
    path: `${P}/cutover-plans/:planId`,
    summary: 'Edit descriptive fields while planning/rehearsal (never status, go/no-go, communications approval or acceptance)',
    tags,
    access: 'readiness.cutover.manage',
    params: PlanParams,
    body: UpdateCutoverPlanBody,
    response: VersionResult,
  }),
  recordCutoverRehearsal: defineRoute({
    id: 'readiness.recordRehearsal',
    method: 'POST',
    path: `${P}/cutover-plans/:planId/rehearsal`,
    summary: 'Record the rehearsal / testing of the transition',
    tags,
    access: 'readiness.cutover.manage',
    command: true,
    params: PlanParams,
    body: z.object({ expectedVersion: ExpectedVersion, testingSummary: RequiredText(8000), note: Text(4000).optional() }),
    response: CutoverCommandResult,
  }),
  recordCommunicationsApproval: defineRoute({
    id: 'readiness.recordCommunicationsApproval',
    method: 'POST',
    path: `${P}/cutover-plans/:planId/communications-approval`,
    summary: 'Record the approval reference of the transition communications',
    tags,
    access: 'readiness.cutover.manage',
    command: true,
    params: PlanParams,
    body: z.object({ expectedVersion: ExpectedVersion, approvalReference: RequiredText(500), note: Text(4000).optional() }),
    response: CutoverCommandResult,
  }),
  linkGoDecision: defineRoute({
    id: 'readiness.linkGoDecision',
    method: 'POST',
    path: `${P}/cutover-plans/:planId/go-decision`,
    summary: 'Link the governance go/no-go decision (type day1_go_no_go, same project) — governance owns the decision',
    tags,
    access: 'readiness.cutover.manage',
    command: true,
    params: PlanParams,
    body: z.object({ expectedVersion: ExpectedVersion, decisionId: Uuid }),
    response: CutoverCommandResult,
  }),
  submitCutoverForDecision: defineRoute({
    id: 'readiness.submitForDecision',
    method: 'POST',
    path: `${P}/cutover-plans/:planId/submit-for-decision`,
    summary: 'Submit for go/no-go — only with every §7.4 element documented (REQ-RDY-003)',
    tags,
    access: 'readiness.cutover.manage',
    command: true,
    params: PlanParams,
    body: Cmd,
    response: CutoverCommandResult,
  }),
  returnCutoverToPlanning: defineRoute({
    id: 'readiness.returnToPlanning',
    method: 'POST',
    path: `${P}/cutover-plans/:planId/return-to-planning`,
    summary: 'Withdraw from decision / re-plan after NO-GO or rollback (history preserved)',
    tags,
    access: 'readiness.cutover.manage',
    command: true,
    params: PlanParams,
    body: CmdWithNote,
    response: CutoverCommandResult,
  }),
  decideGoNoGo: defineRoute({
    id: 'readiness.decideGoNoGo',
    method: 'POST',
    path: `${P}/cutover-plans/:planId/go-no-go`,
    summary: 'Record GO / NO-GO. GO is re-evaluated on the server: open blockers or missing prerequisites refuse it (AT-09)',
    tags,
    access: 'readiness.go_no_go.decide',
    command: true,
    params: PlanParams,
    body: z.object({ expectedVersion: ExpectedVersion, outcome: z.enum(['go', 'no_go']), rationale: RequiredText(4000), decisionId: Uuid.optional() }),
    response: CutoverCommandResult,
  }),
  recordCutoverExecution: defineRoute({
    id: 'readiness.recordExecution',
    method: 'POST',
    path: `${P}/cutover-plans/:planId/execution`,
    summary: 'Record that the transition was executed in the approved operational systems (no device/network/power control)',
    tags,
    access: 'readiness.cutover.manage',
    command: true,
    params: PlanParams,
    body: CmdWithNote,
    response: CutoverCommandResult,
  }),
  recordCutoverRollback: defineRoute({
    id: 'readiness.recordRollback',
    method: 'POST',
    path: `${P}/cutover-plans/:planId/rollback`,
    summary: 'Record that the contingency / rollback was invoked',
    tags,
    access: 'readiness.cutover.manage',
    command: true,
    params: PlanParams,
    body: CmdWithNote,
    response: CutoverCommandResult,
  }),
  acceptCutover: defineRoute({
    id: 'readiness.acceptCutover',
    method: 'POST',
    path: `${P}/cutover-plans/:planId/accept`,
    summary: 'Post-transition acceptance by the accountable owner with evidence (REQ-RDY-005)',
    tags,
    access: 'readiness.cutover.manage',
    command: true,
    params: PlanParams,
    body: CmdWithNote,
    response: CutoverCommandResult,
  }),

  // ---- TSA services ------------------------------------------------------------------------------------------
  listTsaServices: defineRoute({
    id: 'readiness.listTsaServices',
    method: 'GET',
    path: `${P}/tsa-services`,
    summary: 'TSA register (classification and workstream reach applied in SQL)',
    tags,
    access: 'readiness.register.read',
    params: ProjectParams,
    query: PageQuery.extend({ status: TStatus.optional(), workstreamId: Uuid.optional(), enduring: BoolQuery }),
    response: paged(TsaServiceDto).extend({ people: PeopleDto }),
  }),
  getTsaService: defineRoute({
    id: 'readiness.getTsaService',
    method: 'GET',
    path: `${P}/tsa-services/:tsaServiceId`,
    summary: 'TSA service with replacement, extension, escalation and exit-approval state',
    tags,
    access: 'readiness.register.read',
    params: TsaParams,
    response: TsaServiceDetailDto,
  }),
  createTsaService: defineRoute({
    id: 'readiness.createTsaService',
    method: 'POST',
    path: `${P}/tsa-services`,
    summary: 'Register a TSA service (starts as proposed)',
    tags,
    access: 'readiness.tsa.manage',
    params: ProjectParams,
    body: CreateTsaServiceBody,
    response: VersionResult.extend({ code: z.string() }),
  }),
  updateTsaService: defineRoute({
    id: 'readiness.updateTsaService',
    method: 'PATCH',
    path: `${P}/tsa-services/:tsaServiceId`,
    summary: 'Edit descriptive TSA fields (never status, dates of an approved TSA, replacement acceptance, extension or exit)',
    tags,
    access: 'readiness.tsa.manage',
    params: TsaParams,
    body: UpdateTsaServiceBody,
    response: VersionResult,
  }),
  transitionTsaService: defineRoute({
    id: 'readiness.transitionTsaService',
    method: 'POST',
    path: `${P}/tsa-services/:tsaServiceId/transition`,
    summary: 'State-machine command: start_negotiation | activate | start_exit | record_breach | remedy_breach (illegal transitions → 422)',
    tags,
    access: 'readiness.tsa.manage',
    command: true,
    params: TsaParams,
    body: z.object({ expectedVersion: ExpectedVersion, command: z.enum(['start_negotiation', 'activate', 'start_exit', 'record_breach', 'remedy_breach']), note: Text(4000).optional() }),
    response: TsaCommandResult,
  }),
  approveTsaTerms: defineRoute({
    id: 'readiness.approveTsaTerms',
    method: 'POST',
    path: `${P}/tsa-services/:tsaServiceId/approve`,
    summary: 'Record that the TSA terms were approved — needs a final governance decision (tsa_approval_or_extension) and a complete record',
    tags,
    access: 'readiness.tsa.manage',
    command: true,
    params: TsaParams,
    body: z.object({ expectedVersion: ExpectedVersion, decisionId: Uuid, note: Text(4000).optional() }),
    response: TsaCommandResult,
  }),
  acceptTsaReplacement: defineRoute({
    id: 'readiness.acceptReplacement',
    method: 'POST',
    path: `${P}/tsa-services/:tsaServiceId/accept-replacement`,
    summary: 'Accept the replacement service on the basis of linked acceptance evidence',
    tags,
    access: 'readiness.tsa.manage',
    command: true,
    params: TsaParams,
    body: CmdWithNote,
    response: TsaCommandResult,
  }),
  reportTsaReplacementFailure: defineRoute({
    id: 'readiness.reportReplacementFailure',
    method: 'POST',
    path: `${P}/tsa-services/:tsaServiceId/report-replacement-failure`,
    summary: 'Replacement failure → escalation with continuity and extension-decision options routed to the authorized body (REQ-TSA-004)',
    tags,
    access: 'readiness.tsa.manage',
    command: true,
    params: TsaParams,
    body: z.object({ expectedVersion: ExpectedVersion, failureSummary: RequiredText(4000), continuityPlan: RequiredText(8000), decisionDeadline: IsoDate }),
    response: TsaCommandResult.extend({ escalationId: Uuid }),
  }),
  requestTsaExtension: defineRoute({
    id: 'readiness.requestExtension',
    method: 'POST',
    path: `${P}/tsa-services/:tsaServiceId/request-extension`,
    summary: 'Link the extension decision (tsa_approval_or_extension) with the proposed end date and continuity plan — nothing is extended yet',
    tags,
    access: 'readiness.tsa.manage',
    command: true,
    params: TsaParams,
    body: z.object({ expectedVersion: ExpectedVersion, decisionId: Uuid, proposedEndDate: IsoDate, continuityPlan: RequiredText(8000), note: Text(4000).optional() }),
    response: TsaCommandResult,
  }),
  recordTsaExtension: defineRoute({
    id: 'readiness.recordExtension',
    method: 'POST',
    path: `${P}/tsa-services/:tsaServiceId/record-extension`,
    summary: 'Apply the extension ONLY when the linked decision is finally approved (REQ-TSA-005); never automatic',
    tags,
    access: 'readiness.tsa.manage',
    command: true,
    params: TsaParams,
    body: Cmd,
    response: TsaCommandResult,
  }),
  requestTsaExitApproval: defineRoute({
    id: 'readiness.requestExitApproval',
    method: 'POST',
    path: `${P}/tsa-services/:tsaServiceId/request-exit-approval`,
    summary: 'Request approveTSAExit (bound to the TSA version and the accepted-replacement evidence)',
    tags,
    access: 'readiness.tsa.manage',
    command: true,
    params: TsaParams,
    body: Cmd,
    response: TsaCommandResult.extend({ approvalRequestId: Uuid }),
  }),
  approveTsaExit: defineRoute({
    id: 'readiness.approveExit',
    method: 'POST',
    path: `${P}/tsa-services/:tsaServiceId/approve-exit`,
    summary: 'approveTSAExit: accepted replacement with evidence; approver ≠ requester, owner, replacement acceptor (REQ-TSA-006)',
    tags,
    access: 'readiness.tsa.approve_exit',
    command: true,
    params: TsaParams,
    body: Cmd,
    response: TsaCommandResult,
  }),
  rejectTsaExit: defineRoute({
    id: 'readiness.rejectExit',
    method: 'POST',
    path: `${P}/tsa-services/:tsaServiceId/reject-exit`,
    summary: 'Reject the exit approval request (reason required); the TSA stays in its current state',
    tags,
    access: 'readiness.tsa.approve_exit',
    command: true,
    params: TsaParams,
    body: CmdWithNote,
    response: TsaCommandResult,
  }),
});

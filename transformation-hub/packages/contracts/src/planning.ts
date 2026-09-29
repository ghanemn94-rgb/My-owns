import { z } from 'zod';
import {
  TASK_STATUSES,
  MILESTONE_STATUSES,
  DELIVERABLE_STATUSES,
  DEPENDENCY_TYPES,
  SCHEDULE_NODE_TYPES,
  BASELINE_STATUSES,
  CHANGE_REQUEST_STATUSES,
  RAID_STATUSES,
  UPDATE_STATUSES,
  RAG_STATUSES,
  ROLE_KEYS,
  VERIFICATION_STATUSES,
} from '@hub/domain';
import { defineRoute, registerRoutes } from './route';
import { Uuid, IsoDate, PageQuery, paged, Text, RequiredText, ProjectParams, ExpectedVersion, MoneySchema, Ok } from './common';

/**
 * Planning module contracts (spec §6, §9, §14): WBS/tasks, milestones, deliverables, dependencies, schedule
 * (schedule-based forecasts), calendar, baselines, change requests, RAID, periodic status updates, RAG overrides,
 * progress & health, and the cross-project "My Work" inbox.
 * Status changes are explicit commands (`POST .../:id/<verb>` with `expectedVersion`); PATCH routes never touch status.
 */

// ---------------------------------------------------------------------------------------------------------
// Shared helpers

const csvOf = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .trim()
    .max(400)
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(z.enum(values)).min(1));
const BoolQuery = z.enum(['true', 'false']);
const UserRef = z.union([Uuid, z.literal('me')]);
const Reason = RequiredText(2000);
const Command = z.object({ expectedVersion: ExpectedVersion, note: Text(4000).optional() });
const ReasonCommand = z.object({ expectedVersion: ExpectedVersion, reason: Reason });
const CommandResult = z.object({ id: Uuid, status: z.string(), version: z.number().int() });
const VersionResult = z.object({ id: Uuid, version: z.number().int() });
const Created = z.object({ id: Uuid, code: z.string().optional(), version: z.number().int().optional() });
const Duration = z.number().int().min(0).max(2000);
const Weight = z.number().int().min(1).max(100);
const DurationBasis = z.enum(['assumed', 'estimated', 'confirmed', 'tbd']);
const RaciEntityType = z.enum(['task', 'milestone', 'deliverable', 'workstream']);

export const PLANNING_SCHEDULE_LABEL = 'Schedule-based forecast' as const;

const p = (suffix: string) => `/api/v1/projects/:projectId${suffix}`;
const idP = <K extends string>(key: K) => ProjectParams.extend({ [key]: Uuid } as { [P in K]: typeof Uuid });

// ---------------------------------------------------------------------------------------------------------
// Tasks

export const TaskDto = z.object({
  id: Uuid,
  workstreamId: Uuid.nullable(),
  workstreamCode: z.string().nullable(),
  parentId: Uuid.nullable(),
  wbsCode: z.string(),
  title: z.string(),
  titleAr: z.string().nullable(),
  description: z.string().nullable(),
  status: z.enum(TASK_STATUSES),
  accountableUserId: Uuid.nullable(),
  accountableName: z.string().nullable(),
  proposedOwnerFunction: z.string().nullable(),
  output: z.string().nullable(),
  acceptanceCriteria: z.string().nullable(),
  approverRole: z.string().nullable(),
  evidenceType: z.string().nullable(),
  effort: z.string().nullable(),
  durationDays: z.number().int().nullable(),
  durationBasis: z.string().nullable(),
  plannedStart: z.string().nullable(),
  plannedFinish: z.string().nullable(),
  forecastStart: z.string().nullable(),
  forecastFinish: z.string().nullable(),
  actualStart: z.string().nullable(),
  actualFinish: z.string().nullable(),
  /** Owner-reported progress (a claim). */
  reportedProgress: z.number().int(),
  /** Evidence-verified progress: 100 only once accepted by someone other than the submitter. */
  verifiedProgress: z.number().int(),
  requiresAcceptance: z.boolean(),
  submittedBy: Uuid.nullable(),
  acceptedBy: Uuid.nullable(),
  acceptedAt: z.string().nullable(),
  blockedReason: z.string().nullable(),
  gateKey: z.string().nullable(),
  isDeliverable: z.boolean(),
  weight: z.number().int(),
  templateActivityId: z.string().nullable(),
  verificationStatus: z.enum(VERIFICATION_STATUSES),
  overdue: z.boolean(),
  evidenceCount: z.number().int(),
  allowedCommands: z.array(z.string()),
  isDemo: z.boolean(),
  version: z.number().int(),
  updatedAt: z.string(),
});
export type TaskDtoT = z.infer<typeof TaskDto>;

export const TaskListQuery = PageQuery.extend({
  workstreamId: Uuid.optional(),
  status: csvOf(TASK_STATUSES).optional(),
  ownerUserId: UserRef.optional(),
  gateKey: z.string().trim().max(16).optional(),
  overdue: BoolQuery.optional(),
  sort: z.enum(['wbs', 'title', 'status', 'plannedFinish', '-plannedFinish', 'updatedAt', '-updatedAt']).optional(),
});

export const CreateTaskBody = z.object({
  workstreamId: Uuid,
  parentId: Uuid.optional(),
  wbsCode: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9.-]{0,31}$/).optional(),
  title: RequiredText(300),
  titleAr: Text(300).optional(),
  description: Text(4000).optional(),
  output: Text(2000).optional(),
  acceptanceCriteria: Text(2000).optional(),
  approverRole: z.enum(ROLE_KEYS).optional(),
  evidenceType: Text(32).optional(),
  effort: Text(64).optional(),
  durationDays: Duration.optional(),
  durationBasis: DurationBasis.optional(),
  plannedStart: IsoDate.optional(),
  plannedFinish: IsoDate.optional(),
  requiresAcceptance: z.boolean().default(true),
  gateKey: Text(16).optional(),
  weight: Weight.optional(),
  accountableUserId: Uuid.optional(),
});

export const UpdateTaskBody = z
  .object({
    expectedVersion: ExpectedVersion,
    title: RequiredText(300).optional(),
    titleAr: Text(300).nullable().optional(),
    description: Text(4000).nullable().optional(),
    output: Text(2000).nullable().optional(),
    acceptanceCriteria: Text(2000).nullable().optional(),
    approverRole: z.enum(ROLE_KEYS).nullable().optional(),
    evidenceType: Text(32).nullable().optional(),
    effort: Text(64).nullable().optional(),
    durationDays: Duration.nullable().optional(),
    durationBasis: DurationBasis.nullable().optional(),
    plannedStart: IsoDate.nullable().optional(),
    plannedFinish: IsoDate.nullable().optional(),
    requiresAcceptance: z.boolean().optional(),
    gateKey: Text(16).nullable().optional(),
    weight: Weight.optional(),
    parentId: Uuid.nullable().optional(),
  })
  .strict();

export const ProgressBody = z.object({
  expectedVersion: ExpectedVersion,
  reportedProgress: z.number().int().min(0).max(100),
  forecastStart: IsoDate.nullable().optional(),
  forecastFinish: IsoDate.nullable().optional(),
  note: Text(4000).optional(),
});

export const OwnerBody = z.object({ expectedVersion: ExpectedVersion, userId: Uuid, reason: Text(1000).optional() });

// ---------------------------------------------------------------------------------------------------------
// RACI & responsibility matrix

export const RaciDto = z.object({
  id: Uuid.nullable(), // null for the derived accountable-owner row
  entityType: RaciEntityType,
  entityId: Uuid,
  userId: Uuid.nullable(),
  displayName: z.string().nullable(),
  functionLabel: z.string().nullable(),
  raci: z.enum(['R', 'A', 'C', 'I']),
  derived: z.boolean(),
});

export const ResponsibilityDto = z.object({
  thresholds: z.object({ maxOpenAccountable: z.number().int(), maxOverdue: z.number().int() }),
  owners: z.array(
    z.object({
      userId: Uuid,
      displayName: z.string(),
      accountableOpenTasks: z.number().int(),
      overdueTasks: z.number().int(),
      milestones: z.number().int(),
      deliverables: z.number().int(),
      openRisks: z.number().int(),
      responsible: z.number().int(),
      consulted: z.number().int(),
      informed: z.number().int(),
      overloaded: z.boolean(),
      hasProjectRole: z.boolean(),
    }),
  ),
  conflicts: z.array(z.object({ kind: z.enum(['overloaded_owner', 'overdue_concentration', 'owner_without_project_role', 'missing_owner']), userId: Uuid.nullable(), detail: z.string(), count: z.number().int() })),
  explanation: z.string(),
});

// ---------------------------------------------------------------------------------------------------------
// Milestones & deliverables

export const MilestoneDto = z.object({
  id: Uuid,
  workstreamId: Uuid.nullable(),
  workstreamCode: z.string().nullable(),
  code: z.string(),
  title: z.string(),
  titleAr: z.string().nullable(),
  status: z.enum(MILESTONE_STATUSES),
  plannedDate: z.string().nullable(),
  forecastDate: z.string().nullable(),
  actualDate: z.string().nullable(),
  gateKey: z.string().nullable(),
  isCritical: z.boolean(),
  weight: z.number().int(),
  ownerUserId: Uuid.nullable(),
  ownerName: z.string().nullable(),
  verificationStatus: z.enum(VERIFICATION_STATUSES),
  reportedBy: Uuid.nullable(),
  verifiedBy: Uuid.nullable(),
  evidenceCount: z.number().int(),
  overdue: z.boolean(),
  allowedCommands: z.array(z.string()),
  isDemo: z.boolean(),
  version: z.number().int(),
});

export const MilestoneListQuery = PageQuery.extend({
  workstreamId: Uuid.optional(),
  status: csvOf(MILESTONE_STATUSES).optional(),
  gateKey: z.string().trim().max(16).optional(),
  overdue: BoolQuery.optional(),
  critical: BoolQuery.optional(),
});

export const CreateMilestoneBody = z.object({
  workstreamId: Uuid.optional(),
  code: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9.-]{0,31}$/).optional(),
  title: RequiredText(300),
  titleAr: Text(300).optional(),
  plannedDate: IsoDate.optional(),
  gateKey: Text(16).optional(),
  isCritical: z.boolean().default(false),
  weight: Weight.default(3),
  ownerUserId: Uuid.optional(),
});

export const UpdateMilestoneBody = z
  .object({
    expectedVersion: ExpectedVersion,
    title: RequiredText(300).optional(),
    titleAr: Text(300).nullable().optional(),
    plannedDate: IsoDate.nullable().optional(),
    forecastDate: IsoDate.nullable().optional(),
    gateKey: Text(16).nullable().optional(),
    isCritical: z.boolean().optional(),
    weight: Weight.optional(),
  })
  .strict();

export const DeliverableDto = z.object({
  id: Uuid,
  workstreamId: Uuid.nullable(),
  workstreamCode: z.string().nullable(),
  taskId: Uuid.nullable(),
  code: z.string(),
  title: z.string(),
  titleAr: z.string().nullable(),
  status: z.enum(DELIVERABLE_STATUSES),
  weight: z.number().int(),
  weightApproved: z.boolean(),
  weightSetBy: Uuid.nullable(),
  weightApprovedBy: Uuid.nullable(),
  acceptanceCriteria: z.string().nullable(),
  dueDate: z.string().nullable(),
  ownerUserId: Uuid.nullable(),
  ownerName: z.string().nullable(),
  submittedBy: Uuid.nullable(),
  acceptedBy: Uuid.nullable(),
  acceptedAt: z.string().nullable(),
  gateKey: z.string().nullable(),
  evidenceCount: z.number().int(),
  overdue: z.boolean(),
  allowedCommands: z.array(z.string()),
  isDemo: z.boolean(),
  version: z.number().int(),
});

export const DeliverableListQuery = PageQuery.extend({
  workstreamId: Uuid.optional(),
  status: csvOf(DELIVERABLE_STATUSES).optional(),
  gateKey: z.string().trim().max(16).optional(),
  weightApproved: BoolQuery.optional(),
  overdue: BoolQuery.optional(),
});

export const CreateDeliverableBody = z.object({
  workstreamId: Uuid.optional(),
  taskId: Uuid.optional(),
  code: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9.-]{0,31}$/).optional(),
  title: RequiredText(300),
  titleAr: Text(300).optional(),
  weight: Weight.default(1),
  acceptanceCriteria: Text(2000).optional(),
  dueDate: IsoDate.optional(),
  gateKey: Text(16).optional(),
  ownerUserId: Uuid.optional(),
});

export const UpdateDeliverableBody = z
  .object({
    expectedVersion: ExpectedVersion,
    title: RequiredText(300).optional(),
    titleAr: Text(300).nullable().optional(),
    weight: Weight.optional(),
    acceptanceCriteria: Text(2000).nullable().optional(),
    dueDate: IsoDate.nullable().optional(),
    gateKey: Text(16).nullable().optional(),
    taskId: Uuid.nullable().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------------------------------------
// Dependencies, schedule, calendar, look-ahead

export const DependencyDto = z.object({
  id: Uuid,
  predecessorType: z.enum(SCHEDULE_NODE_TYPES),
  predecessorId: Uuid,
  predecessorCode: z.string(),
  predecessorTitle: z.string(),
  successorType: z.enum(SCHEDULE_NODE_TYPES),
  successorId: Uuid,
  successorCode: z.string(),
  successorTitle: z.string(),
  type: z.enum(DEPENDENCY_TYPES),
  lagDays: z.number().int(),
  note: z.string().nullable(),
  createdAt: z.string(),
});

export const CreateDependencyBody = z.object({
  predecessorType: z.enum(SCHEDULE_NODE_TYPES),
  predecessorId: Uuid,
  successorType: z.enum(SCHEDULE_NODE_TYPES),
  successorId: Uuid,
  /** Only FS is supported; SS/FF/SF are rejected with 422 until each is tested (spec §9). */
  type: z.enum(DEPENDENCY_TYPES).default('FS'),
  lagDays: z.number().int().min(-60).max(365).default(0),
  note: Text(1000).optional(),
});

const ScheduleIssue = z.object({ code: z.string(), nodeIds: z.array(z.string()), message: z.string() });

export const ScheduleDto = z.object({
  label: z.literal(PLANNING_SCHEDULE_LABEL),
  status: z.enum(['complete', 'incomplete', 'invalid']),
  scope: z.object({ kind: z.enum(['project', 'driving_network']), targetNodeId: Uuid.nullable(), nodeCount: z.number().int(), edgeCount: z.number().int() }),
  calendar: z.object({ timezone: z.string(), workingDays: z.array(z.number().int()), holidays: z.number().int() }),
  projectStart: z.string().nullable(),
  projectFinish: z.string().nullable(),
  issues: z.array(ScheduleIssue),
  assumptions: z.array(z.string()),
  criticalPath: z.array(z.object({ id: Uuid, type: z.enum(SCHEDULE_NODE_TYPES), code: z.string(), title: z.string() })).nullable(),
  nodes: z.array(
    z.object({
      id: Uuid,
      type: z.enum(SCHEDULE_NODE_TYPES),
      code: z.string(),
      title: z.string(),
      workstreamCode: z.string().nullable(),
      status: z.string(),
      proposed: z.boolean(),
      durationDays: z.number().int().nullable(),
      plannedStart: z.string().nullable(),
      plannedFinish: z.string().nullable(),
      baselineFinish: z.string().nullable(),
      earlyStart: z.string().nullable(),
      earlyFinish: z.string().nullable(),
      lateStart: z.string().nullable(),
      lateFinish: z.string().nullable(),
      totalFloatDays: z.number().int().nullable(),
      critical: z.boolean().nullable(),
    }),
  ),
});

export const ScheduleQuery = z.object({ targetNodeId: Uuid.optional() });

export const DelayImpactBody = z.object({
  nodeId: Uuid,
  delayWorkingDays: z.number().int().min(1).max(365),
  targetNodeId: Uuid.optional(),
});

export const DelayImpactDto = z.object({
  label: z.literal(PLANNING_SCHEDULE_LABEL),
  status: z.enum(['computed', 'incomplete', 'invalid']),
  delayedNode: z.object({ id: Uuid, type: z.enum(SCHEDULE_NODE_TYPES), code: z.string(), title: z.string() }),
  delayWorkingDays: z.number().int(),
  scope: z.object({ kind: z.enum(['project', 'driving_network']), targetNodeId: Uuid.nullable(), nodeCount: z.number().int() }),
  finishBeforeDelay: z.string().nullable(),
  forecastFinish: z.string().nullable(),
  projectSlipWorkingDays: z.number().int().nullable(),
  affected: z.array(
    z.object({ id: Uuid, type: z.enum(SCHEDULE_NODE_TYPES), code: z.string(), title: z.string(), earlyFinishBefore: z.string(), earlyFinishAfter: z.string(), slipWorkingDays: z.number().int(), critical: z.boolean(), gateKey: z.string().nullable() }),
  ),
  affectedGateKeys: z.array(z.string()),
  issues: z.array(ScheduleIssue),
  assumptions: z.array(z.string()),
});

export const HolidayDto = z.object({ id: Uuid, date: z.string(), name: z.string(), isProposed: z.boolean() });
export const CreateHolidayBody = z.object({ date: IsoDate, name: RequiredText(200), isProposed: z.boolean().default(true) });

const LookAheadItem = z.object({
  id: Uuid,
  type: z.enum(['task', 'milestone', 'deliverable']),
  code: z.string(),
  title: z.string(),
  workstreamCode: z.string().nullable(),
  date: z.string(),
  dateKind: z.enum(['start', 'finish', 'due']),
  status: z.string(),
  ownerName: z.string().nullable(),
  critical: z.boolean(),
});
export const LookAheadDto = z.object({
  today: z.string(),
  window: z.object({ from: z.string(), to: z.string(), weeks: z.number().int() }),
  starting: z.array(LookAheadItem),
  due: z.array(LookAheadItem),
  overdue: z.array(LookAheadItem),
});

// ---------------------------------------------------------------------------------------------------------
// Baselines

export const BaselineDto = z.object({
  id: Uuid,
  versionNo: z.number().int(),
  status: z.enum(BASELINE_STATUSES),
  snapshotHash: z.string(),
  changeRequestId: Uuid.nullable(),
  proposedBy: Uuid.nullable(),
  proposedByName: z.string().nullable(),
  approvedBy: Uuid.nullable(),
  approvedAt: z.string().nullable(),
  rejectedBy: Uuid.nullable(),
  rejectedAt: z.string().nullable(),
  supersededAt: z.string().nullable(),
  note: z.string().nullable(),
  decisionNote: z.string().nullable(),
  createdAt: z.string(),
  version: z.number().int(),
  counts: z.object({ tasks: z.number().int(), milestones: z.number().int(), deliverables: z.number().int(), budgetLines: z.number().int(), perimeterItems: z.number().int() }),
});

export const BaselineSnapshotDto = z.object({
  schemaVersion: z.number().int(),
  projectStart: z.string().nullable(),
  calendar: z.object({ timezone: z.string(), workingDays: z.array(z.number().int()), holidays: z.array(z.string()) }),
  schedule: z.object({ status: z.string(), projectFinish: z.string().nullable() }),
  tasks: z.array(z.object({ id: Uuid, wbsCode: z.string(), workstreamId: Uuid.nullable(), status: z.string(), durationDays: z.number().int().nullable(), plannedStart: z.string().nullable(), plannedFinish: z.string().nullable() })),
  milestones: z.array(z.object({ id: Uuid, code: z.string(), workstreamId: Uuid.nullable(), plannedDate: z.string().nullable(), isCritical: z.boolean() })),
  deliverables: z.array(z.object({ id: Uuid, code: z.string(), workstreamId: Uuid.nullable(), weight: z.number().int(), weightApproved: z.boolean() })),
  perimeterItemIds: z.array(Uuid),
  budget: z.union([
    z.object({ restricted: z.literal(false), lines: z.array(z.object({ id: Uuid, code: z.string(), name: z.string(), approvedAmount: z.string().nullable(), currency: z.string(), unitScale: z.number().int(), approvalState: z.string() })) }),
    z.object({ restricted: z.literal(true), lineCount: z.number().int() }),
  ]),
});

export const BaselineDetailDto = BaselineDto.extend({ snapshot: BaselineSnapshotDto });

export const CurrentBaselineDto = z.object({
  baseline: BaselineDto.nullable(),
  /** Perimeter items (included/shared) frozen into the approved baseline — used by carve-out change control (AT-07). */
  perimeterItemIds: z.array(Uuid),
});

export const ProposeBaselineBody = z.object({ note: Text(4000).optional(), changeRequestId: Uuid.optional() });

// ---------------------------------------------------------------------------------------------------------
// Change requests

export const ImpactsSchema = z
  .object({
    time: Text(2000).optional(),
    cost: Text(2000).optional(),
    scope: Text(2000).optional(),
    readiness: Text(2000).optional(),
    transaction: Text(2000).optional(),
    financial: Text(2000).optional(),
    tsa: Text(2000).optional(),
  })
  .strict();

export const ChangeRequestDto = z.object({
  id: Uuid,
  code: z.string(),
  title: z.string(),
  rationale: z.string(),
  alternatives: z.array(z.string()),
  impacts: ImpactsSchema,
  status: z.enum(CHANGE_REQUEST_STATUSES),
  subjectType: z.string().nullable(),
  subjectId: Uuid.nullable(),
  proposedChange: z.record(z.string(), z.unknown()).nullable(),
  rebaseline: z.boolean(),
  requestedBy: Uuid.nullable(),
  requestedByName: z.string().nullable(),
  reviewedBy: Uuid.nullable(),
  decidedBy: Uuid.nullable(),
  decidedAt: z.string().nullable(),
  decisionNote: z.string().nullable(),
  decisionId: Uuid.nullable(),
  linkedBaselineId: Uuid.nullable(),
  allowedCommands: z.array(z.string()),
  isDemo: z.boolean(),
  createdAt: z.string(),
  version: z.number().int(),
});

export const ChangeRequestListQuery = PageQuery.extend({
  status: csvOf(CHANGE_REQUEST_STATUSES).optional(),
  subjectType: z.string().trim().max(32).optional(),
  subjectId: Uuid.optional(),
});

export const CreateChangeRequestBody = z.object({
  title: RequiredText(300),
  rationale: RequiredText(4000),
  alternatives: z.array(RequiredText(1000)).max(10).default([]),
  impacts: ImpactsSchema.default({}),
  subjectType: z.string().trim().regex(/^[a-z_]{2,32}$/).optional(),
  subjectId: Uuid.optional(),
  proposedChange: z.record(z.string(), z.unknown()).optional(),
  rebaseline: z.boolean().default(false),
});

export const UpdateChangeRequestBody = z
  .object({
    expectedVersion: ExpectedVersion,
    title: RequiredText(300).optional(),
    rationale: RequiredText(4000).optional(),
    alternatives: z.array(RequiredText(1000)).max(10).optional(),
    impacts: ImpactsSchema.optional(),
    proposedChange: z.record(z.string(), z.unknown()).nullable().optional(),
    rebaseline: z.boolean().optional(),
  })
  .strict();

export const AssessChangeRequestBody = z.object({ expectedVersion: ExpectedVersion, impacts: ImpactsSchema, note: Text(4000).optional() });

// ---------------------------------------------------------------------------------------------------------
// RAID

export const RAID_KINDS_PATH = ['risks', 'issues', 'assumptions', 'dependencies'] as const;
export const RaidKindPath = z.enum(RAID_KINDS_PATH);

export const RaidItemDto = z.object({
  kind: z.enum(['risk', 'issue', 'assumption', 'dependency']),
  id: Uuid,
  workstreamId: Uuid.nullable(),
  workstreamCode: z.string().nullable(),
  code: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  ownerUserId: Uuid.nullable(),
  ownerName: z.string().nullable(),
  status: z.enum(RAID_STATUSES),
  escalationLevel: z.number().int(),
  dueDate: z.string().nullable(),
  gateKey: z.string().nullable(),
  overdue: z.boolean(),
  isDemo: z.boolean(),
  version: z.number().int(),
  createdAt: z.string(),
  allowedCommands: z.array(z.string()),
  // risk
  probability: z.number().int().nullable(),
  impact: z.number().int().nullable(),
  score: z.number().int().nullable(),
  rating: z.enum(['high', 'medium', 'low']).nullable(),
  trigger: z.string().nullable(),
  response: z.string().nullable(),
  responseStrategy: z.string().nullable(),
  exposure: MoneySchema.nullable(),
  // issue
  severity: z.number().int().nullable(),
  resolution: z.string().nullable(),
  raisedFromRiskId: Uuid.nullable(),
  blocking: z.boolean().nullable(),
  // assumption
  basis: z.string().nullable(),
  validationPlan: z.string().nullable(),
  verificationStatus: z.string().nullable(),
  // dependency
  dependsOn: z.string().nullable(),
  neededBy: z.string().nullable(),
});

export const RaidListQuery = PageQuery.extend({
  status: csvOf(RAID_STATUSES).optional(),
  workstreamId: Uuid.optional(),
  ownerUserId: UserRef.optional(),
  overdue: BoolQuery.optional(),
  gateKey: z.string().trim().max(16).optional(),
  minScore: z.coerce.number().int().min(1).max(25).optional(),
  sort: z.enum(['code', '-score', 'dueDate', '-updatedAt']).optional(),
});

const RaidCommon = {
  workstreamId: Uuid.optional(),
  title: RequiredText(300),
  description: Text(4000).optional(),
  ownerUserId: Uuid.optional(),
  dueDate: IsoDate.optional(),
  gateKey: Text(16).optional(),
};
const RaidCommonUpdate = {
  expectedVersion: ExpectedVersion,
  title: RequiredText(300).optional(),
  description: Text(4000).nullable().optional(),
  dueDate: IsoDate.nullable().optional(),
  gateKey: Text(16).nullable().optional(),
};
const Scale5 = z.number().int().min(1).max(5);

export const CreateRiskBody = z.object({
  ...RaidCommon,
  probability: Scale5,
  impact: Scale5,
  trigger: Text(2000).optional(),
  response: Text(4000).optional(),
  responseStrategy: z.enum(['avoid', 'mitigate', 'transfer', 'accept']).optional(),
  exposure: MoneySchema.optional(),
});
export const UpdateRiskBody = z
  .object({
    ...RaidCommonUpdate,
    probability: Scale5.optional(),
    impact: Scale5.optional(),
    trigger: Text(2000).nullable().optional(),
    response: Text(4000).nullable().optional(),
    responseStrategy: z.enum(['avoid', 'mitigate', 'transfer', 'accept']).nullable().optional(),
    exposure: MoneySchema.nullable().optional(),
  })
  .strict();
export const CreateIssueBody = z.object({ ...RaidCommon, severity: Scale5.default(3), resolution: Text(4000).optional() });
export const UpdateIssueBody = z.object({ ...RaidCommonUpdate, severity: Scale5.optional(), resolution: Text(4000).nullable().optional() }).strict();
export const CreateAssumptionBody = z.object({ ...RaidCommon, basis: Text(4000).optional(), validationPlan: Text(4000).optional() });
export const UpdateAssumptionBody = z
  .object({ ...RaidCommonUpdate, basis: Text(4000).nullable().optional(), validationPlan: Text(4000).nullable().optional(), verificationStatus: z.enum(['assumed', 'proposed', 'confirmed', 'conflicting', 'unknown']).optional() })
  .strict();
export const CreateRaidDependencyBody = z.object({ ...RaidCommon, dependsOn: RequiredText(1000), neededBy: IsoDate.optional() });
export const UpdateRaidDependencyBody = z.object({ ...RaidCommonUpdate, dependsOn: RequiredText(1000).optional(), neededBy: IsoDate.nullable().optional() }).strict();

export const EscalateBody = z.object({ expectedVersion: ExpectedVersion, level: z.number().int().min(1).max(3), reason: Reason });
export const RaiseIssueBody = z.object({ expectedVersion: ExpectedVersion, title: RequiredText(300).optional(), severity: Scale5.default(4), description: Text(4000).optional(), dueDate: IsoDate.optional() });

// ---------------------------------------------------------------------------------------------------------
// Status updates, RAG overrides, progress & health

const RagResultDto = z.object({ status: z.enum(RAG_STATUSES), explanation: z.string(), slipDays: z.number().int().nullable() });

export const StatusUpdateDto = z.object({
  id: Uuid,
  workstreamId: Uuid.nullable(),
  workstreamCode: z.string().nullable(),
  periodEnd: z.string(),
  summary: z.string(),
  achievements: z.string().nullable(),
  nextSteps: z.string().nullable(),
  blockers: z.string().nullable(),
  ragReported: z.enum(RAG_STATUSES).nullable(),
  ragCalculated: z.enum(RAG_STATUSES).nullable(),
  status: z.enum(UPDATE_STATUSES),
  submittedBy: Uuid.nullable(),
  submittedByName: z.string().nullable(),
  submittedAt: z.string().nullable(),
  reviewedBy: Uuid.nullable(),
  reviewedByName: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  reviewNote: z.string().nullable(),
  frozenSnapshot: z.record(z.string(), z.unknown()).nullable(),
  allowedCommands: z.array(z.string()),
  isDemo: z.boolean(),
  createdAt: z.string(),
  version: z.number().int(),
});

export const StatusUpdateListQuery = PageQuery.extend({ workstreamId: Uuid.optional(), status: csvOf(UPDATE_STATUSES).optional() });

export const CreateStatusUpdateBody = z.object({
  workstreamId: Uuid.optional(),
  periodEnd: IsoDate,
  summary: RequiredText(4000),
  achievements: Text(4000).optional(),
  nextSteps: Text(4000).optional(),
  blockers: Text(4000).optional(),
  ragReported: z.enum(['green', 'amber', 'red']).optional(),
});
export const UpdateStatusUpdateBody = z
  .object({
    expectedVersion: ExpectedVersion,
    periodEnd: IsoDate.optional(),
    summary: RequiredText(4000).optional(),
    achievements: Text(4000).nullable().optional(),
    nextSteps: Text(4000).nullable().optional(),
    blockers: Text(4000).nullable().optional(),
    ragReported: z.enum(['green', 'amber', 'red']).nullable().optional(),
  })
  .strict();

export const RagOverrideDto = z.object({
  id: Uuid,
  entityType: z.enum(['workstream', 'project']),
  entityId: Uuid,
  entityLabel: z.string(),
  calculatedAtRequest: z.enum(RAG_STATUSES),
  overrideStatus: z.enum(RAG_STATUSES),
  reason: z.string(),
  expiresOn: z.string(),
  requestedBy: Uuid,
  requestedByName: z.string().nullable(),
  reviewerUserId: Uuid.nullable(),
  reviewerName: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  reviewNote: z.string().nullable(),
  state: z.enum(['pending', 'approved', 'rejected', 'expired']),
  current: z.object({ calculated: z.enum(RAG_STATUSES), effective: z.enum(RAG_STATUSES), overridden: z.boolean(), explanation: z.string() }),
  isDemo: z.boolean(),
  version: z.number().int(),
});

export const CreateRagOverrideBody = z.object({
  entityType: z.enum(['workstream', 'project']),
  entityId: Uuid,
  overrideStatus: z.enum(['green', 'amber', 'red']),
  reason: RequiredText(2000),
  expiresOn: IsoDate,
});

const WeightedProgressDto = z.object({
  percent: z.number().nullable(),
  numeratorWeight: z.number(),
  denominatorWeight: z.number(),
  includedCount: z.number().int(),
  exclusions: z.array(z.object({ id: z.string(), label: z.string().optional(), reason: z.string() })),
  explanation: z.string(),
});

const EffectiveRagDto = z.object({
  calculated: RagResultDto,
  effective: z.enum(RAG_STATUSES),
  overridden: z.boolean(),
  overrideExpired: z.boolean(),
  explanation: z.string(),
  reported: z.enum(RAG_STATUSES).nullable(),
});

export const ProgressDto = z.object({
  today: z.string(),
  thresholds: z.object({ greenMaxSlipDays: z.number().int(), amberMaxSlipDays: z.number().int(), staleAfterDays: z.number().int() }),
  baseline: z.object({ id: Uuid, versionNo: z.number().int() }).nullable(),
  project: z.object({
    progress: WeightedProgressDto,
    rag: EffectiveRagDto,
    aggregate: z.object({ status: z.enum(RAG_STATUSES), explanation: z.string() }),
    redCritical: z.array(z.object({ id: Uuid, type: z.enum(['workstream', 'milestone']), label: z.string(), reason: z.string() })),
    dataQualityIssues: z.array(z.object({ id: z.string(), label: z.string(), issue: z.string() })),
  }),
  workstreams: z.array(
    z.object({
      id: Uuid,
      code: z.string(),
      name: z.string(),
      leadName: z.string().nullable(),
      progress: WeightedProgressDto,
      rag: EffectiveRagDto,
      baselineFinish: z.string().nullable(),
      forecastFinish: z.string().nullable(),
      lastAcceptedUpdate: z.object({ id: Uuid, periodEnd: z.string(), acceptedAt: z.string() }).nullable(),
      openBlockers: z.array(z.object({ id: Uuid, type: z.enum(['task', 'issue']), code: z.string(), title: z.string() })),
      taskCounts: z.record(z.string(), z.number().int()),
      reportedProgressAvg: z.number().nullable(),
      dataQuality: z.array(z.string()),
    }),
  ),
});

// ---------------------------------------------------------------------------------------------------------
// My Work / Inbox

export const MY_WORK_TYPES = [
  'task_accountable',
  'task_acceptance',
  'deliverable_acceptance',
  'milestone_verification',
  'status_update_review',
  'rag_override_review',
  'change_request_assess',
  'change_request_approve',
  'baseline_approval',
  'action_item',
  'decision_vote',
] as const;

export const MyWorkItemDto = z.object({
  type: z.enum(MY_WORK_TYPES),
  projectId: Uuid,
  projectCode: z.string(),
  entityId: Uuid,
  code: z.string().nullable(),
  title: z.string(),
  status: z.string(),
  dueDate: z.string().nullable(),
  overdue: z.boolean(),
  linkPath: z.string(),
  isDemo: z.boolean(),
});
export const MyWorkDto = z.object({ items: z.array(MyWorkItemDto), counts: z.record(z.string(), z.number().int()), generatedAt: z.string() });

// ---------------------------------------------------------------------------------------------------------
// Routes

const T = ['planning'];
const cmd = <B extends z.ZodTypeAny>(id: string, path: string, summary: string, access: string, params: z.ZodTypeAny, body: B, response: z.ZodTypeAny = CommandResult) =>
  defineRoute({ id, method: 'POST', path, summary, tags: T, access, command: true, params, body, response });

const taskP = idP('taskId');
const msP = idP('milestoneId');
const delP = idP('deliverableId');
const blP = idP('baselineId');
const crP = idP('changeRequestId');
const suP = idP('statusUpdateId');
const roP = idP('overrideId');
const raidP = ProjectParams.extend({ kind: RaidKindPath, itemId: Uuid });

export const planningRoutes = registerRoutes({
  // Tasks ------------------------------------------------------------------------------------------------
  listTasks: defineRoute({ id: 'planning.listTasks', method: 'GET', path: p('/tasks'), summary: 'WBS tasks (filters, pagination, sort)', tags: T, access: 'planning.plan.read', params: ProjectParams, query: TaskListQuery, response: paged(TaskDto) }),
  getTask: defineRoute({ id: 'planning.getTask', method: 'GET', path: p('/tasks/:taskId'), summary: 'Task detail', tags: T, access: 'planning.plan.read', params: taskP, response: TaskDto }),
  createTask: defineRoute({ id: 'planning.createTask', method: 'POST', path: p('/tasks'), summary: 'Create a task (confirmed into the plan as Not started)', tags: T, access: 'planning.task.manage', params: ProjectParams, body: CreateTaskBody, response: Created }),
  updateTask: defineRoute({ id: 'planning.updateTask', method: 'PATCH', path: p('/tasks/:taskId'), summary: 'Update descriptive/plan fields (never status, owner, forecast or actuals)', tags: T, access: 'planning.task.manage', params: taskP, body: UpdateTaskBody, response: VersionResult }),
  activateTask: cmd('planning.activateTask', p('/tasks/:taskId/activate'), 'Confirm a proposed (Draft) activity into the plan', 'planning.task.manage', taskP, Command),
  activateWorkstreamTasks: cmd(
    'planning.activateWorkstreamTasks',
    p('/workstreams/:workstreamId/tasks/activate'),
    'Confirm all Draft activities of a workstream into the plan',
    'planning.task.manage',
    idP('workstreamId'),
    z.object({ note: Text(4000).optional() }),
    z.object({ activated: z.number().int() }),
  ),
  startTask: cmd('planning.startTask', p('/tasks/:taskId/start'), 'Start work', 'planning.task.update_progress', taskP, Command.extend({ actualStart: IsoDate.optional() })),
  blockTask: cmd('planning.blockTask', p('/tasks/:taskId/block'), 'Record a blocker (reason required)', 'planning.task.update_progress', taskP, ReasonCommand),
  unblockTask: cmd('planning.unblockTask', p('/tasks/:taskId/unblock'), 'Clear the blocker', 'planning.task.update_progress', taskP, Command),
  submitTaskForAcceptance: cmd('planning.submitTaskForAcceptance', p('/tasks/:taskId/submit-for-acceptance'), 'Submit for acceptance (reported complete)', 'planning.task.update_progress', taskP, Command),
  acceptTask: cmd('planning.acceptTask', p('/tasks/:taskId/accept'), 'Accept (evidence-verified; not the submitter)', 'planning.deliverable.accept', taskP, Command),
  rejectTaskAcceptance: cmd('planning.rejectTaskAcceptance', p('/tasks/:taskId/reject-acceptance'), 'Return a submitted task (reason required)', 'planning.deliverable.accept', taskP, ReasonCommand),
  completeTask: cmd('planning.completeTask', p('/tasks/:taskId/complete'), 'Complete a task that does not require acceptance', 'planning.task.update_progress', taskP, Command.extend({ actualFinish: IsoDate.optional() })),
  cancelTask: cmd('planning.cancelTask', p('/tasks/:taskId/cancel'), 'Cancel (excluded from progress; reason required)', 'planning.task.manage', taskP, ReasonCommand),
  reopenTask: cmd('planning.reopenTask', p('/tasks/:taskId/reopen'), 'Reopen a done/accepted/cancelled task (reason required)', 'planning.task.manage', taskP, ReasonCommand),
  updateTaskProgress: cmd('planning.updateTaskProgress', p('/tasks/:taskId/progress'), 'Report progress and forecast dates (reported, not verified)', 'planning.task.update_progress', taskP, ProgressBody, VersionResult),
  assignTaskOwner: cmd('planning.assignTaskOwner', p('/tasks/:taskId/owner'), 'Set the single accountable owner', 'planning.task.manage', taskP, OwnerBody, VersionResult),

  // RACI & responsibility ---------------------------------------------------------------------------------
  listRaci: defineRoute({
    id: 'planning.listRaci',
    method: 'GET',
    path: p('/raci'),
    summary: 'RACI for a record (the accountable owner is shown as the derived A)',
    tags: T,
    access: 'planning.plan.read',
    params: ProjectParams,
    query: z.object({ entityType: RaciEntityType, entityId: Uuid }),
    response: z.object({ items: z.array(RaciDto) }),
  }),
  addRaci: defineRoute({
    id: 'planning.addRaci',
    method: 'POST',
    path: p('/raci'),
    summary: 'Add an R/C/I assignment (A is the accountable owner, set via the owner command)',
    tags: T,
    access: 'planning.task.manage',
    params: ProjectParams,
    body: z.object({ entityType: RaciEntityType, entityId: Uuid, userId: Uuid.optional(), functionLabel: Text(200).optional(), raci: z.enum(['R', 'A', 'C', 'I']) }).refine((b) => !!b.userId || !!b.functionLabel, 'userId or functionLabel is required'),
    response: Created,
  }),
  removeRaci: defineRoute({ id: 'planning.removeRaci', method: 'POST', path: p('/raci/:raciId/remove'), summary: 'Remove an R/C/I assignment', tags: T, access: 'planning.task.manage', command: true, params: idP('raciId'), body: z.object({ reason: Text(1000).optional() }), response: Ok }),
  responsibility: defineRoute({ id: 'planning.responsibility', method: 'GET', path: p('/responsibility'), summary: 'Responsibility matrix and owner-level conflicts (no resource optimisation)', tags: T, access: 'planning.plan.read', params: ProjectParams, response: ResponsibilityDto }),

  // Milestones -------------------------------------------------------------------------------------------
  listMilestones: defineRoute({ id: 'planning.listMilestones', method: 'GET', path: p('/milestones'), summary: 'Milestones', tags: T, access: 'planning.plan.read', params: ProjectParams, query: MilestoneListQuery, response: paged(MilestoneDto) }),
  getMilestone: defineRoute({ id: 'planning.getMilestone', method: 'GET', path: p('/milestones/:milestoneId'), summary: 'Milestone detail', tags: T, access: 'planning.plan.read', params: msP, response: MilestoneDto }),
  createMilestone: defineRoute({ id: 'planning.createMilestone', method: 'POST', path: p('/milestones'), summary: 'Create a milestone', tags: T, access: 'planning.wbs.manage', params: ProjectParams, body: CreateMilestoneBody, response: Created }),
  updateMilestone: defineRoute({ id: 'planning.updateMilestone', method: 'PATCH', path: p('/milestones/:milestoneId'), summary: 'Update milestone plan fields (no status)', tags: T, access: 'planning.wbs.manage', params: msP, body: UpdateMilestoneBody, response: VersionResult }),
  flagMilestoneAtRisk: cmd('planning.flagMilestoneAtRisk', p('/milestones/:milestoneId/flag-at-risk'), 'Flag at risk (reason required)', 'planning.task.update_progress', msP, ReasonCommand),
  clearMilestoneRisk: cmd('planning.clearMilestoneRisk', p('/milestones/:milestoneId/clear-risk'), 'Clear the at-risk flag', 'planning.task.update_progress', msP, Command),
  reportMilestoneAchieved: cmd('planning.reportMilestoneAchieved', p('/milestones/:milestoneId/report-achieved'), 'Report achieved (pending evidence verification)', 'planning.task.update_progress', msP, Command.extend({ actualDate: IsoDate })),
  verifyMilestoneAchieved: cmd('planning.verifyMilestoneAchieved', p('/milestones/:milestoneId/verify-achieved'), 'Verify achievement (≥1 active evidence; not the reporter)', 'planning.deliverable.accept', msP, Command),
  rejectMilestoneEvidence: cmd('planning.rejectMilestoneEvidence', p('/milestones/:milestoneId/reject-evidence'), 'Reject achievement evidence (reason required)', 'planning.deliverable.accept', msP, ReasonCommand),
  markMilestoneMissed: cmd('planning.markMilestoneMissed', p('/milestones/:milestoneId/mark-missed'), 'Mark missed (reason required)', 'planning.wbs.manage', msP, ReasonCommand),
  cancelMilestone: cmd('planning.cancelMilestone', p('/milestones/:milestoneId/cancel'), 'Cancel (reason required)', 'planning.wbs.manage', msP, ReasonCommand),
  assignMilestoneOwner: cmd('planning.assignMilestoneOwner', p('/milestones/:milestoneId/owner'), 'Set the accountable owner', 'planning.wbs.manage', msP, OwnerBody, VersionResult),

  // Deliverables -----------------------------------------------------------------------------------------
  listDeliverables: defineRoute({ id: 'planning.listDeliverables', method: 'GET', path: p('/deliverables'), summary: 'Deliverables', tags: T, access: 'planning.plan.read', params: ProjectParams, query: DeliverableListQuery, response: paged(DeliverableDto) }),
  getDeliverable: defineRoute({ id: 'planning.getDeliverable', method: 'GET', path: p('/deliverables/:deliverableId'), summary: 'Deliverable detail', tags: T, access: 'planning.plan.read', params: delP, response: DeliverableDto }),
  createDeliverable: defineRoute({ id: 'planning.createDeliverable', method: 'POST', path: p('/deliverables'), summary: 'Create a deliverable (weight unapproved)', tags: T, access: 'planning.wbs.manage', params: ProjectParams, body: CreateDeliverableBody, response: Created }),
  updateDeliverable: defineRoute({ id: 'planning.updateDeliverable', method: 'PATCH', path: p('/deliverables/:deliverableId'), summary: 'Update deliverable fields (weight change resets approval)', tags: T, access: 'planning.wbs.manage', params: delP, body: UpdateDeliverableBody, response: VersionResult }),
  approveDeliverableWeights: defineRoute({
    id: 'planning.approveDeliverableWeights',
    method: 'POST',
    path: p('/deliverables/weights/approve'),
    summary: 'Approve deliverable weights (baseline-approval authority; not the person who set the weight)',
    tags: T,
    access: 'planning.baseline.approve',
    command: true,
    params: ProjectParams,
    body: z.object({ items: z.array(z.object({ id: Uuid, expectedVersion: ExpectedVersion })).min(1).max(500), note: Text(2000).optional() }),
    response: z.object({ approved: z.number().int() }),
  }),
  startDeliverable: cmd('planning.startDeliverable', p('/deliverables/:deliverableId/start'), 'Start', 'planning.task.update_progress', delP, Command),
  submitDeliverable: cmd('planning.submitDeliverable', p('/deliverables/:deliverableId/submit'), 'Submit for acceptance', 'planning.task.update_progress', delP, Command),
  acceptDeliverable: cmd('planning.acceptDeliverable', p('/deliverables/:deliverableId/accept'), 'Accept (≥1 active evidence; not the submitter)', 'planning.deliverable.accept', delP, Command),
  rejectDeliverable: cmd('planning.rejectDeliverable', p('/deliverables/:deliverableId/reject'), 'Reject (reason required)', 'planning.deliverable.accept', delP, ReasonCommand),
  cancelDeliverable: cmd('planning.cancelDeliverable', p('/deliverables/:deliverableId/cancel'), 'Cancel (excluded from progress; reason required)', 'planning.wbs.manage', delP, ReasonCommand),
  reopenDeliverable: cmd('planning.reopenDeliverable', p('/deliverables/:deliverableId/reopen'), 'Reopen (e.g. defective evidence; reason required)', 'planning.wbs.manage', delP, ReasonCommand),
  assignDeliverableOwner: cmd('planning.assignDeliverableOwner', p('/deliverables/:deliverableId/owner'), 'Set the accountable owner', 'planning.wbs.manage', delP, OwnerBody, VersionResult),

  // Dependencies, schedule, calendar, look-ahead ---------------------------------------------------------
  listDependencies: defineRoute({
    id: 'planning.listDependencies',
    method: 'GET',
    path: p('/dependencies'),
    summary: 'Dependency graph (optionally around one node)',
    tags: T,
    access: 'planning.plan.read',
    params: ProjectParams,
    query: z.object({ nodeId: Uuid.optional() }),
    response: z.object({ items: z.array(DependencyDto) }),
  }),
  createDependency: defineRoute({ id: 'planning.createDependency', method: 'POST', path: p('/dependencies'), summary: 'Create an FS dependency (cycle-checked; same project only)', tags: T, access: 'planning.dependency.manage', params: ProjectParams, body: CreateDependencyBody, response: Created }),
  removeDependency: defineRoute({ id: 'planning.removeDependency', method: 'POST', path: p('/dependencies/:dependencyId/remove'), summary: 'Remove a dependency', tags: T, access: 'planning.dependency.manage', command: true, params: idP('dependencyId'), body: z.object({ reason: Text(1000).optional() }), response: Ok }),
  getSchedule: defineRoute({ id: 'planning.getSchedule', method: 'GET', path: p('/schedule'), summary: 'Schedule-based forecast: critical path and float (FS only; incomplete when data is missing)', tags: T, access: 'planning.plan.read', params: ProjectParams, query: ScheduleQuery, response: ScheduleDto }),
  delayImpact: defineRoute({ id: 'planning.delayImpact', method: 'POST', path: p('/schedule/delay-impact'), summary: 'What-if: calendar-based impact of delaying one activity (AT-15; no probabilities)', tags: T, access: 'planning.plan.read', params: ProjectParams, body: DelayImpactBody, response: DelayImpactDto }),
  listHolidays: defineRoute({ id: 'planning.listHolidays', method: 'GET', path: p('/calendar/holidays'), summary: 'Project calendar holidays', tags: T, access: 'planning.plan.read', params: ProjectParams, response: z.object({ timezone: z.string(), workingDays: z.array(z.number().int()), items: z.array(HolidayDto) }) }),
  addHoliday: defineRoute({ id: 'planning.addHoliday', method: 'POST', path: p('/calendar/holidays'), summary: 'Add a non-working day', tags: T, access: 'planning.wbs.manage', params: ProjectParams, body: CreateHolidayBody, response: Created }),
  removeHoliday: defineRoute({ id: 'planning.removeHoliday', method: 'POST', path: p('/calendar/holidays/:holidayId/remove'), summary: 'Remove a non-working day', tags: T, access: 'planning.wbs.manage', command: true, params: idP('holidayId'), body: z.object({ reason: Text(1000).optional() }), response: Ok }),
  lookAhead: defineRoute({
    id: 'planning.lookAhead',
    method: 'GET',
    path: p('/look-ahead'),
    summary: 'Look-ahead: what starts / is due in the next 2, 4 or 8 weeks, and what is overdue',
    tags: T,
    access: 'planning.plan.read',
    params: ProjectParams,
    query: z.object({ weeks: z.coerce.number().int().refine((w) => [2, 4, 8].includes(w), 'weeks must be 2, 4 or 8').default(2), workstreamId: Uuid.optional() }),
    response: LookAheadDto,
  }),

  // Baselines --------------------------------------------------------------------------------------------
  listBaselines: defineRoute({ id: 'planning.listBaselines', method: 'GET', path: p('/baselines'), summary: 'Baseline versions', tags: T, access: 'planning.plan.read', params: ProjectParams, response: z.object({ items: z.array(BaselineDto) }) }),
  currentBaseline: defineRoute({ id: 'planning.currentBaseline', method: 'GET', path: p('/baselines/current'), summary: 'Current approved baseline and its perimeter scope (used by carve-out change control)', tags: T, access: 'planning.plan.read', params: ProjectParams, response: CurrentBaselineDto }),
  getBaseline: defineRoute({ id: 'planning.getBaseline', method: 'GET', path: p('/baselines/:baselineId'), summary: 'Baseline snapshot', tags: T, access: 'planning.plan.read', params: blP, response: BaselineDetailDto }),
  proposeBaseline: defineRoute({
    id: 'planning.proposeBaseline',
    method: 'POST',
    path: p('/baselines'),
    summary: 'Propose a baseline (snapshot + hash). A re-baseline requires an approved change request.',
    tags: T,
    access: 'planning.baseline.propose',
    command: true,
    params: ProjectParams,
    body: ProposeBaselineBody,
    response: z.object({ id: Uuid, versionNo: z.number().int(), status: z.string(), snapshotHash: z.string(), version: z.number().int() }),
  }),
  approveBaseline: cmd('planning.approveBaseline', p('/baselines/:baselineId/approve'), 'Approve (not the proposer; previous approved baseline is superseded)', 'planning.baseline.approve', blP, Command),
  rejectBaseline: cmd('planning.rejectBaseline', p('/baselines/:baselineId/reject'), 'Reject (reason required)', 'planning.baseline.approve', blP, ReasonCommand),

  // Change requests --------------------------------------------------------------------------------------
  listChangeRequests: defineRoute({ id: 'planning.listChangeRequests', method: 'GET', path: p('/change-requests'), summary: 'Change requests', tags: T, access: 'planning.plan.read', params: ProjectParams, query: ChangeRequestListQuery, response: paged(ChangeRequestDto) }),
  getChangeRequest: defineRoute({ id: 'planning.getChangeRequest', method: 'GET', path: p('/change-requests/:changeRequestId'), summary: 'Change request detail', tags: T, access: 'planning.plan.read', params: crP, response: ChangeRequestDto }),
  createChangeRequest: defineRoute({ id: 'planning.createChangeRequest', method: 'POST', path: p('/change-requests'), summary: 'Create a change request (Draft)', tags: T, access: 'planning.change_request.create', params: ProjectParams, body: CreateChangeRequestBody, response: Created }),
  updateChangeRequest: defineRoute({ id: 'planning.updateChangeRequest', method: 'PATCH', path: p('/change-requests/:changeRequestId'), summary: 'Edit a Draft change request', tags: T, access: 'planning.change_request.create', params: crP, body: UpdateChangeRequestBody, response: VersionResult }),
  submitChangeRequest: cmd('planning.submitChangeRequest', p('/change-requests/:changeRequestId/submit'), 'Submit', 'planning.change_request.create', crP, Command),
  startChangeRequestReview: cmd('planning.startChangeRequestReview', p('/change-requests/:changeRequestId/start-review'), 'Start the impact review', 'planning.change_request.assess', crP, Command),
  assessChangeRequest: cmd('planning.assessChangeRequest', p('/change-requests/:changeRequestId/assess'), 'Record the impact assessment (time/cost/scope/readiness/transaction/financial/TSA)', 'planning.change_request.assess', crP, AssessChangeRequestBody),
  approveChangeRequest: cmd('planning.approveChangeRequest', p('/change-requests/:changeRequestId/approve'), 'Approve (not the requester)', 'planning.change_request.approve', crP, Command),
  rejectChangeRequest: cmd('planning.rejectChangeRequest', p('/change-requests/:changeRequestId/reject'), 'Reject (reason required; not the requester)', 'planning.change_request.approve', crP, ReasonCommand),
  withdrawChangeRequest: cmd('planning.withdrawChangeRequest', p('/change-requests/:changeRequestId/withdraw'), 'Withdraw (reason required)', 'planning.change_request.create', crP, ReasonCommand),
  implementChangeRequest: cmd('planning.implementChangeRequest', p('/change-requests/:changeRequestId/mark-implemented'), 'Mark implemented (a re-baseline CR needs its approved baseline)', 'planning.change_request.assess', crP, Command),

  // RAID -------------------------------------------------------------------------------------------------
  listRaid: defineRoute({ id: 'planning.listRaid', method: 'GET', path: p('/raid/:kind'), summary: 'RAID register (risks, issues, assumptions, dependencies)', tags: T, access: 'planning.plan.read', params: ProjectParams.extend({ kind: RaidKindPath }), query: RaidListQuery, response: paged(RaidItemDto) }),
  getRaid: defineRoute({ id: 'planning.getRaid', method: 'GET', path: p('/raid/:kind/:itemId'), summary: 'RAID item', tags: T, access: 'planning.plan.read', params: raidP, response: RaidItemDto }),
  createRisk: defineRoute({ id: 'planning.createRisk', method: 'POST', path: p('/raid/risks'), summary: 'Create a risk', tags: T, access: 'planning.raid.manage', params: ProjectParams, body: CreateRiskBody, response: Created }),
  createIssue: defineRoute({ id: 'planning.createIssue', method: 'POST', path: p('/raid/issues'), summary: 'Create an issue', tags: T, access: 'planning.raid.manage', params: ProjectParams, body: CreateIssueBody, response: Created }),
  createAssumption: defineRoute({ id: 'planning.createAssumption', method: 'POST', path: p('/raid/assumptions'), summary: 'Create an assumption', tags: T, access: 'planning.raid.manage', params: ProjectParams, body: CreateAssumptionBody, response: Created }),
  createRaidDependency: defineRoute({ id: 'planning.createRaidDependency', method: 'POST', path: p('/raid/dependencies'), summary: 'Create a RAID dependency', tags: T, access: 'planning.raid.manage', params: ProjectParams, body: CreateRaidDependencyBody, response: Created }),
  updateRisk: defineRoute({ id: 'planning.updateRisk', method: 'PATCH', path: p('/raid/risks/:itemId'), summary: 'Update a risk (no status)', tags: T, access: 'planning.raid.manage', params: idP('itemId'), body: UpdateRiskBody, response: VersionResult }),
  updateIssue: defineRoute({ id: 'planning.updateIssue', method: 'PATCH', path: p('/raid/issues/:itemId'), summary: 'Update an issue (no status)', tags: T, access: 'planning.raid.manage', params: idP('itemId'), body: UpdateIssueBody, response: VersionResult }),
  updateAssumption: defineRoute({ id: 'planning.updateAssumption', method: 'PATCH', path: p('/raid/assumptions/:itemId'), summary: 'Update an assumption (no status)', tags: T, access: 'planning.raid.manage', params: idP('itemId'), body: UpdateAssumptionBody, response: VersionResult }),
  updateRaidDependency: defineRoute({ id: 'planning.updateRaidDependency', method: 'PATCH', path: p('/raid/dependencies/:itemId'), summary: 'Update a RAID dependency (no status)', tags: T, access: 'planning.raid.manage', params: idP('itemId'), body: UpdateRaidDependencyBody, response: VersionResult }),
  monitorRaid: cmd('planning.monitorRaid', p('/raid/:kind/:itemId/monitor'), 'Move to monitoring', 'planning.raid.manage', raidP, Command),
  escalateRaid: cmd('planning.escalateRaid', p('/raid/:kind/:itemId/escalate'), 'Escalate to a higher level (reason required)', 'planning.raid.manage', raidP, EscalateBody),
  mitigateRaid: cmd('planning.mitigateRaid', p('/raid/:kind/:itemId/mitigate'), 'Mark mitigated', 'planning.raid.manage', raidP, Command),
  closeRaid: cmd('planning.closeRaid', p('/raid/:kind/:itemId/close'), 'Close (reason required)', 'planning.raid.manage', raidP, ReasonCommand),
  cancelRaid: cmd('planning.cancelRaid', p('/raid/:kind/:itemId/cancel'), 'Cancel (reason required)', 'planning.raid.manage', raidP, ReasonCommand),
  reopenRaid: cmd('planning.reopenRaid', p('/raid/:kind/:itemId/reopen'), 'Reopen (reason required)', 'planning.raid.manage', raidP, ReasonCommand),
  assignRaidOwner: cmd('planning.assignRaidOwner', p('/raid/:kind/:itemId/owner'), 'Set the owner', 'planning.raid.manage', raidP, OwnerBody, VersionResult),
  raiseIssueFromRisk: cmd('planning.raiseIssueFromRisk', p('/raid/risks/:itemId/raise-issue'), 'Raise an issue from a materialised risk', 'planning.raid.manage', idP('itemId'), RaiseIssueBody, Created),

  // Status updates ---------------------------------------------------------------------------------------
  listStatusUpdates: defineRoute({ id: 'planning.listStatusUpdates', method: 'GET', path: p('/status-updates'), summary: 'Periodic updates', tags: T, access: 'planning.plan.read', params: ProjectParams, query: StatusUpdateListQuery, response: paged(StatusUpdateDto) }),
  getStatusUpdate: defineRoute({ id: 'planning.getStatusUpdate', method: 'GET', path: p('/status-updates/:statusUpdateId'), summary: 'Periodic update', tags: T, access: 'planning.plan.read', params: suP, response: StatusUpdateDto }),
  createStatusUpdate: defineRoute({ id: 'planning.createStatusUpdate', method: 'POST', path: p('/status-updates'), summary: 'Draft a periodic update', tags: T, access: 'planning.status_update.submit', params: ProjectParams, body: CreateStatusUpdateBody, response: Created }),
  updateStatusUpdate: defineRoute({ id: 'planning.updateStatusUpdate', method: 'PATCH', path: p('/status-updates/:statusUpdateId'), summary: 'Edit a draft/returned update', tags: T, access: 'planning.status_update.submit', params: suP, body: UpdateStatusUpdateBody, response: VersionResult }),
  submitStatusUpdate: cmd('planning.submitStatusUpdate', p('/status-updates/:statusUpdateId/submit'), 'Submit for review', 'planning.status_update.submit', suP, Command),
  returnStatusUpdate: cmd('planning.returnStatusUpdate', p('/status-updates/:statusUpdateId/return'), 'Return for rework (reason required; not the submitter)', 'planning.status_update.review', suP, ReasonCommand),
  acceptStatusUpdate: cmd('planning.acceptStatusUpdate', p('/status-updates/:statusUpdateId/accept'), 'Accept and freeze (not the submitter)', 'planning.status_update.review', suP, Command),

  // RAG overrides ----------------------------------------------------------------------------------------
  listRagOverrides: defineRoute({
    id: 'planning.listRagOverrides',
    method: 'GET',
    path: p('/rag-overrides'),
    summary: 'Manual RAG overrides (calculated value retained)',
    tags: T,
    access: 'planning.plan.read',
    params: ProjectParams,
    query: z.object({ state: z.enum(['pending', 'approved', 'rejected', 'expired']).optional() }),
    response: z.object({ items: z.array(RagOverrideDto) }),
  }),
  requestRagOverride: defineRoute({ id: 'planning.requestRagOverride', method: 'POST', path: p('/rag-overrides'), summary: 'Request a manual RAG override (reason + expiry; needs review)', tags: T, access: 'planning.rag_override.set', params: ProjectParams, body: CreateRagOverrideBody, response: Created }),
  approveRagOverride: cmd('planning.approveRagOverride', p('/rag-overrides/:overrideId/approve'), 'Approve the override (not the requester)', 'planning.rag_override.review', roP, Command),
  rejectRagOverride: cmd('planning.rejectRagOverride', p('/rag-overrides/:overrideId/reject'), 'Reject the override (reason required)', 'planning.rag_override.review', roP, ReasonCommand),

  // Progress & health, My Work ---------------------------------------------------------------------------
  progress: defineRoute({ id: 'planning.progress', method: 'GET', path: p('/progress'), summary: 'Weighted progress (approved deliverable weights) and worst-of RAG with data-quality flags', tags: T, access: 'planning.plan.read', params: ProjectParams, response: ProgressDto }),
  myWork: defineRoute({ id: 'planning.myWork', method: 'GET', path: '/api/v1/me/work', summary: 'My Work / Inbox across my projects', tags: ['planning', 'identity'], access: 'authenticated', response: MyWorkDto }),
});

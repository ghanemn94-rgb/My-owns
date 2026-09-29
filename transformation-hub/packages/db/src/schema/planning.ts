import { pgTable, uuid, text, integer, jsonb, varchar, date, boolean, index, unique, uniqueIndex, smallint, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  pk,
  orgIdCol,
  projectIdCol,
  createdAt,
  updatedAt,
  createdBy,
  versionCol,
  isDemo,
  ts,
  projectFk,
  type FkTarget,
  taskStatus,
  milestoneStatus,
  deliverableStatus,
  dependencyType,
  scheduleNodeType,
  baselineStatus,
  changeRequestStatus,
  raidStatus,
  updateStatus,
  ragStatus,
  raciValue,
  verificationStatus,
  moneyCols,
} from './_common';
import { project, workstream } from './portfolio';
import { appUser } from './identity';
import { decision } from './governance';

export const task = pgTable(
  'task',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    workstreamId: uuid('workstream_id'),
    parentId: uuid('parent_id'),
    wbsCode: varchar('wbs_code', { length: 32 }).notNull(),
    title: text('title').notNull(),
    titleAr: text('title_ar'),
    description: text('description'),
    status: taskStatus('status').notNull().default('draft'),
    accountableUserId: uuid('accountable_user_id').references(() => appUser.id),
    proposedOwnerFunction: text('proposed_owner_function'),
    output: text('output'),
    acceptanceCriteria: text('acceptance_criteria'),
    approverRole: varchar('approver_role', { length: 32 }),
    evidenceType: varchar('evidence_type', { length: 32 }),
    effort: text('effort'),
    durationDays: integer('duration_days'),
    durationBasis: varchar('duration_basis', { length: 16 }),
    plannedStart: date('planned_start', { mode: 'string' }),
    plannedFinish: date('planned_finish', { mode: 'string' }),
    forecastStart: date('forecast_start', { mode: 'string' }),
    forecastFinish: date('forecast_finish', { mode: 'string' }),
    actualStart: date('actual_start', { mode: 'string' }),
    actualFinish: date('actual_finish', { mode: 'string' }),
    reportedProgress: smallint('reported_progress').notNull().default(0),
    requiresAcceptance: boolean('requires_acceptance').notNull().default(false),
    acceptedBy: uuid('accepted_by'),
    acceptedAt: ts('accepted_at'),
    gateKey: varchar('gate_key', { length: 16 }),
    isDeliverable: boolean('is_deliverable').notNull().default(false),
    weight: integer('weight').notNull().default(1),
    templateActivityId: varchar('template_activity_id', { length: 32 }),
    verificationStatus: verificationStatus('verification_status').notNull().default('proposed'),
    sortOrder: integer('sort_order').notNull().default(0),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    unique('task_pid_uq').on(t.projectId, t.id),
    uniqueIndex('task_wbs_uq').on(t.projectId, t.wbsCode),
    projectFk('task_ws_fk', t.projectId, t.workstreamId, (): FkTarget => workstream),
    projectFk('task_parent_fk', t.projectId, t.parentId, { projectId: t.projectId, id: t.id }),
    index('task_ws_idx').on(t.workstreamId),
    check('task_progress_chk', sql`${t.reportedProgress} between 0 and 100`),
    check('task_duration_chk', sql`${t.durationDays} is null or ${t.durationDays} >= 0`),
  ],
);

export const milestone = pgTable(
  'milestone',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    workstreamId: uuid('workstream_id'),
    code: varchar('code', { length: 32 }).notNull(),
    title: text('title').notNull(),
    titleAr: text('title_ar'),
    status: milestoneStatus('status').notNull().default('planned'),
    plannedDate: date('planned_date', { mode: 'string' }),
    forecastDate: date('forecast_date', { mode: 'string' }),
    actualDate: date('actual_date', { mode: 'string' }),
    gateKey: varchar('gate_key', { length: 16 }),
    isCritical: boolean('is_critical').notNull().default(false),
    weight: integer('weight').notNull().default(3),
    ownerUserId: uuid('owner_user_id').references(() => appUser.id),
    verificationStatus: verificationStatus('verification_status').notNull().default('proposed'),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    unique('milestone_pid_uq').on(t.projectId, t.id),
    uniqueIndex('milestone_code_uq').on(t.projectId, t.code),
    projectFk('milestone_ws_fk', t.projectId, t.workstreamId, (): FkTarget => workstream),
  ],
);

export const deliverable = pgTable(
  'deliverable',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    workstreamId: uuid('workstream_id'),
    taskId: uuid('task_id'),
    code: varchar('code', { length: 32 }).notNull(),
    title: text('title').notNull(),
    titleAr: text('title_ar'),
    status: deliverableStatus('status').notNull().default('planned'),
    weight: integer('weight').notNull().default(1),
    weightApproved: boolean('weight_approved').notNull().default(false),
    acceptanceCriteria: text('acceptance_criteria'),
    dueDate: date('due_date', { mode: 'string' }),
    ownerUserId: uuid('owner_user_id').references(() => appUser.id),
    acceptedBy: uuid('accepted_by'),
    acceptedAt: ts('accepted_at'),
    gateKey: varchar('gate_key', { length: 16 }),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    unique('deliverable_pid_uq').on(t.projectId, t.id),
    uniqueIndex('deliverable_code_uq').on(t.projectId, t.code),
    projectFk('deliverable_ws_fk', t.projectId, t.workstreamId, (): FkTarget => workstream),
    projectFk('deliverable_task_fk', t.projectId, t.taskId, (): FkTarget => task),
    check('deliverable_weight_chk', sql`${t.weight} > 0`),
  ],
);

/** Schedule dependency between tasks/milestones in the same project (FS only exposed until SS/FF/SF tested). */
export const dependency = pgTable(
  'dependency',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    predecessorType: scheduleNodeType('predecessor_type').notNull(),
    predecessorId: uuid('predecessor_id').notNull(),
    successorType: scheduleNodeType('successor_type').notNull(),
    successorId: uuid('successor_id').notNull(),
    type: dependencyType('type').notNull().default('FS'),
    lagDays: integer('lag_days').notNull().default(0),
    note: text('note'),
    createdAt: createdAt(),
    createdBy: createdBy(),
  },
  (t) => [
    uniqueIndex('dependency_uq').on(t.projectId, t.predecessorId, t.successorId),
    check('dependency_no_self_chk', sql`${t.predecessorId} <> ${t.successorId}`),
  ],
);

/** Cross-project dependency: exposes only minimal information across the boundary (spec §5). */
export const crossProjectDependency = pgTable('cross_project_dependency', {
  id: pk(),
  orgId: orgIdCol(),
  projectId: projectIdCol().references(() => project.id), // the dependent project (owner of this row)
  otherProjectId: uuid('other_project_id').notNull().references(() => project.id),
  description: text('description').notNull(),
  neededBy: date('needed_by', { mode: 'string' }),
  status: raidStatus('status').notNull().default('open'),
  createdAt: createdAt(),
  createdBy: createdBy(),
  version: versionCol(),
});

export const raciAssignment = pgTable(
  'raci_assignment',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    entityType: varchar('entity_type', { length: 32 }).notNull(),
    entityId: uuid('entity_id').notNull(),
    userId: uuid('user_id').references(() => appUser.id),
    functionLabel: text('function_label'),
    raci: raciValue('raci').notNull(),
    createdAt: createdAt(),
    createdBy: createdBy(),
  },
  (t) => [index('raci_entity_idx').on(t.projectId, t.entityType, t.entityId)],
);

/** Baseline snapshot: start/finish/duration/budget/scope frozen at approval (spec §9). */
export const baselineVersion = pgTable(
  'baseline_version',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    versionNo: integer('version_no').notNull(),
    status: baselineStatus('status').notNull().default('draft'),
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
    snapshotHash: text('snapshot_hash').notNull(),
    changeRequestId: uuid('change_request_id'),
    proposedBy: uuid('proposed_by'),
    approvedBy: uuid('approved_by'),
    approvedAt: ts('approved_at'),
    note: text('note'),
    createdAt: createdAt(),
    version: versionCol(),
  },
  (t) => [
    projectFk('baseline_change_request_fk', t.projectId, t.changeRequestId, (): FkTarget => changeRequest),unique('baseline_pid_uq').on(t.projectId, t.id), uniqueIndex('baseline_version_uq').on(t.projectId, t.versionNo)],
);

export const changeRequest = pgTable(
  'change_request',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    code: varchar('code', { length: 32 }).notNull(),
    title: text('title').notNull(),
    rationale: text('rationale').notNull(),
    alternatives: jsonb('alternatives').$type<string[]>().notNull().default([]),
    impacts: jsonb('impacts')
      .$type<{ time?: string; cost?: string; scope?: string; readiness?: string; transaction?: string; financial?: string; tsa?: string }>()
      .notNull()
      .default({}),
    status: changeRequestStatus('status').notNull().default('draft'),
    subjectType: varchar('subject_type', { length: 32 }),
    subjectId: uuid('subject_id'),
    proposedChange: jsonb('proposed_change').$type<Record<string, unknown>>(),
    requestedBy: uuid('requested_by'),
    reviewedBy: uuid('reviewed_by'),
    decidedBy: uuid('decided_by'),
    decidedAt: ts('decided_at'),
    decisionNote: text('decision_note'),
    decisionId: uuid('decision_id'),
    rebaseline: boolean('rebaseline').notNull().default(false),
    isDemo: isDemo(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    projectFk('change_request_decision_fk', t.projectId, t.decisionId, (): FkTarget => decision),unique('change_request_pid_uq').on(t.projectId, t.id), uniqueIndex('change_request_code_uq').on(t.projectId, t.code)],
);

const raidCommon = () => ({
  id: pk(),
  orgId: orgIdCol(),
  projectId: projectIdCol().references(() => project.id),
  workstreamId: uuid('workstream_id'),
  code: varchar('code', { length: 32 }).notNull(),
  title: text('title').notNull(),
  description: text('description'),
  ownerUserId: uuid('owner_user_id').references(() => appUser.id),
  status: raidStatus('status').notNull().default('open'),
  escalationLevel: smallint('escalation_level').notNull().default(0),
  dueDate: date('due_date', { mode: 'string' }),
  gateKey: varchar('gate_key', { length: 16 }),
  isDemo: isDemo(),
  createdAt: createdAt(),
  createdBy: createdBy(),
  updatedAt: updatedAt(),
  version: versionCol(),
});

export const risk = pgTable(
  'risk',
  {
    ...raidCommon(),
    probability: smallint('probability').notNull(), // 1..5
    impact: smallint('impact').notNull(), // 1..5
    trigger: text('trigger'),
    response: text('response'),
    responseStrategy: varchar('response_strategy', { length: 16 }), // avoid|mitigate|transfer|accept
    ...moneyCols('exposure'),
  },
  (t) => [
    unique('risk_pid_uq').on(t.projectId, t.id),
    uniqueIndex('risk_code_uq').on(t.projectId, t.code),
    projectFk('risk_ws_fk', t.projectId, t.workstreamId, (): FkTarget => workstream),
    check('risk_prob_chk', sql`${t.probability} between 1 and 5`),
    check('risk_impact_chk', sql`${t.impact} between 1 and 5`),
  ],
);

export const issue = pgTable(
  'issue',
  {
    ...raidCommon(),
    severity: smallint('severity').notNull().default(3), // 1..5
    resolution: text('resolution'),
    raisedFromRiskId: uuid('raised_from_risk_id'),
  },
  (t) => [
    unique('issue_pid_uq').on(t.projectId, t.id),
    uniqueIndex('issue_code_uq').on(t.projectId, t.code),
    projectFk('issue_ws_fk', t.projectId, t.workstreamId, (): FkTarget => workstream),
    projectFk('issue_risk_fk', t.projectId, t.raisedFromRiskId, (): FkTarget => risk),
  ],
);

export const assumption = pgTable(
  'assumption',
  {
    ...raidCommon(),
    basis: text('basis'),
    validationPlan: text('validation_plan'),
    verificationStatus: verificationStatus('verification_status').notNull().default('assumed'),
  },
  (t) => [
    unique('assumption_pid_uq').on(t.projectId, t.id),
    uniqueIndex('assumption_code_uq').on(t.projectId, t.code),
    projectFk('assumption_ws_fk', t.projectId, t.workstreamId, (): FkTarget => workstream),
  ],
);

/** RAID "dependency" (external/organizational dependency) — distinct from schedule `dependency`. */
export const raidDependency = pgTable(
  'raid_dependency',
  {
    ...raidCommon(),
    dependsOn: text('depends_on').notNull(),
    neededBy: date('needed_by', { mode: 'string' }),
  },
  (t) => [
    unique('raid_dependency_pid_uq').on(t.projectId, t.id),
    uniqueIndex('raid_dependency_code_uq').on(t.projectId, t.code),
    projectFk('raid_dependency_ws_fk', t.projectId, t.workstreamId, (): FkTarget => workstream),
  ],
);

/** Periodic workstream/project update: submit → review → return/accept; accepted updates are frozen. */
export const statusUpdate = pgTable(
  'status_update',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    workstreamId: uuid('workstream_id'),
    periodEnd: date('period_end', { mode: 'string' }).notNull(),
    summary: text('summary').notNull(),
    achievements: text('achievements'),
    nextSteps: text('next_steps'),
    blockers: text('blockers'),
    ragReported: ragStatus('rag_reported'),
    ragCalculated: ragStatus('rag_calculated'),
    status: updateStatus('status').notNull().default('draft'),
    submittedBy: uuid('submitted_by'),
    submittedAt: ts('submitted_at'),
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: ts('reviewed_at'),
    reviewNote: text('review_note'),
    frozenSnapshot: jsonb('frozen_snapshot').$type<Record<string, unknown>>(),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [unique('status_update_pid_uq').on(t.projectId, t.id), projectFk('status_update_ws_fk', t.projectId, t.workstreamId, (): FkTarget => workstream)],
);

/** Manual RAG override: reason, expiry, reviewer; calculated value retained (measurement rule 6). */
export const ragOverride = pgTable('rag_override', {
  id: pk(),
  orgId: orgIdCol(),
  projectId: projectIdCol().references(() => project.id),
  entityType: varchar('entity_type', { length: 32 }).notNull(),
  entityId: uuid('entity_id').notNull(),
  calculatedStatus: ragStatus('calculated_status').notNull(),
  overrideStatus: ragStatus('override_status').notNull(),
  reason: text('reason').notNull(),
  expiresOn: date('expires_on', { mode: 'string' }).notNull(),
  requestedBy: uuid('requested_by').notNull(),
  reviewerUserId: uuid('reviewer_user_id'),
  approved: boolean('approved').notNull().default(false),
  reviewedAt: ts('reviewed_at'),
  createdAt: createdAt(),
  version: versionCol(),
});

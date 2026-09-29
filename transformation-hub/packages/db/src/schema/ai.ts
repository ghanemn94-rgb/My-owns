import { pgTable, uuid, text, integer, jsonb, varchar, boolean, numeric, unique, index, uniqueIndex } from 'drizzle-orm/pg-core';
import {
  pk,
  orgIdCol,
  projectIdCol,
  createdAt,
  updatedAt,
  createdBy,
  versionCol,
  ts,
  projectFk,
  type FkTarget,
  aiMode,
  aiProvider,
  aiRunStatus,
  aiProposalStatus,
} from './_common';
import { project } from './portfolio';

/** Per-project AI settings. Mode defaults to OFF; advisory is the default once enabled (spec §12.3). */
export const aiProjectSettings = pgTable(
  'ai_project_settings',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    mode: aiMode('mode').notNull().default('off'),
    provider: aiProvider('provider').notNull().default('off'),
    model: varchar('model', { length: 128 }),
    killSwitch: boolean('kill_switch').notNull().default(false),
    killSwitchBy: uuid('kill_switch_by'),
    killSwitchAt: ts('kill_switch_at'),
    maxClassificationToProvider: varchar('max_classification_to_provider', { length: 32 }).notNull().default('internal'),
    monthlyTokenBudget: integer('monthly_token_budget').notNull().default(0),
    monthlyCostBudget: numeric('monthly_cost_budget', { precision: 12, scale: 2 }),
    costCurrency: varchar('cost_currency', { length: 3 }),
    perRunTokenLimit: integer('per_run_token_limit').notNull().default(20000),
    perRunTimeoutMs: integer('per_run_timeout_ms').notNull().default(60000),
    quietHoursStart: integer('quiet_hours_start'), // local hour 0-23
    quietHoursEnd: integer('quiet_hours_end'),
    briefingCron: varchar('briefing_cron', { length: 64 }),
    briefingTimezone: text('briefing_timezone').notNull().default('Asia/Riyadh'),
    autopilotPolicy: jsonb('autopilot_policy')
      .$type<{ allowlist: string[]; maxActionsPerDay: number; expiresOn: string | null; revoked: boolean; approvedBy?: string }>(),
    policyVersion: varchar('policy_version', { length: 32 }).notNull().default('ai-policy-1'),
    circuitOpenUntil: ts('circuit_open_until'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    updatedBy: uuid('updated_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [uniqueIndex('ai_project_settings_uq').on(t.projectId)],
);

export const aiRun = pgTable(
  'ai_run',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    kind: varchar('kind', { length: 32 }).notNull(), // briefing | weekly_summary | question | detection | extraction
    trigger: varchar('trigger', { length: 32 }).notNull(), // scheduled | event | user
    triggerRef: text('trigger_ref'),
    requestedBy: uuid('requested_by'), // human principal on whose behalf output is produced (ACL subject)
    serviceIdentity: varchar('service_identity', { length: 64 }).notNull().default('svc-ai-pm'),
    status: aiRunStatus('status').notNull().default('queued'),
    provider: aiProvider('provider').notNull(),
    model: varchar('model', { length: 128 }),
    locale: varchar('locale', { length: 5 }).notNull().default('en'),
    question: text('question'),
    output: jsonb('output').$type<Record<string, unknown>>(),
    evidenceSnapshot: jsonb('evidence_snapshot').$type<Record<string, unknown>>(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costEstimate: numeric('cost_estimate', { precision: 12, scale: 4 }),
    policyVersion: varchar('policy_version', { length: 32 }),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
    error: text('error'),
    createdAt: createdAt(),
  },
  (t) => [unique('ai_run_pid_uq').on(t.projectId, t.id), index('ai_run_project_idx').on(t.projectId, t.createdAt)],
);

export const aiProposal = pgTable(
  'ai_proposal',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    runId: uuid('run_id'),
    actionType: varchar('action_type', { length: 64 }).notNull(),
    targetType: varchar('target_type', { length: 32 }),
    targetId: uuid('target_id'),
    targetVersion: integer('target_version'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    payloadHash: varchar('payload_hash', { length: 64 }).notNull(),
    rationale: text('rationale'),
    citations: jsonb('citations').$type<{ type: string; id: string; label?: string; location?: string }[]>().notNull().default([]),
    status: aiProposalStatus('status').notNull().default('proposed'),
    policyVersion: varchar('policy_version', { length: 32 }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 200 }).notNull(),
    executionResult: jsonb('execution_result').$type<Record<string, unknown>>(),
    executedAt: ts('executed_at'),
    invalidatedReason: text('invalidated_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    unique('ai_proposal_pid_uq').on(t.projectId, t.id),
    uniqueIndex('ai_proposal_idem_uq').on(t.idempotencyKey),
    projectFk('ai_proposal_run_fk', t.projectId, t.runId, (): FkTarget => aiRun),
  ],
);

export const aiActionApproval = pgTable(
  'ai_action_approval',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    proposalId: uuid('proposal_id').notNull(),
    approverUserId: uuid('approver_user_id').notNull(),
    payloadHash: varchar('payload_hash', { length: 64 }).notNull(),
    targetVersion: integer('target_version'),
    expiresAt: ts('expires_at').notNull(),
    status: varchar('status', { length: 16 }).notNull().default('valid'), // valid | consumed | invalidated
    invalidatedReason: text('invalidated_reason'),
    createdAt: createdAt(),
  },
  (t) => [projectFk('ai_action_approval_proposal_fk', t.projectId, t.proposalId, (): FkTarget => aiProposal)],
);

/**
 * Derived AI artifacts (summaries/caches). Keyed by the ACL fingerprint of the principal and the source versions
 * used; invalidated on source/permission changes (spec §12.1).
 */
export const aiDerivedArtifact = pgTable(
  'ai_derived_artifact',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    kind: varchar('kind', { length: 32 }).notNull(),
    aclFingerprint: varchar('acl_fingerprint', { length: 64 }).notNull(),
    sourceRefs: jsonb('source_refs').$type<{ type: string; id: string; version?: number }[]>().notNull(),
    content: jsonb('content').$type<Record<string, unknown>>().notNull(),
    invalidatedAt: ts('invalidated_at'),
    invalidatedReason: text('invalidated_reason'),
    createdAt: createdAt(),
    createdBy: createdBy(),
  },
  (t) => [index('ai_derived_artifact_idx').on(t.projectId, t.kind, t.aclFingerprint)],
);

import { z } from 'zod';
import { AI_MODES, AI_PROVIDERS, AI_RUN_STATUSES, AI_PROPOSAL_STATUSES, AI_PROPOSABLE_ACTIONS, CLASSIFICATIONS } from '@hub/domain';
import { defineRoute, registerRoutes } from './route';
import { ProjectParams, idParams, Uuid, IsoDate, PageQuery, SortParam, paged, RequiredText, Text, ExpectedVersion, DecimalString, Currency, ServerMessageSchema } from './common';

/**
 * Runtime AI project manager — contract routes (spec §12, §15, §16; AT-17…AT-22, AT-28).
 * AI output is always labelled: `simulated: true` for the mock provider; real providers are "Not configured" until an
 * approved endpoint exists. Nothing here can approve, waive, verify, sign, close, pay, grant or change permissions.
 */

const Tag = ['ai'];
const VersionOrZero = z.number().int().min(0);
const Classification = z.enum(CLASSIFICATIONS);

export const AiCitationDto = z.object({
  type: z.string(),
  id: z.string(),
  version: z.number().int().nullable().optional(),
  location: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
  /** Arabic label, present only when the record has an Arabic (template) title — bilingual data, module guide §2 (QA-P5-04). */
  labelAr: z.string().nullable().optional(),
  isDemo: z.boolean().optional(),
});
export type AiCitation = z.infer<typeof AiCitationDto>;

export const AiClaimDto = z.object({ text: z.string(), kind: z.enum(['fact', 'inference']), citations: z.array(AiCitationDto) });

export const AI_DETECTION_CODES = [
  'task_overdue',
  'milestone_overdue',
  'owner_missing',
  'stale_update',
  'decision_bottleneck',
  'approval_bottleneck',
  'action_overdue',
  'predecessor_delay',
  'cp_open_gate_link',
  'cp_missing_evidence',
  'tsa_expiring',
  'readiness_blocker',
  'milestone_pending_evidence',
] as const;

export const AiDetectionDto = z.object({
  code: z.enum(AI_DETECTION_CODES),
  severity: z.enum(['info', 'warning', 'critical']),
  entityType: z.string(),
  entityId: z.string(),
  /** English / primary label (`<code> <title>`). */
  label: z.string(),
  /** Arabic label, present only when the record has an Arabic (template) title (QA-P5-04); a title typed by a person has none. */
  labelAr: z.string().nullable().optional(),
  /** English sentence (kept for audit and the English AI context). */
  detail: z.string(),
  /** The same as codes + parameters (`ai.detection.*`; enum values translated by the client) — QA-P5-04. */
  detailI18n: z.array(ServerMessageSchema).optional(),
  gateKey: z.string().nullable(),
  dueDate: z.string().nullable(),
  citations: z.array(AiCitationDto),
});
export type AiDetection = z.infer<typeof AiDetectionDto>;

export const AiRunOutputDto = z.object({
  simulated: z.boolean(),
  providerLabel: z.string(),
  headline: z.string(),
  claims: z.array(AiClaimDto),
  missing: z.array(z.object({ key: z.string(), description: z.string(), ownerRole: z.string().nullable() })),
  conflicts: z.array(z.object({ description: z.string(), citations: z.array(AiCitationDto) })),
  freshness: z.object({ asOf: z.string(), oldestSource: z.string().nullable(), newestSource: z.string().nullable(), staleSources: z.number().int() }),
  warnings: z.array(z.string()),
  detections: z.array(AiDetectionDto),
  proposals: z.array(z.object({ id: Uuid, actionType: z.string(), status: z.string() })),
  refusedToolCalls: z.array(z.object({ name: z.string(), reason: z.string() })),
  preparedRequests: z.array(z.object({ action: z.string(), text: z.string() })),
  withheldFromProvider: z.object({ aboveCeiling: z.number().int(), roomRestricted: z.number().int() }),
  droppedClaims: z.number().int(),
  disclaimer: z.string(),
});
export type AiRunOutput = z.infer<typeof AiRunOutputDto>;

export const AiRunSummaryDto = z.object({
  id: Uuid,
  kind: z.string(),
  trigger: z.string(),
  status: z.enum(AI_RUN_STATUSES),
  provider: z.enum(AI_PROVIDERS),
  model: z.string().nullable(),
  simulated: z.boolean(),
  locale: z.string(),
  question: z.string().nullable(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  costEstimate: z.string().nullable(),
  policyVersion: z.string().nullable(),
  error: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  createdAt: z.string(),
});
export const AiRunDto = AiRunSummaryDto.extend({
  output: AiRunOutputDto.nullable(),
  /** Names of the typed read tools the runtime invoked for this run (from its evidence snapshot; names only). */
  toolsUsed: z.array(z.string()),
});
export type AiRun = z.infer<typeof AiRunDto>;

export const AutopilotPolicyDto = z.object({
  allowlist: z.array(z.string()),
  maxActionsPerDay: z.number().int(),
  expiresOn: z.string().nullable(),
  revoked: z.boolean(),
  status: z.enum(['proposed', 'approved', 'revoked', 'expired']),
  proposedBy: z.string().nullable(),
  approvedBy: z.string().nullable(),
  approvedAt: z.string().nullable(),
});

export const AI_PROVIDER_STATUSES = ['off', 'simulated', 'not_configured', 'configured_unverified', 'egress_not_approved', 'disabled_by_config'] as const;

export const AiSettingsDto = z.object({
  projectId: Uuid,
  mode: z.enum(AI_MODES),
  provider: z.enum(AI_PROVIDERS),
  providerStatus: z.enum(AI_PROVIDER_STATUSES),
  model: z.string().nullable(),
  killSwitch: z.boolean(),
  killSwitchAt: z.string().nullable(),
  killSwitchBy: z.string().nullable(),
  maxClassificationToProvider: Classification,
  monthlyTokenBudget: z.number().int(),
  monthlyCostBudget: z.string().nullable(),
  costCurrency: z.string().nullable(),
  perRunTokenLimit: z.number().int(),
  perRunTimeoutMs: z.number().int(),
  quietHoursStart: z.number().int().nullable(),
  quietHoursEnd: z.number().int().nullable(),
  /** Deduplication / cooldown window of AI actions in hours (0 = off) — spec §12.4, AIT-27. */
  actionCooldownHours: z.number().int(),
  briefingCron: z.string().nullable(),
  briefingTimezone: z.string(),
  autopilotPolicy: AutopilotPolicyDto.nullable(),
  policyVersion: z.string(),
  version: z.number().int(),
  updatedAt: z.string().nullable(),
});
export type AiSettings = z.infer<typeof AiSettingsDto>;

const Cron = z.string().trim().regex(/^(\S+\s+){4}\S+$/, 'Five-field cron expression').max(64);
const Hour = z.number().int().min(0).max(23);

export const UpdateAiSettingsBody = z.object({
  expectedVersion: VersionOrZero,
  mode: z.enum(AI_MODES).optional(),
  provider: z.enum(AI_PROVIDERS).optional(),
  model: Text(128).nullable().optional(),
  maxClassificationToProvider: Classification.optional(),
  monthlyTokenBudget: z.number().int().min(0).max(1_000_000_000).optional(),
  monthlyCostBudget: DecimalString.nullable().optional(),
  costCurrency: Currency.nullable().optional(),
  perRunTokenLimit: z.number().int().min(500).max(200_000).optional(),
  perRunTimeoutMs: z.number().int().min(1000).max(300_000).optional(),
  quietHoursStart: Hour.nullable().optional(),
  quietHoursEnd: Hour.nullable().optional(),
  actionCooldownHours: z.number().int().min(0).max(168).optional(),
  briefingCron: Cron.nullable().optional(),
  briefingTimezone: z.string().trim().min(1).max(64).optional(),
  autopilotPolicy: z
    .object({ allowlist: z.array(z.enum(AI_PROPOSABLE_ACTIONS)).max(10), maxActionsPerDay: z.number().int().min(1).max(1000), expiresOn: IsoDate })
    .nullable()
    .optional(),
  reason: Text(1000).optional(),
}).strict(); // REQ-DAT-013: a generic update refuses unknown fields (400) instead of dropping them.

export const KillSwitchBody = z.object({ reason: RequiredText(1000) });
export const AutopilotApproveBody = z.object({ expectedVersion: ExpectedVersion, note: Text(1000).optional() });
export const AutopilotRevokeBody = z.object({ expectedVersion: ExpectedVersion, reason: RequiredText(1000) });

export const AskBody = z.object({
  question: RequiredText(2000),
  locale: z.enum(['en', 'ar']).optional(),
  /** Run in the worker instead of synchronously (the answer is fetched from GET .../ai/runs/:runId). */
  async: z.boolean().default(false),
});

export const AiApprovalDto = z.object({
  id: Uuid,
  approverUserId: Uuid,
  status: z.string(),
  expiresAt: z.string(),
  targetVersion: z.number().int().nullable(),
  invalidatedReason: z.string().nullable(),
  createdAt: z.string(),
});

export const AiProposalDto = z.object({
  id: Uuid,
  runId: Uuid.nullable(),
  actionType: z.string(),
  targetType: z.string().nullable(),
  targetId: Uuid.nullable(),
  targetVersion: z.number().int().nullable(),
  payload: z.record(z.string(), z.unknown()),
  payloadHash: z.string(),
  rationale: z.string().nullable(),
  citations: z.array(AiCitationDto),
  status: z.enum(AI_PROPOSAL_STATUSES),
  requestedBy: Uuid.nullable(),
  policyVersion: z.string(),
  invalidatedReason: z.string().nullable(),
  executionResult: z.record(z.string(), z.unknown()).nullable(),
  executedAt: z.string().nullable(),
  createdAt: z.string(),
  version: z.number().int(),
  approvals: z.array(AiApprovalDto),
  simulated: z.boolean(),
  /**
   * Display names of the people the reviewer must identify — the delegating user, the message recipient and the approvers
   * (QA-P5-05) — so an approver who cannot list the project members still sees who will receive the message.
   */
  people: z.array(z.object({ userId: Uuid, displayName: z.string() })),
});
export type AiProposal = z.infer<typeof AiProposalDto>;

export const ProposalCommandBody = z.object({ expectedVersion: ExpectedVersion, note: Text(1000).optional() });
export const ProposalRejectBody = z.object({ expectedVersion: ExpectedVersion, note: RequiredText(1000) });
export const ProposalReviseBody = z.object({ expectedVersion: ExpectedVersion, payload: z.record(z.string(), z.unknown()), note: Text(1000).optional() });

export const BriefingScheduleDto = z.object({
  id: Uuid,
  kind: z.enum(['daily', 'weekly']),
  cron: z.string(),
  timezone: z.string(),
  enabled: z.boolean(),
  ownerUserId: Uuid.nullable(),
  nextRunAt: z.string().nullable(),
  lastRunAt: z.string().nullable(),
  lastStatus: z.string().nullable(),
  lastError: z.string().nullable(),
  version: z.number().int(),
});
export const SubscribeBriefingBody = z.object({
  kind: z.enum(['daily', 'weekly']).default('daily'),
  cron: Cron.optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  enabled: z.boolean().default(true),
});

export const AiStatusDto = z.object({
  mode: z.enum(AI_MODES),
  provider: z.enum(AI_PROVIDERS),
  providerLabel: z.string(),
  providerStatus: z.enum(AI_PROVIDER_STATUSES),
  simulated: z.boolean(),
  killSwitch: z.boolean(),
  health: z.enum(['off', 'ok', 'degraded', 'circuit_open', 'budget_exhausted', 'kill_switch', 'not_configured']),
  failureReason: z.string().nullable(),
  lastRun: z.object({ id: Uuid, kind: z.string(), status: z.string(), finishedAt: z.string().nullable(), error: z.string().nullable() }).nullable(),
  nextRunAt: z.string().nullable(),
  circuitOpenUntil: z.string().nullable(),
  budget: z.object({
    month: z.string(),
    tokensUsed: z.number().int(),
    monthlyTokenBudget: z.number().int(),
    costUsed: z.string(),
    monthlyCostBudget: z.string().nullable(),
    currency: z.string().nullable(),
    exhausted: z.boolean(),
  }),
  manualFallback: z.string(),
  deterministicFeatures: z.array(z.string()),
  /**
   * Deployment status of every provider type (not only the one this project uses), so the UI can state honestly that a
   * real model endpoint is "Not configured" instead of assuming it. Statuses only — never a URL, host or secret.
   */
  endpoints: z.array(z.object({ provider: z.enum(AI_PROVIDERS), status: z.enum(AI_PROVIDER_STATUSES), simulated: z.boolean() })),
});

export const AiCostsDto = z.object({
  items: z.array(z.object({ month: z.string(), runs: z.number().int(), inputTokens: z.number().int(), outputTokens: z.number().int(), costEstimate: z.string() })),
  currency: z.string().nullable(),
  note: z.string(),
});

export const AiToolMatrixDto = z.object({
  items: z.array(
    z.object({
      name: z.string(),
      kind: z.enum(['retrieve', 'propose']),
      permission: z.string().nullable(),
      aiFlag: z.enum(['none', 'retrieve', 'propose']),
      action: z.string().nullable(),
      modes: z.array(z.enum(AI_MODES)),
      executable: z.string(),
      autopilotEligible: z.boolean(),
      description: z.string(),
    }),
  ),
  prohibitedActions: z.array(z.string()),
  policyVersion: z.string(),
});

export const AiArtifactDto = z.object({
  id: Uuid,
  kind: z.string(),
  sourceRefs: z.array(z.object({ type: z.string(), id: z.string(), version: z.number().int().optional() })),
  content: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});

export const aiRoutes = registerRoutes({
  getSettings: defineRoute({
    id: 'ai.settings.get',
    method: 'GET',
    path: '/api/v1/projects/:projectId/ai/settings',
    summary: 'AI settings of the project (mode, provider, budgets, schedule, autopilot policy, kill switch)',
    tags: Tag,
    access: 'ai.settings.manage',
    params: ProjectParams,
    response: AiSettingsDto,
  }),
  updateSettings: defineRoute({
    id: 'ai.settings.update',
    method: 'PUT',
    path: '/api/v1/projects/:projectId/ai/settings',
    summary: 'Update AI settings (enabling defaults to Advisory). Autopilot policies are only proposed here and need a separate approval.',
    tags: Tag,
    access: 'ai.settings.manage',
    params: ProjectParams,
    body: UpdateAiSettingsBody,
    response: AiSettingsDto,
  }),
  approveAutopilot: defineRoute({
    id: 'ai.autopilot.approve',
    method: 'POST',
    path: '/api/v1/projects/:projectId/ai/autopilot-policy/approve',
    summary: 'Approve the proposed autopilot policy (not by its proposer)',
    tags: Tag,
    access: 'ai.autopilot_policy.approve',
    command: true,
    params: ProjectParams,
    body: AutopilotApproveBody,
    response: AiSettingsDto,
  }),
  revokeAutopilot: defineRoute({
    id: 'ai.autopilot.revoke',
    method: 'POST',
    path: '/api/v1/projects/:projectId/ai/autopilot-policy/revoke',
    summary: 'Revoke the autopilot policy immediately',
    tags: Tag,
    access: 'ai.settings.manage',
    command: true,
    params: ProjectParams,
    body: AutopilotRevokeBody,
    response: AiSettingsDto,
  }),
  activateKillSwitch: defineRoute({
    id: 'ai.killswitch.activate',
    method: 'POST',
    path: '/api/v1/projects/:projectId/ai/killswitch/activate',
    summary: 'Emergency stop: block new runs, cancel queued AI jobs, invalidate pending approvals; history preserved',
    tags: Tag,
    access: 'ai.killswitch.activate',
    command: true,
    params: ProjectParams,
    body: KillSwitchBody,
    response: z.object({ killSwitch: z.literal(true), cancelledJobs: z.number().int(), invalidatedApprovals: z.number().int(), cancelledProposals: z.number().int(), cancelledDeliveries: z.number().int() }),
  }),
  releaseKillSwitch: defineRoute({
    id: 'ai.killswitch.release',
    method: 'POST',
    path: '/api/v1/projects/:projectId/ai/killswitch/release',
    summary: 'Release the emergency stop (a different person than the activator)',
    tags: Tag,
    access: 'ai.killswitch.release',
    command: true,
    params: ProjectParams,
    body: KillSwitchBody,
    response: z.object({ killSwitch: z.literal(false) }),
  }),
  ask: defineRoute({
    id: 'ai.ask',
    method: 'POST',
    path: '/api/v1/projects/:projectId/ai/ask',
    summary: 'Ask the AI project manager (grounded, cited, ACL-filtered). Advisory: no record changes.',
    tags: Tag,
    access: 'ai.assistant.use',
    params: ProjectParams,
    body: AskBody,
    response: AiRunDto,
  }),
  listRuns: defineRoute({
    id: 'ai.runs.list',
    method: 'GET',
    path: '/api/v1/projects/:projectId/ai/runs',
    summary: 'My AI runs (answers are per user and never shared). Service-enforced: ai.run.read, ai.assistant.use or ai.briefing.subscribe — a subscriber reads the briefings delivered to them (QA-P5-02)',
    tags: Tag,
    access: 'authenticated',
    params: ProjectParams,
    // Default order: newest first.
    query: PageQuery.extend({ sort: SortParam(['createdAt', 'kind', 'status']) }),
    response: paged(AiRunSummaryDto),
  }),
  getRun: defineRoute({
    id: 'ai.runs.get',
    method: 'GET',
    path: '/api/v1/projects/:projectId/ai/runs/:runId',
    summary: 'One of my AI runs; citations are re-checked against my current access on every read. Service-enforced: ai.run.read, ai.assistant.use or ai.briefing.subscribe (own runs only, QA-P5-02)',
    tags: Tag,
    access: 'authenticated',
    params: idParams('runId'),
    response: AiRunDto,
  }),
  status: defineRoute({
    id: 'ai.status',
    method: 'GET',
    path: '/api/v1/projects/:projectId/ai/status',
    summary: 'AI operational status: last/next run, health, failure reason, budget, manual fallback',
    tags: Tag,
    access: 'ai.run.read',
    params: ProjectParams,
    response: AiStatusDto,
  }),
  costs: defineRoute({
    id: 'ai.costs',
    method: 'GET',
    path: '/api/v1/projects/:projectId/ai/costs',
    summary: 'AI token usage and estimated cost per month',
    tags: Tag,
    access: 'ai.operations.read',
    params: ProjectParams,
    response: AiCostsDto,
  }),
  detections: defineRoute({
    id: 'ai.detections',
    method: 'GET',
    path: '/api/v1/projects/:projectId/ai/detections',
    summary: 'Deterministic detections (rules only; available with AI Off)',
    tags: Tag,
    access: 'planning.plan.read',
    params: ProjectParams,
    response: z.object({ items: z.array(AiDetectionDto), computedAt: z.string(), rulesOnly: z.literal(true), today: IsoDate }),
  }),
  tools: defineRoute({
    id: 'ai.tools',
    method: 'GET',
    path: '/api/v1/projects/:projectId/ai/tools',
    summary: 'AI tool / action permission matrix',
    tags: Tag,
    access: 'ai.assistant.use',
    params: ProjectParams,
    response: AiToolMatrixDto,
  }),
  listProposals: defineRoute({
    id: 'ai.proposals.list',
    method: 'GET',
    path: '/api/v1/projects/:projectId/ai/proposals',
    summary: 'AI proposals awaiting review / history',
    tags: Tag,
    access: 'ai.proposal.read',
    params: ProjectParams,
    // Default order: newest first.
    query: PageQuery.extend({ status: z.enum(AI_PROPOSAL_STATUSES).optional(), sort: SortParam(['createdAt', 'updatedAt', 'status', 'actionType']) }),
    response: paged(AiProposalDto),
  }),
  getProposal: defineRoute({
    id: 'ai.proposals.get',
    method: 'GET',
    path: '/api/v1/projects/:projectId/ai/proposals/:proposalId',
    summary: 'One AI proposal (404 when the reader may not see its target, its run inputs or the project — as the list)',
    tags: Tag,
    access: 'ai.proposal.read',
    params: idParams('proposalId'),
    response: AiProposalDto,
  }),
  approveProposal: defineRoute({
    id: 'ai.proposals.approve',
    method: 'POST',
    path: '/api/v1/projects/:projectId/ai/proposals/:proposalId/approve',
    summary: 'Approve an AI proposal (binds payload hash, target version, approver, expiry; not the requester)',
    tags: Tag,
    access: 'ai.proposal.approve',
    command: true,
    params: idParams('proposalId'),
    body: ProposalCommandBody,
    response: AiProposalDto,
  }),
  rejectProposal: defineRoute({
    id: 'ai.proposals.reject',
    method: 'POST',
    path: '/api/v1/projects/:projectId/ai/proposals/:proposalId/reject',
    summary: 'Reject an AI proposal',
    tags: Tag,
    access: 'ai.proposal.reject',
    command: true,
    params: idParams('proposalId'),
    body: ProposalRejectBody,
    response: AiProposalDto,
  }),
  reviseProposal: defineRoute({
    id: 'ai.proposals.revise',
    method: 'POST',
    path: '/api/v1/projects/:projectId/ai/proposals/:proposalId/revise',
    summary: 'Revise a proposal payload (requester only); invalidates existing approvals and requires a fresh review',
    tags: Tag,
    access: 'ai.assistant.use',
    command: true,
    params: idParams('proposalId'),
    body: ProposalReviseBody,
    response: AiProposalDto,
  }),
  listBriefings: defineRoute({
    id: 'ai.briefings.list',
    method: 'GET',
    path: '/api/v1/projects/:projectId/ai/briefings',
    summary: 'My briefing schedules',
    tags: Tag,
    access: 'ai.briefing.subscribe',
    params: ProjectParams,
    response: z.object({ items: z.array(BriefingScheduleDto) }),
  }),
  subscribeBriefing: defineRoute({
    id: 'ai.briefings.subscribe',
    method: 'POST',
    path: '/api/v1/projects/:projectId/ai/briefings',
    summary: 'Create/update my durable briefing schedule (cron in a timezone, default Asia/Riyadh); delivered to me only',
    tags: Tag,
    access: 'ai.briefing.subscribe',
    params: ProjectParams,
    body: SubscribeBriefingBody,
    response: BriefingScheduleDto,
  }),
  listArtifacts: defineRoute({
    id: 'ai.artifacts.list',
    method: 'GET',
    path: '/api/v1/projects/:projectId/ai/artifacts',
    summary: 'My AI drafts/derived artefacts that are still valid for my current access',
    tags: Tag,
    access: 'ai.assistant.use',
    params: ProjectParams,
    response: z.object({ items: z.array(AiArtifactDto) }),
  }),
});

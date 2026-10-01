import { z } from 'zod';
import {
  AI_MODES,
  INTEGRATION_KINDS,
  INTEGRATION_STATUSES,
  ONBOARDING_ITEMS,
  ONBOARDING_WARNINGS,
  PROJECT_STATUSES,
  RAG_STATUSES,
  RAG_THRESHOLD_STATES,
  RETENTION_YEARS_BOUNDS,
  RAG_THRESHOLD_BOUNDS,
  ROLE_KEYS,
  SETUP_STEPS,
  TEMPLATE_KINDS,
  TEMPLATE_MIGRATION_STATUSES,
} from '@hub/domain';
import { defineRoute, registerRoutes } from './route';
import { ClassificationSchema, ExpectedVersion, I18nTextSchema, ProjectParams, RequiredText, ServerMessageSchema, Text, Uuid } from './common';

/**
 * Project configuration (module `config`, REQ module project-config): RAG thresholds per project (REQ-PLN-019), template
 * upgrades with preview and approval (REQ-ENT-009, AT-26), setup wizard steps 7–8 and the onboarding checklist
 * (REQ-SET-007, -015, -016), template administration (read-only) and the deployment settings (REQ-UX-020).
 */

const T = ['config'];
const p = (s: string) => `/api/v1/projects/:projectId${s}`;
const Messages = z.array(ServerMessageSchema);

// =====================================================================================================================
// RAG thresholds

const SlipDays = z.number().int().min(0).max(RAG_THRESHOLD_BOUNDS.maxSlipDays);
const StaleDays = z.number().int().min(RAG_THRESHOLD_BOUNDS.minStaleDays).max(RAG_THRESHOLD_BOUNDS.maxStaleDays);
export const RagThresholdsSchema = z.object({ greenMaxSlipDays: SlipDays, amberMaxSlipDays: SlipDays, staleAfterDays: StaleDays });

export const RagThresholdsRefDto = z.object({
  source: z.enum(['approved', 'template_default']),
  versionNo: z.number().int().nullable(),
  templateVersionNo: z.number().int(),
});

export const RagThresholdVersionDto = z.object({
  /** The approval request of the change. */
  id: Uuid,
  versionNo: z.number().int(),
  state: z.enum(RAG_THRESHOLD_STATES),
  thresholds: RagThresholdsSchema,
  /** The thresholds in force when the change was proposed. */
  basedOn: z.object({ ref: RagThresholdsRefDto, thresholds: RagThresholdsSchema }),
  reason: z.string(),
  proposedBy: Uuid,
  proposedByName: z.string().nullable(),
  proposedAt: z.string(),
  decidedBy: Uuid.nullable(),
  decidedByName: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decisionNote: z.string().nullable(),
  version: z.number().int(),
});

export const RagThresholdsDto = z.object({
  inForce: z.object({
    thresholds: RagThresholdsSchema,
    ref: RagThresholdsRefDto,
    approvedAt: z.string().nullable(),
    approvedByName: z.string().nullable(),
  }),
  templateDefault: z.object({ thresholds: RagThresholdsSchema, templateKey: z.string(), templateVersionNo: z.number().int() }),
  /** The explanation of each calculated status under the thresholds in force. */
  rules: z.array(z.object({ status: z.enum(RAG_STATUSES), explanation: z.string(), explanationI18n: Messages })),
  pendingId: Uuid.nullable(),
  versions: z.array(RagThresholdVersionDto),
});

export const ProposeRagThresholdsBody = RagThresholdsSchema.extend({ reason: RequiredText(2000) }).strict();
const DecideBody = z.object({ expectedVersion: ExpectedVersion, note: Text(2000).optional() }).strict();
const RejectBody = z.object({ expectedVersion: ExpectedVersion, reason: RequiredText(2000) }).strict();
const RagCommandResult = z.object({ id: Uuid, versionNo: z.number().int(), state: z.enum(RAG_THRESHOLD_STATES), version: z.number().int() });

// =====================================================================================================================
// Template upgrades (AT-26)

const Keys = z.array(z.string());
export const TemplateDiffDto = z.object({
  addedGates: Keys,
  removedGates: Keys,
  changedGates: Keys,
  addedCriteria: Keys,
  removedCriteria: Keys,
  addedWorkstreams: Keys,
  removedWorkstreams: Keys,
  changedWorkstreams: Keys,
  addedActivities: Keys,
  removedActivities: Keys,
  changedActivities: Keys,
  addedKpis: Keys,
  removedKpis: Keys,
  changedKpis: Keys,
  kpiTextsArabicOnly: Keys,
  addedPhases: Keys,
  removedPhases: Keys,
  changedPhases: Keys,
  addedStatusDimensions: Keys,
  removedStatusDimensions: Keys,
  addedReadinessChecks: Keys,
  removedReadinessChecks: Keys,
  ragPolicyChanged: z.boolean(),
});

const RagValues = z.object({ greenMaxSlipDays: z.number().int(), amberMaxSlipDays: z.number().int(), staleAfterDays: z.number().int() });
export const UPGRADE_KEEP_KINDS = ['gate', 'criterion', 'workstream', 'activity', 'kpi', 'phase', 'status_dimension', 'readiness_check'] as const;
export const UPGRADE_KEEP_REASONS = ['removed_in_new_version', 'changed_in_new_version', 'added_to_existing_gate'] as const;
export const TemplateUpgradePlanDto = z.object({
  templateKey: z.string(),
  fromVersionNo: z.number().int(),
  toVersionNo: z.number().int(),
  add: z.object({
    workstreams: z.array(z.object({ key: z.string(), name: I18nTextSchema })),
    gates: z.array(z.object({ key: z.string(), name: I18nTextSchema, criteria: z.number().int() })),
    activities: z.array(z.object({ id: z.string(), workstreamKey: z.string(), title: I18nTextSchema, isMilestone: z.boolean() })),
    kpis: z.array(z.object({ key: z.string(), name: I18nTextSchema })),
  }),
  keep: z.array(z.object({ kind: z.enum(UPGRADE_KEEP_KINDS), key: z.string(), reason: z.enum(UPGRADE_KEEP_REASONS) })),
  texts: z.object({ kpisArabic: Keys, phasesAdded: Keys, phasesRemoved: Keys, phasesChanged: Keys }),
  statusDimensionsAdded: Keys,
  readinessChecksAvailable: Keys,
  ragDefaults: z.object({ from: RagValues, to: RagValues, changed: z.boolean(), appliesToProject: z.boolean() }),
  versionOnly: z.boolean(),
  diff: TemplateDiffDto,
});

export const TemplateUpgradeResultDto = z.object({
  workstreams: z.number().int(),
  gates: z.number().int(),
  criteria: z.number().int(),
  tasks: z.number().int(),
  milestones: z.number().int(),
  deliverables: z.number().int(),
  dependencies: z.number().int(),
  kpis: z.number().int(),
});

export const TemplateUpgradeDto = z.object({
  id: Uuid,
  fromVersionId: Uuid,
  fromVersionNo: z.number().int(),
  toVersionId: Uuid,
  toVersionNo: z.number().int(),
  status: z.enum(TEMPLATE_MIGRATION_STATUSES),
  plan: TemplateUpgradePlanDto,
  planHash: z.string(),
  reason: z.string().nullable(),
  proposedBy: Uuid.nullable(),
  proposedByName: z.string().nullable(),
  createdAt: z.string(),
  decidedBy: Uuid.nullable(),
  decidedByName: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decisionNote: z.string().nullable(),
  appliedAt: z.string().nullable(),
  result: TemplateUpgradeResultDto.nullable(),
  /** For an open proposal: false when the project or the template changed since the preview (approval would be refused). */
  current: z.boolean(),
  version: z.number().int(),
});

const TemplateRef = z.object({
  templateId: Uuid,
  templateKey: z.string(),
  kind: z.enum(TEMPLATE_KINDS),
  name: z.string(),
  nameAr: z.string().nullable(),
  versionId: Uuid,
  versionNo: z.number().int(),
});

export const TemplateUpgradesDto = z.object({
  current: TemplateRef,
  available: z.array(z.object({ versionId: Uuid, versionNo: z.number().int(), publishedAt: z.string().nullable() })),
  items: z.array(TemplateUpgradeDto),
});

// =====================================================================================================================
// Setup wizard (steps 7–8) and onboarding checklist

export const SetupDto = z.object({
  status: z.enum(PROJECT_STATUSES),
  isDemo: z.boolean(),
  templateKind: z.enum(TEMPLATE_KINDS),
  version: z.number().int(),
  checklist: z.object({
    items: z.array(
      z.object({
        key: z.enum(ONBOARDING_ITEMS),
        step: z.enum(SETUP_STEPS),
        state: z.enum(['done', 'open', 'not_applicable']),
        /** Roles that can complete or approve the item (from the policy matrix — never a named person). */
        byRoles: z.array(z.enum(ROLE_KEYS)),
        /** When / by whom it was approved, read from the record (null when open, not applicable or not readable by the caller). */
        evidence: z.object({ at: z.string().nullable(), byName: z.string().nullable() }).nullable(),
      }),
    ),
    warnings: z.array(z.enum(ONBOARDING_WARNINGS)),
    blockingGaps: z.array(z.enum(ONBOARDING_ITEMS)),
  }),
  policies: z.object({
    classification: ClassificationSchema,
    retentionYears: z.number().int().nullable(),
    reviewedAt: z.string().nullable(),
    reviewedByName: z.string().nullable(),
  }),
  ai: z.object({ mode: z.enum(AI_MODES), killSwitch: z.boolean(), isDefault: z.boolean() }),
  /** Organization integration connections with their honest status (`verified` only after a real connectivity check). */
  integrations: z.array(z.object({ kind: z.enum(INTEGRATION_KINDS), name: z.string(), status: z.enum(INTEGRATION_STATUSES), enabled: z.boolean() })),
  launch: z.object({ at: z.string(), byName: z.string().nullable(), acknowledgedGaps: z.array(z.enum(ONBOARDING_WARNINGS)), note: z.string().nullable() }).nullable(),
});

export const SetupPoliciesBody = z
  .object({
    expectedVersion: ExpectedVersion,
    classification: ClassificationSchema,
    retentionYears: z.number().int().min(RETENTION_YEARS_BOUNDS.min).max(RETENTION_YEARS_BOUNDS.max).nullable(),
    reason: Text(2000).optional(),
  })
  .strict();

export const LaunchBody = z
  .object({
    expectedVersion: ExpectedVersion,
    acknowledgedGaps: z.array(z.enum(ONBOARDING_WARNINGS)).max(ONBOARDING_WARNINGS.length).default([]),
    note: Text(2000).optional(),
  })
  .strict();

// =====================================================================================================================
// Administration (read-only): templates and deployment settings

export const AdminTemplatesDto = z.object({
  items: z.array(
    z.object({
      templateId: Uuid,
      key: z.string(),
      kind: z.enum(TEMPLATE_KINDS),
      name: z.string(),
      nameAr: z.string().nullable(),
      versions: z.array(
        z.object({
          id: Uuid,
          versionNo: z.number().int(),
          status: z.string(),
          publishedAt: z.string().nullable(),
          counts: z.object({ gates: z.number().int(), workstreams: z.number().int(), activities: z.number().int(), kpis: z.number().int() }),
          /** Projects pinned to this version, among the projects the caller may see. */
          projects: z.number().int(),
        }),
      ),
    }),
  ),
});

export const DeploymentSettingsDto = z.object({
  appName: z.string(),
  nodeEnv: z.string(),
  mode: z.enum(['demo', 'standard']),
  privateMode: z.boolean(),
  /** Host names allowed for outbound calls (no credentials, no paths). */
  egressAllowlist: z.array(z.string()),
  identity: z.object({
    oidcConfigured: z.boolean(),
    oidcIssuerHost: z.string().nullable(),
    linkByEmail: z.boolean(),
    demoLogin: z.boolean(),
    cookieSecure: z.boolean(),
    sessionIdleMinutes: z.number().int(),
    sessionAbsoluteHours: z.number().int(),
  }),
  storage: z.object({
    driver: z.enum(['local', 's3']),
    s3: z.object({ endpointHost: z.string(), bucket: z.string(), region: z.string(), sse: z.string(), kmsKeyConfigured: z.boolean() }).nullable(),
    maxUploadMb: z.number().int(),
    allowUnscannedFiles: z.boolean(),
  }),
  ai: z.object({ mockProviderAllowed: z.boolean(), openAiCompatibleEndpointHost: z.string().nullable(), anthropicGatewayHost: z.string().nullable() }),
  rateLimits: z.object({ perMinute: z.number().int(), mutationsPerMinute: z.number().int(), publicPerMinute: z.number().int() }),
  /** Accepted but noteworthy settings, as logged at start-up (no values of secrets). */
  warnings: z.array(z.string()),
});

export const configRoutes = registerRoutes({
  // ---------------------------------------------------------------------------------------------- RAG thresholds
  getRagThresholds: defineRoute({
    id: 'config.getRagThresholds',
    method: 'GET',
    path: p('/rag-thresholds'),
    summary: 'RAG thresholds in force (approved project version or the template default), the rule of each status, and the version history',
    tags: T,
    access: 'portfolio.project.read',
    params: ProjectParams,
    response: RagThresholdsDto,
  }),
  proposeRagThresholds: defineRoute({
    id: 'config.proposeRagThresholds',
    method: 'POST',
    path: p('/rag-thresholds'),
    summary: 'Propose a new RAG threshold version (in force only once another person approves it)',
    tags: T,
    access: 'config.project_settings.manage',
    command: true,
    params: ProjectParams,
    body: ProposeRagThresholdsBody,
    response: RagCommandResult,
  }),
  approveRagThresholds: defineRoute({
    id: 'config.approveRagThresholds',
    method: 'POST',
    path: p('/rag-thresholds/:requestId/approve'),
    summary: 'Approve a proposed RAG threshold version (not the proposer); the previous approved version is superseded',
    tags: T,
    access: 'config.project_settings.approve',
    command: true,
    params: ProjectParams.extend({ requestId: Uuid }),
    body: DecideBody,
    response: RagCommandResult,
  }),
  rejectRagThresholds: defineRoute({
    id: 'config.rejectRagThresholds',
    method: 'POST',
    path: p('/rag-thresholds/:requestId/reject'),
    summary: 'Reject a proposed RAG threshold version (reason required); the thresholds in force stay unchanged',
    tags: T,
    access: 'config.project_settings.approve',
    command: true,
    params: ProjectParams.extend({ requestId: Uuid }),
    body: RejectBody,
    response: RagCommandResult,
  }),
  withdrawRagThresholds: defineRoute({
    id: 'config.withdrawRagThresholds',
    method: 'POST',
    path: p('/rag-thresholds/:requestId/withdraw'),
    summary: 'Withdraw your own pending RAG threshold proposal',
    tags: T,
    access: 'config.project_settings.manage',
    command: true,
    params: ProjectParams.extend({ requestId: Uuid }),
    body: DecideBody,
    response: RagCommandResult,
  }),
  // ---------------------------------------------------------------------------------------------- Template upgrades
  listTemplateUpgrades: defineRoute({
    id: 'config.listTemplateUpgrades',
    method: 'GET',
    path: p('/template-upgrades'),
    summary: 'Pinned template version, newer published versions and the upgrade history of the project',
    tags: T,
    access: 'config.template.read',
    params: ProjectParams,
    response: TemplateUpgradesDto,
  }),
  previewTemplateUpgrade: defineRoute({
    id: 'config.previewTemplateUpgrade',
    method: 'POST',
    path: p('/template-upgrades/preview'),
    summary: 'Preview what moving the project to a newer template version would change (nothing is changed)',
    tags: T,
    access: 'config.template.read',
    params: ProjectParams,
    body: z.object({ toVersionId: Uuid }).strict(),
    response: z.object({ toVersionId: Uuid, plan: TemplateUpgradePlanDto, planHash: z.string() }),
  }),
  proposeTemplateUpgrade: defineRoute({
    id: 'config.proposeTemplateUpgrade',
    method: 'POST',
    path: p('/template-upgrades'),
    summary: 'Propose the previewed template upgrade for approval (the project stays on its version until approved)',
    tags: T,
    access: 'config.template_migration.propose',
    command: true,
    params: ProjectParams,
    body: z.object({ toVersionId: Uuid, planHash: z.string().regex(/^[0-9a-f]{64}$/), reason: RequiredText(2000) }).strict(),
    response: TemplateUpgradeDto,
  }),
  getTemplateUpgrade: defineRoute({
    id: 'config.getTemplateUpgrade',
    method: 'GET',
    path: p('/template-upgrades/:upgradeId'),
    summary: 'A template upgrade with the plan the approver decides on',
    tags: T,
    access: 'config.template.read',
    params: ProjectParams.extend({ upgradeId: Uuid }),
    response: TemplateUpgradeDto,
  }),
  approveTemplateUpgrade: defineRoute({
    id: 'config.approveTemplateUpgrade',
    method: 'POST',
    path: p('/template-upgrades/:upgradeId/approve'),
    summary: 'Approve the template upgrade (not the proposer): applied in the same transaction exactly as previewed',
    tags: T,
    access: 'config.template_migration.approve',
    command: true,
    params: ProjectParams.extend({ upgradeId: Uuid }),
    body: DecideBody,
    response: TemplateUpgradeDto,
  }),
  rejectTemplateUpgrade: defineRoute({
    id: 'config.rejectTemplateUpgrade',
    method: 'POST',
    path: p('/template-upgrades/:upgradeId/reject'),
    summary: 'Reject the template upgrade (reason required); nothing changes',
    tags: T,
    access: 'config.template_migration.approve',
    command: true,
    params: ProjectParams.extend({ upgradeId: Uuid }),
    body: RejectBody,
    response: TemplateUpgradeDto,
  }),
  // ---------------------------------------------------------------------------------------------- Setup wizard
  getSetup: defineRoute({
    id: 'config.getSetup',
    method: 'GET',
    path: p('/setup'),
    summary: 'Onboarding checklist (required approvals and gap list), confidentiality / retention / AI mode / integrations, launch state',
    tags: T,
    access: 'portfolio.project.read',
    params: ProjectParams,
    response: SetupDto,
  }),
  setupPolicies: defineRoute({
    id: 'config.setupPolicies',
    method: 'POST',
    path: p('/setup/steps/policies'),
    summary: 'Setup wizard step 7: confidentiality (project classification) and retention, while the project is in setup',
    tags: T,
    access: 'config.project_settings.manage',
    command: true,
    params: ProjectParams,
    body: SetupPoliciesBody,
    response: z.object({ version: z.number().int() }),
  }),
  launch: defineRoute({
    id: 'config.launch',
    method: 'POST',
    path: p('/setup/launch'),
    summary: 'Setup wizard step 8: launch monitoring (setup → active) — refused while a required onboarding item is open; the gap list is returned and recorded',
    tags: T,
    access: 'config.project_settings.manage',
    command: true,
    params: ProjectParams,
    body: LaunchBody,
    response: z.object({ status: z.enum(PROJECT_STATUSES), version: z.number().int(), launchedAt: z.string(), acknowledgedGaps: z.array(z.enum(ONBOARDING_WARNINGS)) }),
  }),
  // ---------------------------------------------------------------------------------------------- Administration
  adminTemplates: defineRoute({
    id: 'config.adminTemplates',
    method: 'GET',
    path: '/api/v1/admin/templates',
    summary: 'Templates with every version, its status and how many projects are pinned to it',
    tags: T,
    access: { org: 'config.template.read' },
    response: AdminTemplatesDto,
  }),
  adminTemplateDiff: defineRoute({
    id: 'config.adminTemplateDiff',
    method: 'GET',
    path: '/api/v1/admin/templates/versions/:versionId/diff',
    summary: 'What a template version changes compared with an earlier version of the same template',
    tags: T,
    access: { org: 'config.template.read' },
    params: z.object({ versionId: Uuid }),
    query: z.object({ from: Uuid }),
    response: z.object({ templateKey: z.string(), fromVersionNo: z.number().int(), toVersionNo: z.number().int(), diff: TemplateDiffDto }),
  }),
  deploymentSettings: defineRoute({
    id: 'config.deploymentSettings',
    method: 'GET',
    path: '/api/v1/admin/deployment-settings',
    summary: 'Deployment configuration as running (no secrets: only whether each one is configured)',
    tags: T,
    access: { org: 'admin.org_settings.manage' },
    response: DeploymentSettingsDto,
  }),
});

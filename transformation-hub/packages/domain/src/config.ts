import { ruleViolation } from './errors';
import type { AiMode, RagStatus, TemplateKind } from './enums';
import { DEFAULT_RAG_THRESHOLDS, type RagThresholds, type RagThresholdsRef } from './measurement';
import type { ServerMessage } from './messages';
import { planMessage, planningEn } from './planning-messages';
import { diffTemplates, type I18nText, type ProjectTemplateDefinition, type TemplateDiff } from './templates';
import type { Machine } from './workflows';

/**
 * Project configuration rules (module project-config / `config`): RAG thresholds per project (REQ-PLN-019, DOM-P2-08),
 * template upgrade plans (REQ-ENT-009, AT-26) and the onboarding checklist of the setup wizard (REQ-SET-007, -015, -016).
 * Pure functions — the API loads the facts and applies these rules inside the request transaction.
 */

// =====================================================================================================================
// RAG thresholds (spec §9 measurement rule 4)

/**
 * A threshold change is an `approval_request` (action `config.rag_thresholds.change`, subject = the project, subject
 * version = the threshold version number): pending until a second person approves it; only an APPROVED version is ever in
 * force — the latest one (older approved versions are shown as superseded).
 */
export const RAG_THRESHOLD_CHANGE_ACTION = 'config.rag_thresholds.change';
export const RAG_THRESHOLD_STATES = ['pending', 'approved', 'superseded', 'rejected', 'withdrawn'] as const;
export type RagThresholdState = (typeof RAG_THRESHOLD_STATES)[number];
export type RagThresholdCommand = 'approve' | 'reject' | 'withdraw';
type StoredState = Exclude<RagThresholdState, 'superseded'>;

export const RAG_THRESHOLD_MACHINE: Machine<StoredState, RagThresholdCommand> = {
  approve: { from: ['pending'], to: 'approved', description: 'Approved — in force from now on (the previous approved version is superseded)' },
  reject: { from: ['pending'], to: 'rejected', description: 'Rejected — the thresholds in force stay unchanged' },
  withdraw: { from: ['pending'], to: 'withdrawn', description: 'Withdrawn by the proposer' },
};

/** Validation bounds (working days for slips, calendar days for freshness). Bounds, not proposed values. */
export const RAG_THRESHOLD_BOUNDS = { maxSlipDays: 260, minStaleDays: 1, maxStaleDays: 90 } as const;

/** Refusal codes of an invalid threshold set (empty = valid). */
export function ragThresholdIssues(t: RagThresholds): string[] {
  const issues: string[] = [];
  const vals = [t.greenMaxSlipDays, t.amberMaxSlipDays, t.staleAfterDays];
  if (!vals.every((v) => Number.isInteger(v))) return ['config.rag_thresholds.not_integer'];
  if (t.greenMaxSlipDays < 0 || t.amberMaxSlipDays < 0) issues.push('config.rag_thresholds.negative');
  if (t.greenMaxSlipDays > RAG_THRESHOLD_BOUNDS.maxSlipDays || t.amberMaxSlipDays > RAG_THRESHOLD_BOUNDS.maxSlipDays) issues.push('config.rag_thresholds.slip_out_of_range');
  if (t.amberMaxSlipDays < t.greenMaxSlipDays) issues.push('config.rag_thresholds.amber_below_green');
  if (t.staleAfterDays < RAG_THRESHOLD_BOUNDS.minStaleDays || t.staleAfterDays > RAG_THRESHOLD_BOUNDS.maxStaleDays) issues.push('config.rag_thresholds.stale_out_of_range');
  return issues;
}

export function assertRagThresholds(t: RagThresholds): void {
  const issues = ragThresholdIssues(t);
  if (issues.length) {
    throw ruleViolation(issues[0]!, `Invalid RAG thresholds: green ≤ amber, both 0–${RAG_THRESHOLD_BOUNDS.maxSlipDays} working days; freshness ${RAG_THRESHOLD_BOUNDS.minStaleDays}–${RAG_THRESHOLD_BOUNDS.maxStaleDays} days`, { issues });
  }
}

export const sameRagThresholds = (a: RagThresholds, b: RagThresholds) =>
  a.greenMaxSlipDays === b.greenMaxSlipDays && a.amberMaxSlipDays === b.amberMaxSlipDays && a.staleAfterDays === b.staleAfterDays;

/**
 * The proposed default of a template version: its stated slip thresholds (version 2 and later) or the platform's proposed
 * defaults, and its freshness window (`ragPolicy.staleAfterDays`).
 */
export function templateRagThresholds(def: Pick<ProjectTemplateDefinition, 'ragPolicy'> | null | undefined): RagThresholds {
  const p = def?.ragPolicy;
  return {
    greenMaxSlipDays: p?.thresholds?.greenMaxSlipDays ?? DEFAULT_RAG_THRESHOLDS.greenMaxSlipDays,
    amberMaxSlipDays: p?.thresholds?.amberMaxSlipDays ?? DEFAULT_RAG_THRESHOLDS.amberMaxSlipDays,
    staleAfterDays: p?.staleAfterDays ?? DEFAULT_RAG_THRESHOLDS.staleAfterDays,
  };
}

/** Thresholds in force: the project's latest APPROVED version, else the pinned template version's proposed default. */
export function ragThresholdsInForce(
  def: Pick<ProjectTemplateDefinition, 'ragPolicy'> | null | undefined,
  templateVersionNo: number,
  approved: { versionNo: number; thresholds: RagThresholds } | null,
): { thresholds: RagThresholds; ref: RagThresholdsRef } {
  if (approved) return { thresholds: approved.thresholds, ref: { source: 'approved', versionNo: approved.versionNo, templateVersionNo } };
  return { thresholds: templateRagThresholds(def), ref: { source: 'template_default', versionNo: null, templateVersionNo } };
}

/** The explanation of each calculated status under a threshold set (spec §9 rule 4 "an explanation for each status"). */
export function ragStatusRules(t: RagThresholds): { status: RagStatus; explanation: string; explanationI18n: ServerMessage[] }[] {
  const rule = (status: RagStatus, params: Record<string, number> = {}) => {
    const explanationI18n = [planMessage(`plan.rag.rule.${status}`, params)];
    return { status, explanation: planningEn(explanationI18n), explanationI18n };
  };
  return [
    rule('green', { green: t.greenMaxSlipDays, stale: t.staleAfterDays }),
    rule('amber', { green: t.greenMaxSlipDays, amber: t.amberMaxSlipDays }),
    rule('red', { amber: t.amberMaxSlipDays }),
    rule('stale', { stale: t.staleAfterDays }),
    rule('unknown'),
    rule('not_updated'),
  ];
}

// =====================================================================================================================
// Template upgrade plan (REQ-ENT-009, AT-26)

/** What a project already holds from its template (keys only), read by the API. */
export interface ProjectTemplateFootprint {
  gateKeys: string[];
  /** Workstream template keys (or codes for workstreams created without a template key). */
  workstreamKeys: string[];
  /** Template activity ids of the project's tasks and milestone codes. */
  activityIds: string[];
  kpiKeys: string[];
  hasApprovedRagThresholds: boolean;
}

export type UpgradeKeepKind = 'gate' | 'criterion' | 'workstream' | 'activity' | 'kpi' | 'phase' | 'status_dimension' | 'readiness_check';
export type UpgradeKeepReason = 'removed_in_new_version' | 'changed_in_new_version' | 'added_to_existing_gate';

export interface TemplateUpgradePlan {
  templateKey: string;
  fromVersionNo: number;
  toVersionNo: number;
  /** Created in the project when the upgrade is approved (new in the new version and not in the project yet). */
  add: {
    workstreams: { key: string; name: I18nText }[];
    gates: { key: string; name: I18nText; criteria: number }[];
    activities: { id: string; workstreamKey: string; title: I18nText; isMilestone: boolean }[];
    kpis: { key: string; name: I18nText }[];
  };
  /** NOT applied: the project's existing records keep their values; any change goes through the owning module's commands. */
  keep: { kind: UpgradeKeepKind; key: string; reason: UpgradeKeepReason }[];
  /** Texts read from the pinned version that change with it (phases shown on the overview, Arabic KPI texts). */
  texts: { kpisArabic: string[]; phasesAdded: string[]; phasesRemoved: string[]; phasesChanged: string[] };
  /** Status dimensions of the new version that the project lacks: added by the status-dimension recompute after the upgrade. */
  statusDimensionsAdded: string[];
  /** Readiness default checks new in the new version: offered by Readiness → "checklist from template" (never auto-created). */
  readinessChecksAvailable: string[];
  /** The template default RAG thresholds before / after, and whether the project uses them (no approved project version). */
  ragDefaults: { from: RagThresholds; to: RagThresholds; changed: boolean; appliesToProject: boolean };
  /** True when approving the upgrade changes nothing but the pinned version number. */
  versionOnly: boolean;
  diff: TemplateDiff;
}

export function templateUpgradePlan(
  from: ProjectTemplateDefinition,
  to: ProjectTemplateDefinition,
  versions: { templateKey: string; fromVersionNo: number; toVersionNo: number },
  project: ProjectTemplateFootprint,
): TemplateUpgradePlan {
  const diff = diffTemplates(from, to);
  const has = (xs: string[]) => new Set(xs);
  const pGates = has(project.gateKeys), pWs = has(project.workstreamKeys), pAct = has(project.activityIds), pKpi = has(project.kpiKeys);
  const addedWs = to.workstreams.filter((w) => diff.addedWorkstreams.includes(w.key) && !pWs.has(w.key));
  const wsAvailable = new Set([...pWs, ...addedWs.map((w) => w.key)]);
  const add = {
    workstreams: addedWs.map((w) => ({ key: w.key, name: w.name })),
    gates: to.gates.filter((g) => diff.addedGates.includes(g.key) && !pGates.has(g.key)).map((g) => ({ key: g.key, name: g.name, criteria: g.criteria.length })),
    activities: to.wbs
      .filter((a) => diff.addedActivities.includes(a.id) && !pAct.has(a.id) && wsAvailable.has(a.workstreamKey))
      .map((a) => ({ id: a.id, workstreamKey: a.workstreamKey, title: a.title, isMilestone: a.isMilestone })),
    kpis: to.kpis.filter((k) => diff.addedKpis.includes(k.key) && !pKpi.has(k.key)).map((k) => ({ key: k.key, name: k.name })),
  };
  const keep: TemplateUpgradePlan['keep'] = [];
  const k = (kind: UpgradeKeepKind, keys: string[], present: Set<string> | null, reason: UpgradeKeepReason) => {
    for (const key of keys) if (!present || present.has(key)) keep.push({ kind, key, reason });
  };
  k('gate', diff.removedGates, pGates, 'removed_in_new_version');
  k('gate', diff.changedGates, pGates, 'changed_in_new_version');
  // Criteria of a gate the project already has are never added or removed retroactively (gate definition management).
  const existingGateCriteria = (def: ProjectTemplateDefinition, keys: string[]) =>
    def.gates.filter((g) => pGates.has(g.key) && !diff.addedGates.includes(g.key)).flatMap((g) => g.criteria.map((c) => c.key)).filter((c) => keys.includes(c));
  k('criterion', existingGateCriteria(to, diff.addedCriteria), null, 'added_to_existing_gate');
  k('criterion', existingGateCriteria(from, diff.removedCriteria), null, 'removed_in_new_version');
  k('workstream', diff.removedWorkstreams, pWs, 'removed_in_new_version');
  k('workstream', diff.changedWorkstreams, pWs, 'changed_in_new_version');
  k('activity', diff.removedActivities, pAct, 'removed_in_new_version');
  k('activity', diff.changedActivities, pAct, 'changed_in_new_version');
  k('kpi', diff.removedKpis, pKpi, 'removed_in_new_version');
  k('kpi', diff.changedKpis, pKpi, 'changed_in_new_version');
  k('status_dimension', diff.removedStatusDimensions, null, 'removed_in_new_version');
  k('readiness_check', diff.removedReadinessChecks, null, 'removed_in_new_version');
  const fromRag = templateRagThresholds(from);
  const toRag = templateRagThresholds(to);
  const ragChanged = !sameRagThresholds(fromRag, toRag);
  const texts = {
    kpisArabic: diff.kpiTextsArabicOnly.filter((x) => pKpi.has(x)),
    phasesAdded: diff.addedPhases,
    phasesRemoved: diff.removedPhases,
    phasesChanged: diff.changedPhases,
  };
  const versionOnly =
    add.workstreams.length + add.gates.length + add.activities.length + add.kpis.length === 0 &&
    keep.length === 0 &&
    texts.kpisArabic.length + texts.phasesAdded.length + texts.phasesRemoved.length + texts.phasesChanged.length === 0 &&
    diff.addedStatusDimensions.length === 0 &&
    diff.addedReadinessChecks.length === 0 &&
    !(ragChanged && !project.hasApprovedRagThresholds);
  return {
    templateKey: versions.templateKey,
    fromVersionNo: versions.fromVersionNo,
    toVersionNo: versions.toVersionNo,
    add,
    keep,
    texts,
    statusDimensionsAdded: diff.addedStatusDimensions,
    readinessChecksAvailable: diff.addedReadinessChecks,
    ragDefaults: { from: fromRag, to: toRag, changed: ragChanged, appliesToProject: !project.hasApprovedRagThresholds },
    versionOnly,
    diff,
  };
}

/** Only a newer published version of the SAME template can be proposed (no downgrade, no switch of template). */
export function assertUpgradeTarget(current: { templateId: string; versionNo: number }, target: { templateId: string; versionNo: number; status: string }): void {
  if (target.templateId !== current.templateId) throw ruleViolation('config.template_upgrade.other_template', 'A project can only move to another version of its own template');
  if (target.status !== 'published') throw ruleViolation('config.template_upgrade.not_published', 'Only a published template version can be applied');
  if (target.versionNo <= current.versionNo) throw ruleViolation('config.template_upgrade.not_newer', 'Only a newer template version can be applied (no downgrade)');
}

// =====================================================================================================================
// Setup wizard: onboarding checklist (REQ-SET-007), policies (REQ-SET-015), launch with gap list (REQ-SET-016)

/** Wizard steps (spec §21). */
export const SETUP_STEPS = ['program', 'newco', 'sources', 'perimeter', 'committee', 'baseline', 'settings', 'launch'] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

/** Required onboarding items: each is approved / recorded through its own module command; launch is refused while one is open. */
export const ONBOARDING_ITEMS = ['objective', 'newco', 'sources', 'perimeter', 'owners', 'permissions', 'committee', 'authority_matrix', 'baseline', 'policies'] as const;
export type OnboardingItem = (typeof ONBOARDING_ITEMS)[number];
/** Gaps that do not block launch but must be acknowledged explicitly and are recorded with the launch. */
export const ONBOARDING_WARNINGS = ['no_sources', 'retention_tbd'] as const;
export type OnboardingWarning = (typeof ONBOARDING_WARNINGS)[number];

export const ONBOARDING_ITEM_STEP: Record<OnboardingItem, SetupStep> = {
  objective: 'program',
  newco: 'newco',
  sources: 'sources',
  perimeter: 'perimeter',
  owners: 'perimeter',
  permissions: 'perimeter',
  committee: 'committee',
  authority_matrix: 'committee',
  baseline: 'baseline',
  policies: 'settings',
};

/**
 * The command (permission) that completes or approves each item — its own module's command, never the wizard (REQ-SET-007
 * security rule "each approval via its module command"). The screen names the ROLES holding it (policy matrix), never a person.
 */
export const ONBOARDING_ITEM_PERMISSION: Record<OnboardingItem, string> = {
  objective: 'portfolio.project.update',
  newco: 'newco.incorporation.verify',
  sources: 'documents.claim.verify',
  perimeter: 'carveout.perimeter.approve',
  owners: 'planning.ownership.reassign',
  permissions: 'admin.role_assignment.manage',
  committee: 'governance.charter.approve',
  authority_matrix: 'governance.authority_matrix.approve',
  baseline: 'planning.baseline.approve',
  policies: 'config.project_settings.manage',
};

export interface SetupFacts {
  templateKind: TemplateKind;
  objective: string | null;
  /** NewCo linked to the project (carve-out templates). */
  newco: { linked: boolean; incorporationStatus: string | null; verification: string | null };
  sources: { total: number; pendingClaims: number };
  perimeterApproved: boolean;
  workstreams: { total: number; withoutLead: number };
  members: { projectManagers: number; sponsors: number };
  committee: { active: boolean; charterApproved: boolean };
  authorityMatrixInForce: boolean;
  baselineApproved: boolean;
  policiesReviewed: boolean;
  retentionYears: number | null;
}

export type ChecklistState = 'done' | 'open' | 'not_applicable';

export interface OnboardingChecklist {
  items: { key: OnboardingItem; step: SetupStep; state: ChecklistState }[];
  warnings: OnboardingWarning[];
  /** Required items still open — launch is refused while any remains. */
  blockingGaps: OnboardingItem[];
}

const CARVEOUT_KINDS: readonly TemplateKind[] = ['dc_carveout'];

/** The onboarding checklist from current records (never a snapshot). */
export function onboardingChecklist(f: SetupFacts): OnboardingChecklist {
  const carve = CARVEOUT_KINDS.includes(f.templateKind);
  const state = (applies: boolean, done: boolean): ChecklistState => (!applies ? 'not_applicable' : done ? 'done' : 'open');
  // A NewCo status is "approved" when it was recorded as unconfirmed (no evidence claimed) or verified by Legal against
  // evidence; a self-declared "incorporated / in progress" awaiting verification is still open.
  const newcoDone = f.newco.linked && (f.newco.incorporationStatus === 'unconfirmed' || f.newco.incorporationStatus === 'not_applicable' || f.newco.verification === 'confirmed');
  const s: Record<OnboardingItem, ChecklistState> = {
    objective: state(true, !!f.objective && f.objective.trim().length > 0),
    newco: state(carve, newcoDone),
    // Every claim extracted from the project's sources has been reviewed (a project with no source has nothing to review).
    sources: state(true, f.sources.pendingClaims === 0),
    perimeter: state(carve, f.perimeterApproved),
    owners: state(true, f.workstreams.total > 0 && f.workstreams.withoutLead === 0),
    permissions: state(true, f.members.projectManagers > 0 && f.members.sponsors > 0),
    committee: state(true, f.committee.active && f.committee.charterApproved),
    authority_matrix: state(true, f.authorityMatrixInForce),
    baseline: state(true, f.baselineApproved),
    policies: state(true, f.policiesReviewed),
  };
  const items = ONBOARDING_ITEMS.map((key) => ({ key, step: ONBOARDING_ITEM_STEP[key], state: s[key] }));
  const warnings: OnboardingWarning[] = [];
  if (f.sources.total === 0) warnings.push('no_sources');
  if (f.retentionYears === null) warnings.push('retention_tbd');
  return { items, warnings, blockingGaps: items.filter((i) => i.state === 'open').map((i) => i.key) };
}

/**
 * Launch rule (REQ-SET-016): only from setup, only with every required item done, and every remaining warning
 * acknowledged explicitly (the acknowledged gap list is recorded with the launch).
 */
export function assertLaunchable(projectStatus: string, c: OnboardingChecklist, acknowledged: readonly string[]): void {
  if (projectStatus !== 'setup') throw ruleViolation('setup.not_in_setup', 'The project has already left setup', { status: projectStatus });
  if (c.blockingGaps.length) {
    throw ruleViolation('setup.launch_blocked', `Monitoring cannot be launched while required onboarding items are open: ${c.blockingGaps.join(', ')}`, { gaps: c.blockingGaps, warnings: c.warnings });
  }
  const missing = c.warnings.filter((w) => !acknowledged.includes(w));
  if (missing.length) throw ruleViolation('setup.gaps_not_acknowledged', `Acknowledge the remaining gaps before launch: ${missing.join(', ')}`, { warnings: missing });
}

/** Policies step (REQ-SET-015): classification and retention are set while the project is in setup only. */
export const RETENTION_YEARS_BOUNDS = { min: 1, max: 100 } as const;

export function assertPoliciesStep(input: { projectStatus: string; retentionYears: number | null }): void {
  if (input.projectStatus !== 'setup') throw ruleViolation('setup.policies_after_launch', 'Confidentiality and retention are set in the setup wizard only while the project is in setup');
  const r = input.retentionYears;
  if (r !== null && (!Number.isInteger(r) || r < RETENTION_YEARS_BOUNDS.min || r > RETENTION_YEARS_BOUNDS.max)) {
    throw ruleViolation('setup.retention_out_of_range', `Retention is ${RETENTION_YEARS_BOUNDS.min}–${RETENTION_YEARS_BOUNDS.max} years, or left to be confirmed`);
  }
}

/** Wizard defaults (REQ-SET-015): AI starts Off; integrations are Not configured until a real connectivity check. */
export const SETUP_DEFAULTS: { aiMode: AiMode; integrationStatus: 'not_configured' } = { aiMode: 'off', integrationStatus: 'not_configured' };

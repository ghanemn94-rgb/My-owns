import { describe, expect, it } from 'vitest';
import {
  RAG_THRESHOLD_MACHINE,
  assertLaunchable,
  assertPoliciesStep,
  assertRagThresholds,
  assertUpgradeTarget,
  onboardingChecklist,
  ragStatusRules,
  ragThresholdIssues,
  ragThresholdsInForce,
  templateRagThresholds,
  templateUpgradePlan,
  SETUP_DEFAULTS,
  ONBOARDING_ITEMS,
  ONBOARDING_ITEM_PERMISSION,
  type SetupFacts,
} from './config';
import { calculateRag, DEFAULT_RAG_THRESHOLDS } from './measurement';
import { POLICY_MATRIX } from './policy';
import { kpiTemplateArabic, type ProjectTemplateDefinition, type TemplateKpi } from './templates';
import { transition } from './workflows';
import { DomainError } from './errors';

const code = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (e) {
    return (e as DomainError).code;
  }
};

const bi = (en: string) => ({ en, ar: `ع ${en}` });
const gate = (key: string, criteria: string[] = [`${key}-C01`]) =>
  ({ key, order: 0, name: bi(key), purpose: bi(key), prerequisiteGateKeys: [], ownerRole: 'project_manager', reviewerRole: 'secretary_cpmo', approverRole: 'sponsor', criteria: criteria.map((c) => ({ key: c, description: bi(c), mandatory: true, blocking: false, waivable: false, waiverAuthorityRole: null, evidenceRequired: true, evidenceType: 'other', ownerRole: 'project_manager', reviewerRole: 'secretary_cpmo', applicability: 'proposed' })) }) as unknown as ProjectTemplateDefinition['gates'][number];
const ws = (key: string) => ({ key, name: bi(key), objective: bi(key), scope: bi(key), leadRole: 'workstream_lead', proposedLeadFunction: 'PMO', raci: [], linkedGates: [], budgetRelevant: false, typicalRisks: [], acceptanceEvidence: [] }) as unknown as ProjectTemplateDefinition['workstreams'][number];
const act = (id: string, workstreamKey: string, title = id) => ({ id, workstreamKey, title: bi(title), description: bi(title), proposedOwnerFunction: 'PMO', prerequisites: [], output: bi('o'), acceptanceCriteria: bi('a'), approverRole: 'project_manager', evidenceType: 'other', effort: 'TBD', durationDays: null, durationBasis: 'tbd', gateKey: 'G0', isMilestone: false, isDeliverable: false, weight: 1, requiresAcceptance: false, status: 'draft', verificationStatus: 'proposed' }) as unknown as ProjectTemplateDefinition['wbs'][number];
const kpi = (key: string, extra: Partial<TemplateKpi> = {}): TemplateKpi => ({ key, name: bi(key), definition: bi(`${key} definition`), formula: `${key} formula`, unit: 'count', period: 'weekly', ownerRole: 'project_manager', source: `${key} register`, target: null, thresholds: { green: 'none', amber: 'some', red: 'many' }, direction: 'lower_is_better', frequency: 'weekly', status: 'proposal', ...extra });
const base = (over: Partial<ProjectTemplateDefinition> = {}): ProjectTemplateDefinition =>
  ({
    key: 't',
    version: 1,
    kind: 'general_transformation',
    name: bi('T'),
    description: bi('T'),
    statusDimensions: [],
    phases: [{ key: 'P1', order: 1, name: bi('P1'), description: bi('P1'), gateKeys: ['G0'] }],
    gates: [gate('G0'), gate('G1', ['G1-C01', 'G1-C02'])],
    workstreams: [ws('WS01'), ws('WS02')],
    wbs: [act('WS01-A01', 'WS01'), act('WS02-A01', 'WS02')],
    readinessAreas: [],
    kpis: [kpi('k1'), kpi('k2')],
    ragPolicy: { description: bi('rag'), rules: [], staleAfterDays: 14 },
    tsaStates: [],
    decisionStates: [],
    partnerStages: [],
    ...over,
  }) as ProjectTemplateDefinition;

describe('REQ-PLN-019 — RAG thresholds: validation, template default, version in force, explanation', () => {
  it('UT: a threshold set must be ordered and bounded (green ≤ amber, freshness 1–90 days, integers)', () => {
    expect(ragThresholdIssues(DEFAULT_RAG_THRESHOLDS)).toEqual([]);
    expect(ragThresholdIssues({ greenMaxSlipDays: 6, amberMaxSlipDays: 5, staleAfterDays: 14 })).toContain('config.rag_thresholds.amber_below_green');
    expect(ragThresholdIssues({ greenMaxSlipDays: -1, amberMaxSlipDays: 5, staleAfterDays: 14 })).toContain('config.rag_thresholds.negative');
    expect(ragThresholdIssues({ greenMaxSlipDays: 0, amberMaxSlipDays: 5, staleAfterDays: 0 })).toContain('config.rag_thresholds.stale_out_of_range');
    expect(ragThresholdIssues({ greenMaxSlipDays: 0, amberMaxSlipDays: 500, staleAfterDays: 14 })).toContain('config.rag_thresholds.slip_out_of_range');
    expect(ragThresholdIssues({ greenMaxSlipDays: 0.5, amberMaxSlipDays: 5, staleAfterDays: 14 })).toEqual(['config.rag_thresholds.not_integer']);
    expect(code(() => assertRagThresholds({ greenMaxSlipDays: 6, amberMaxSlipDays: 5, staleAfterDays: 14 }))).toBe('config.rag_thresholds.amber_below_green');
  });

  it('UT: the template default comes from the pinned template version (stated thresholds, else the platform defaults, and its freshness window)', () => {
    expect(templateRagThresholds(base())).toEqual(DEFAULT_RAG_THRESHOLDS);
    expect(templateRagThresholds(base({ ragPolicy: { description: bi('r'), rules: [], staleAfterDays: 21, thresholds: { greenMaxSlipDays: 2, amberMaxSlipDays: 8 } } }))).toEqual({ greenMaxSlipDays: 2, amberMaxSlipDays: 8, staleAfterDays: 21 });
  });

  it('UT: the approved project version is in force; without one the template default applies — and the reference says which', () => {
    const t = { greenMaxSlipDays: 3, amberMaxSlipDays: 6, staleAfterDays: 10 };
    expect(ragThresholdsInForce(base(), 2, null)).toEqual({ thresholds: DEFAULT_RAG_THRESHOLDS, ref: { source: 'template_default', versionNo: null, templateVersionNo: 2 } });
    expect(ragThresholdsInForce(base(), 2, { versionNo: 4, thresholds: t })).toEqual({ thresholds: t, ref: { source: 'approved', versionNo: 4, templateVersionNo: 2 } });
  });

  it('UT: status explanation shows threshold applied — every RAG that compared against a threshold names the version used', () => {
    const input = { baselineFinish: '2026-10-01', forecastFinish: '2026-10-08', lastUpdatedOn: '2026-09-28', today: '2026-09-29', hasOpenBlocker: false };
    const byDefault = calculateRag({ ...input, thresholdsRef: { source: 'template_default', versionNo: null, templateVersionNo: 1 } });
    expect(byDefault.status).toBe('amber');
    expect(byDefault.explanationI18n).toEqual([
      { code: 'plan.rag.amber', params: { slip: 5, limit: 10 } },
      { code: 'plan.rag.thresholds_template_default', params: { templateVersion: 1 } },
    ]);
    expect(byDefault.explanation).toBe('Forecast slip of 5 working days (amber ≤ 10). Thresholds: proposed default of template version 1 (no project version approved).');
    const approved = calculateRag({ ...input, thresholds: { greenMaxSlipDays: 5, amberMaxSlipDays: 8, staleAfterDays: 14 }, thresholdsRef: { source: 'approved', versionNo: 2, templateVersionNo: 1 } });
    expect(approved.status).toBe('green');
    expect(approved.explanation).toBe('Forecast within tolerance (slip 5 working days). Thresholds: project version 2 (approved).');
    // Decided before any threshold applies: no reference.
    expect(calculateRag({ ...input, hasOpenBlocker: true, thresholdsRef: { source: 'approved', versionNo: 2, templateVersionNo: 1 } }).explanationI18n).toEqual([{ code: 'plan.rag.open_blocker', params: {} }]);
    // Without a reference the explanation is unchanged (frozen updates of earlier versions).
    expect(calculateRag(input).explanationI18n).toEqual([{ code: 'plan.rag.amber', params: { slip: 5, limit: 10 } }]);
  });

  it('UT: an explanation for each status under the thresholds in force', () => {
    const rules = ragStatusRules({ greenMaxSlipDays: 1, amberMaxSlipDays: 7, staleAfterDays: 10 });
    expect(rules.map((r) => r.status)).toEqual(['green', 'amber', 'red', 'stale', 'unknown', 'not_updated']);
    expect(rules[1]!.explanationI18n).toEqual([{ code: 'plan.rag.rule.amber', params: { green: 1, amber: 7 } }]);
    expect(rules[0]!.explanation).toContain('at most 1 working days');
  });

  it('UT: a proposal is in force only once approved; a rejected / withdrawn proposal can never be approved', () => {
    expect(transition('rag_thresholds', RAG_THRESHOLD_MACHINE, 'pending', 'approve')).toBe('approved');
    expect(transition('rag_thresholds', RAG_THRESHOLD_MACHINE, 'pending', 'withdraw')).toBe('withdrawn');
    for (const s of ['rejected', 'withdrawn', 'approved'] as const) {
      expect(code(() => transition('rag_thresholds', RAG_THRESHOLD_MACHINE, s, 'approve'))).toBe('rag_thresholds.invalid_transition');
    }
  });
});

describe('REQ-ENT-009 / AT-26 — template upgrade plan: preview of what would change, nothing retroactive', () => {
  const footprint = { gateKeys: ['G0', 'G1'], workstreamKeys: ['WS01', 'WS02'], activityIds: ['WS01-A01', 'WS02-A01'], kpiKeys: ['k1', 'k2'], hasApprovedRagThresholds: false };

  it('UT: added gates / workstreams / activities / KPIs are created; removed and changed ones are kept as they are in the project', () => {
    const v2 = base({
      version: 2,
      gates: [gate('G0'), gate('G1', ['G1-C01', 'G1-C03']), gate('G2')],
      workstreams: [ws('WS01'), ws('WS03')],
      wbs: [act('WS01-A01', 'WS01', 'changed title'), act('WS01-A02', 'WS01'), act('WS03-A01', 'WS03')],
      kpis: [kpi('k1', { formula: 'changed formula' }), kpi('k3')],
    });
    const plan = templateUpgradePlan(base(), v2, { templateKey: 't', fromVersionNo: 1, toVersionNo: 2 }, footprint);
    expect(plan.add.gates.map((g) => g.key)).toEqual(['G2']);
    expect(plan.add.workstreams.map((w) => w.key)).toEqual(['WS03']);
    expect(plan.add.activities.map((a) => a.id)).toEqual(['WS01-A02', 'WS03-A01']);
    expect(plan.add.kpis.map((k) => k.key)).toEqual(['k3']);
    expect(plan.keep).toEqual(
      expect.arrayContaining([
        { kind: 'gate', key: 'G1', reason: 'changed_in_new_version' },
        { kind: 'criterion', key: 'G1-C03', reason: 'added_to_existing_gate' },
        { kind: 'criterion', key: 'G1-C02', reason: 'removed_in_new_version' },
        { kind: 'workstream', key: 'WS02', reason: 'removed_in_new_version' },
        { kind: 'activity', key: 'WS02-A01', reason: 'removed_in_new_version' },
        { kind: 'activity', key: 'WS01-A01', reason: 'changed_in_new_version' },
        { kind: 'kpi', key: 'k2', reason: 'removed_in_new_version' },
        { kind: 'kpi', key: 'k1', reason: 'changed_in_new_version' },
      ]),
    );
    expect(plan.versionOnly).toBe(false);
  });

  it('UT: an element the project already has is never added twice; a project without the removed element keeps nothing', () => {
    const v2 = base({ version: 2, gates: [gate('G0'), gate('G1', ['G1-C01', 'G1-C02']), gate('G2')] });
    const plan = templateUpgradePlan(base(), v2, { templateKey: 't', fromVersionNo: 1, toVersionNo: 2 }, { ...footprint, gateKeys: ['G0', 'G1', 'G2'] });
    expect(plan.add.gates).toEqual([]);
  });

  it('UT: Arabic-only KPI text changes and the template default thresholds are listed; an approved project threshold version is unaffected', () => {
    const v2 = base({
      version: 2,
      kpis: [kpi('k1', { formulaAr: 'صيغة', sourceAr: 'سجل', thresholdsAr: { green: 'لا شيء', amber: 'بعض', red: 'كثير' } }), kpi('k2')],
      ragPolicy: { description: bi('rag'), rules: [], staleAfterDays: 14, thresholds: { greenMaxSlipDays: 0, amberMaxSlipDays: 10 } },
    });
    const plan = templateUpgradePlan(base(), v2, { templateKey: 't', fromVersionNo: 1, toVersionNo: 2 }, footprint);
    expect(plan.texts.kpisArabic).toEqual(['k1']);
    expect(plan.keep).toEqual([]);
    expect(plan.diff.changedKpis).toEqual([]);
    expect(plan.ragDefaults).toEqual({ from: DEFAULT_RAG_THRESHOLDS, to: DEFAULT_RAG_THRESHOLDS, changed: false, appliesToProject: true });
    expect(plan.versionOnly).toBe(false);
    const v3 = base({ version: 3, ragPolicy: { description: bi('rag'), rules: [], staleAfterDays: 21 } });
    expect(templateUpgradePlan(base(), v3, { templateKey: 't', fromVersionNo: 1, toVersionNo: 3 }, footprint).ragDefaults).toMatchObject({ changed: true, appliesToProject: true });
    expect(templateUpgradePlan(base(), v3, { templateKey: 't', fromVersionNo: 1, toVersionNo: 3 }, { ...footprint, hasApprovedRagThresholds: true }).ragDefaults).toMatchObject({ changed: true, appliesToProject: false });
  });

  it('UT: only a newer published version of the same template can be proposed', () => {
    const cur = { templateId: 'a', versionNo: 2 };
    expect(code(() => assertUpgradeTarget(cur, { templateId: 'b', versionNo: 3, status: 'published' }))).toBe('config.template_upgrade.other_template');
    expect(code(() => assertUpgradeTarget(cur, { templateId: 'a', versionNo: 2, status: 'published' }))).toBe('config.template_upgrade.not_newer');
    expect(code(() => assertUpgradeTarget(cur, { templateId: 'a', versionNo: 1, status: 'published' }))).toBe('config.template_upgrade.not_newer');
    expect(code(() => assertUpgradeTarget(cur, { templateId: 'a', versionNo: 3, status: 'draft' }))).toBe('config.template_upgrade.not_published');
    expect(code(() => assertUpgradeTarget(cur, { templateId: 'a', versionNo: 3, status: 'published' }))).toBeNull();
  });
});

describe('QA-P5-07 — Arabic KPI texts: template value + Arabic, null once edited by a person', () => {
  const tpl = kpi('k', { formulaAr: 'صيغة', sourceAr: 'سجل', thresholdsAr: { green: 'أ', amber: 'ب', red: 'ج' } });
  const row = { definition: 'k definition', formula: 'k formula', source: 'k register', thresholds: { green: 'none', amber: 'some', red: 'many' } };
  it('UT: unedited template KPI → Arabic of each field; an edited field → null for that field only', () => {
    expect(kpiTemplateArabic(tpl, row)).toEqual({ definitionAr: 'ع k definition', formulaAr: 'صيغة', sourceAr: 'سجل', thresholdsAr: { green: 'أ', amber: 'ب', red: 'ج' } });
    expect(kpiTemplateArabic(tpl, { ...row, formula: 'typed by a person' })).toMatchObject({ formulaAr: null, sourceAr: 'سجل' });
    expect(kpiTemplateArabic(tpl, { ...row, thresholds: { ...row.thresholds, red: 'edited' } }).thresholdsAr).toBeNull();
    // A version without Arabic texts (template version 1) and a user-defined KPI give none.
    expect(kpiTemplateArabic(kpi('k'), row)).toMatchObject({ formulaAr: null, sourceAr: null, thresholdsAr: null });
    expect(kpiTemplateArabic(undefined, row)).toEqual({ definitionAr: null, formulaAr: null, sourceAr: null, thresholdsAr: null });
  });
});

describe('REQ-SET-007 / REQ-SET-015 / REQ-SET-016 — onboarding checklist, policies step and launch rule', () => {
  const done: SetupFacts = {
    templateKind: 'dc_carveout',
    objective: 'Separate the data centres',
    newco: { linked: true, incorporationStatus: 'incorporated', verification: 'confirmed' },
    sources: { total: 2, pendingClaims: 0 },
    perimeterApproved: true,
    workstreams: { total: 12, withoutLead: 0 },
    members: { projectManagers: 1, sponsors: 1 },
    committee: { active: true, charterApproved: true },
    authorityMatrixInForce: true,
    baselineApproved: true,
    policiesReviewed: true,
    retentionYears: 10,
  };

  it('UT: every onboarding item is completed by an existing permission held by at least one role (no invented approver)', () => {
    for (const item of ONBOARDING_ITEMS) {
      const perm = ONBOARDING_ITEM_PERMISSION[item];
      expect(POLICY_MATRIX.permissions[perm], `${item} → ${perm}`).toBeDefined();
      expect(Object.values(POLICY_MATRIX.roles).some((r) => r.permissions.includes(perm)), `${item} → ${perm} held by a role`).toBe(true);
    }
  });

  it('UT: wizard defaults AI Off and integrations Not configured', () => {
    expect(SETUP_DEFAULTS).toEqual({ aiMode: 'off', integrationStatus: 'not_configured' });
  });

  it('UT: every required approval is an item; all done → no gap; perimeter and NewCo apply to carve-out templates only', () => {
    expect(onboardingChecklist(done)).toMatchObject({ blockingGaps: [], warnings: [] });
    const gen = onboardingChecklist({ ...done, templateKind: 'general_transformation', newco: { linked: false, incorporationStatus: null, verification: null }, perimeterApproved: false });
    expect(gen.blockingGaps).toEqual([]);
    expect(gen.items.find((i) => i.key === 'perimeter')!.state).toBe('not_applicable');
    expect(gen.items.find((i) => i.key === 'newco')!.state).toBe('not_applicable');
  });

  it('UT: each missing approval is a blocking gap; a self-declared incorporation awaiting verification is still open', () => {
    const c = onboardingChecklist({
      ...done,
      objective: ' ',
      newco: { linked: true, incorporationStatus: 'incorporated', verification: 'proposed' },
      sources: { total: 1, pendingClaims: 3 },
      perimeterApproved: false,
      workstreams: { total: 12, withoutLead: 2 },
      members: { projectManagers: 1, sponsors: 0 },
      committee: { active: true, charterApproved: false },
      authorityMatrixInForce: false,
      baselineApproved: false,
      policiesReviewed: false,
    });
    expect(c.blockingGaps).toEqual(['objective', 'newco', 'sources', 'perimeter', 'owners', 'permissions', 'committee', 'authority_matrix', 'baseline', 'policies']);
    expect(onboardingChecklist({ ...done, newco: { linked: true, incorporationStatus: 'unconfirmed', verification: 'unknown' } }).blockingGaps).toEqual([]);
  });

  it('IT-equivalent: launch refused while a required item is open (gap list returned); warnings must be acknowledged; only from setup', () => {
    const blocked = onboardingChecklist({ ...done, baselineApproved: false });
    let err: DomainError | null = null;
    try {
      assertLaunchable('setup', blocked, []);
    } catch (e) {
      err = e as DomainError;
    }
    expect(err?.code).toBe('setup.launch_blocked');
    expect(err?.details).toMatchObject({ gaps: ['baseline'] });
    const warn = onboardingChecklist({ ...done, sources: { total: 0, pendingClaims: 0 }, retentionYears: null });
    expect(warn.warnings).toEqual(['no_sources', 'retention_tbd']);
    expect(code(() => assertLaunchable('setup', warn, ['no_sources']))).toBe('setup.gaps_not_acknowledged');
    expect(code(() => assertLaunchable('setup', warn, ['no_sources', 'retention_tbd']))).toBeNull();
    expect(code(() => assertLaunchable('active', onboardingChecklist(done), []))).toBe('setup.not_in_setup');
  });

  it('UT: policies are set only in setup; retention is 1–100 years or to be confirmed', () => {
    expect(code(() => assertPoliciesStep({ projectStatus: 'active', retentionYears: 5 }))).toBe('setup.policies_after_launch');
    expect(code(() => assertPoliciesStep({ projectStatus: 'setup', retentionYears: 0 }))).toBe('setup.retention_out_of_range');
    expect(code(() => assertPoliciesStep({ projectStatus: 'setup', retentionYears: null }))).toBeNull();
    expect(code(() => assertPoliciesStep({ projectStatus: 'setup', retentionYears: 7 }))).toBeNull();
  });
});

import { canonicalJson } from './canonical';
import type { RoleKey, TemplateKind } from './enums';

/** Bilingual text used in templates. */
export interface I18nText {
  en: string;
  ar: string;
}

export interface TemplateCriterion {
  key: string;
  description: I18nText;
  mandatory: boolean;
  blocking: boolean;
  waivable: boolean;
  waiverAuthorityRole: RoleKey | null;
  waivabilityBasis?: string;
  evidenceRequired: boolean;
  evidenceType: string;
  ownerRole: RoleKey;
  reviewerRole: RoleKey;
  applicability: 'proposed';
}

export interface TemplateGate {
  key: string;
  order: number;
  name: I18nText;
  purpose: I18nText;
  prerequisiteGateKeys: string[];
  ownerRole: RoleKey;
  reviewerRole: RoleKey;
  approverRole: RoleKey;
  criteria: TemplateCriterion[];
}

export interface TemplateWorkstream {
  key: string;
  name: I18nText;
  objective: I18nText;
  scope: I18nText;
  leadRole: RoleKey;
  proposedLeadFunction: string;
  raci: { function: string; raci: 'R' | 'A' | 'C' | 'I' }[];
  linkedGates: string[];
  budgetRelevant: boolean;
  typicalRisks: I18nText[];
  acceptanceEvidence: I18nText[];
}

export interface TemplateActivity {
  id: string;
  workstreamKey: string;
  title: I18nText;
  description: I18nText;
  proposedOwnerFunction: string;
  prerequisites: string[];
  output: I18nText;
  acceptanceCriteria: I18nText;
  approverRole: RoleKey;
  evidenceType: string;
  effort: string;
  durationDays: number | null;
  durationBasis: 'assumed' | 'tbd';
  gateKey: string;
  isMilestone: boolean;
  isDeliverable: boolean;
  weight: number;
  requiresAcceptance: boolean;
  status: 'draft';
  verificationStatus: 'proposed';
}

export interface TemplateReadinessArea {
  key: string;
  name: I18nText;
  defaultChecks: { key: string; title: I18nText; mandatory: boolean; blocker: boolean; signoffRole: RoleKey }[];
}

export interface KpiThresholdTexts {
  green: string;
  amber: string;
  red: string;
}

export interface TemplateKpi {
  key: string;
  name: I18nText;
  definition: I18nText;
  formula: string;
  unit: string;
  period: string;
  ownerRole: RoleKey;
  source: string;
  target: string | null;
  thresholds: KpiThresholdTexts;
  direction: 'higher_is_better' | 'lower_is_better';
  frequency: string;
  status: 'proposal';
  /**
   * Arabic of `formula`, `source` and `thresholds` (template version 2 and later — QA-P5-07). A translation of the English
   * text only; version 1 carries none (projects pinned to it show the English text until an approved template upgrade).
   */
  formulaAr?: string;
  sourceAr?: string;
  thresholdsAr?: KpiThresholdTexts;
}

/** Proposed default RAG slip thresholds stated by a template (version 2 and later); version 1 relies on the code defaults. */
export interface TemplateRagThresholds {
  greenMaxSlipDays: number;
  amberMaxSlipDays: number;
}

export interface ProjectTemplateDefinition {
  key: string;
  version: number;
  kind: TemplateKind;
  name: I18nText;
  description: I18nText;
  statusDimensions: { key: string; name: I18nText; description: I18nText; states: { key: string; name: I18nText }[] }[];
  phases: { key: string; order: number; name: I18nText; description: I18nText; gateKeys: string[] }[];
  gates: TemplateGate[];
  workstreams: TemplateWorkstream[];
  wbs: TemplateActivity[];
  readinessAreas: TemplateReadinessArea[];
  kpis: TemplateKpi[];
  ragPolicy: { description: I18nText; rules: { status: string; explanation: I18nText; rule: string }[]; staleAfterDays: number; thresholds?: TemplateRagThresholds };
  tsaStates: string[];
  decisionStates: string[];
  partnerStages: string[];
}

/** Structural diff between two template versions — used for the explicit migration preview (AT-26). */
export interface TemplateDiff {
  addedGates: string[];
  removedGates: string[];
  changedGates: string[];
  addedCriteria: string[];
  removedCriteria: string[];
  addedWorkstreams: string[];
  removedWorkstreams: string[];
  changedWorkstreams: string[];
  addedActivities: string[];
  removedActivities: string[];
  changedActivities: string[];
  addedKpis: string[];
  removedKpis: string[];
  /** KPIs whose definition, formula, source, thresholds, unit, period, frequency, direction or owner role changed. */
  changedKpis: string[];
  /** KPIs whose template texts changed only in Arabic (a translation added or corrected — QA-P5-07). */
  kpiTextsArabicOnly: string[];
  addedPhases: string[];
  removedPhases: string[];
  changedPhases: string[];
  addedStatusDimensions: string[];
  removedStatusDimensions: string[];
  /** Readiness default checks as `<area>-<key>`. */
  addedReadinessChecks: string[];
  removedReadinessChecks: string[];
  ragPolicyChanged: boolean;
}

/** Key-order independent comparison (definitions read from jsonb do not keep the key order of the template file). */
const json = (v: unknown) => canonicalJson(v ?? null);

/** The English (structural) part of a template KPI: everything except its Arabic texts. */
function kpiCore(k: TemplateKpi) {
  return {
    key: k.key,
    name: k.name.en,
    definition: k.definition.en,
    formula: k.formula,
    unit: k.unit,
    period: k.period,
    ownerRole: k.ownerRole,
    source: k.source,
    target: k.target,
    thresholds: k.thresholds,
    direction: k.direction,
    frequency: k.frequency,
  };
}

export function diffTemplates(a: ProjectTemplateDefinition, b: ProjectTemplateDefinition): TemplateDiff {
  const keys = <T>(xs: T[] | undefined, k: (x: T) => string) => new Set((xs ?? []).map(k));
  const added = (x: Set<string>, y: Set<string>) => [...y].filter((v) => !x.has(v));
  const changed = <T>(xs: T[] | undefined, ys: T[] | undefined, k: (x: T) => string, cmp: (x: T) => unknown = (x) => x) => {
    const other = new Map((ys ?? []).map((y) => [k(y), y]));
    return (xs ?? []).filter((x) => other.has(k(x)) && json(cmp(x)) !== json(cmp(other.get(k(x))!))).map(k);
  };
  const aG = keys(a.gates, (g) => g.key), bG = keys(b.gates, (g) => g.key);
  const aC = new Set(a.gates.flatMap((g) => g.criteria.map((c) => c.key)));
  const bC = new Set(b.gates.flatMap((g) => g.criteria.map((c) => c.key)));
  const aW = keys(a.workstreams, (w) => w.key), bW = keys(b.workstreams, (w) => w.key);
  const aA = keys(a.wbs, (x) => x.id), bA = keys(b.wbs, (x) => x.id);
  const aK = keys(a.kpis, (x) => x.key), bK = keys(b.kpis, (x) => x.key);
  const aP = keys(a.phases, (x) => x.key), bP = keys(b.phases, (x) => x.key);
  const aD = keys(a.statusDimensions, (x) => x.key), bD = keys(b.statusDimensions, (x) => x.key);
  const checks = (d: ProjectTemplateDefinition) => new Set((d.readinessAreas ?? []).flatMap((r) => r.defaultChecks.map((c) => `${r.key}-${c.key}`)));
  const aR = checks(a), bR = checks(b);
  const changedKpis = changed(a.kpis, b.kpis, (k) => k.key, kpiCore);
  const kpiTextsArabicOnly = changed(a.kpis, b.kpis, (k) => k.key).filter((k) => !changedKpis.includes(k));
  return {
    addedGates: added(aG, bG),
    removedGates: added(bG, aG),
    changedGates: changed(a.gates, b.gates, (g) => g.key),
    addedCriteria: added(aC, bC),
    removedCriteria: added(bC, aC),
    addedWorkstreams: added(aW, bW),
    removedWorkstreams: added(bW, aW),
    changedWorkstreams: changed(a.workstreams, b.workstreams, (w) => w.key),
    addedActivities: added(aA, bA),
    removedActivities: added(bA, aA),
    changedActivities: changed(a.wbs, b.wbs, (x) => x.id),
    addedKpis: added(aK, bK),
    removedKpis: added(bK, aK),
    changedKpis,
    kpiTextsArabicOnly,
    addedPhases: added(aP, bP),
    removedPhases: added(bP, aP),
    changedPhases: changed(a.phases, b.phases, (x) => x.key),
    addedStatusDimensions: added(aD, bD),
    removedStatusDimensions: added(bD, aD),
    addedReadinessChecks: added(aR, bR),
    removedReadinessChecks: added(bR, aR),
    ragPolicyChanged: json(a.ragPolicy) !== json(b.ragPolicy),
  };
}

/**
 * Arabic texts of a KPI that still carries its template's English text (QA-P34-01h for the definition, QA-P5-07 for the
 * formula, source and thresholds): each `<field>Ar` is the pinned template version's Arabic while the stored English equals
 * the template's English, and null once a person edited the field (the KPI is then shown as entered) or when the pinned
 * version has no Arabic for it (template version 1 for formula, source and thresholds).
 */
export function kpiTemplateArabic(
  tpl: TemplateKpi | undefined,
  row: { definition: string; formula: string; source: string; thresholds: KpiThresholdTexts },
): { definitionAr: string | null; formulaAr: string | null; sourceAr: string | null; thresholdsAr: KpiThresholdTexts | null } {
  if (!tpl) return { definitionAr: null, formulaAr: null, sourceAr: null, thresholdsAr: null };
  // Field by field: both sides may come from jsonb, which does not keep the key order of the template file.
  const sameThresholds = (['green', 'amber', 'red'] as const).every((k) => tpl.thresholds[k] === row.thresholds[k]);
  return {
    definitionAr: tpl.definition.ar && tpl.definition.en === row.definition ? tpl.definition.ar : null,
    formulaAr: tpl.formulaAr && tpl.formula === row.formula ? tpl.formulaAr : null,
    sourceAr: tpl.sourceAr && tpl.source === row.source ? tpl.sourceAr : null,
    thresholdsAr: tpl.thresholdsAr && sameThresholds ? { green: tpl.thresholdsAr.green, amber: tpl.thresholdsAr.amber, red: tpl.thresholdsAr.red } : null,
  };
}

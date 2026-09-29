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
  thresholds: { green: string; amber: string; red: string };
  direction: 'higher_is_better' | 'lower_is_better';
  frequency: string;
  status: 'proposal';
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
  ragPolicy: { description: I18nText; rules: { status: string; explanation: I18nText; rule: string }[]; staleAfterDays: number };
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
  addedActivities: string[];
  removedActivities: string[];
  changedActivities: string[];
}

export function diffTemplates(a: ProjectTemplateDefinition, b: ProjectTemplateDefinition): TemplateDiff {
  const keys = <T>(xs: T[], k: (x: T) => string) => new Set(xs.map(k));
  const added = (x: Set<string>, y: Set<string>) => [...y].filter((v) => !x.has(v));
  const aG = keys(a.gates, (g) => g.key), bG = keys(b.gates, (g) => g.key);
  const aC = new Set(a.gates.flatMap((g) => g.criteria.map((c) => c.key)));
  const bC = new Set(b.gates.flatMap((g) => g.criteria.map((c) => c.key)));
  const aW = keys(a.workstreams, (w) => w.key), bW = keys(b.workstreams, (w) => w.key);
  const aA = keys(a.wbs, (x) => x.id), bA = keys(b.wbs, (x) => x.id);
  const changedGates = a.gates
    .filter((g) => bG.has(g.key))
    .filter((g) => JSON.stringify(g) !== JSON.stringify(b.gates.find((x) => x.key === g.key)))
    .map((g) => g.key);
  const changedActivities = a.wbs
    .filter((x) => bA.has(x.id))
    .filter((x) => JSON.stringify(x) !== JSON.stringify(b.wbs.find((y) => y.id === x.id)))
    .map((x) => x.id);
  return {
    addedGates: added(aG, bG),
    removedGates: added(bG, aG),
    changedGates,
    addedCriteria: added(aC, bC),
    removedCriteria: added(bC, aC),
    addedWorkstreams: added(aW, bW),
    removedWorkstreams: added(bW, aW),
    addedActivities: added(aA, bA),
    removedActivities: added(bA, aA),
    changedActivities,
  };
}

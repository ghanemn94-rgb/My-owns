/**
 * Project workspace sections (spec §10 screens). `permissions` is any-of; `phase` marks sections whose
 * backend is delivered in a later implementation phase (rendered as an honest "not implemented yet" state).
 * Visibility is a UI hint only — the API authorizes every request.
 */
import type { TemplateKind } from '@hub/domain';

export type SectionKey =
  | 'overview'
  | 'charter'
  | 'committee'
  | 'plan'
  | 'workstreams'
  | 'raid'
  | 'perimeter'
  | 'newco'
  | 'readiness'
  | 'finance'
  | 'jv'
  | 'documents'
  | 'ai'
  | 'reports'
  | 'members';

export interface SectionDef {
  key: SectionKey;
  /** Path segment under /projects/:projectId ('' = overview). */
  segment: string;
  permissions: readonly string[];
  phase: string | null;
  /** Restrict to template kinds where the section is meaningful (undefined = all kinds). */
  kinds?: readonly TemplateKind[];
}

const TRANSACTION_KINDS: readonly TemplateKind[] = ['dc_carveout', 'transaction_other'];

export const PROJECT_SECTIONS: readonly SectionDef[] = [
  { key: 'overview', segment: '', permissions: ['portfolio.project.read'], phase: null },
  { key: 'charter', segment: 'charter', permissions: ['portfolio.project.read'], phase: null },
  { key: 'committee', segment: 'committee', permissions: ['governance.committee.read', 'governance.decision.read'], phase: 'P2' },
  { key: 'plan', segment: 'plan', permissions: ['planning.plan.read'], phase: 'P2' },
  { key: 'workstreams', segment: 'workstreams', permissions: ['planning.plan.read'], phase: null },
  { key: 'raid', segment: 'raid', permissions: ['planning.plan.read'], phase: 'P2' },
  { key: 'perimeter', segment: 'perimeter', permissions: ['carveout.register.read'], phase: 'P3', kinds: TRANSACTION_KINDS },
  { key: 'newco', segment: 'newco', permissions: ['newco.register.read'], phase: 'P3', kinds: TRANSACTION_KINDS },
  { key: 'readiness', segment: 'readiness', permissions: ['readiness.register.read'], phase: 'P3', kinds: TRANSACTION_KINDS },
  { key: 'finance', segment: 'finance', permissions: ['finance.record.read'], phase: 'P4' },
  { key: 'jv', segment: 'jv', permissions: ['jv.deal.read', 'jv.partner.read', 'jv.room.read'], phase: 'P4', kinds: TRANSACTION_KINDS },
  { key: 'documents', segment: 'documents', permissions: ['documents.document.read'], phase: 'P2/P3' },
  { key: 'ai', segment: 'ai', permissions: ['ai.proposal.read', 'ai.run.read', 'ai.assistant.use'], phase: 'P5' },
  { key: 'reports', segment: 'reports', permissions: ['reports.snapshot.read', 'reports.report.generate'], phase: 'P6' },
  { key: 'members', segment: 'members', permissions: ['admin.role_assignment.read'], phase: null },
];

export function sectionByKey(key: SectionKey): SectionDef {
  const s = PROJECT_SECTIONS.find((x) => x.key === key);
  if (!s) throw new Error(`Unknown section ${key}`);
  return s;
}

export function sectionHref(projectId: string, key: SectionKey): string {
  const s = sectionByKey(key);
  return s.segment ? `/projects/${projectId}/${s.segment}` : `/projects/${projectId}`;
}

export function sectionAppliesTo(section: SectionDef, kind: TemplateKind | undefined): boolean {
  return !section.kinds || !kind || section.kinds.includes(kind);
}

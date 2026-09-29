import { ruleViolation } from './errors';
import type { CriterionStatus, GateAssessmentStatus } from './enums';

/**
 * Gate evaluation (spec §3). A gate is ready for decision only when every mandatory criterion is met with
 * accepted evidence (or legitimately waived / marked not applicable by the authorized specialist) and all
 * prerequisite gates are approved. Task completion percentages are deliberately NOT an input.
 */
export interface CriterionState {
  key: string;
  mandatory: boolean;
  blocking: boolean;
  waivable: boolean;
  evidenceRequired: boolean;
  status: CriterionStatus;
  activeEvidenceCount: number;
  conflictingEvidenceCount: number;
  /** Set when status = waived: the approved waiver id. */
  approvedWaiverId?: string | null;
  /**
   * Set when status = not_applicable: the recorded specialist determination (who, basis, approved). Without an
   * approved determination "not applicable" does NOT satisfy the criterion (P0 review D-01).
   */
  naDetermination?: { approved: boolean; basis: string; byUserId: string } | null;
}

export interface GateEvaluationInput {
  criteria: CriterionState[];
  prerequisites: { gateKey: string; status: GateAssessmentStatus | 'none' }[];
}

export interface GateBlocker {
  kind: 'criterion' | 'prerequisite' | 'evidence_conflict';
  ref: string;
  message: string;
}

export interface GateEvaluation {
  ready: boolean;
  hasWaivers: boolean;
  blockers: GateBlocker[];
  counts: { total: number; mandatory: number; met: number; waived: number; notApplicable: number; unmet: number };
}

const APPROVED: (GateAssessmentStatus | 'none')[] = ['approved', 'approved_with_exceptions'];

export function evaluateGate(input: GateEvaluationInput): GateEvaluation {
  const blockers: GateBlocker[] = [];
  let met = 0, waived = 0, na = 0, unmet = 0;
  for (const c of input.criteria) {
    if (c.conflictingEvidenceCount > 0 || c.status === 'conflicting') {
      blockers.push({ kind: 'evidence_conflict', ref: c.key, message: `Criterion ${c.key} has conflicting evidence requiring reassessment` });
    }
    switch (c.status) {
      case 'met':
        if (c.evidenceRequired && c.activeEvidenceCount === 0) {
          unmet++;
          if (c.mandatory || c.blocking) blockers.push({ kind: 'criterion', ref: c.key, message: `Criterion ${c.key} is marked met but has no active evidence` });
        } else met++;
        break;
      case 'waived':
        if (!c.waivable || !c.approvedWaiverId) {
          unmet++;
          if (c.mandatory || c.blocking) blockers.push({ kind: 'criterion', ref: c.key, message: `Criterion ${c.key} waiver is not valid` });
        } else waived++;
        break;
      case 'not_applicable':
        if (!c.naDetermination?.approved || !c.naDetermination.basis.trim()) {
          unmet++;
          if (c.mandatory || c.blocking) {
            blockers.push({ kind: 'criterion', ref: c.key, message: `Criterion ${c.key} is marked not applicable without an approved specialist determination` });
          }
        } else na++;
        break;
      default:
        unmet++;
        if (c.mandatory || c.blocking) blockers.push({ kind: 'criterion', ref: c.key, message: `Mandatory criterion ${c.key} is not met` });
    }
  }
  for (const p of input.prerequisites) {
    if (!APPROVED.includes(p.status)) {
      blockers.push({ kind: 'prerequisite', ref: p.gateKey, message: `Prerequisite gate ${p.gateKey} is not approved` });
    }
  }
  return {
    ready: blockers.length === 0,
    hasWaivers: waived > 0,
    blockers,
    counts: {
      total: input.criteria.length,
      mandatory: input.criteria.filter((c) => c.mandatory).length,
      met,
      waived,
      notApplicable: na,
      unmet,
    },
  };
}

/** AT-13: non-waivable conditions cannot be waived; waivers need an authorized approver distinct from requester. */
export function assertWaiverAllowed(input: {
  criterionKey: string;
  waivable: boolean;
  waiverAuthorityRole: string | null;
  approverRoles: string[];
  approverUserId: string;
  requesterUserId: string;
  basis: string;
  impact: string;
}): void {
  if (!input.waivable) {
    throw ruleViolation('gates.waiver.non_waivable', `Criterion ${input.criterionKey} is not waivable`);
  }
  if (!input.waiverAuthorityRole || !input.approverRoles.includes(input.waiverAuthorityRole)) {
    throw ruleViolation('gates.waiver.unauthorized', `Waiver requires the ${input.waiverAuthorityRole ?? 'designated'} authority`);
  }
  if (input.approverUserId === input.requesterUserId) {
    throw ruleViolation('gates.waiver.self_approval', 'The waiver requester cannot approve their own waiver');
  }
  if (!input.basis.trim() || !input.impact.trim()) {
    throw ruleViolation('gates.waiver.missing_basis', 'A waiver requires a documented basis and impact');
  }
}

/**
 * "Not applicable" is a specialist determination distinct from a waiver: it needs a documented basis, must be made by
 * the criterion's reviewer role, and cannot be made by the person who proposed it (P0 review D-01).
 */
export function assertNotApplicableAllowed(input: {
  criterionKey: string;
  reviewerRole: string;
  determinerRoles: string[];
  determinerUserId: string;
  proposerUserId: string;
  basis: string;
}): void {
  if (!input.basis.trim()) throw ruleViolation('gates.na.missing_basis', 'A not-applicable determination requires a documented basis');
  if (!input.determinerRoles.includes(input.reviewerRole)) {
    throw ruleViolation('gates.na.unauthorized', `Only the ${input.reviewerRole} role may determine ${input.criterionKey} not applicable`);
  }
  if (input.determinerUserId === input.proposerUserId) {
    throw ruleViolation('gates.na.self_approval', 'The proposer cannot approve their own not-applicable determination');
  }
}

/**
 * Controlled reopen (spec §3, P0 review D-09): the approved/rejected assessment is NEVER modified; a new assessment
 * cycle is created in status "reopened" that supersedes it.
 */
export function planReopen(prev: { id: string; cycle: number; status: string }, reason: string) {
  if (!['approved', 'approved_with_exceptions', 'rejected'].includes(prev.status)) {
    throw ruleViolation('gates.reopen.invalid_state', `Only decided assessments can be reopened (current: ${prev.status})`);
  }
  if (!reason.trim()) throw ruleViolation('gates.reopen.missing_reason', 'Reopening requires a reason (e.g. evidence found defective)');
  return { cycle: prev.cycle + 1, supersedesAssessmentId: prev.id, status: 'reopened' as const, reason };
}

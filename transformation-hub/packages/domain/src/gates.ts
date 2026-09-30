import { ruleViolation } from './errors';
import { formatMessage, serverMessage, type ServerMessage } from './messages';
import type { CriterionStatus, GateAssessmentStatus, DecisionStatus, DecisionAuthorityOutcome } from './enums';

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
  kind: 'criterion' | 'prerequisite' | 'evidence_conflict' | 'decision';
  ref: string;
  /** English sentence (kept for problem details, audit and AI context); rendered from `messageI18n`. */
  message: string;
  /** The same sentence as a translatable code + parameters (QA-P1-14); clients translate `gates.messages.<code>`. */
  messageI18n: ServerMessage[];
}

/**
 * English templates of every gate blocker code. The web catalogue (`gates.messages.gate.*`, en + ar) carries the same codes
 * and placeholders. `{status}` is a decision status enum value.
 */
export const GATE_MESSAGES_EN: Readonly<Record<string, string>> = {
  'gate.blocker.evidence_conflict': 'Criterion {criterion} has conflicting evidence requiring reassessment',
  'gate.blocker.met_without_evidence': 'Criterion {criterion} is marked met but has no active evidence',
  'gate.blocker.waiver_invalid': 'Criterion {criterion} waiver is not valid',
  'gate.blocker.not_applicable_undetermined': 'Criterion {criterion} is marked not applicable without an approved specialist determination',
  'gate.blocker.criterion_unmet': 'Mandatory criterion {criterion} is not met',
  'gate.blocker.prerequisite_not_approved': 'Prerequisite gate {gate} is not approved',
  'gate.blocker.no_decision': 'No approved governance decision is linked to gate {gate}',
  'gate.blocker.decision_other_gate': 'The linked decision was raised for gate {decisionGate}, not {gate}',
  'gate.blocker.decision_recommended': 'The linked decision is recommended — pending the external authority; it is not a final approval and the gate stays blocked',
  'gate.blocker.decision_not_approved': 'The linked decision is {status}; only an approved decision can back a gate approval',
  'gate.blocker.decision_external_unrecorded': 'The linked decision is outside the committee delegation and no approval by the authorized body is recorded',
  'gate.blocker.decision_no_authority': 'The linked decision has no authority assessment (within mandate / external authority)',
};

function blocker(kind: GateBlocker['kind'], ref: string, code: string, params: Record<string, string | number> = {}): GateBlocker {
  const template = GATE_MESSAGES_EN[code];
  if (template === undefined) throw new Error(`No English template for message code ${code}`);
  return { kind, ref, message: formatMessage(template, params), messageI18n: [serverMessage(code, params)] };
}

export interface GateEvaluation {
  ready: boolean;
  hasWaivers: boolean;
  blockers: GateBlocker[];
  /** `blockingUnmet` = blocking criteria not satisfied (forces the gate RAG to red — business-gates.md §2.1). */
  counts: { total: number; mandatory: number; met: number; waived: number; notApplicable: number; unmet: number; blockingUnmet: number };
}

const APPROVED: (GateAssessmentStatus | 'none')[] = ['approved', 'approved_with_exceptions'];

export function evaluateGate(input: GateEvaluationInput): GateEvaluation {
  const blockers: GateBlocker[] = [];
  let met = 0, waived = 0, na = 0, unmet = 0, blockingUnmet = 0;
  for (const c of input.criteria) {
    const conflicting = c.conflictingEvidenceCount > 0 || c.status === 'conflicting';
    if (conflicting) {
      blockers.push(blocker('evidence_conflict', c.key, 'gate.blocker.evidence_conflict', { criterion: c.key }));
    }
    let satisfied = false;
    switch (c.status) {
      case 'met':
        if (c.evidenceRequired && c.activeEvidenceCount === 0) {
          unmet++;
          if (c.mandatory || c.blocking) blockers.push(blocker('criterion', c.key, 'gate.blocker.met_without_evidence', { criterion: c.key }));
        } else {
          met++;
          satisfied = true;
        }
        break;
      case 'waived':
        if (!c.waivable || !c.approvedWaiverId) {
          unmet++;
          if (c.mandatory || c.blocking) blockers.push(blocker('criterion', c.key, 'gate.blocker.waiver_invalid', { criterion: c.key }));
        } else {
          waived++;
          satisfied = true;
        }
        break;
      case 'not_applicable':
        if (!c.naDetermination?.approved || !c.naDetermination.basis.trim()) {
          unmet++;
          if (c.mandatory || c.blocking) {
            blockers.push(blocker('criterion', c.key, 'gate.blocker.not_applicable_undetermined', { criterion: c.key }));
          }
        } else {
          na++;
          satisfied = true;
        }
        break;
      default:
        unmet++;
        if (c.mandatory || c.blocking) blockers.push(blocker('criterion', c.key, 'gate.blocker.criterion_unmet', { criterion: c.key }));
    }
    if (c.blocking && (!satisfied || conflicting)) blockingUnmet++;
  }
  for (const p of input.prerequisites) {
    if (!APPROVED.includes(p.status)) {
      blockers.push(blocker('prerequisite', p.gateKey, 'gate.blocker.prerequisite_not_approved', { gate: p.gateKey }));
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
      blockingUnmet,
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// Assessment lifecycle guards used by the gates command service

/** Assessments whose status and decision are final for their cycle (never modified afterwards — reopen creates a new cycle). */
export const DECIDED_GATE_STATUSES: readonly GateAssessmentStatus[] = ['approved', 'approved_with_exceptions', 'rejected'];
export const APPROVED_GATE_STATUSES: readonly GateAssessmentStatus[] = ['approved', 'approved_with_exceptions'];
/**
 * Criterion assessments may be changed only while the cycle is being assessed. From `ready_for_decision` the owner must
 * first send the gate back to assessment (explicit command), so a decision is never taken on a moving target.
 */
export const CRITERION_EDITABLE_GATE_STATUSES: readonly GateAssessmentStatus[] = ['not_started', 'in_assessment', 'reopened'];

export function assertCriterionEditable(gateKey: string, status: GateAssessmentStatus): void {
  if (!CRITERION_EDITABLE_GATE_STATUSES.includes(status)) {
    throw ruleViolation(
      'gates.assessment.not_editable',
      status === 'ready_for_decision'
        ? `Gate ${gateKey} is ready for decision — send it back to assessment before changing criteria`
        : `Gate ${gateKey} assessment is ${status}; criteria of a decided cycle are preserved (use the controlled reopen)`,
      { status },
    );
  }
}

/**
 * Decision states that are a final approval. Approval ≠ implementation (spec §4.2): the implementation-tracking states
 * that follow `approved` are still approved decisions.
 */
export const FINAL_APPROVED_DECISION_STATUSES: readonly DecisionStatus[] = ['approved', 'implementation_pending', 'implemented_verified'];

export interface GateDecisionBacking {
  id: string;
  status: DecisionStatus;
  authorityOutcome: DecisionAuthorityOutcome;
  /** Reference of the external authority's approval (recorded when a recommendation was approved by the authorized body). */
  externalAuthorityReference?: string | null;
  /** Gate the decision was raised for (decision.gate_key), when set. */
  gateKey?: string | null;
}

/**
 * AT-04: a gate approval must be backed by a FINAL governance decision. A decision that is only `recommended` (outside the
 * committee's delegation, pending the external authority), still in review, deferred, rejected or superseded keeps the
 * gate blocked. A decision is final when approved within the committee mandate, or when the authorized body approved a
 * recommendation (status approved + external approval reference recorded — governance.assertApprovalAllowed).
 * Returns null when the decision can back the approval, otherwise the blocker.
 */
export function gateDecisionIssue(d: GateDecisionBacking | null, gateKey: string): GateBlocker | null {
  if (!d) return blocker('decision', gateKey, 'gate.blocker.no_decision', { gate: gateKey });
  if (d.gateKey && d.gateKey !== gateKey) return blocker('decision', d.id, 'gate.blocker.decision_other_gate', { decisionGate: d.gateKey, gate: gateKey });
  if (!FINAL_APPROVED_DECISION_STATUSES.includes(d.status)) {
    return d.status === 'recommended'
      ? blocker('decision', d.id, 'gate.blocker.decision_recommended')
      : blocker('decision', d.id, 'gate.blocker.decision_not_approved', { status: d.status });
  }
  if (d.authorityOutcome === 'within_mandate') return null;
  if (d.authorityOutcome === 'pending_external_authority' && d.externalAuthorityReference?.trim()) return null;
  return d.authorityOutcome === 'pending_external_authority'
    ? blocker('decision', d.id, 'gate.blocker.decision_external_unrecorded')
    : blocker('decision', d.id, 'gate.blocker.decision_no_authority');
}

export type GateDecisionOutcome = 'approve' | 'approve_with_exceptions' | 'reject';

/**
 * Guard for the gate decision command (server-side re-evaluation at decision time; spec §3 "Task completion reaching 100%
 * does not unlock a gate. Validate evidence, approvals, and mandatory criteria on the server").
 */
export function assertGateDecisionAllowed(input: {
  gateKey: string;
  outcome: GateDecisionOutcome;
  evaluation: GateEvaluation;
  decision: GateDecisionBacking | null;
  /** Decisions that already backed an earlier cycle of the same gate (a reopened gate needs a fresh decision). */
  decisionIdsUsedByPriorCycles: string[];
  note: string;
}): void {
  if (input.outcome === 'reject') {
    if (!input.note.trim()) throw ruleViolation('gates.decide.missing_reason', 'A gate rejection requires a recorded reason');
    return;
  }
  if (!input.evaluation.ready) {
    throw ruleViolation('gates.decide.not_ready', `Gate ${input.gateKey} is not ready at decision time`, { blockers: input.evaluation.blockers });
  }
  const issue = gateDecisionIssue(input.decision, input.gateKey);
  if (issue) {
    throw ruleViolation('gates.decide.decision_not_final', issue.message, {
      decisionId: input.decision?.id ?? null,
      decisionStatus: input.decision?.status ?? null,
      authorityOutcome: input.decision?.authorityOutcome ?? null,
    });
  }
  if (input.decision && input.decisionIdsUsedByPriorCycles.includes(input.decision.id)) {
    throw ruleViolation('gates.decide.decision_reused', 'This decision already backed an earlier cycle of the gate; a reopened gate needs a fresh decision');
  }
  if (input.outcome === 'approve_with_exceptions' && !input.evaluation.hasWaivers) {
    throw ruleViolation('gates.decide.no_exceptions', 'Approve with exceptions requires at least one approved waiver');
  }
  if (input.outcome === 'approve' && input.evaluation.hasWaivers) {
    throw ruleViolation('gates.decide.exceptions_present', 'Approved waivers exist — record the decision as approved with exceptions so the exceptions stay visible');
  }
}

/**
 * Gate RAG from criteria and blockers only (never from task progress or the workstream average — spec §9 rule 3).
 */
export function gateRag(status: GateAssessmentStatus, evaluation: GateEvaluation, needsReassessment: boolean): 'green' | 'amber' | 'red' {
  if (needsReassessment) return 'red';
  if (APPROVED_GATE_STATUSES.includes(status)) return 'green';
  if (status === 'rejected') return 'red';
  if (evaluation.blockers.some((b) => b.kind === 'evidence_conflict') || evaluation.counts.blockingUnmet > 0) return 'red';
  if (evaluation.ready) return 'green';
  return 'amber';
}

/** A waiver counts only when approved and not past its expiry (business date, inclusive). */
export function waiverIsEffective(w: { status: string; expiresOn: string | null } | null | undefined, today: string): boolean {
  return !!w && w.status === 'approved' && (!w.expiresOn || w.expiresOn >= today);
}

export interface PriorCriterionAssessment {
  criterionId: string;
  status: CriterionStatus;
  waiverId: string | null;
}

/**
 * Criterion states of a new (reopened) cycle. The prior cycle is never modified; the new cycle starts from its states
 * except: criteria whose evidence is now conflicting → `conflicting`; criteria named by the reopener → `unmet` (re-review);
 * a prior `conflicting` state that is no longer conflicting → `unmet` (must be re-assessed, never silently "met").
 */
export function carryForwardCriteria(
  prior: PriorCriterionAssessment[],
  opts: { conflictingCriterionIds: ReadonlySet<string>; resetCriterionIds: ReadonlySet<string> },
): { criterionId: string; status: CriterionStatus; waiverId: string | null; carriedFrom: CriterionStatus }[] {
  return prior.map((p) => {
    let status: CriterionStatus = p.status;
    if (opts.conflictingCriterionIds.has(p.criterionId)) status = 'conflicting';
    else if (opts.resetCriterionIds.has(p.criterionId) || p.status === 'conflicting') status = 'unmet';
    return { criterionId: p.criterionId, status, waiverId: status === 'waived' ? p.waiverId : null, carriedFrom: p.status };
  });
}

/** Whether a role may approve waivers at all (waiver authority must be a role holding the approve permission). */
export function assertWaivabilityDetermination(input: { waivable: boolean; waiverAuthorityRole: string | null; basis: string; authorityRoleCanApprove: boolean }): void {
  if (!input.basis.trim()) throw ruleViolation('gates.waivability.missing_basis', 'A waivability determination requires a documented specialist basis');
  if (input.waivable) {
    if (!input.waiverAuthorityRole) throw ruleViolation('gates.waivability.missing_authority', 'A waivable criterion must name the waiver authority role');
    if (!input.authorityRoleCanApprove) {
      throw ruleViolation('gates.waivability.invalid_authority', `Role ${input.waiverAuthorityRole} cannot approve waivers under the policy matrix`);
    }
  }
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

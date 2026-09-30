import type { RaidStatus, RagStatus, TaskStatus, MilestoneStatus, DeliverableStatus, DecisionStatus, DecisionAuthorityOutcome, GateAssessmentStatus, AgreementStage, ApprovalRequestStatus } from './enums';
import type { Machine } from './workflows';
import type { WeightedItem } from './measurement';
import { addCalendarDays } from './calendar';
import { canonicalJson } from './canonical';
import { forbidden, ruleViolation } from './errors';
import { APPROVED_GATE_STATUSES, gateDecisionIssue } from './gates';

/**
 * Planning rules that are not schedule/measurement maths (spec §9): RAID lifecycle and exposure, open blockers,
 * look-ahead windows, deliverable progress states, driving-network selection and canonical snapshots.
 * Pure functions only (no I/O) — the API applies them inside the request transaction.
 */

// ---------------------------------------------------------------------------------------------------------
// RAID lifecycle (risks, issues, assumptions, RAID dependencies share one status set)

export type RaidCommand = 'monitor' | 'escalate' | 'mitigate' | 'close' | 'cancel' | 'reopen';
export const RAID_MACHINE: Machine<RaidStatus, RaidCommand> = {
  monitor: { from: ['open'], to: 'monitoring', description: 'Being monitored (trigger not yet reached)' },
  escalate: { from: ['open', 'monitoring', 'escalated'], to: 'escalated', description: 'Escalated to a higher level (level must increase)' },
  mitigate: { from: ['open', 'monitoring', 'escalated'], to: 'mitigated', description: 'Response implemented; residual exposure accepted' },
  close: { from: ['open', 'monitoring', 'escalated', 'mitigated'], to: 'closed', description: 'Closed with a reason' },
  cancel: { from: ['open', 'monitoring'], to: 'cancelled', description: 'Recorded in error / no longer applicable' },
  reopen: { from: ['closed', 'mitigated', 'cancelled'], to: 'open', description: 'Reopened with a reason' },
};

export const OPEN_RAID_STATUSES: readonly RaidStatus[] = ['open', 'monitoring', 'escalated'];
export const MAX_ESCALATION_LEVEL = 3;

/** Risk exposure score = probability × impact on 1–5 scales (1–25). */
export function riskScore(probability: number, impact: number): number {
  if (!Number.isInteger(probability) || !Number.isInteger(impact) || probability < 1 || probability > 5 || impact < 1 || impact > 5) {
    throw new RangeError('probability and impact must be integers 1..5');
  }
  return probability * impact;
}

/** Proposed rating bands (configurable later): ≥15 high, ≥8 medium, else low. */
export function riskRating(score: number): 'high' | 'medium' | 'low' {
  return score >= 15 ? 'high' : score >= 8 ? 'medium' : 'low';
}

/** An issue counts as an open blocker when it is open and of severity 4–5 (high/critical). */
export function isBlockingIssue(i: { status: RaidStatus; severity: number }): boolean {
  return OPEN_RAID_STATUSES.includes(i.status) && i.severity >= 4;
}

/** Overdue = has a due date strictly before today and is still open. */
export function isOverdue(dueDate: string | null | undefined, today: string, isOpen: boolean): boolean {
  return !!dueDate && isOpen && dueDate < today;
}

export const OPEN_TASK_STATUSES: readonly TaskStatus[] = ['not_started', 'in_progress', 'blocked', 'submitted_for_acceptance'];
export const CLOSED_TASK_STATUSES: readonly TaskStatus[] = ['accepted', 'done', 'cancelled'];
export const OPEN_MILESTONE_STATUSES: readonly MilestoneStatus[] = ['planned', 'at_risk', 'achieved_pending_evidence', 'missed'];
export const OPEN_DELIVERABLE_STATUSES: readonly DeliverableStatus[] = ['planned', 'in_progress', 'submitted', 'rejected'];

// ---------------------------------------------------------------------------------------------------------
// Acceptance authority (spec §6 "approver role" per activity, §9 "completion requires acceptance"; DOM-P2-07)

/**
 * A task (or a deliverable linked to a task) that designates an approver role is accepted — or returned — only by a holder
 * of that role, on top of the acceptance permission and separation of duties (the submitter never accepts). No designated
 * role (`null`) = the acceptance permission decides.
 */
export function assertDesignatedApprover(input: { subject: string; approverRole: string | null; actorRoles: readonly string[] }): void {
  if (input.approverRole && !input.actorRoles.includes(input.approverRole)) {
    throw forbidden('planning.acceptance.not_approver_role', `Only the designated approver role (${input.approverRole}) may accept or return ${input.subject}`);
  }
}

// ---------------------------------------------------------------------------------------------------------
// Non-schedule prerequisites (spec §9 "Dependency graph … linking approvals, agreements, evidence, decisions, and gates";
// REQ-PLN-006; DOM-P2-18)

export const PREREQUISITE_TYPES = ['decision', 'gate', 'agreement', 'approval_request', 'evidence_link'] as const;
export type PrerequisiteType = (typeof PREREQUISITE_TYPES)[number];

export type PrerequisiteState =
  | { type: 'decision'; status: DecisionStatus; authorityOutcome: DecisionAuthorityOutcome; externalAuthorityReference: string | null }
  | { type: 'gate'; status: GateAssessmentStatus | 'not_started'; needsReassessment: boolean }
  | { type: 'agreement'; stage: AgreementStage }
  | { type: 'approval_request'; status: ApprovalRequestStatus }
  | { type: 'evidence_link'; status: 'active' | 'superseded' | 'conflicting' | 'rejected'; verified: boolean };

/**
 * Whether a non-schedule predecessor is satisfied: a FINAL decision (approved within the mandate, or approved by the
 * authorized body with its reference — never a recommendation); an approved gate not flagged for reassessment; a signed
 * or effective agreement; an approved approval request; active evidence that passed verification.
 */
export function prerequisiteSatisfied(s: PrerequisiteState): boolean {
  switch (s.type) {
    case 'decision':
      return gateDecisionIssue({ id: 'prerequisite', status: s.status, authorityOutcome: s.authorityOutcome, externalAuthorityReference: s.externalAuthorityReference }, 'prerequisite') === null;
    case 'gate':
      return (APPROVED_GATE_STATUSES as readonly string[]).includes(s.status) && !s.needsReassessment;
    case 'agreement':
      return s.stage === 'signed' || s.stage === 'effective';
    case 'approval_request':
      return s.status === 'approved';
    case 'evidence_link':
      return s.status === 'active' && s.verified;
  }
}

/** Finish-to-Start: a task / milestone with an unsatisfied prerequisite cannot start / be reported achieved (count only). */
export function assertPrerequisitesSatisfied(subject: string, states: readonly PrerequisiteState[]): void {
  const pending = states.filter((s) => !prerequisiteSatisfied(s));
  if (pending.length) {
    throw ruleViolation(
      'planning.prerequisite_pending',
      `${subject} is blocked by ${pending.length} prerequisite(s) not yet satisfied (decision, gate, agreement, approval or evidence)`,
      { pending: pending.length, types: [...new Set(pending.map((s) => s.type))] },
    );
  }
}

// ---------------------------------------------------------------------------------------------------------
// Look-ahead

export const LOOK_AHEAD_WEEKS = [2, 4, 8] as const;
export type LookAheadWeeks = (typeof LOOK_AHEAD_WEEKS)[number];

/** Inclusive window [today, today + 7×weeks − 1] in local business dates. */
export function lookAheadWindow(today: string, weeks: number): { from: string; to: string } {
  if (!(LOOK_AHEAD_WEEKS as readonly number[]).includes(weeks)) throw new RangeError('weeks must be 2, 4 or 8');
  return { from: today, to: addCalendarDays(today, weeks * 7 - 1) };
}

export function inWindow(d: string | null | undefined, w: { from: string; to: string }): boolean {
  return !!d && d >= w.from && d <= w.to;
}

// ---------------------------------------------------------------------------------------------------------
// Weighted progress inputs (measurement rules 1–2)

/**
 * Maps a deliverable to a weighted-progress item. Only ACCEPTED deliverables count as complete (evidence-verified);
 * cancelled deliverables are excluded (never complete); unapproved weights are excluded with a reason.
 */
export function deliverableProgressItem(d: { id: string; code?: string; title?: string; status: DeliverableStatus; weight: number; weightApproved: boolean }): WeightedItem {
  const label = d.code ? `${d.code} ${d.title ?? ''}`.trim() : d.title;
  if (d.status === 'cancelled') return { id: d.id, label, weight: d.weight, state: 'cancelled', exclusionReason: 'Cancelled — excluded from the denominator, not counted as complete' };
  if (!d.weightApproved) return { id: d.id, label, weight: d.weight, state: 'excluded', exclusionReason: 'Weight not approved' };
  if (d.status === 'accepted') return { id: d.id, label, weight: d.weight, state: 'accepted' };
  if (d.status === 'planned') return { id: d.id, label, weight: d.weight, state: 'not_started' };
  return { id: d.id, label, weight: d.weight, state: 'in_progress' };
}

// ---------------------------------------------------------------------------------------------------------
// Schedule scoping

/** The target node plus all of its transitive predecessors (the network that drives the target's date). */
export function drivingNetwork(targetId: string, edges: { predecessorId: string; successorId: string }[]): Set<string> {
  const preds = new Map<string, string[]>();
  for (const e of edges) (preds.get(e.successorId) ?? preds.set(e.successorId, []).get(e.successorId)!).push(e.predecessorId);
  const out = new Set<string>([targetId]);
  const stack = [targetId];
  while (stack.length) {
    const n = stack.pop()!;
    for (const p of preds.get(n) ?? []) {
      if (!out.has(p)) {
        out.add(p);
        stack.push(p);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// RAG helpers

/** Latest of a set of ISO dates (null when any is missing and `requireAll`, or when empty). */
export function latestDate(dates: (string | null | undefined)[], requireAll = true): string | null {
  if (dates.length === 0) return null;
  let best: string | null = null;
  for (const d of dates) {
    if (!d) {
      if (requireAll) return null;
      continue;
    }
    if (!best || d > best) best = d;
  }
  return best;
}

/** Freshness date of an accepted update: the earlier of its period end and its acceptance date (cannot be pre-dated into the future). */
export function updateFreshnessDate(periodEnd: string, acceptedOn: string): string {
  return periodEnd < acceptedOn ? periodEnd : acceptedOn;
}

export const RAG_OVERRIDE_MAX_DAYS = 90;

export function ragSeverityLabel(s: RagStatus): string {
  return { green: 'On track', amber: 'At risk', red: 'Off track', unknown: 'Unknown', stale: 'Data stale', not_updated: 'Not updated' }[s];
}

// ---------------------------------------------------------------------------------------------------------
// Canonical JSON (for snapshot hashes — hashing itself happens in the API)


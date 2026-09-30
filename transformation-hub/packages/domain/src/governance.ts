import Decimal from 'decimal.js';
import { ruleViolation } from './errors';
import type { ActionItemStatus, AGENDA_SCREENING_STATUSES, ATTENDANCE_STATUSES, CommitteeMemberRole, MeetingStatus, VoteChoice } from './enums';
import type { Machine } from './workflows';

// Local aliases (enums.ts exports the value lists only for these vocabularies).
type AgendaScreeningStatus = (typeof AGENDA_SCREENING_STATUSES)[number];
type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/**
 * Committee rules (spec §4): quorum, recusal, voting thresholds, ties, delegated authority, self-approval.
 * All checks are pure and executed server-side by the governance command service (AT-04, AT-05).
 */

export interface AuthorityPolicy {
  isDemoPolicy: boolean;
  quorum: { minVotingMembersPresent: number; minFractionPresent: number };
  approvalThreshold: { type: 'simple_majority' | 'two_thirds' };
  tieRule: 'chair_casting_vote' | 'escalate';
  decisionTypes: {
    key: string;
    maxAmount: string | null; // decimal string in `currency`×`unitScale`; null = no monetary limit
    currency: string;
    unitScale: number;
    withinCommitteeAuthority: boolean;
    escalateTo: string;
    /** Gates whose passage this decision type may approve (authority-matrix.md §2.2; none when absent — DOM-P2-01). */
    gateKeys?: string[];
  }[];
  selfApprovalProhibited: boolean;
  recusedMembersExcludedFromQuorum: boolean;
}

export interface MemberSnapshot {
  membershipId: string;
  userId: string | null;
  role: CommitteeMemberRole;
  voting: boolean;
  validFrom: string; // ISO date
  validTo: string | null;
}

export function isMemberActiveOn(m: MemberSnapshot, date: string): boolean {
  return m.validFrom <= date && (m.validTo === null || m.validTo >= date);
}

export interface QuorumInput {
  members: MemberSnapshot[];
  presentUserIds: string[];
  recusedUserIds: string[];
  onDate: string;
  policy: AuthorityPolicy;
  /** The decision requester: excluded from quorum when self-approval is prohibited (A-19, P0 QA review QA-02). */
  requesterUserId?: string | null;
}

export interface QuorumResult {
  eligibleVoting: number;
  presentVoting: number;
  required: number;
  met: boolean;
  explanation: string;
}

export function computeQuorum(input: QuorumInput): QuorumResult {
  const { policy } = input;
  const recused = new Set(input.recusedUserIds);
  // Members barred from voting on this decision (recused, or the requester when self-approval is prohibited)
  // cannot make up the quorum for it.
  if (policy.selfApprovalProhibited && input.requesterUserId) recused.add(input.requesterUserId);
  const present = new Set(input.presentUserIds);
  const voting = input.members.filter((m) => m.voting && m.userId && isMemberActiveOn(m, input.onDate));
  const eligible = policy.recusedMembersExcludedFromQuorum ? voting.filter((m) => !recused.has(m.userId!)) : voting;
  const presentVoting = eligible.filter((m) => present.has(m.userId!)).length;
  const byFraction = Math.ceil(eligible.length * policy.quorum.minFractionPresent - 1e-9);
  const required = Math.max(policy.quorum.minVotingMembersPresent, byFraction);
  const met = eligible.length > 0 && presentVoting >= required;
  return {
    eligibleVoting: eligible.length,
    presentVoting,
    required,
    met,
    explanation: met
      ? `Quorum met: ${presentVoting} of ${eligible.length} eligible voting members present (required ${required}).`
      : `Quorum NOT met: ${presentVoting} of ${eligible.length} eligible voting members present (required ${required}).`,
  };
}

export interface VoteEligibilityInput {
  voterUserId: string;
  members: MemberSnapshot[];
  recusedUserIds: string[];
  requesterUserId: string | null;
  onDate: string;
  policy: AuthorityPolicy;
}

/** Throws a rule violation if the user may not vote on this decision (AT-05). */
export function assertMayVote(input: VoteEligibilityInput): MemberSnapshot {
  const m = input.members.find((x) => x.userId === input.voterUserId && isMemberActiveOn(x, input.onDate));
  if (!m) throw ruleViolation('governance.vote.not_member', 'Only active committee members may vote');
  if (!m.voting) throw ruleViolation('governance.vote.not_voting_member', 'Advisory members and guests cannot vote');
  if (input.recusedUserIds.includes(input.voterUserId)) {
    throw ruleViolation('governance.vote.recused', 'A recused member cannot vote on this decision');
  }
  if (input.policy.selfApprovalProhibited && input.requesterUserId && input.requesterUserId === input.voterUserId) {
    throw ruleViolation('governance.vote.self_approval', 'The requester of a decision may not vote to approve it (self-approval prohibited)');
  }
  return m;
}

export interface TallyInput {
  votes: { userId: string; choice: VoteChoice }[];
  chairUserId: string | null;
  quorumMet: boolean;
  policy: AuthorityPolicy;
}

export type TallyOutcome = 'approve' | 'reject' | 'tie_escalate' | 'no_quorum' | 'insufficient_votes';

export interface TallyResult {
  outcome: TallyOutcome;
  approve: number;
  reject: number;
  abstain: number;
  explanation: string;
}

export function tallyVotes(input: TallyInput): TallyResult {
  const approve = input.votes.filter((v) => v.choice === 'approve').length;
  const reject = input.votes.filter((v) => v.choice === 'reject').length;
  const abstain = input.votes.filter((v) => v.choice === 'abstain').length;
  const base = { approve, reject, abstain };
  if (!input.quorumMet) return { ...base, outcome: 'no_quorum', explanation: 'Quorum not met — no valid outcome can be recorded.' };
  const cast = approve + reject;
  if (cast === 0) return { ...base, outcome: 'insufficient_votes', explanation: 'No approve/reject votes cast.' };
  if (input.policy.approvalThreshold.type === 'two_thirds') {
    if (approve * 3 >= cast * 2) return { ...base, outcome: 'approve', explanation: `Two-thirds threshold reached (${approve}/${cast}).` };
    return { ...base, outcome: 'reject', explanation: `Two-thirds threshold not reached (${approve}/${cast}).` };
  }
  if (approve > reject) return { ...base, outcome: 'approve', explanation: `Simple majority (${approve} to ${reject}).` };
  if (reject > approve) return { ...base, outcome: 'reject', explanation: `Majority against (${reject} to ${approve}).` };
  if (input.policy.tieRule === 'chair_casting_vote' && input.chairUserId) {
    const chairVote = input.votes.find((v) => v.userId === input.chairUserId);
    if (chairVote && chairVote.choice !== 'abstain') {
      return {
        ...base,
        outcome: chairVote.choice === 'approve' ? 'approve' : 'reject',
        explanation: `Tie resolved by chair casting vote (${chairVote.choice}).`,
      };
    }
  }
  return { ...base, outcome: 'tie_escalate', explanation: 'Tie — escalated per policy.' };
}

export interface AuthorityCheckInput {
  policy: AuthorityPolicy;
  decisionTypeKey: string;
  amount: { amount: string; currency: string; unitScale: number } | null;
}

export interface AuthorityCheckResult {
  outcome: 'within_mandate' | 'pending_external_authority';
  escalateTo: string | null;
  reason: string;
}

/**
 * Determines whether the committee may make a final decision (AT-04). Unknown decision types, amounts in a
 * different currency than the limit, and amounts above the limit are all *outside* the mandate.
 */
export function checkAuthority(input: AuthorityCheckInput): AuthorityCheckResult {
  const t = input.policy.decisionTypes.find((d) => d.key === input.decisionTypeKey);
  if (!t) {
    return { outcome: 'pending_external_authority', escalateTo: 'Authority to be confirmed', reason: `Decision type "${input.decisionTypeKey}" is not in the approved authority matrix.` };
  }
  if (!t.withinCommitteeAuthority) {
    return { outcome: 'pending_external_authority', escalateTo: t.escalateTo, reason: `Decision type "${t.key}" is reserved for ${t.escalateTo}.` };
  }
  if (t.maxAmount !== null) {
    if (!input.amount) {
      return { outcome: 'pending_external_authority', escalateTo: t.escalateTo, reason: 'Amount required to assess delegated limit but none was provided.' };
    }
    if (input.amount.currency !== t.currency) {
      return {
        outcome: 'pending_external_authority',
        escalateTo: t.escalateTo,
        reason: `Amount currency ${input.amount.currency} differs from limit currency ${t.currency}; conversion basis needed.`,
      };
    }
    const amt = new Decimal(input.amount.amount).mul(input.amount.unitScale);
    const limit = new Decimal(t.maxAmount).mul(t.unitScale);
    if (amt.gt(limit)) {
      return { outcome: 'pending_external_authority', escalateTo: t.escalateTo, reason: 'Amount exceeds the committee delegated limit.' };
    }
  }
  return { outcome: 'within_mandate', escalateTo: null, reason: 'Within delegated authority.' };
}

/**
 * Decision paper completeness (spec §4.2) before submission. Returns missing field names. Impacts must state the
 * financial, operational AND schedule impact (use "None identified" explicitly rather than leaving one out).
 */
export function missingDecisionPaperFields(paper: {
  issue?: string | null;
  whyNow?: string | null;
  alternatives?: unknown[] | null;
  recommendation?: string | null;
  impacts?: Record<string, unknown> | null;
  risks?: string | null;
  dependencies?: string | null;
  latestSafeDate?: string | null;
  requiredAuthority?: string | null;
  decisionTypeKey?: string | null;
  requesterUserId?: string | null;
}): string[] {
  const missing: string[] = [];
  const txt = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
  if (!txt(paper.issue)) missing.push('issue');
  if (!txt(paper.whyNow)) missing.push('whyNow');
  if (!paper.alternatives || paper.alternatives.length === 0) missing.push('alternatives');
  if (!txt(paper.recommendation)) missing.push('recommendation');
  for (const k of ['financial', 'operational', 'schedule']) if (!txt(paper.impacts?.[k])) missing.push(`impacts.${k}`);
  if (!txt(paper.risks)) missing.push('risks');
  if (!txt(paper.dependencies)) missing.push('dependencies');
  if (!paper.latestSafeDate) missing.push('latestSafeDate');
  if (!txt(paper.requiredAuthority)) missing.push('requiredAuthority');
  if (!paper.decisionTypeKey) missing.push('decisionTypeKey');
  if (!paper.requesterUserId) missing.push('requesterUserId');
  return missing;
}

export interface MatrixState {
  status: 'draft' | 'approved' | 'superseded';
  isDemoPolicy: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

/** An authority matrix is usable on a date only if approved, in its effective window, and demo policies only on demo projects. */
export function matrixUsable(m: MatrixState | null, onDate: string, projectIsDemo: boolean): { usable: boolean; reason: string } {
  if (!m) return { usable: false, reason: 'No authority matrix exists for this committee' };
  if (m.status !== 'approved') return { usable: false, reason: `Authority matrix is ${m.status}` };
  if (m.effectiveFrom && m.effectiveFrom > onDate) return { usable: false, reason: 'Authority matrix not yet effective' };
  if (m.effectiveTo && m.effectiveTo < onDate) return { usable: false, reason: 'Authority matrix (delegation) has expired' };
  if (m.isDemoPolicy && !projectIsDemo) return { usable: false, reason: 'A demo policy cannot authorize decisions on a non-demo project' };
  return { usable: true, reason: 'Approved authority matrix in force' };
}

/**
 * Guard for `record_approval` (P0 review D-03, AT-04):
 *  - from `under_review`: the vote/circulation outcome must be within the committee mandate under a usable matrix;
 *  - from `recommended`: an external-authority approval reference is required and must be recorded by a different
 *    person than the one who recorded the recommendation.
 */
export function assertApprovalAllowed(input: {
  from: 'under_review' | 'recommended' | string;
  authorityOutcome: 'within_mandate' | 'pending_external_authority' | 'not_assessed';
  matrix: MatrixState | null;
  projectIsDemo: boolean;
  onDate: string;
  externalReference?: string | null;
  recorderUserId: string;
  recommendationRecordedBy?: string | null;
}): void {
  if (input.from === 'under_review') {
    if (input.authorityOutcome !== 'within_mandate') {
      throw ruleViolation('governance.approval.outside_mandate', 'The decision is outside the committee delegated authority — record it as a recommendation pending the authorized body');
    }
    const m = matrixUsable(input.matrix, input.onDate, input.projectIsDemo);
    if (!m.usable) throw ruleViolation('governance.approval.no_usable_matrix', `${m.reason} — production approval authority is not active`);
    return;
  }
  if (input.from === 'recommended') {
    if (!input.externalReference?.trim()) {
      throw ruleViolation('governance.approval.missing_external_reference', 'Approval of a recommendation requires the external authority approval reference');
    }
    if (input.recommendationRecordedBy && input.recommendationRecordedBy === input.recorderUserId) {
      throw ruleViolation('governance.approval.same_recorder', 'The person who recorded the recommendation cannot also record its external approval');
    }
    return;
  }
  throw ruleViolation('governance.approval.invalid_state', `Cannot approve a decision in state ${input.from}`);
}

// =============================================================================================================
// P2 additions (governance module): meeting lifecycle, agenda screening, membership seats, outcome planning,
// action / implementation guards. Pure rules — the API command services call these (spec §4.2).
// =============================================================================================================

/** Meeting lifecycle. Circulations are `meeting` rows flagged `is_circulation` and are opened directly `in_session`. */
export type MeetingCommand = 'publish_agenda' | 'start_session' | 'close_session' | 'draft_minutes' | 'approve_minutes' | 'cancel';
export const MEETING_MACHINE: Machine<MeetingStatus, MeetingCommand> = {
  publish_agenda: { from: ['planned'], to: 'agenda_published', description: 'Numbered agenda published to members' },
  start_session: { from: ['agenda_published'], to: 'in_session', description: 'Session opened (attendance, conflicts, votes)' },
  close_session: { from: ['in_session'], to: 'held', description: 'Session closed' },
  draft_minutes: {
    from: ['held', 'minutes_draft', 'minutes_approved'],
    to: 'minutes_draft',
    description: 'Minutes drafted; a correction of approved minutes creates a new version with a reason',
  },
  approve_minutes: { from: ['minutes_draft'], to: 'minutes_approved', description: 'Minutes approved (immutable version)' },
  cancel: { from: ['planned', 'agenda_published'], to: 'cancelled', description: 'Meeting cancelled' },
};

/** Secretariat screening of agenda requests. */
export type AgendaScreeningCommand = 'accept' | 'return' | 'defer';
export const AGENDA_SCREENING_MACHINE: Machine<AgendaScreeningStatus, AgendaScreeningCommand> = {
  accept: { from: ['requested', 'deferred'], to: 'accepted', description: 'Accepted onto a numbered meeting agenda' },
  return: { from: ['requested', 'deferred'], to: 'returned', description: 'Returned to the requester with reasons' },
  defer: { from: ['requested'], to: 'deferred', description: 'Deferred to a later meeting' },
};

/** Seats that may carry a vote (charter §7): secretary, advisory members and guests never vote. */
export const VOTING_SEAT_ROLES: readonly CommitteeMemberRole[] = ['chair', 'sponsor', 'voting_member'];

export function assertMembershipSeat(input: { memberRole: CommitteeMemberRole; voting: boolean; validFrom: string; validTo?: string | null }): void {
  if (input.voting && !VOTING_SEAT_ROLES.includes(input.memberRole)) {
    throw ruleViolation('governance.membership.non_voting_role', `A ${input.memberRole} seat cannot carry a vote (only chair, sponsor and voting members)`);
  }
  if (input.validTo && input.validTo < input.validFrom) {
    throw ruleViolation('governance.membership.invalid_term', 'Membership end date is before its start date');
  }
}

/** Attendance statuses that count as present for quorum and voting (alternates/proxies are not modelled yet). */
export const PRESENT_ATTENDANCE: readonly AttendanceStatus[] = ['present', 'remote'];

export function presentUserIds(rows: { userId: string | null; status: AttendanceStatus }[]): string[] {
  return [...new Set(rows.filter((r) => r.userId && PRESENT_ATTENDANCE.includes(r.status)).map((r) => r.userId!))];
}

/**
 * Resolution by circulation (assumption, documented): the members who "attend" a circulation are the voting members
 * who responded in the current round; the same quorum thresholds then apply to responders.
 */
export function circulationResponders(votes: { userId: string; round: number; viaCirculation: boolean }[], round: number): string[] {
  return [...new Set(votes.filter((v) => v.round === round && v.viaCirculation).map((v) => v.userId))];
}

export type DecisionOutcomeCommand = 'record_approval' | 'record_recommendation' | 'record_rejection';

export interface DecisionOutcomePlan {
  /** Decision command to apply; `null` = the decision stays under review (tie escalated). */
  command: DecisionOutcomeCommand | null;
  authorityOutcome: 'within_mandate' | 'pending_external_authority' | 'not_assessed';
  escalate: boolean;
  escalateTo: string | null;
  explanation: string;
}

/**
 * Maps a server-computed tally + authority check to the decision command (AT-04, AT-05). No quorum and "no
 * approve/reject votes" are rule violations; a passing vote outside the mandate becomes a recommendation.
 */
export function planDecisionOutcome(input: { tally: TallyResult; authority: AuthorityCheckResult; quorum: QuorumResult }): DecisionOutcomePlan {
  const { tally, authority } = input;
  switch (tally.outcome) {
    case 'no_quorum':
      throw ruleViolation('governance.outcome.no_quorum', input.quorum.explanation, { quorum: input.quorum });
    case 'insufficient_votes':
      throw ruleViolation('governance.outcome.insufficient_votes', 'No approve or reject votes were cast in the current round', { tally });
    case 'approve':
      if (authority.outcome === 'within_mandate') {
        return { command: 'record_approval', authorityOutcome: 'within_mandate', escalate: false, escalateTo: null, explanation: `${tally.explanation} ${authority.reason}` };
      }
      return {
        command: 'record_recommendation',
        authorityOutcome: 'pending_external_authority',
        escalate: true,
        escalateTo: authority.escalateTo,
        explanation: `${tally.explanation} Recommended — pending external authority: ${authority.reason}`,
      };
    case 'reject':
      return { command: 'record_rejection', authorityOutcome: authority.outcome, escalate: false, escalateTo: null, explanation: tally.explanation };
    case 'tie_escalate':
      return {
        command: null,
        authorityOutcome: 'not_assessed',
        escalate: true,
        escalateTo: authority.escalateTo ?? 'Delegating authority — to be confirmed',
        explanation: tally.explanation,
      };
  }
}

/** Votes are evaluated against the matrix version in force when they were cast; a changed matrix requires a new round. */
export function assertVotesUnderMatrix(votes: { authorityMatrixVersionId: string | null }[], matrixVersionId: string): void {
  if (votes.some((v) => v.authorityMatrixVersionId !== matrixVersionId)) {
    throw ruleViolation(
      'governance.outcome.matrix_changed',
      'The authority matrix changed after votes were cast — defer and resume the decision to open a new voting round',
    );
  }
}

export interface ActionSnapshot {
  status: ActionItemStatus;
  ownerUserId: string | null;
  dueDate: string | null;
}

/** Overdue = still open/in progress and the due date (project-timezone business date) is before today. */
export function isActionOverdue(a: { status: ActionItemStatus; dueDate: string | null }, today: string): boolean {
  return (a.status === 'open' || a.status === 'in_progress') && !!a.dueDate && a.dueDate < today;
}

/** Transition 10: implementation tracking needs at least one live action with one accountable owner and a due date. */
export function assertImplementationStartable(actions: ActionSnapshot[]): void {
  const live = actions.filter((a) => a.status !== 'cancelled');
  if (!live.some((a) => a.ownerUserId && a.dueDate)) {
    throw ruleViolation('governance.implementation.no_actions', 'Implementation tracking requires at least one action with an owner and a due date');
  }
}

/**
 * Transition 11 (approval ≠ implementation): every live linked action is verified closed with evidence, at least one
 * exists, the verifier supplies an evidence note and owns none of the actions.
 */
export function assertImplementationVerifiable(input: { actions: ActionSnapshot[]; verifierUserId: string; evidenceNote: string | null | undefined }): void {
  if (!input.evidenceNote?.trim()) {
    throw ruleViolation('governance.implementation.evidence_required', 'An implementation evidence note is required to verify implementation');
  }
  const live = input.actions.filter((a) => a.status !== 'cancelled');
  if (live.length === 0) throw ruleViolation('governance.implementation.no_actions', 'No implementation actions are linked to this decision');
  const open = live.filter((a) => a.status !== 'verified_closed');
  if (open.length > 0) {
    throw ruleViolation('governance.implementation.actions_open', `${open.length} linked action(s) are not verified closed`, { openActions: open.length });
  }
  if (live.some((a) => a.ownerUserId === input.verifierUserId)) {
    throw ruleViolation('governance.implementation.verifier_is_owner', 'An owner of the implementation actions cannot verify the implementation');
  }
}

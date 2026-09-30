import Decimal from 'decimal.js';
import { forbidden, ruleViolation } from './errors';
import { decisionRelianceIssue, type DecisionSubject, type DecisionUseRecord, type ExternalEvidenceState } from './decision-reliance';
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
  /**
   * Appointed voting members on the date: active voting seats held by a named person. Vacant seats ("Role — To be
   * confirmed") are not appointed and are not counted. This is the denominator of `minFractionPresent`
   * (authority-matrix.md §2.1 and §3 step 4; committee-charter-draft.md §10).
   */
  appointedVoting?: number;
  /** Appointed voting members who may count toward quorum for THIS item (appointed − recused − requester). */
  eligibleVoting: number;
  /** Eligible members recorded present (for a circulation: eligible members who responded). */
  presentVoting: number;
  required: number;
  met: boolean;
  explanation: string;
}

/**
 * Quorum per agenda item (authority-matrix.md §3 step 4): the eligible members present — voting members present, minus
 * members recused from the item, minus the requester when self-approval is prohibited — must be at least
 * `minVotingMembersPresent` AND at least `minFractionPresent` of the APPOINTED voting members (DOM-P2-13: the fraction is
 * taken over all appointed voting members, not over the members left after recusals, so recusals never lower the bar).
 */
export function computeQuorum(input: QuorumInput): QuorumResult {
  const { policy } = input;
  const recused = new Set(input.recusedUserIds);
  // Members barred from voting on this decision (recused, or the requester when self-approval is prohibited)
  // cannot make up the quorum for it.
  if (policy.selfApprovalProhibited && input.requesterUserId) recused.add(input.requesterUserId);
  const present = new Set(input.presentUserIds);
  const appointed = input.members.filter((m) => m.voting && m.userId && isMemberActiveOn(m, input.onDate));
  const eligible = policy.recusedMembersExcludedFromQuorum ? appointed.filter((m) => !recused.has(m.userId!)) : appointed;
  const presentVoting = eligible.filter((m) => present.has(m.userId!)).length;
  const byFraction = Math.ceil(appointed.length * policy.quorum.minFractionPresent - 1e-9);
  const required = Math.max(policy.quorum.minVotingMembersPresent, byFraction);
  const met = eligible.length > 0 && presentVoting >= required;
  const basis = `required ${required}: at least ${policy.quorum.minVotingMembersPresent} and ${policy.quorum.minFractionPresent * 100}% of ${appointed.length} appointed voting members`;
  return {
    appointedVoting: appointed.length,
    eligibleVoting: eligible.length,
    presentVoting,
    required,
    met,
    explanation: met
      ? `Quorum met: ${presentVoting} of ${eligible.length} eligible voting members present (${basis}).`
      : `Quorum NOT met: ${presentVoting} of ${eligible.length} eligible voting members present (${basis}).`,
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
  /**
   * The ELIGIBLE votes of the current round only: votes of members who are recused or who requested the item must not
   * be passed (the API refuses to record an outcome when such a vote exists — see `assertTallyIntegrity`).
   */
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
  /** Eligible votes cast (approve + reject + abstain): the threshold denominator (authority-matrix.md §3 step 5). */
  eligibleVotes?: number;
  explanation: string;
}

/**
 * Vote tally — the DOCUMENTED rule of this build (authority-matrix.md §3 steps 5–6; committee-charter-draft.md §11–12;
 * DOM-P2-02, DOM-P2-13). The rule awaits confirmation by Mobily's governance owner (docs/assumptions-and-open-questions.md
 * A-40 / Q-40; casting vote A-41 / Q-41):
 *  - eligible votes = approve + reject + abstain votes cast in the round by eligible members (members present who do not
 *    vote are not counted); ABSTENTIONS COUNT AS NOT APPROVING;
 *  - `simple_majority`: approved when approve > half of the eligible votes (approve × 2 > eligible votes);
 *  - `two_thirds`: approved when approve × 3 ≥ eligible votes × 2;
 *  - tie (simple majority only): approve votes equal non-approve (reject + abstain) votes. `chair_casting_vote` → the side
 *    the chair voted for in the round prevails, only when the chair cast an eligible, non-abstaining vote (the chair has no
 *    second vote); otherwise, and under `escalate`, the item is recorded as tied and escalated — no approval;
 *  - no approve and no reject vote at all (nothing cast, or abstentions only) → no outcome can be recorded.
 */
export function tallyVotes(input: TallyInput): TallyResult {
  const approve = input.votes.filter((v) => v.choice === 'approve').length;
  const reject = input.votes.filter((v) => v.choice === 'reject').length;
  const abstain = input.votes.filter((v) => v.choice === 'abstain').length;
  const eligibleVotes = approve + reject + abstain;
  const nonApprove = reject + abstain;
  const base = { approve, reject, abstain, eligibleVotes };
  if (!input.quorumMet) return { ...base, outcome: 'no_quorum', explanation: 'Quorum not met — no valid outcome can be recorded.' };
  if (approve + reject === 0) {
    return { ...base, outcome: 'insufficient_votes', explanation: abstain > 0 ? `No approve or reject votes cast (${abstain} abstention(s) only).` : 'No votes cast in this round.' };
  }
  const counts = `${approve} approve, ${reject} reject, ${abstain} abstain of ${eligibleVotes} eligible votes; abstentions count as not approving`;
  if (input.policy.approvalThreshold.type === 'two_thirds') {
    if (approve * 3 >= eligibleVotes * 2) return { ...base, outcome: 'approve', explanation: `Two-thirds threshold reached (${counts}).` };
    return { ...base, outcome: 'reject', explanation: `Two-thirds threshold not reached (${counts}).` };
  }
  if (approve * 2 > eligibleVotes) return { ...base, outcome: 'approve', explanation: `Simple majority of eligible votes (${counts}).` };
  if (approve * 2 < eligibleVotes) return { ...base, outcome: 'reject', explanation: `No majority of eligible votes (${counts}).` };
  // Tie: approve === non-approve.
  if (input.policy.tieRule === 'chair_casting_vote' && input.chairUserId) {
    const chairVote = input.votes.find((v) => v.userId === input.chairUserId);
    if (chairVote && chairVote.choice !== 'abstain') {
      return {
        ...base,
        outcome: chairVote.choice === 'approve' ? 'approve' : 'reject',
        explanation: `Tie (${approve} approve to ${nonApprove} not approving) resolved by the chair's casting vote: the side the chair voted for (${chairVote.choice}) prevails (${counts}).`,
      };
    }
    return { ...base, outcome: 'tie_escalate', explanation: `Tie (${approve} approve to ${nonApprove} not approving); the chair did not cast an eligible approve/reject vote — escalated (${counts}).` };
  }
  return { ...base, outcome: 'tie_escalate', explanation: `Tie (${approve} approve to ${nonApprove} not approving) — escalated per policy (${counts}).` };
}

/**
 * Tally integrity (DOM-P2-06): votes are immutable and every vote cast in the current round must count. A vote of a member
 * who is recused from the item (or of its requester) in the current round means the round's votes and the eligibility
 * records disagree — the outcome is refused; the round has to be restarted (defer → resume) instead of silently dropping
 * a cast vote.
 */
export function assertTallyIntegrity(input: {
  votes: { userId: string }[];
  recusedUserIds: string[];
  requesterUserId: string | null;
  round: number;
  /** Meeting votes only (DOM-P2-20): members recorded present. Omit for a circulation (responders are the attendance). */
  presentUserIds?: string[];
}): void {
  const recused = new Set(input.recusedUserIds);
  const bad = input.votes.filter((v) => recused.has(v.userId) || (input.requesterUserId !== null && v.userId === input.requesterUserId));
  if (bad.length > 0) {
    throw ruleViolation(
      'governance.outcome.vote_integrity',
      `${bad.length} vote(s) of round ${input.round} were cast by members who are recused from the item or requested it — cast votes are never discarded; defer and resume the decision to open a new voting round`,
      { round: input.round, votes: bad.length },
    );
  }
  if (input.presentUserIds) {
    const present = new Set(input.presentUserIds);
    const absent = input.votes.filter((v) => !present.has(v.userId));
    if (absent.length > 0) {
      throw ruleViolation(
        'governance.outcome.vote_integrity',
        `${absent.length} vote(s) of round ${input.round} were cast by members no longer recorded present — the attendance behind the votes changed; defer and resume the decision to open a new voting round`,
        { round: input.round, votes: absent.length },
      );
    }
  }
}

/**
 * Recusal guard (DOM-P2-06, committee-charter-draft.md §14): a recusal can no longer be recorded for a member who has
 * already voted in the current round (it would silently discard a cast vote and change the outcome); the conflict must be
 * handled by opening a new round (defer → resume) before the member votes again. A recusal recorded on behalf of another
 * member needs a reason (it is audited with the recorder).
 */
export function assertRecusalAllowed(input: { targetUserId: string; recordedByUserId: string; reason: string | null | undefined; votedInCurrentRound: boolean; round: number }): void {
  if (input.votedInCurrentRound) {
    throw ruleViolation(
      'governance.recusal.after_vote',
      `The member has already voted in round ${input.round}; a recusal recorded now would discard a cast vote. Defer and resume the decision to open a new voting round, then record the recusal before the member votes`,
      { round: input.round },
    );
  }
  if (input.targetUserId !== input.recordedByUserId && !input.reason?.trim()) {
    throw ruleViolation('governance.recusal.reason_required', 'A recusal recorded on behalf of another member requires a reason');
  }
}

/**
 * Attendance freeze (DOM-P2-20): once votes have been cast in the current round of a decision tabled at the meeting (and
 * its outcome is not yet recorded), attendance — the basis of that decision's quorum — can no longer change. Record the
 * outcome first, or restart the voting round (defer → resume) to correct attendance.
 */
export function assertAttendanceChangeable(openVoting: { code: string; round: number }[]): void {
  if (openVoting.length > 0) {
    throw ruleViolation(
      'governance.attendance.frozen_voting_open',
      `Attendance is frozen while voting is open on ${openVoting.map((d) => `${d.code} (round ${d.round})`).join(', ')} — record the outcome, or defer and resume the decision to open a new round, before changing attendance`,
      { decisions: openVoting },
    );
  }
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

// =============================================================================================================
// Delegated authority for individual approvals of change control (DOM-P2-03; authority-matrix.md §3, §4.2, §5)
// =============================================================================================================

/** Authority-matrix decision types that govern change control (authority-matrix.md §4.2). */
export const CHANGE_CONTROL_DECISION_TYPES = { baseline: 'baseline_approval', changeRequest: 'change_request_budget' } as const;

/** Decision states that are FINAL approvals (within the committee mandate, or recorded from the external authority). */
export const FINAL_APPROVED_DECISION_STATES = ['approved', 'implementation_pending', 'implemented_verified'] as const;

export type ApprovalAmount =
  /** The monetary impact, in decimal string + ISO 4217 currency + unit scale. */
  | { kind: 'amount'; money: { amount: string; currency: string; unitScale: number } }
  /** No monetary impact (explicitly none recorded). */
  | { kind: 'none' }
  /** A monetary impact exists but is not quantified (free text only) or cannot be compared (mixed currencies/units). */
  | { kind: 'unquantified'; reason: string };

export interface GoverningMatrix {
  policy: AuthorityPolicy;
  /** `approved_matrix`: the approved, in-force matrix of the project's steering committee; `demo_sandbox_policy`: the
   * labelled DEMO policy, used only in a demo project that has no approved matrix. */
  source: 'approved_matrix' | 'demo_sandbox_policy';
  matrixVersionId: string | null;
  committeeId: string | null;
}

export interface LinkedDecisionSnapshot {
  id: string;
  code: string;
  status: string;
  authorityOutcome: 'within_mandate' | 'pending_external_authority' | 'not_assessed';
  decisionTypeKey: string | null;
  amount: { amount: string; currency: string; unitScale: number } | null;
  externalAuthorityReference: string | null;
  /** The record the decision authorizes (DOM-P2R-03); null = raised for no specific record. */
  subjectType: string | null;
  subjectId: string | null;
  /** The evidence link of the external approval as it is now (DOM-P2R-04); null when none is recorded. */
  externalEvidence: ExternalEvidenceState | null;
}

export interface DelegatedApprovalInput {
  decisionTypeKey: string;
  /** Null when no usable matrix exists (and the project is not a demo project). */
  matrix: GoverningMatrix | null;
  /** Why no matrix is usable (shown in the refusal). */
  matrixUnusableReason?: string;
  amount: ApprovalAmount;
  /**
   * DOM-P2R-02: the structured amount was recorded or confirmed by an assessor who is NOT the requester (a baseline's
   * frozen, approved budget lines are always confirmed). A requester-stated amount may refuse an approval (above a limit)
   * but never make it pass.
   */
  amountConfirmed: boolean;
  /** The record being approved (DOM-P2R-03): a linked decision must have been raised for exactly this record. */
  subject: DecisionSubject;
  /** A governance decision offered as the basis of the approval (already loaded inside the project). */
  decision: LinkedDecisionSnapshot | null;
  /**
   * Registered uses of that decision (`decision_use` rows, read under the decision row lock — DOM-P2R-05, QA-P2-01). One
   * decision backs one record of each kind. Omitted = none registered.
   */
  decisionUses?: readonly DecisionUseRecord[];
}

export interface DelegatedApprovalResult {
  withinAuthority: boolean;
  /** `delegated_authority`: within the matrix limits for the decision type; `governance_decision`: backed by a final
   * decision of the matching type that covers the amount. */
  basis: 'delegated_authority' | 'governance_decision' | null;
  /** Refusal code when not within authority (HTTP 422). */
  code: string | null;
  reason: string;
  decisionTypeKey: string;
  escalateTo: string | null;
  matrixSource: GoverningMatrix['source'] | null;
  matrixVersionId: string | null;
  decisionId: string | null;
}

const moneyGte = (a: { amount: string; unitScale: number }, b: { amount: string; unitScale: number }) =>
  new Decimal(a.amount).mul(a.unitScale).gte(new Decimal(b.amount).mul(b.unitScale));

/**
 * Evaluates whether an individual approval of a baseline or change request is within delegated authority (DOM-P2-03).
 *
 * 1. With a linked governance decision, in this order: the decision must be FINAL (approved within the committee mandate,
 *    or approved by the external authority and recorded) and — for an external approval — its evidence must STILL be an
 *    active, verified evidence link (DOM-P2R-04); of the matching decision type; raised for THIS record (its subject —
 *    DOM-P2R-03); and — when the change has a monetary impact — carry an amount in the same currency that covers it. It is
 *    then the basis of the approval (the out-of-authority route: the committee decides or recommends, the authorized body
 *    approves).
 * 2. Without a decision: an approved, in-force authority matrix is required (outside the demo sandbox); the decision type
 *    must be within the committee's delegation and the monetary impact within `maxAmount` (same currency; decimal
 *    arithmetic). An unquantified monetary impact is never assumed to be within a limit.
 * 3. Last (DOM-P2R-02): an approval that would pass on a structured amount stated by the requester alone is refused until
 *    an assessor other than the requester records or confirms it (`change_control.amount_unconfirmed`).
 * The caller passes `withinAuthority` explicitly to the policy check and refuses (422, audited) with `code` otherwise.
 */
export function evaluateDelegatedApproval(input: DelegatedApprovalInput): DelegatedApprovalResult {
  const base = {
    decisionTypeKey: input.decisionTypeKey,
    matrixSource: input.matrix?.source ?? null,
    matrixVersionId: input.matrix?.matrixVersionId ?? null,
  };
  const refuse = (code: string, reason: string, escalateTo: string | null = null, decisionId: string | null = null): DelegatedApprovalResult => ({
    ...base,
    withinAuthority: false,
    basis: null,
    code,
    reason,
    escalateTo,
    decisionId,
  });
  const unconfirmed = (decisionId: string | null): DelegatedApprovalResult | null =>
    input.amount.kind === 'amount' && !input.amountConfirmed
      ? refuse(
          'change_control.amount_unconfirmed',
          'The cost impact that decides this approval was stated by the requester only — an assessor other than the requester must record or confirm it through the impact assessment before approval',
          null,
          decisionId,
        )
      : null;
  const d = input.decision;
  if (d) {
    // The generic reliance check (decision-reliance.ts): final → external evidence still standing → type → raised for this
    // record → not used for another record of the same kind.
    const reliance = decisionRelianceIssue({
      decision: d,
      use: { kind: input.subject.type, subjectType: input.subject.type, subjectId: input.subject.id },
      uses: input.decisionUses ?? [],
      subjectRule: 'required',
      decisionTypeKeys: [input.decisionTypeKey],
      codePrefix: 'change_control',
    });
    if (reliance) return refuse(reliance.code, reliance.reason, null, d.id);
    if (input.amount.kind === 'unquantified') {
      return refuse('change_control.amount_unquantified', `${input.amount.reason} — record the monetary impact as an amount with currency and unit (0 when none) before approval`, null, d.id);
    }
    if (input.amount.kind === 'amount' && Number(input.amount.money.amount) !== 0) {
      const m = input.amount.money;
      if (!d.amount) return refuse('change_control.decision_amount_missing', `Decision ${d.code} carries no amount; it cannot cover a monetary impact of ${m.amount} ${m.currency} (unit ${m.unitScale})`, null, d.id);
      if (d.amount.currency !== m.currency) {
        return refuse('change_control.decision_amount_currency', `Decision ${d.code} is in ${d.amount.currency}; the change is in ${m.currency} — no conversion basis is applied`, null, d.id);
      }
      if (!moneyGte(d.amount, m)) {
        return refuse('change_control.decision_amount_insufficient', `Decision ${d.code} covers ${d.amount.amount} ${d.amount.currency} (unit ${d.amount.unitScale}); the change is ${m.amount} ${m.currency} (unit ${m.unitScale})`, null, d.id);
      }
    }
    return unconfirmed(d.id) ?? { ...base, withinAuthority: true, basis: 'governance_decision', code: null, reason: `Backed by the final governance decision ${d.code}.`, escalateTo: null, decisionId: d.id };
  }
  if (!input.matrix) {
    return refuse(
      'change_control.no_usable_matrix',
      `${input.matrixUnusableReason ?? 'No approved authority matrix is in force for this project'} — approval authority is not active (spec §4.1); approve through a final governance decision once a matrix is approved`,
    );
  }
  const t = input.matrix.policy.decisionTypes.find((x) => x.key === input.decisionTypeKey);
  if (input.amount.kind === 'unquantified' && t && t.withinCommitteeAuthority && t.maxAmount !== null) {
    return refuse('change_control.amount_unquantified', `${input.amount.reason} — the delegated limit for "${t.key}" cannot be checked; record the monetary impact as an amount with currency and unit (0 when none), or link a final governance decision`, t.escalateTo);
  }
  const amount =
    input.amount.kind === 'amount'
      ? input.amount.money
      : // No monetary impact (or an unquantified one where no limit applies): zero in the limit's own currency and unit.
        t
        ? { amount: '0', currency: t.currency, unitScale: t.unitScale }
        : null;
  const a = checkAuthority({ policy: input.matrix.policy, decisionTypeKey: input.decisionTypeKey, amount });
  if (a.outcome !== 'within_mandate') {
    return refuse(
      'change_control.outside_delegated_authority',
      `${a.reason} Outside delegated authority — route it to a committee decision of type "${input.decisionTypeKey}" (escalated to ${a.escalateTo ?? 'the authorized body'} when above the committee's limit) and approve with that final decision`,
      a.escalateTo,
    );
  }
  return (
    unconfirmed(null) ?? {
      ...base,
      withinAuthority: true,
      basis: 'delegated_authority',
      code: null,
      reason: `${a.reason} (${input.matrix.source === 'demo_sandbox_policy' ? 'DEMO sandbox policy — synthetic, not a real delegation' : 'approved authority matrix in force'}).`,
      escalateTo: null,
      decisionId: null,
    }
  );
}

/**
 * Monetary impact of a baseline for the `baseline_approval` limit: the total of the approved budget lines frozen in the
 * snapshot. Lines in different currencies or unit scales are not added up without a conversion basis (AT-29) — the total
 * is then "unquantified" and cannot be compared with a limit.
 */
export function baselineBudgetAmount(lines: { approvedAmount: string | null; currency: string; unitScale: number }[]): ApprovalAmount {
  const withAmount = lines.filter((l) => l.approvedAmount !== null && l.approvedAmount !== undefined);
  if (withAmount.length === 0) return { kind: 'none' };
  const cur = new Set(withAmount.map((l) => l.currency));
  const scales = new Set(withAmount.map((l) => l.unitScale));
  if (cur.size > 1 || scales.size > 1) return { kind: 'unquantified', reason: 'The baseline budget spans several currencies or unit scales and has no conversion basis' };
  const total = withAmount.reduce((s, l) => s.add(new Decimal(l.approvedAmount!)), new Decimal(0));
  return { kind: 'amount', money: { amount: total.toFixed(4), currency: withAmount[0]!.currency, unitScale: withAmount[0]!.unitScale } };
}

/**
 * Authority-matrix approval (DOM-P2-12, authority-matrix.md §1.2): loading a real (non-demo) matrix requires the approval
 * record as a document of the documents module, and the matrix comes into force only after a second person — not its
 * drafter, not its approver, not the uploader of the document — verifies the approval evidence. The DEMO policy (demo
 * projects only) is synthetic by definition: it has no approving authority to evidence and takes effect on approval.
 */
export function matrixApprovalPlan(input: { isDemoPolicy: boolean; approvalDocumentId: string | null | undefined }): { requiresVerification: boolean } {
  if (input.isDemoPolicy) return { requiresVerification: false };
  if (!input.approvalDocumentId) {
    throw ruleViolation(
      'governance.authority_matrix.evidence_required',
      'Approving a (non-demo) authority matrix requires the approval record as a document (approved delegation / board resolution) — upload it in the documents module and pass approvalDocumentId',
    );
  }
  return { requiresVerification: true };
}

/**
 * Evidence of an external authority's decision (DOM-P2-12, authority-matrix.md §1.2, decision-workflow.md transition 9):
 * an ACTIVE evidence link on the decision itself that a second person verified (documents module verification), and the
 * verifier is not the person recording the external decision.
 */
export function assertExternalApprovalEvidence(input: {
  decisionId: string;
  recorderUserId: string;
  link: { targetType: string; targetId: string; status: string; reviewedBy: string | null } | null;
}): void {
  const l = input.link;
  if (!l) {
    throw ruleViolation('governance.external.evidence_required', 'Recording an external authority decision requires a verified evidence link on the decision (e.g. the board resolution) — link it in the documents module and have a second person verify it');
  }
  if (l.targetType !== 'decision' || l.targetId !== input.decisionId) {
    throw ruleViolation('governance.external.evidence_other_target', 'The evidence link belongs to another record');
  }
  if (l.status !== 'active') throw ruleViolation('governance.external.evidence_not_active', `The evidence link is ${l.status}`);
  if (!l.reviewedBy) {
    throw ruleViolation('governance.external.evidence_unverified', 'The evidence link has not been verified — a second person must verify it (documents module) before the external decision is recorded');
  }
}

/**
 * Decision paper completeness (spec §4.2) before submission. Returns missing field names. Impacts must state the
 * financial, operational AND schedule impact (use "None identified" explicitly rather than leaving one out).
 * DOM-P2-14 (REQ-GOV-014, decision-workflow.md §2 "evidence; attachments"): the paper carries at least one active evidence
 * link or attachment (documents module, target = the decision), or an explicit "none — reason" entry
 * (`evidenceNoneReason`); otherwise `supportingEvidence` is missing.
 */
export function missingDecisionPaperFields(
  paper: {
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
    evidenceNoneReason?: string | null;
  },
  supporting: { activeEvidenceLinks: number },
): string[] {
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
  if (supporting.activeEvidenceLinks <= 0 && !txt(paper.evidenceNoneReason)) missing.push('supportingEvidence');
  return missing;
}

// =============================================================================================================
// Voting closure (DOM-P2R-01) and conflict-of-interest declarations before voting (REQ-GOV-015, F-01)
// PROPOSED default of this build, pending the governance owner's confirmation (Q-40): documented in
// docs/governance/authority-matrix.md §3 step 5 and decision-workflow.md §5.
// =============================================================================================================

/**
 * Members who still have a vote to cast in the round: the eligible voting members expected to vote — for a meeting, the
 * appointed voting members recorded present; for a circulation, every appointed voting member (the circulation is sent to
 * all of them) — minus members recused from the item and the requester (self-approval prohibited), minus those who voted.
 */
export function outstandingVoters(input: {
  members: MemberSnapshot[];
  onDate: string;
  /** Meeting: user ids recorded present. Circulation: omit (every appointed voting member is expected to respond). */
  presentUserIds: string[] | null;
  recusedUserIds: string[];
  requesterUserId: string | null;
  selfApprovalProhibited: boolean;
  votedUserIds: string[];
}): string[] {
  const excluded = new Set(input.recusedUserIds);
  if (input.selfApprovalProhibited && input.requesterUserId) excluded.add(input.requesterUserId);
  const present = input.presentUserIds ? new Set(input.presentUserIds) : null;
  const voted = new Set(input.votedUserIds);
  const expected = input.members.filter((m) => m.voting && m.userId && isMemberActiveOn(m, input.onDate) && !excluded.has(m.userId) && (!present || present.has(m.userId)));
  return [...new Set(expected.map((m) => m.userId!).filter((u) => !voted.has(u)))];
}

/**
 * DOM-P2R-01: an outcome is recorded only when the vote is complete — every eligible member expected to vote has voted
 * (approve, reject or abstain), or the chair closed voting for the round with a reason (a circulation also completes when
 * its response deadline has passed). Members who did not vote when voting closed are listed in the tally snapshot and are
 * not counted (abstention handling unchanged: authority-matrix.md §3 step 5).
 */
export function assertVotingComplete(input: { outstanding: string[]; closedByChair: boolean; circulationDeadlinePassed?: boolean; round: number }): void {
  if (input.outstanding.length === 0 || input.closedByChair || input.circulationDeadlinePassed) return;
  throw ruleViolation(
    'governance.outcome.votes_outstanding',
    `${input.outstanding.length} eligible member(s) have not voted in round ${input.round} — wait for their votes, or the chair closes voting with a reason before the outcome is recorded`,
    { round: input.round, outstanding: input.outstanding.length },
  );
}

/**
 * DOM-P2R-01: the chair of the decision's committee (the chair seat holder on the meeting date) closes voting for the
 * current round with a reason. Role (the command's permission) → state → the actor is the chair → reason.
 */
export function assertVotingClosable(input: { status: string; actorUserId: string | null; chairUserId: string | null; closedRound: number | null; round: number; reason: string | null | undefined; tabled: boolean }): void {
  if (input.status !== 'under_review') throw ruleViolation('governance.voting.not_open', `Voting can be closed only while the decision is under review (current: ${input.status})`);
  if (!input.tabled) throw ruleViolation('governance.vote.not_tabled', 'The decision is not tabled at a meeting or circulated');
  if (input.closedRound === input.round) throw ruleViolation('governance.voting.already_closed', `Voting on round ${input.round} is already closed`, { round: input.round });
  if (!input.chairUserId) throw forbidden('governance.voting.no_chair', 'The committee has no chair appointed on the meeting date, so nobody can close voting');
  if (!input.actorUserId || input.actorUserId !== input.chairUserId) throw forbidden('governance.voting.not_chair', "Only the committee's chair closes voting");
  if (!input.reason?.trim()) throw ruleViolation('governance.voting.reason_required', 'Closing voting requires a reason (recorded in the audit trail and the tally snapshot)');
}

/** No vote is accepted in a round whose voting the chair closed. */
export function assertVotingOpen(input: { closedRound: number | null; round: number }): void {
  if (input.closedRound === input.round) {
    throw ruleViolation('governance.vote.voting_closed', `The chair closed voting on round ${input.round}; no further votes are accepted in this round`, { round: input.round });
  }
}

/** Declarations that allow a member to vote on an item: no conflict, or an interest declared (the chair may rule a recusal). */
export const VOTING_DECLARATIONS: readonly string[] = ['no_conflict', 'interest_declared'];

/**
 * REQ-GOV-015 (committee-charter-draft.md §14): before voting on an item, the member has declared — in their OWN name — either
 * "no conflict" or an interest in the item. A conflict leads to recusal (recused members cannot vote). A declaration
 * recorded by someone else on the member's behalf does not count here.
 */
export function assertConflictDeclared(input: { voterUserId: string; declarations: { userId: string; recordedBy: string | null; declaration: string }[] }): void {
  const own = input.declarations.filter((x) => x.userId === input.voterUserId && x.recordedBy === input.voterUserId && VOTING_DECLARATIONS.includes(x.declaration));
  if (own.length === 0) {
    throw ruleViolation(
      'governance.vote.declaration_required',
      'Declare your conflict of interest for this item before voting: "no conflict", or declare the conflict and recuse yourself',
    );
  }
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

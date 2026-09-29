import { describe, it, expect } from 'vitest';
import { computeQuorum, assertMayVote, tallyVotes, checkAuthority, missingDecisionPaperFields, AuthorityPolicy, MemberSnapshot } from './governance';
import { transition, DECISION_MACHINE, allowedCommands } from './workflows';

const policy: AuthorityPolicy = {
  isDemoPolicy: true,
  quorum: { minVotingMembersPresent: 3, minFractionPresent: 0.5 },
  approvalThreshold: { type: 'simple_majority' },
  tieRule: 'chair_casting_vote',
  decisionTypes: [
    { key: 'budget_reallocation', maxAmount: '5000000', currency: 'SAR', unitScale: 1, withinCommitteeAuthority: true, escalateTo: 'Board — to be confirmed' },
    { key: 'jv_signing', maxAmount: null, currency: 'SAR', unitScale: 1, withinCommitteeAuthority: false, escalateTo: 'Board of Directors — to be confirmed' },
    { key: 'gate_approval', maxAmount: null, currency: 'SAR', unitScale: 1, withinCommitteeAuthority: true, escalateTo: 'n/a' },
  ],
  selfApprovalProhibited: true,
  recusedMembersExcludedFromQuorum: true,
};

const m = (id: string, voting = true, role: MemberSnapshot['role'] = 'voting_member', validTo: string | null = null): MemberSnapshot => ({
  membershipId: `ms-${id}`,
  userId: id,
  role,
  voting,
  validFrom: '2026-01-01',
  validTo,
});
const members = [m('chair', true, 'chair'), m('u1'), m('u2'), m('u3'), m('u4'), m('adv', false, 'advisory_member'), m('old', true, 'voting_member', '2026-06-30')];

describe('quorum', () => {
  it('counts only active voting members and excludes recused members', () => {
    const q = computeQuorum({ members, presentUserIds: ['chair', 'u1', 'adv', 'old'], recusedUserIds: [], onDate: '2026-09-29', policy });
    expect(q.eligibleVoting).toBe(5);
    expect(q.presentVoting).toBe(2);
    expect(q.required).toBe(3);
    expect(q.met).toBe(false);
  });

  it('meets quorum with enough present voting members', () => {
    const q = computeQuorum({ members, presentUserIds: ['chair', 'u1', 'u2'], recusedUserIds: ['u4'], onDate: '2026-09-29', policy });
    expect(q.eligibleVoting).toBe(4);
    expect(q.met).toBe(true);
  });
});

describe('AT-05 — vote eligibility rules (server-side)', () => {
  const base = { members, recusedUserIds: ['u2'], requesterUserId: 'u3', onDate: '2026-09-29', policy };
  it('rejects a recused member', () => expect(() => assertMayVote({ ...base, voterUserId: 'u2' })).toThrow(/recused/));
  it('rejects self-approval by the requester', () => expect(() => assertMayVote({ ...base, voterUserId: 'u3' })).toThrow(/self-approval/));
  it('rejects advisory members', () => expect(() => assertMayVote({ ...base, voterUserId: 'adv' })).toThrow(/Advisory/));
  it('rejects members whose term expired', () => expect(() => assertMayVote({ ...base, voterUserId: 'old' })).toThrow(/active committee members/));
  it('accepts an eligible voting member', () => expect(assertMayVote({ ...base, voterUserId: 'u1' }).userId).toBe('u1'));
});

describe('tally', () => {
  it('yields no outcome without quorum', () => {
    expect(tallyVotes({ votes: [{ userId: 'u1', choice: 'approve' }], chairUserId: 'chair', quorumMet: false, policy }).outcome).toBe('no_quorum');
  });
  it('resolves ties with the chair casting vote when configured', () => {
    const votes = [
      { userId: 'chair', choice: 'approve' as const },
      { userId: 'u1', choice: 'reject' as const },
    ];
    expect(tallyVotes({ votes, chairUserId: 'chair', quorumMet: true, policy }).outcome).toBe('approve');
    expect(tallyVotes({ votes, chairUserId: 'chair', quorumMet: true, policy: { ...policy, tieRule: 'escalate' } }).outcome).toBe('tie_escalate');
  });
  it('supports two-thirds thresholds', () => {
    const votes = [
      { userId: 'a', choice: 'approve' as const },
      { userId: 'b', choice: 'approve' as const },
      { userId: 'c', choice: 'reject' as const },
    ];
    expect(tallyVotes({ votes, chairUserId: null, quorumMet: true, policy: { ...policy, approvalThreshold: { type: 'two_thirds' } } }).outcome).toBe('approve');
  });
});

describe('AT-04 — decisions outside delegated authority', () => {
  it('reserved decision types are pending external authority', () => {
    const r = checkAuthority({ policy, decisionTypeKey: 'jv_signing', amount: null });
    expect(r.outcome).toBe('pending_external_authority');
    expect(r.escalateTo).toMatch(/Board/);
  });
  it('amounts above the delegated limit are pending external authority', () => {
    expect(checkAuthority({ policy, decisionTypeKey: 'budget_reallocation', amount: { amount: '6000000', currency: 'SAR', unitScale: 1 } }).outcome).toBe(
      'pending_external_authority',
    );
    expect(checkAuthority({ policy, decisionTypeKey: 'budget_reallocation', amount: { amount: '6', currency: 'SAR', unitScale: 1_000_000 } }).outcome).toBe(
      'pending_external_authority',
    );
  });
  it('different currency than the limit is not silently compared', () => {
    expect(checkAuthority({ policy, decisionTypeKey: 'budget_reallocation', amount: { amount: '1', currency: 'USD', unitScale: 1 } }).outcome).toBe(
      'pending_external_authority',
    );
  });
  it('unknown decision types are outside the matrix', () => {
    expect(checkAuthority({ policy, decisionTypeKey: 'unknown', amount: null }).outcome).toBe('pending_external_authority');
  });
  it('within limit is within mandate', () => {
    expect(checkAuthority({ policy, decisionTypeKey: 'budget_reallocation', amount: { amount: '4000', currency: 'SAR', unitScale: 1000 } }).outcome).toBe('within_mandate');
  });
});

describe('decision lifecycle — approval ≠ implementation', () => {
  it('approved decisions do not become implemented automatically', () => {
    expect(allowedCommands(DECISION_MACHINE, 'approved')).not.toContain('verify_implementation');
    expect(() => transition('decision', DECISION_MACHINE, 'approved', 'verify_implementation')).toThrow(/Cannot verify_implementation/);
    const s1 = transition('decision', DECISION_MACHINE, 'approved', 'start_implementation');
    expect(transition('decision', DECISION_MACHINE, s1, 'verify_implementation')).toBe('implemented_verified');
  });
  it('recommended (beyond mandate) decisions can only be approved via a recorded outcome', () => {
    expect(transition('decision', DECISION_MACHINE, 'recommended', 'record_approval')).toBe('approved');
    expect(() => transition('decision', DECISION_MACHINE, 'draft', 'record_approval')).toThrow();
  });
  it('requires a complete decision paper', () => {
    expect(missingDecisionPaperFields({ issue: 'x' })).toEqual(
      expect.arrayContaining(['whyNow', 'alternatives', 'recommendation', 'impacts', 'risks', 'latestSafeDate', 'decisionTypeKey']),
    );
  });
});

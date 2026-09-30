import { describe, it, expect } from 'vitest';
import { computeQuorum, assertMayVote, tallyVotes, checkAuthority, missingDecisionPaperFields, assertApprovalAllowed, matrixUsable, AuthorityPolicy, MemberSnapshot, MatrixState } from './governance';
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

describe('QA-02 — the requester does not count toward quorum when self-approval is prohibited', () => {
  it('excludes the requester from eligible and present voting members', () => {
    const q = computeQuorum({ members, presentUserIds: ['chair', 'u1', 'u2'], recusedUserIds: [], requesterUserId: 'u2', onDate: '2026-09-29', policy });
    expect(q.eligibleVoting).toBe(4);
    expect(q.presentVoting).toBe(2);
    expect(q.met).toBe(false);
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
  it('the state machine only allows record_approval from under_review / recommended (guards are separate)', () => {
    expect(transition('decision', DECISION_MACHINE, 'recommended', 'record_approval')).toBe('approved');
    expect(() => transition('decision', DECISION_MACHINE, 'draft', 'record_approval')).toThrow();
  });
  it('requires a complete decision paper incl. all three impacts, dependencies, authority and requester', () => {
    expect(missingDecisionPaperFields({ issue: 'x', impacts: { financial: 'none' } }, { activeEvidenceLinks: 0 })).toEqual(
      expect.arrayContaining(['whyNow', 'alternatives', 'recommendation', 'impacts.operational', 'impacts.schedule', 'risks', 'dependencies', 'latestSafeDate', 'requiredAuthority', 'decisionTypeKey', 'requesterUserId', 'supportingEvidence']),
    );
    expect(missingDecisionPaperFields({ issue: 'x' }, { activeEvidenceLinks: 0 })).not.toContain('issue');
  });
});

describe('AT-04 — approval guard ties the outcome to delegated authority (P0 review D-03)', () => {
  const approved: MatrixState = { status: 'approved', isDemoPolicy: false, effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31' };
  const base = { projectIsDemo: false, onDate: '2026-09-29', recorderUserId: 'sec' };
  it('rejects approval outside the mandate', () => {
    expect(() => assertApprovalAllowed({ ...base, from: 'under_review', authorityOutcome: 'pending_external_authority', matrix: approved })).toThrow(/outside the committee/);
  });
  it('rejects approval without an approved, effective matrix', () => {
    expect(() => assertApprovalAllowed({ ...base, from: 'under_review', authorityOutcome: 'within_mandate', matrix: null })).toThrow(/not active/);
    expect(() => assertApprovalAllowed({ ...base, from: 'under_review', authorityOutcome: 'within_mandate', matrix: { ...approved, status: 'draft' } })).toThrow(/draft/);
    expect(() => assertApprovalAllowed({ ...base, from: 'under_review', authorityOutcome: 'within_mandate', matrix: { ...approved, effectiveTo: '2026-06-30' } })).toThrow(/expired/);
  });
  it('a demo policy never authorizes a non-demo project', () => {
    expect(() => assertApprovalAllowed({ ...base, from: 'under_review', authorityOutcome: 'within_mandate', matrix: { ...approved, isDemoPolicy: true } })).toThrow(/demo policy/);
    expect(() => assertApprovalAllowed({ ...base, projectIsDemo: true, from: 'under_review', authorityOutcome: 'within_mandate', matrix: { ...approved, isDemoPolicy: true } })).not.toThrow();
  });
  it('approving a recommendation needs an external reference recorded by a different person', () => {
    expect(() => assertApprovalAllowed({ ...base, from: 'recommended', authorityOutcome: 'pending_external_authority', matrix: approved })).toThrow(/external authority approval reference/);
    expect(() => assertApprovalAllowed({ ...base, from: 'recommended', authorityOutcome: 'pending_external_authority', matrix: approved, externalReference: 'BoD resolution (demo)', recommendationRecordedBy: 'sec' })).toThrow(/cannot also record/);
    expect(() => assertApprovalAllowed({ ...base, from: 'recommended', authorityOutcome: 'pending_external_authority', matrix: approved, externalReference: 'BoD resolution (demo)', recommendationRecordedBy: 'chair' })).not.toThrow();
  });
  it('matrixUsable explains why', () => {
    expect(matrixUsable(approved, '2026-09-29', false)).toEqual({ usable: true, reason: 'Approved authority matrix in force' });
  });
});

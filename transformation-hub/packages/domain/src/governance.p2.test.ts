import { describe, it, expect } from 'vitest';
import {
  AGENDA_SCREENING_MACHINE,
  MEETING_MACHINE,
  assertImplementationStartable,
  assertImplementationVerifiable,
  assertMembershipSeat,
  assertVotesUnderMatrix,
  checkAuthority,
  circulationResponders,
  computeQuorum,
  isActionOverdue,
  planDecisionOutcome,
  presentUserIds,
  tallyVotes,
  AuthorityPolicy,
  MemberSnapshot,
  QuorumResult,
} from './governance';
import { transition, allowedCommands } from './workflows';

const policy: AuthorityPolicy = {
  isDemoPolicy: true,
  quorum: { minVotingMembersPresent: 3, minFractionPresent: 0.5 },
  approvalThreshold: { type: 'simple_majority' },
  tieRule: 'escalate',
  decisionTypes: [
    { key: 'change_request_budget', maxAmount: '1000000.0000', currency: 'SAR', unitScale: 1, withinCommitteeAuthority: true, escalateTo: 'Delegating authority — to be confirmed' },
    { key: 'jv_signing_authorization', maxAmount: null, currency: 'SAR', unitScale: 1, withinCommitteeAuthority: false, escalateTo: 'Board of Directors — to be confirmed' },
  ],
  selfApprovalProhibited: true,
  recusedMembersExcludedFromQuorum: true,
};
const quorumMet: QuorumResult = { eligibleVoting: 5, presentVoting: 5, required: 3, met: true, explanation: 'met' };

describe('meeting lifecycle (REQ-GOV-013, REQ-GOV-017)', () => {
  it('follows planned → agenda_published → in_session → held → minutes_draft → minutes_approved', () => {
    let s = transition('meeting', MEETING_MACHINE, 'planned', 'publish_agenda');
    s = transition('meeting', MEETING_MACHINE, s, 'start_session');
    s = transition('meeting', MEETING_MACHINE, s, 'close_session');
    s = transition('meeting', MEETING_MACHINE, s, 'draft_minutes');
    expect(transition('meeting', MEETING_MACHINE, s, 'approve_minutes')).toBe('minutes_approved');
  });
  it('approved minutes can only change through a new draft version; a held meeting cannot be cancelled', () => {
    expect(transition('meeting', MEETING_MACHINE, 'minutes_approved', 'draft_minutes')).toBe('minutes_draft');
    expect(() => transition('meeting', MEETING_MACHINE, 'held', 'cancel')).toThrow(/Cannot cancel/);
    expect(() => transition('meeting', MEETING_MACHINE, 'planned', 'start_session')).toThrow();
    expect(allowedCommands(MEETING_MACHINE, 'in_session')).toEqual(['close_session']);
  });
});

describe('agenda screening (REQ-GOV-012)', () => {
  it('accepts, returns or defers requested items; a returned item stays returned', () => {
    expect(transition('agenda_request', AGENDA_SCREENING_MACHINE, 'requested', 'accept')).toBe('accepted');
    expect(transition('agenda_request', AGENDA_SCREENING_MACHINE, 'deferred', 'accept')).toBe('accepted');
    expect(() => transition('agenda_request', AGENDA_SCREENING_MACHINE, 'returned', 'accept')).toThrow();
    expect(() => transition('agenda_request', AGENDA_SCREENING_MACHINE, 'accepted', 'defer')).toThrow();
  });
});

describe('membership seats (REQ-GOV-005, REQ-GOV-006)', () => {
  it('only chair, sponsor and voting members may carry a vote', () => {
    expect(() => assertMembershipSeat({ memberRole: 'secretary', voting: true, validFrom: '2026-01-01' })).toThrow(/cannot carry a vote/);
    expect(() => assertMembershipSeat({ memberRole: 'advisory_member', voting: true, validFrom: '2026-01-01' })).toThrow();
    expect(() => assertMembershipSeat({ memberRole: 'guest', voting: false, validFrom: '2026-01-01' })).not.toThrow();
    expect(() => assertMembershipSeat({ memberRole: 'chair', voting: true, validFrom: '2026-01-01' })).not.toThrow();
  });
  it('rejects a term ending before it starts', () => {
    expect(() => assertMembershipSeat({ memberRole: 'voting_member', voting: true, validFrom: '2026-05-01', validTo: '2026-04-30' })).toThrow(/end date/);
  });
  it('a placeholder seat (no person) never counts toward quorum', () => {
    const members: MemberSnapshot[] = [
      { membershipId: 'p', userId: null, role: 'chair', voting: true, validFrom: '2026-01-01', validTo: null },
      { membershipId: 'a', userId: 'a', role: 'voting_member', voting: true, validFrom: '2026-01-01', validTo: null },
    ];
    expect(computeQuorum({ members, presentUserIds: ['a'], recusedUserIds: [], onDate: '2026-09-29', policy }).eligibleVoting).toBe(1);
  });
});

describe('attendance and circulation responders (REQ-GOV-015, REQ-GOV-016)', () => {
  it('present and remote count; absent, apologies and delegated do not', () => {
    expect(
      presentUserIds([
        { userId: 'a', status: 'present' },
        { userId: 'b', status: 'remote' },
        { userId: 'c', status: 'absent' },
        { userId: 'd', status: 'apologies' },
        { userId: 'e', status: 'delegated' },
        { userId: null, status: 'present' },
      ]).sort(),
    ).toEqual(['a', 'b']);
  });
  it('circulation "attendance" = distinct responders in the current round only', () => {
    const votes = [
      { userId: 'a', round: 1, viaCirculation: true },
      { userId: 'b', round: 2, viaCirculation: true },
      { userId: 'c', round: 2, viaCirculation: false },
      { userId: 'b', round: 2, viaCirculation: true },
    ];
    expect(circulationResponders(votes, 2)).toEqual(['b']);
  });
});

describe('outcome planning (AT-04, AT-05)', () => {
  const approve = tallyVotes({ votes: [{ userId: 'a', choice: 'approve' }, { userId: 'b', choice: 'approve' }, { userId: 'c', choice: 'reject' }], chairUserId: null, quorumMet: true, policy });
  it('within mandate → record_approval', () => {
    const plan = planDecisionOutcome({ tally: approve, authority: checkAuthority({ policy, decisionTypeKey: 'change_request_budget', amount: { amount: '500000', currency: 'SAR', unitScale: 1 } }), quorum: quorumMet });
    expect(plan).toMatchObject({ command: 'record_approval', authorityOutcome: 'within_mandate', escalate: false });
  });
  it('reserved matter → recommendation pending external authority, escalated to the body in the matrix', () => {
    const plan = planDecisionOutcome({ tally: approve, authority: checkAuthority({ policy, decisionTypeKey: 'jv_signing_authorization', amount: null }), quorum: quorumMet });
    expect(plan).toMatchObject({ command: 'record_recommendation', authorityOutcome: 'pending_external_authority', escalate: true, escalateTo: 'Board of Directors — to be confirmed' });
  });
  it('above the delegated limit → recommendation, never approval', () => {
    const plan = planDecisionOutcome({ tally: approve, authority: checkAuthority({ policy, decisionTypeKey: 'change_request_budget', amount: { amount: '1500000', currency: 'SAR', unitScale: 1 } }), quorum: quorumMet });
    expect(plan.command).toBe('record_recommendation');
  });
  it('no quorum and no approve/reject votes are rule violations', () => {
    const noQ = tallyVotes({ votes: [{ userId: 'a', choice: 'approve' }], chairUserId: null, quorumMet: false, policy });
    expect(() => planDecisionOutcome({ tally: noQ, authority: checkAuthority({ policy, decisionTypeKey: 'change_request_budget', amount: null }), quorum: { ...quorumMet, met: false, explanation: 'Quorum NOT met' } })).toThrow(/Quorum NOT met/);
    const abstain = tallyVotes({ votes: [{ userId: 'a', choice: 'abstain' }], chairUserId: null, quorumMet: true, policy });
    expect(() => planDecisionOutcome({ tally: abstain, authority: checkAuthority({ policy, decisionTypeKey: 'change_request_budget', amount: null }), quorum: quorumMet })).toThrow(/No approve or reject/);
  });
  it('a rejected vote is recorded as rejection; a tie under the escalate rule keeps the decision under review and escalates', () => {
    const reject = tallyVotes({ votes: [{ userId: 'a', choice: 'reject' }], chairUserId: null, quorumMet: true, policy });
    expect(planDecisionOutcome({ tally: reject, authority: checkAuthority({ policy, decisionTypeKey: 'change_request_budget', amount: null }), quorum: quorumMet }).command).toBe('record_rejection');
    const tie = tallyVotes({ votes: [{ userId: 'a', choice: 'approve' }, { userId: 'b', choice: 'reject' }], chairUserId: 'a', quorumMet: true, policy });
    expect(planDecisionOutcome({ tally: tie, authority: checkAuthority({ policy, decisionTypeKey: 'change_request_budget', amount: null }), quorum: quorumMet })).toMatchObject({ command: null, escalate: true });
  });
  it('votes cast under another matrix version require a new round', () => {
    expect(() => assertVotesUnderMatrix([{ authorityMatrixVersionId: 'm1' }, { authorityMatrixVersionId: 'm2' }], 'm2')).toThrow(/new voting round/);
    expect(() => assertVotesUnderMatrix([{ authorityMatrixVersionId: 'm2' }], 'm2')).not.toThrow();
  });
});

describe('actions and implementation (REQ-GOV-018, REQ-GOV-020)', () => {
  it('overdue only while open / in progress and past the due date', () => {
    expect(isActionOverdue({ status: 'open', dueDate: '2026-09-28' }, '2026-09-29')).toBe(true);
    expect(isActionOverdue({ status: 'open', dueDate: '2026-09-29' }, '2026-09-29')).toBe(false);
    expect(isActionOverdue({ status: 'done_pending_verification', dueDate: '2026-01-01' }, '2026-09-29')).toBe(false);
    expect(isActionOverdue({ status: 'in_progress', dueDate: null }, '2026-09-29')).toBe(false);
  });
  it('implementation tracking needs an owned, dated live action', () => {
    expect(() => assertImplementationStartable([])).toThrow(/owner and a due date/);
    expect(() => assertImplementationStartable([{ status: 'cancelled', ownerUserId: 'u', dueDate: '2026-10-01' }])).toThrow();
    expect(() => assertImplementationStartable([{ status: 'open', ownerUserId: 'u', dueDate: '2026-10-01' }])).not.toThrow();
  });
  it('verification requires evidence, all live actions verified closed, and a verifier who owns none of them', () => {
    const closed = [{ status: 'verified_closed' as const, ownerUserId: 'owner', dueDate: '2026-10-01' }, { status: 'cancelled' as const, ownerUserId: 'x', dueDate: null }];
    expect(() => assertImplementationVerifiable({ actions: closed, verifierUserId: 'v', evidenceNote: '  ' })).toThrow(/evidence note/);
    expect(() => assertImplementationVerifiable({ actions: [{ status: 'in_progress', ownerUserId: 'owner', dueDate: null }], verifierUserId: 'v', evidenceNote: 'e' })).toThrow(/not verified closed/);
    expect(() => assertImplementationVerifiable({ actions: closed, verifierUserId: 'owner', evidenceNote: 'e' })).toThrow(/owner of the implementation actions/);
    expect(() => assertImplementationVerifiable({ actions: [], verifierUserId: 'v', evidenceNote: 'e' })).toThrow(/No implementation actions/);
    expect(() => assertImplementationVerifiable({ actions: closed, verifierUserId: 'v', evidenceNote: 'Closure evidence reviewed' })).not.toThrow();
  });
});

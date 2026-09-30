import { describe, it, expect } from 'vitest';
import {
  AuthorityPolicy,
  GoverningMatrix,
  LinkedDecisionSnapshot,
  MemberSnapshot,
  assertAttendanceChangeable,
  assertExternalApprovalEvidence,
  assertRecusalAllowed,
  assertTallyIntegrity,
  baselineBudgetAmount,
  computeQuorum,
  evaluateDelegatedApproval,
  matrixApprovalPlan,
  tallyVotes,
} from './governance';

/**
 * Governance / authority fixes of the P2 domain review (docs/reviews/P2-domain-review.md): DOM-P2-02 (abstentions),
 * DOM-P2-03 (delegated authority of change control), DOM-P2-06 (recusal after voting), DOM-P2-12 (evidence of approvals),
 * DOM-P2-13 (quorum denominator, casting vote), DOM-P2-20 (attendance freeze). Synthetic values only.
 */

const policy: AuthorityPolicy = {
  isDemoPolicy: true,
  quorum: { minVotingMembersPresent: 3, minFractionPresent: 0.5 },
  approvalThreshold: { type: 'simple_majority' },
  tieRule: 'escalate',
  decisionTypes: [
    { key: 'baseline_approval', maxAmount: null, currency: 'SAR', unitScale: 1, withinCommitteeAuthority: true, escalateTo: 'Not applicable (demo)' },
    { key: 'change_request_budget', maxAmount: '1000000.0000', currency: 'SAR', unitScale: 1, withinCommitteeAuthority: true, escalateTo: 'Delegating authority — to be confirmed' },
    { key: 'jv_signing_authorization', maxAmount: null, currency: 'SAR', unitScale: 1, withinCommitteeAuthority: false, escalateTo: 'Board of Directors — to be confirmed' },
  ],
  selfApprovalProhibited: true,
  recusedMembersExcludedFromQuorum: true,
};
const v = (userId: string, choice: 'approve' | 'reject' | 'abstain') => ({ userId, choice });

describe('DOM-P2-02 — abstentions count as not approving (authority-matrix.md §3 steps 5–6)', () => {
  it('simple majority is taken over all eligible votes cast, abstentions included', () => {
    const one = tallyVotes({ votes: [v('a', 'approve'), v('b', 'abstain'), v('c', 'abstain'), v('d', 'abstain'), v('e', 'abstain')], chairUserId: null, quorumMet: true, policy });
    expect(one).toMatchObject({ outcome: 'reject', approve: 1, abstain: 4, eligibleVotes: 5 });
    expect(one.explanation).toMatch(/abstentions count as not approving/);
    const three = tallyVotes({ votes: [v('a', 'approve'), v('b', 'approve'), v('c', 'approve'), v('d', 'reject'), v('e', 'abstain')], chairUserId: null, quorumMet: true, policy });
    expect(three.outcome).toBe('approve'); // 3 > 5 / 2
  });
  it('two-thirds: approve × 3 ≥ eligible votes × 2, abstentions in the denominator', () => {
    const tt = { ...policy, approvalThreshold: { type: 'two_thirds' as const } };
    expect(tallyVotes({ votes: [v('a', 'approve'), v('b', 'approve'), v('c', 'reject'), v('d', 'abstain'), v('e', 'abstain')], chairUserId: null, quorumMet: true, policy: tt }).outcome).toBe('reject');
    expect(tallyVotes({ votes: [v('a', 'approve'), v('b', 'approve'), v('c', 'abstain')], chairUserId: null, quorumMet: true, policy: tt }).outcome).toBe('approve'); // 6 ≥ 6
    expect(tallyVotes({ votes: [v('a', 'approve'), v('b', 'approve'), v('c', 'abstain'), v('d', 'abstain')], chairUserId: null, quorumMet: true, policy: tt }).outcome).toBe('reject'); // 6 < 8
  });
  it('a tie is approve = reject + abstain; under "escalate" it is escalated, never approved', () => {
    const t = tallyVotes({ votes: [v('a', 'approve'), v('b', 'approve'), v('c', 'reject'), v('d', 'abstain')], chairUserId: 'a', quorumMet: true, policy });
    expect(t.outcome).toBe('tie_escalate');
  });
  it('abstentions only (or nothing cast) → no outcome can be recorded', () => {
    expect(tallyVotes({ votes: [v('a', 'abstain'), v('b', 'abstain'), v('c', 'abstain')], chairUserId: null, quorumMet: true, policy }).outcome).toBe('insufficient_votes');
    expect(tallyVotes({ votes: [], chairUserId: null, quorumMet: true, policy }).outcome).toBe('insufficient_votes');
  });
});

describe('DOM-P2-13 — casting vote and quorum denominator follow the documents', () => {
  const casting = { ...policy, tieRule: 'chair_casting_vote' as const };
  it('casting vote: on a tie the side the chair voted for prevails — only if the chair cast an eligible approve/reject vote', () => {
    const votes = [v('chair', 'approve'), v('b', 'reject'), v('c', 'abstain'), v('d', 'approve')];
    expect(tallyVotes({ votes, chairUserId: 'chair', quorumMet: true, policy: casting })).toMatchObject({ outcome: 'approve' });
    const chairRejects = [v('chair', 'reject'), v('b', 'approve'), v('c', 'approve'), v('d', 'abstain')];
    expect(tallyVotes({ votes: chairRejects, chairUserId: 'chair', quorumMet: true, policy: casting }).outcome).toBe('reject');
    const chairAbstains = [v('chair', 'abstain'), v('b', 'approve'), v('c', 'approve'), v('d', 'reject')];
    expect(tallyVotes({ votes: chairAbstains, chairUserId: 'chair', quorumMet: true, policy: casting }).outcome).toBe('tie_escalate');
    // The chair's vote is not among the eligible votes (e.g. recused or requester) → no casting vote.
    const noChair = [v('a', 'approve'), v('b', 'reject')];
    expect(tallyVotes({ votes: noChair, chairUserId: 'chair', quorumMet: true, policy: casting }).outcome).toBe('tie_escalate');
  });

  const m = (id: string, voting = true, userId: string | null = id): MemberSnapshot => ({ membershipId: `ms-${id}`, userId, role: 'voting_member', voting, validFrom: '2026-01-01', validTo: null });
  const eight = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => m(id));
  it('the fraction is taken over ALL appointed voting members (recusals do not lower the bar)', () => {
    // 8 appointed, 3 recused: 5 eligible. Required = max(3, 50% × 8 = 4) = 4 (not 50% × 5 = 3).
    const q3 = computeQuorum({ members: eight, presentUserIds: ['d', 'e', 'f'], recusedUserIds: ['a', 'b', 'c'], onDate: '2026-09-29', policy });
    expect(q3).toMatchObject({ appointedVoting: 8, eligibleVoting: 5, presentVoting: 3, required: 4, met: false });
    expect(q3.explanation).toMatch(/50% of 8 appointed voting members/);
    const q4 = computeQuorum({ members: eight, presentUserIds: ['d', 'e', 'f', 'g'], recusedUserIds: ['a', 'b', 'c'], onDate: '2026-09-29', policy });
    expect(q4.met).toBe(true);
    // Recused members present never count toward quorum.
    const q5 = computeQuorum({ members: eight, presentUserIds: ['a', 'b', 'c', 'd'], recusedUserIds: ['a', 'b', 'c'], onDate: '2026-09-29', policy });
    expect(q5).toMatchObject({ presentVoting: 1, met: false });
  });
  it('vacant voting seats ("Role — To be confirmed") are not appointed and are not counted', () => {
    const members = [...['a', 'b', 'c', 'd'].map((id) => m(id)), m('vacant1', true, null), m('vacant2', true, null), m('adv', false)];
    const q = computeQuorum({ members, presentUserIds: ['a', 'b', 'c'], recusedUserIds: [], onDate: '2026-09-29', policy });
    expect(q).toMatchObject({ appointedVoting: 4, required: 3, met: true });
  });
});

describe('DOM-P2-06 — recusal after voting and tally integrity', () => {
  it('a recusal is refused for a member who already voted in the current round', () => {
    expect(() => assertRecusalAllowed({ targetUserId: 'u1', recordedByUserId: 'sec', reason: 'x', votedInCurrentRound: true, round: 1 })).toThrow(/already voted in round 1/);
    expect(() => assertRecusalAllowed({ targetUserId: 'u1', recordedByUserId: 'u1', reason: 'own', votedInCurrentRound: true, round: 2 })).toThrow(/defer and resume|Defer and resume/);
  });
  it('a recusal on behalf of another member needs a reason; the own declaration does not', () => {
    expect(() => assertRecusalAllowed({ targetUserId: 'u1', recordedByUserId: 'sec', reason: '  ', votedInCurrentRound: false, round: 1 })).toThrow(/requires a reason/);
    expect(() => assertRecusalAllowed({ targetUserId: 'u1', recordedByUserId: 'u1', reason: null, votedInCurrentRound: false, round: 1 })).not.toThrow();
    expect(() => assertRecusalAllowed({ targetUserId: 'u1', recordedByUserId: 'sec', reason: 'Declared interest', votedInCurrentRound: false, round: 1 })).not.toThrow();
  });
  it('an outcome is refused when a current-round vote belongs to a recused member or the requester (votes are never dropped)', () => {
    expect(() => assertTallyIntegrity({ votes: [{ userId: 'a' }, { userId: 'b' }], recusedUserIds: ['b'], requesterUserId: null, round: 1 })).toThrow(/cast votes are never discarded/);
    expect(() => assertTallyIntegrity({ votes: [{ userId: 'a' }, { userId: 'req' }], recusedUserIds: [], requesterUserId: 'req', round: 3 })).toThrow(/round 3/);
    expect(() => assertTallyIntegrity({ votes: [{ userId: 'a' }], recusedUserIds: ['b'], requesterUserId: 'req', round: 1 })).not.toThrow();
  });
});

describe('DOM-P2-20 — attendance is frozen while voting is open', () => {
  it('refuses a change while a decision tabled at the meeting has current-round votes and no outcome', () => {
    expect(() => assertAttendanceChangeable([{ code: 'DEC-007', round: 2 }])).toThrow(/DEC-007 \(round 2\)/);
    expect(() => assertAttendanceChangeable([])).not.toThrow();
  });
});

describe('DOM-P2-03 — delegated authority for baseline and change-request approvals', () => {
  const demo: GoverningMatrix = { policy, source: 'demo_sandbox_policy', matrixVersionId: null, committeeId: null };
  const real: GoverningMatrix = { policy: { ...policy, isDemoPolicy: false }, source: 'approved_matrix', matrixVersionId: 'mx1', committeeId: 'c1' };
  const sar = (amount: string) => ({ kind: 'amount' as const, money: { amount, currency: 'SAR', unitScale: 1 } });

  it('no approved matrix (outside the demo sandbox) → refused', () => {
    const r = evaluateDelegatedApproval({ decisionTypeKey: 'baseline_approval', matrix: null, matrixUnusableReason: 'No authority matrix exists', amount: { kind: 'none' }, decision: null });
    expect(r).toMatchObject({ withinAuthority: false, code: 'change_control.no_usable_matrix' });
  });
  it('within the matrix: decision type within the committee delegation and the amount within the limit', () => {
    expect(evaluateDelegatedApproval({ decisionTypeKey: 'baseline_approval', matrix: real, amount: { kind: 'none' }, decision: null })).toMatchObject({ withinAuthority: true, basis: 'delegated_authority', matrixSource: 'approved_matrix', matrixVersionId: 'mx1' });
    expect(evaluateDelegatedApproval({ decisionTypeKey: 'change_request_budget', matrix: demo, amount: sar('1000000'), decision: null })).toMatchObject({ withinAuthority: true, matrixSource: 'demo_sandbox_policy' });
    expect(evaluateDelegatedApproval({ decisionTypeKey: 'change_request_budget', matrix: demo, amount: { kind: 'none' }, decision: null }).withinAuthority).toBe(true);
    expect(evaluateDelegatedApproval({ decisionTypeKey: 'change_request_budget', matrix: demo, amount: { kind: 'amount', money: { amount: '0.9', currency: 'SAR', unitScale: 1_000_000 } }, decision: null }).withinAuthority).toBe(true);
  });
  it('above the limit, another currency, a reserved or unknown type → outside delegated authority, with the body to escalate to', () => {
    const above = evaluateDelegatedApproval({ decisionTypeKey: 'change_request_budget', matrix: demo, amount: sar('1500000'), decision: null });
    expect(above).toMatchObject({ withinAuthority: false, code: 'change_control.outside_delegated_authority', escalateTo: 'Delegating authority — to be confirmed' });
    expect(above.reason).toMatch(/exceeds the committee delegated limit/);
    expect(evaluateDelegatedApproval({ decisionTypeKey: 'change_request_budget', matrix: demo, amount: { kind: 'amount', money: { amount: '1', currency: 'USD', unitScale: 1 } }, decision: null }).code).toBe('change_control.outside_delegated_authority');
    expect(evaluateDelegatedApproval({ decisionTypeKey: 'jv_signing_authorization', matrix: demo, amount: { kind: 'none' }, decision: null }).code).toBe('change_control.outside_delegated_authority');
    expect(evaluateDelegatedApproval({ decisionTypeKey: 'unknown_type', matrix: demo, amount: { kind: 'none' }, decision: null }).code).toBe('change_control.outside_delegated_authority');
  });
  it('a monetary impact stated only as text is never assumed to be within a limit', () => {
    const r = evaluateDelegatedApproval({ decisionTypeKey: 'change_request_budget', matrix: demo, amount: { kind: 'unquantified', reason: 'The cost impact is stated as text only' }, decision: null });
    expect(r).toMatchObject({ withinAuthority: false, code: 'change_control.amount_unquantified' });
    // …but where the matrix sets no monetary limit for the type, the amount does not matter.
    expect(evaluateDelegatedApproval({ decisionTypeKey: 'baseline_approval', matrix: demo, amount: { kind: 'unquantified', reason: 'mixed currencies' }, decision: null }).withinAuthority).toBe(true);
  });

  const dec = (over: Partial<LinkedDecisionSnapshot> = {}): LinkedDecisionSnapshot => ({
    id: 'd1',
    code: 'DEC-001',
    status: 'approved',
    authorityOutcome: 'pending_external_authority',
    decisionTypeKey: 'change_request_budget',
    amount: { amount: '1500000.0000', currency: 'SAR', unitScale: 1 },
    externalAuthorityReference: 'Synthetic external reference (test)',
    ...over,
  });
  it('out-of-authority changes are approved on a final governance decision of the matching type that covers the amount', () => {
    const r = evaluateDelegatedApproval({ decisionTypeKey: 'change_request_budget', matrix: demo, amount: sar('1500000'), decision: dec() });
    expect(r).toMatchObject({ withinAuthority: true, basis: 'governance_decision', decisionId: 'd1' });
    // The decision route works even without a usable matrix today (the decision was evaluated when it was taken).
    expect(evaluateDelegatedApproval({ decisionTypeKey: 'change_request_budget', matrix: null, amount: sar('1500000'), decision: dec() }).withinAuthority).toBe(true);
    expect(evaluateDelegatedApproval({ decisionTypeKey: 'change_request_budget', matrix: demo, amount: sar('1500000'), decision: dec({ status: 'implementation_pending' }) }).withinAuthority).toBe(true);
  });
  it('the decision must be final, of the right type, and cover the amount in the same currency', () => {
    const e = (d: LinkedDecisionSnapshot, amount = sar('1500000')) => evaluateDelegatedApproval({ decisionTypeKey: 'change_request_budget', matrix: demo, amount, decision: d }).code;
    expect(e(dec({ status: 'recommended' }))).toBe('change_control.decision_not_final');
    expect(e(dec({ status: 'under_review' }))).toBe('change_control.decision_not_final');
    expect(e(dec({ status: 'superseded' }))).toBe('change_control.decision_not_final');
    expect(e(dec({ externalAuthorityReference: null }))).toBe('change_control.decision_not_final');
    expect(e(dec({ decisionTypeKey: 'baseline_approval' }))).toBe('change_control.decision_type_mismatch');
    expect(e(dec({ amount: null }))).toBe('change_control.decision_amount_missing');
    expect(e(dec({ amount: { amount: '1', currency: 'USD', unitScale: 1_000_000 } }))).toBe('change_control.decision_amount_currency');
    expect(e(dec({ amount: { amount: '1.4', currency: 'SAR', unitScale: 1_000_000 } }))).toBe('change_control.decision_amount_insufficient');
    expect(e(dec(), { kind: 'unquantified', reason: 'text only' })).toBe('change_control.amount_unquantified');
    expect(e(dec({ authorityOutcome: 'within_mandate', externalAuthorityReference: null, amount: { amount: '250000', currency: 'SAR', unitScale: 1 } }), sar('250000'))).toBeNull();
  });

  it('baseline budget: one currency/unit is totalled; mixed currencies are not comparable; no lines = no monetary impact', () => {
    expect(baselineBudgetAmount([])).toEqual({ kind: 'none' });
    expect(baselineBudgetAmount([{ approvedAmount: '100.5', currency: 'SAR', unitScale: 1 }, { approvedAmount: '0.5', currency: 'SAR', unitScale: 1 }, { approvedAmount: null, currency: 'SAR', unitScale: 1 }])).toEqual({
      kind: 'amount',
      money: { amount: '101.0000', currency: 'SAR', unitScale: 1 },
    });
    expect(baselineBudgetAmount([{ approvedAmount: '1', currency: 'SAR', unitScale: 1 }, { approvedAmount: '1', currency: 'USD', unitScale: 1 }]).kind).toBe('unquantified');
    expect(baselineBudgetAmount([{ approvedAmount: '1', currency: 'SAR', unitScale: 1 }, { approvedAmount: '1', currency: 'SAR', unitScale: 1000 }]).kind).toBe('unquantified');
  });
});

describe('DOM-P2-12 — approvals of the matrix and of external authorities rest on verified evidence', () => {
  it('a non-demo matrix needs an approval document and a second-person verification; the DEMO policy does not', () => {
    expect(() => matrixApprovalPlan({ isDemoPolicy: false, approvalDocumentId: null })).toThrow(/requires the approval record as a document/);
    expect(matrixApprovalPlan({ isDemoPolicy: false, approvalDocumentId: 'doc' })).toEqual({ requiresVerification: true });
    expect(matrixApprovalPlan({ isDemoPolicy: true, approvalDocumentId: undefined })).toEqual({ requiresVerification: false });
  });
  it('an external decision needs an active, verified evidence link on the decision itself', () => {
    const ok = { targetType: 'decision', targetId: 'd1', status: 'active', reviewedBy: 'verifier' };
    expect(() => assertExternalApprovalEvidence({ decisionId: 'd1', recorderUserId: 'sec2', link: null })).toThrow(/verified evidence link/);
    expect(() => assertExternalApprovalEvidence({ decisionId: 'd1', recorderUserId: 'sec2', link: { ...ok, targetId: 'd2' } })).toThrow(/another record/);
    expect(() => assertExternalApprovalEvidence({ decisionId: 'd1', recorderUserId: 'sec2', link: { ...ok, status: 'rejected' } })).toThrow(/rejected/);
    expect(() => assertExternalApprovalEvidence({ decisionId: 'd1', recorderUserId: 'sec2', link: { ...ok, reviewedBy: null } })).toThrow(/not been verified/);
    expect(() => assertExternalApprovalEvidence({ decisionId: 'd1', recorderUserId: 'sec2', link: ok })).not.toThrow();
  });
});

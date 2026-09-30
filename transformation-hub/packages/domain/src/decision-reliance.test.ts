import { describe, expect, it } from 'vitest';
import {
  DECISION_USE_KINDS,
  DECISION_USE_SUBJECT_TYPE,
  assertDecisionReliance,
  assertDecisionSubjectChangeable,
  assertDecisionSubjectOpen,
  assertPrerequisiteRemovable,
  decisionEvidenceReassessment,
  decisionRelianceIssue,
  decisionSubjectIssue,
  decisionSubjectOf,
  decisionUseConflict,
  externalApprovalEvidenceIssue,
  type DecisionRelianceInput,
} from './decision-reliance';
import {
  assertConflictDeclared,
  assertVotingClosable,
  assertVotingComplete,
  assertVotingOpen,
  evaluateDelegatedApproval,
  missingDecisionPaperFields,
  outstandingVoters,
  type AuthorityPolicy,
  type GoverningMatrix,
  type LinkedDecisionSnapshot,
  type MemberSnapshot,
} from './governance';
import { assertGateDecisionAllowed, evaluateGate, gateDecisionIssue, type GateDecisionAuthority } from './gates';

/**
 * P2 domain re-review fixes (docs/reviews/P2-domain-rereview.md): DOM-P2R-01 (voting closure), -02 (requester-stated
 * amount), -03 (decision bound to its subject), -04 (external-approval evidence at every reliance), -07 (prerequisite
 * removal), REQ-GOV-015 (declaration before voting), DOM-P2-14 (supporting evidence), and QA-P2-03 (review re-checked at
 * decision time). Synthetic values only.
 */

const policy: AuthorityPolicy = {
  isDemoPolicy: true,
  quorum: { minVotingMembersPresent: 3, minFractionPresent: 0.5 },
  approvalThreshold: { type: 'simple_majority' },
  tieRule: 'escalate',
  decisionTypes: [{ key: 'change_request_budget', maxAmount: '1000000.0000', currency: 'SAR', unitScale: 1, withinCommitteeAuthority: true, escalateTo: 'Delegating authority — to be confirmed' }],
  selfApprovalProhibited: true,
  recusedMembersExcludedFromQuorum: true,
};
const demo: GoverningMatrix = { policy, source: 'demo_sandbox_policy', matrixVersionId: null, committeeId: null };
const sar = (amount: string) => ({ kind: 'amount' as const, money: { amount, currency: 'SAR', unitScale: 1 } });
const VERIFIED = { linkId: 'l1', status: 'active', verified: true };
const crX = { type: 'change_request' as const, id: 'crX' };
const crY = { type: 'change_request' as const, id: 'crY' };
const decision = (over: Partial<LinkedDecisionSnapshot> = {}): LinkedDecisionSnapshot => ({
  id: 'd1',
  code: 'DEC-001',
  status: 'approved',
  authorityOutcome: 'pending_external_authority',
  decisionTypeKey: 'change_request_budget',
  amount: { amount: '1500000.0000', currency: 'SAR', unitScale: 1 },
  externalAuthorityReference: 'DEMO-REF (synthetic)',
  subjectType: 'change_request',
  subjectId: 'crX',
  externalEvidence: VERIFIED,
  ...over,
});

describe('DOM-P2R-03 — a decision is bound to the record it authorizes [REQ-GOV-022, REQ-PLN-013]', () => {
  it('the subject is all-or-nothing and of a known type', () => {
    expect(decisionSubjectOf(null, null)).toBeNull();
    expect(decisionSubjectOf('change_request', 'x')).toEqual({ type: 'change_request', id: 'x' });
    expect(() => decisionSubjectOf('change_request', null)).toThrow(expect.objectContaining({ code: 'governance.decision.subject_incomplete' }));
    expect(() => decisionSubjectOf('gate_definition', 'x')).toThrow(expect.objectContaining({ code: 'governance.decision.subject_incomplete' }));
  });
  it('the subject is fixed once the paper was submitted (even after a return to draft)', () => {
    expect(() => assertDecisionSubjectChangeable({ current: null, next: crX, submittedBefore: false })).not.toThrow();
    expect(() => assertDecisionSubjectChangeable({ current: crX, next: crY, submittedBefore: false })).not.toThrow();
    expect(() => assertDecisionSubjectChangeable({ current: crX, next: crX, submittedBefore: true })).not.toThrow();
    expect(() => assertDecisionSubjectChangeable({ current: crX, next: crY, submittedBefore: true })).toThrow(expect.objectContaining({ code: 'governance.decision.subject_locked' }));
    expect(() => assertDecisionSubjectChangeable({ current: crX, next: null, submittedBefore: true })).toThrow(expect.objectContaining({ code: 'governance.decision.subject_locked' }));
  });
  it('a paper is raised only for a record awaiting approval', () => {
    expect(() => assertDecisionSubjectOpen(crX, 'under_review')).not.toThrow();
    expect(() => assertDecisionSubjectOpen(crX, 'approved')).toThrow(expect.objectContaining({ code: 'governance.decision.subject_not_open' }));
    expect(() => assertDecisionSubjectOpen({ type: 'baseline_version', id: 'b' }, 'proposed')).not.toThrow();
    expect(() => assertDecisionSubjectOpen({ type: 'perimeter_version', id: 'p' }, 'approved')).toThrow();
  });
  it('a decision about change X cannot approve change Y; a decision raised for no record backs no approval', () => {
    expect(decisionSubjectIssue({ code: 'D', subjectType: 'change_request', subjectId: 'crX' }, crX, 'change_control')).toBeNull();
    expect(decisionSubjectIssue({ code: 'D', subjectType: 'change_request', subjectId: 'crX' }, crY, 'change_control')?.code).toBe('change_control.decision_other_subject');
    expect(decisionSubjectIssue({ code: 'D', subjectType: 'baseline_version', subjectId: 'crY' }, crY, 'change_control')?.code).toBe('change_control.decision_other_subject');
    expect(decisionSubjectIssue({ code: 'D', subjectType: null, subjectId: null }, crY, 'change_control')?.code).toBe('change_control.decision_no_subject');
    const base = { decisionTypeKey: 'change_request_budget', matrix: demo, amount: sar('1200000'), amountConfirmed: true };
    expect(evaluateDelegatedApproval({ ...base, subject: crY, decision: decision() })).toMatchObject({ withinAuthority: false, code: 'change_control.decision_other_subject' });
    expect(evaluateDelegatedApproval({ ...base, subject: crX, decision: decision() })).toMatchObject({ withinAuthority: true, basis: 'governance_decision' });
    expect(evaluateDelegatedApproval({ ...base, subject: crX, decision: decision({ subjectType: null, subjectId: null }) }).code).toBe('change_control.decision_no_subject');
  });
});

describe('DOM-P2R-04 — the evidence of an external approval must still stand whenever the decision is relied upon [REQ-LCY-015, REQ-DAT-014]', () => {
  const ext = { authorityOutcome: 'pending_external_authority', externalAuthorityReference: 'DEMO-REF' };
  it('active + verified evidence stands; missing, inactive or unverified evidence does not (fail closed)', () => {
    expect(externalApprovalEvidenceIssue({ ...ext, externalEvidence: VERIFIED })).toBeNull();
    expect(externalApprovalEvidenceIssue({ ...ext, externalEvidence: null })).toEqual({ kind: 'missing' });
    expect(externalApprovalEvidenceIssue({ ...ext, externalEvidence: { ...VERIFIED, status: 'rejected' } })).toEqual({ kind: 'not_active', status: 'rejected' });
    expect(externalApprovalEvidenceIssue({ ...ext, externalEvidence: { ...VERIFIED, verified: false } })).toEqual({ kind: 'unverified' });
    // Decisions within the committee mandate involve no external approval.
    expect(externalApprovalEvidenceIssue({ authorityOutcome: 'within_mandate', externalEvidence: null })).toBeNull();
  });
  it('rejected / superseded / conflicting evidence flags the gates that relied on the decision', () => {
    expect(decisionEvidenceReassessment({ ...ext, externalEvidence: VERIFIED })).toBeNull();
    expect(decisionEvidenceReassessment({ ...ext, externalEvidence: { ...VERIFIED, status: 'rejected' } })).toEqual({ reason: 'evidence_defective', linkId: 'l1' });
    expect(decisionEvidenceReassessment({ ...ext, externalEvidence: { ...VERIFIED, status: 'superseded' } })).toEqual({ reason: 'evidence_superseded', linkId: 'l1' });
    expect(decisionEvidenceReassessment({ ...ext, externalEvidence: { ...VERIFIED, status: 'conflicting' } })).toEqual({ reason: 'evidence_conflict', linkId: 'l1' });
  });
  it('change control: a decision whose evidence was rejected stops backing new approvals (checked before type, subject and amount)', () => {
    const r = evaluateDelegatedApproval({ decisionTypeKey: 'change_request_budget', matrix: demo, amount: sar('1500000'), amountConfirmed: true, subject: crY, decision: decision({ externalEvidence: { ...VERIFIED, status: 'rejected' } }) });
    expect(r).toMatchObject({ withinAuthority: false, code: 'change_control.decision_evidence_invalid' });
    expect(evaluateDelegatedApproval({ decisionTypeKey: 'change_request_budget', matrix: demo, amount: sar('1500000'), amountConfirmed: true, subject: crX, decision: decision({ externalEvidence: null }) }).code).toBe('change_control.decision_evidence_invalid');
  });
  it('gates: the decide guard refuses with the evidence code', () => {
    const op: GateDecisionAuthority = { matrixVersionId: 'm1', decisionType: { key: 'gate_decision_mandate', gateKeys: ['G0'], withinCommitteeAuthority: false } };
    const d = { id: 'g', status: 'approved' as const, authorityOutcome: 'pending_external_authority' as const, externalAuthorityReference: 'DEMO-REF', gateKey: 'G0', decisionTypeKey: 'gate_decision_mandate' };
    const ready = evaluateGate({ criteria: [], prerequisites: [] });
    const args = { gateKey: 'G0', outcome: 'approve' as const, evaluation: ready, authority: op, decisionIdsUsedByPriorCycles: [], note: 'x' };
    expect(() => assertGateDecisionAllowed({ ...args, decision: { ...d, externalEvidence: VERIFIED } })).not.toThrow();
    expect(() => assertGateDecisionAllowed({ ...args, decision: { ...d, externalEvidence: { ...VERIFIED, status: 'rejected' } } })).toThrow(expect.objectContaining({ code: 'gates.decide.decision_evidence_invalid' }));
    expect(gateDecisionIssue({ ...d, externalEvidence: { ...VERIFIED, status: 'superseded' } }, 'G0')?.messageI18n[0]).toEqual({ code: 'gate.blocker.decision_external_evidence_invalid', params: { status: 'superseded' } });
  });
});

describe('DOM-P2R-02 — a requester-stated amount never makes an approval pass', () => {
  const base = { decisionTypeKey: 'change_request_budget', matrix: demo, subject: crX, decision: null };
  it('within the delegation on an unconfirmed amount → refused; confirmed by an assessor → approved', () => {
    expect(evaluateDelegatedApproval({ ...base, amount: sar('0'), amountConfirmed: false })).toMatchObject({ withinAuthority: false, code: 'change_control.amount_unconfirmed' });
    expect(evaluateDelegatedApproval({ ...base, amount: sar('0'), amountConfirmed: true })).toMatchObject({ withinAuthority: true });
  });
  it('an unconfirmed amount above the limit is refused as outside authority (the stated figure may refuse, never pass)', () => {
    expect(evaluateDelegatedApproval({ ...base, amount: sar('1500000'), amountConfirmed: false }).code).toBe('change_control.outside_delegated_authority');
  });
  it('no monetary impact at all is not an amount to confirm', () => {
    expect(evaluateDelegatedApproval({ ...base, amount: { kind: 'none' }, amountConfirmed: false }).withinAuthority).toBe(true);
  });
  it('the decision route checks the confirmation last', () => {
    expect(evaluateDelegatedApproval({ ...base, amount: sar('1500000'), amountConfirmed: false, decision: decision() }).code).toBe('change_control.amount_unconfirmed');
    expect(evaluateDelegatedApproval({ ...base, amount: sar('2000000'), amountConfirmed: false, decision: decision() }).code).toBe('change_control.decision_amount_insufficient');
  });
});

describe('DOM-P2R-01 — voting closes when every eligible member voted, or the chair closes it [REQ-GOV-016]', () => {
  const seat = (u: string, voting = true, role: MemberSnapshot['role'] = 'voting_member'): MemberSnapshot => ({ membershipId: `m-${u}`, userId: u, role, voting, validFrom: '2026-01-01', validTo: null });
  const members = [seat('chair', true, 'chair'), seat('a'), seat('b'), seat('c'), seat('sec', false, 'secretary'), { ...seat('gone'), validTo: '2026-02-01' }];
  const common = { members, onDate: '2026-09-30', recusedUserIds: ['c'], requesterUserId: 'b', selfApprovalProhibited: true };
  it('meeting: the present eligible members (not recused, not the requester, not non-voting) who have not voted', () => {
    expect(outstandingVoters({ ...common, presentUserIds: ['chair', 'a', 'b', 'c', 'sec'], votedUserIds: ['chair'] })).toEqual(['a']);
    expect(outstandingVoters({ ...common, presentUserIds: ['chair', 'a', 'b', 'c', 'sec'], votedUserIds: ['chair', 'a'] })).toEqual([]);
    expect(outstandingVoters({ ...common, presentUserIds: ['chair'], votedUserIds: [] })).toEqual(['chair']);
  });
  it('circulation: every appointed eligible voting member is expected to respond', () => {
    expect(outstandingVoters({ ...common, presentUserIds: null, votedUserIds: ['chair'] })).toEqual(['a']);
  });
  it('an outcome needs no outstanding voter, or the chair closed voting, or (circulation) the deadline passed', () => {
    expect(() => assertVotingComplete({ outstanding: ['a'], closedByChair: false, round: 1 })).toThrow(expect.objectContaining({ code: 'governance.outcome.votes_outstanding', details: { round: 1, outstanding: 1 } }));
    expect(() => assertVotingComplete({ outstanding: ['a'], closedByChair: true, round: 1 })).not.toThrow();
    expect(() => assertVotingComplete({ outstanding: ['a'], closedByChair: false, circulationDeadlinePassed: true, round: 1 })).not.toThrow();
    expect(() => assertVotingComplete({ outstanding: [], closedByChair: false, round: 1 })).not.toThrow();
  });
  it('only the chair closes voting, while under review, once per round, with a reason', () => {
    const ok = { status: 'under_review', actorUserId: 'chair', chairUserId: 'chair', closedRound: null, round: 2, reason: 'Members left the room (synthetic)', tabled: true };
    expect(() => assertVotingClosable(ok)).not.toThrow();
    expect(() => assertVotingClosable({ ...ok, actorUserId: 'sec' })).toThrow(expect.objectContaining({ code: 'governance.voting.not_chair', kind: 'forbidden' }));
    expect(() => assertVotingClosable({ ...ok, chairUserId: null })).toThrow(expect.objectContaining({ code: 'governance.voting.no_chair' }));
    expect(() => assertVotingClosable({ ...ok, status: 'approved' })).toThrow(expect.objectContaining({ code: 'governance.voting.not_open' }));
    expect(() => assertVotingClosable({ ...ok, closedRound: 2 })).toThrow(expect.objectContaining({ code: 'governance.voting.already_closed' }));
    expect(() => assertVotingClosable({ ...ok, closedRound: 1 })).not.toThrow();
    expect(() => assertVotingClosable({ ...ok, reason: ' ' })).toThrow(expect.objectContaining({ code: 'governance.voting.reason_required' }));
    expect(() => assertVotingClosable({ ...ok, tabled: false })).toThrow(expect.objectContaining({ code: 'governance.vote.not_tabled' }));
  });
  it('no vote after the chair closed the round', () => {
    expect(() => assertVotingOpen({ closedRound: 2, round: 2 })).toThrow(expect.objectContaining({ code: 'governance.vote.voting_closed' }));
    expect(() => assertVotingOpen({ closedRound: 1, round: 2 })).not.toThrow();
    expect(() => assertVotingOpen({ closedRound: null, round: 1 })).not.toThrow();
  });
});

describe('REQ-GOV-015 — a conflict-of-interest declaration for the item before voting', () => {
  it('the member’s OWN "no conflict" or declared interest; on-behalf declarations and other members’ do not count', () => {
    expect(() => assertConflictDeclared({ voterUserId: 'a', declarations: [] })).toThrow(expect.objectContaining({ code: 'governance.vote.declaration_required' }));
    expect(() => assertConflictDeclared({ voterUserId: 'a', declarations: [{ userId: 'a', recordedBy: 'a', declaration: 'no_conflict' }] })).not.toThrow();
    expect(() => assertConflictDeclared({ voterUserId: 'a', declarations: [{ userId: 'a', recordedBy: 'a', declaration: 'interest_declared' }] })).not.toThrow();
    expect(() => assertConflictDeclared({ voterUserId: 'a', declarations: [{ userId: 'a', recordedBy: 'sec', declaration: 'no_conflict' }] })).toThrow();
    expect(() => assertConflictDeclared({ voterUserId: 'a', declarations: [{ userId: 'b', recordedBy: 'b', declaration: 'no_conflict' }] })).toThrow();
  });
});

describe('DOM-P2-14 — a paper cites supporting evidence or states "none" with a reason [REQ-GOV-014]', () => {
  const paper = {
    issue: 'i',
    whyNow: 'w',
    alternatives: [{ title: 'a' }],
    recommendation: 'r',
    impacts: { financial: 'f', operational: 'o', schedule: 's' },
    risks: 'r',
    dependencies: 'd',
    latestSafeDate: '2026-10-30',
    requiredAuthority: 'x',
    decisionTypeKey: 'change_request_budget',
    requesterUserId: 'u',
  };
  it('missing without evidence and without a reason; complete with either', () => {
    expect(missingDecisionPaperFields(paper, { activeEvidenceLinks: 0 })).toEqual(['supportingEvidence']);
    expect(missingDecisionPaperFields({ ...paper, evidenceNoneReason: '  ' }, { activeEvidenceLinks: 0 })).toEqual(['supportingEvidence']);
    expect(missingDecisionPaperFields({ ...paper, evidenceNoneReason: 'No documents exist yet (synthetic)' }, { activeEvidenceLinks: 0 })).toEqual([]);
    expect(missingDecisionPaperFields(paper, { activeEvidenceLinks: 1 })).toEqual([]);
  });
});

describe('DOM-P2R-07 — removing a blocking prerequisite needs a reason and another person than the one it blocks', () => {
  it('reason always required; while blocking, not by the accountable person of the task / milestone', () => {
    expect(() => assertPrerequisiteRemovable({ satisfied: true, reason: '', actorUserId: 'pm', blockedUserIds: [] })).toThrow(expect.objectContaining({ code: 'planning.prerequisite.reason_required' }));
    expect(() => assertPrerequisiteRemovable({ satisfied: false, reason: 'Obsolete (synthetic)', actorUserId: 'lead', blockedUserIds: ['lead'] })).toThrow(expect.objectContaining({ code: 'planning.prerequisite.removal_by_blocked_party', kind: 'forbidden' }));
    expect(() => assertPrerequisiteRemovable({ satisfied: false, reason: 'Obsolete (synthetic)', actorUserId: 'pm', blockedUserIds: ['lead'] })).not.toThrow();
    expect(() => assertPrerequisiteRemovable({ satisfied: true, reason: 'Satisfied (synthetic)', actorUserId: 'lead', blockedUserIds: ['lead'] })).not.toThrow();
    expect(() => assertPrerequisiteRemovable({ satisfied: false, reason: 'x', actorUserId: null, blockedUserIds: [] })).toThrow(expect.objectContaining({ code: 'policy.sod_subject_unknown' }));
  });
});

describe('QA-P2-03 — an approval is decided only on the state the gate reviewer endorsed', () => {
  it('a stale or missing endorsement at decision time → 422 review_stale (rejection unaffected)', () => {
    const op: GateDecisionAuthority = { matrixVersionId: 'm1', decisionType: { key: 'gate_decision_operational', gateKeys: ['G1'], withinCommitteeAuthority: true } };
    const d = { id: 'g', status: 'approved' as const, authorityOutcome: 'within_mandate' as const, gateKey: 'G1', decisionTypeKey: 'gate_decision_operational' };
    const ready = evaluateGate({ criteria: [], prerequisites: [] });
    const args = { gateKey: 'G1', outcome: 'approve' as const, evaluation: ready, decision: d, authority: op, decisionIdsUsedByPriorCycles: [], note: 'x' };
    expect(() => assertGateDecisionAllowed({ ...args, reviewState: 'endorsed' })).not.toThrow();
    expect(() => assertGateDecisionAllowed({ ...args, reviewState: 'stale' })).toThrow(expect.objectContaining({ code: 'gates.assessment.review_stale' }));
    expect(() => assertGateDecisionAllowed({ ...args, reviewState: 'not_reviewed' })).toThrow(expect.objectContaining({ code: 'gates.assessment.review_stale' }));
    expect(() => assertGateDecisionAllowed({ ...args, outcome: 'reject', reviewState: 'stale' })).not.toThrow();
  });
});

describe('Generic reliance on a decision + decision-use registry (DOM-P2R-03/-04/-05, QA-P2-01, O-1) [REQ-GOV-022, REQ-PLN-013]', () => {
  const base = (over: Partial<DecisionRelianceInput> = {}): DecisionRelianceInput => ({
    decision: {
      id: 'd1',
      code: 'DEC-001',
      status: 'approved',
      authorityOutcome: 'pending_external_authority',
      externalAuthorityReference: 'DEMO-REF (synthetic)',
      decisionTypeKey: 'change_request_budget',
      subjectType: 'change_request',
      subjectId: 'crX',
      externalEvidence: VERIFIED,
    },
    use: { kind: 'change_request', subjectType: 'change_request', subjectId: 'crX' },
    uses: [],
    subjectRule: 'required',
    decisionTypeKeys: ['change_request_budget'],
    codePrefix: 'change_control',
    ...over,
  });
  const code = (i: DecisionRelianceInput) => decisionRelianceIssue(i)?.code ?? null;
  const d = base().decision;

  it('every kind of use names the record type it backs', () => {
    for (const k of DECISION_USE_KINDS) expect(DECISION_USE_SUBJECT_TYPE[k]).toMatch(/^[a-z_]+$/);
    expect(DECISION_USE_SUBJECT_TYPE.gate_cycle).toBe('gate_assessment');
  });

  it('a final decision raised for this record, evidenced, of the right type and unused → no issue', () => {
    expect(decisionRelianceIssue(base())).toBeNull();
    expect(() => assertDecisionReliance(base())).not.toThrow();
    // Within the committee mandate: no external evidence is involved.
    expect(code(base({ decision: { ...d, authorityOutcome: 'within_mandate', externalAuthorityReference: null, externalEvidence: null } }))).toBeNull();
  });

  it('checks, in order: final → evidence → type → single use → subject; codes carry the caller prefix', () => {
    expect(code(base({ decision: { ...d, status: 'recommended' } }))).toBe('change_control.decision_not_final');
    expect(code(base({ decision: { ...d, externalAuthorityReference: null } }))).toBe('change_control.decision_not_final');
    expect(code(base({ decision: { ...d, authorityOutcome: 'none' } }))).toBe('change_control.decision_not_final');
    expect(code(base({ decision: { ...d, externalEvidence: { linkId: 'l1', status: 'rejected', verified: true } } }))).toBe('change_control.decision_evidence_invalid');
    expect(code(base({ decision: { ...d, externalEvidence: { linkId: 'l1', status: 'active', verified: false } } }))).toBe('change_control.decision_evidence_invalid');
    expect(code(base({ decision: { ...d, externalEvidence: null } }))).toBe('change_control.decision_evidence_invalid');
    expect(code(base({ decision: { ...d, decisionTypeKey: 'baseline_approval' } }))).toBe('change_control.decision_type_mismatch');
    expect(code(base({ decision: { ...d, subjectType: null, subjectId: null } }))).toBe('change_control.decision_no_subject');
    expect(code(base({ decision: { ...d, subjectId: 'crY' } }))).toBe('change_control.decision_other_subject');
    expect(code(base({ uses: [{ kind: 'change_request', subjectType: 'change_request', subjectId: 'crOther' }] }))).toBe('change_control.decision_already_used');
    // Evidence is checked before the type: a rejected external approval is reported as such whatever else is wrong.
    expect(code(base({ decision: { ...d, decisionTypeKey: 'x', subjectId: 'crY', externalEvidence: { linkId: 'l1', status: 'superseded', verified: true } } }))).toBe(
      'change_control.decision_evidence_invalid',
    );
    // A decision consumed by X and offered for Y is refused as used (before its subject is compared).
    expect(code(base({ use: { kind: 'change_request', subjectType: 'change_request', subjectId: 'crY' }, uses: [{ kind: 'change_request', subjectType: 'change_request', subjectId: 'crX' }] }))).toBe(
      'change_control.decision_already_used',
    );
    const issue = decisionRelianceIssue(base({ codePrefix: 'jv.closing', uses: [{ kind: 'change_request', subjectType: 'change_request', subjectId: 'crOther' }] }));
    expect(issue).toMatchObject({ kind: 'already_used', code: 'jv.closing.decision_already_used', params: { decisionId: 'd1', usedBySubjectId: 'crOther' } });
    expect(() => assertDecisionReliance(base({ decision: { ...d, subjectId: 'crY' } }))).toThrow(expect.objectContaining({ code: 'change_control.decision_other_subject', kind: 'rule_violation' }));
  });

  it('subject rules: required / if_set / none; a use of ANOTHER kind (or for this same record) does not block', () => {
    const unbound = { ...d, subjectType: null, subjectId: null };
    expect(code(base({ decision: unbound, subjectRule: 'if_set' }))).toBeNull();
    expect(code(base({ decision: { ...d, subjectId: 'crY' }, subjectRule: 'if_set' }))).toBe('change_control.decision_other_subject');
    expect(code(base({ decision: { ...d, subjectId: 'crY' }, subjectRule: 'none' }))).toBeNull();
    // A G1 decision backs the G1 gate cycle AND one perimeter version (different kinds) — but never two perimeter versions.
    const g1 = { ...unbound, decisionTypeKey: 'gate_decision_operational' };
    const pv = (uses: DecisionRelianceInput['uses']) =>
      code(
        base({
          decision: g1,
          use: { kind: 'perimeter_version', subjectType: 'perimeter_version', subjectId: 'v2' },
          uses,
          subjectRule: 'if_set',
          decisionTypeKeys: undefined,
          codePrefix: 'perimeter.version',
        }),
      );
    expect(pv([{ kind: 'gate_cycle', subjectType: 'gate_assessment', subjectId: 'cycle1' }])).toBeNull();
    expect(pv([{ kind: 'perimeter_version', subjectType: 'perimeter_version', subjectId: 'v1' }])).toBe('perimeter.version.decision_already_used');
    expect(pv([{ kind: 'perimeter_version', subjectType: 'perimeter_version', subjectId: 'v2' }])).toBeNull();
    // A reliance that does not consume the decision (prerequisite satisfaction): no single-use check.
    expect(
      code(base({ use: { kind: null, subjectType: 'task', subjectId: 't1' }, subjectRule: 'none', decisionTypeKeys: undefined, uses: [{ kind: 'change_request', subjectType: 'change_request', subjectId: 'crX' }] })),
    ).toBeNull();
    expect(decisionUseConflict([{ kind: 'gate_cycle', subjectType: 'gate_assessment', subjectId: 'c1' }], 'gate_cycle', 'c2')).toMatchObject({ subjectId: 'c1' });
    expect(decisionUseConflict([{ kind: 'gate_cycle', subjectType: 'gate_assessment', subjectId: 'c1' }], 'gate_cycle', 'c1')).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import {
  evaluateGate,
  gateDecisionIssue,
  assertGateDecisionAllowed,
  assertCriterionEditable,
  gateRag,
  waiverIsEffective,
  carryForwardCriteria,
  assertWaivabilityDetermination,
  CriterionState,
  GateEvaluation,
} from './gates';

const crit = (over: Partial<CriterionState>): CriterionState => ({
  key: 'G1-C01',
  mandatory: true,
  blocking: true,
  waivable: false,
  evidenceRequired: true,
  status: 'unmet',
  activeEvidenceCount: 0,
  conflictingEvidenceCount: 0,
  ...over,
});

const readyEval = (over: Partial<GateEvaluation> = {}): GateEvaluation => ({
  ...evaluateGate({ criteria: [crit({ status: 'met', activeEvidenceCount: 1 })], prerequisites: [] }),
  ...over,
});

describe('gate evaluation counts [REQ-LCY-010, REQ-LCY-011]', () => {
  it('counts blocking criteria that are not satisfied (drives red RAG)', () => {
    const e = evaluateGate({
      criteria: [crit({}), crit({ key: 'C2', status: 'met', activeEvidenceCount: 1 }), crit({ key: 'C3', blocking: false, mandatory: true })],
      prerequisites: [],
    });
    expect(e.counts.blockingUnmet).toBe(1);
    expect(e.counts.unmet).toBe(2);
  });
  it('a met criterion with conflicting evidence still counts as a blocking problem', () => {
    const e = evaluateGate({ criteria: [crit({ status: 'met', activeEvidenceCount: 1, conflictingEvidenceCount: 1 })], prerequisites: [] });
    expect(e.ready).toBe(false);
    expect(e.counts.blockingUnmet).toBe(1);
  });
});

describe('AT-04 — gate approval needs a final governance decision [REQ-LCY-010, REQ-GOV]', () => {
  const base = { id: 'd1', status: 'approved' as const, authorityOutcome: 'within_mandate' as const };
  it('a recommended decision (pending external authority) is not final', () => {
    const i = gateDecisionIssue({ ...base, status: 'recommended', authorityOutcome: 'pending_external_authority' }, 'G1');
    expect(i?.kind).toBe('decision');
    expect(i?.message).toMatch(/pending the external authority/);
  });
  it('under review / deferred / rejected / superseded decisions are not final', () => {
    for (const s of ['draft', 'submitted', 'under_review', 'deferred', 'rejected', 'superseded'] as const) {
      expect(gateDecisionIssue({ ...base, status: s }, 'G1')).not.toBeNull();
    }
  });
  it('an approved decision within mandate backs the approval (implementation states too)', () => {
    expect(gateDecisionIssue(base, 'G1')).toBeNull();
    expect(gateDecisionIssue({ ...base, status: 'implementation_pending' }, 'G1')).toBeNull();
  });
  it('an approved decision outside mandate needs the recorded approval of the authorized body', () => {
    expect(gateDecisionIssue({ ...base, authorityOutcome: 'pending_external_authority' }, 'G1')).not.toBeNull();
    expect(gateDecisionIssue({ ...base, authorityOutcome: 'pending_external_authority', externalAuthorityReference: 'Board resolution (demo ref)' }, 'G1')).toBeNull();
    expect(gateDecisionIssue({ ...base, authorityOutcome: 'not_assessed' }, 'G1')).not.toBeNull();
  });
  it('a decision raised for another gate cannot back this gate', () => {
    expect(gateDecisionIssue({ ...base, gateKey: 'G2' }, 'G1')?.message).toMatch(/gate G2/);
    expect(gateDecisionIssue(null, 'G1')?.message).toMatch(/No approved governance decision/);
  });
  it('assertGateDecisionAllowed re-evaluates readiness and the decision at decision time', () => {
    const args = { gateKey: 'G1', outcome: 'approve' as const, decision: base, decisionIdsUsedByPriorCycles: [], note: 'ok' };
    expect(() => assertGateDecisionAllowed({ ...args, evaluation: readyEval() })).not.toThrow();
    expect(() => assertGateDecisionAllowed({ ...args, evaluation: evaluateGate({ criteria: [crit({})], prerequisites: [] }) })).toThrow(/not ready/);
    expect(() => assertGateDecisionAllowed({ ...args, evaluation: readyEval(), decision: { ...base, status: 'recommended' } })).toThrow(/pending the external authority/);
    expect(() => assertGateDecisionAllowed({ ...args, evaluation: readyEval(), decision: null })).toThrow(/No approved governance decision/);
    expect(() => assertGateDecisionAllowed({ ...args, evaluation: readyEval(), decisionIdsUsedByPriorCycles: ['d1'] })).toThrow(/fresh decision/);
  });
  it('exceptions: approve_with_exceptions only with waivers; plain approve not when waivers exist', () => {
    const args = { gateKey: 'G1', decision: base, decisionIdsUsedByPriorCycles: [], note: 'ok' };
    expect(() => assertGateDecisionAllowed({ ...args, outcome: 'approve_with_exceptions', evaluation: readyEval() })).toThrow(/at least one approved waiver/);
    expect(() => assertGateDecisionAllowed({ ...args, outcome: 'approve', evaluation: readyEval({ hasWaivers: true }) })).toThrow(/approved with exceptions/);
    expect(() => assertGateDecisionAllowed({ ...args, outcome: 'approve_with_exceptions', evaluation: readyEval({ hasWaivers: true }) })).not.toThrow();
  });
  it('rejection needs a reason but no readiness', () => {
    const e = evaluateGate({ criteria: [crit({})], prerequisites: [] });
    expect(() => assertGateDecisionAllowed({ gateKey: 'G1', outcome: 'reject', evaluation: e, decision: null, decisionIdsUsedByPriorCycles: [], note: ' ' })).toThrow(/reason/);
    expect(() => assertGateDecisionAllowed({ gateKey: 'G1', outcome: 'reject', evaluation: e, decision: null, decisionIdsUsedByPriorCycles: [], note: 'Evidence insufficient' })).not.toThrow();
  });
});

describe('criterion editing and reassessment [REQ-LCY-015]', () => {
  it('criteria are editable only while the cycle is being assessed', () => {
    expect(() => assertCriterionEditable('G1', 'in_assessment')).not.toThrow();
    expect(() => assertCriterionEditable('G1', 'reopened')).not.toThrow();
    expect(() => assertCriterionEditable('G1', 'ready_for_decision')).toThrow(/back to assessment/);
    expect(() => assertCriterionEditable('G1', 'approved')).toThrow(/controlled reopen/);
  });
  it('a new cycle carries states forward, marks conflicts and resets named criteria', () => {
    const out = carryForwardCriteria(
      [
        { criterionId: 'a', status: 'met', waiverId: null },
        { criterionId: 'b', status: 'met', waiverId: null },
        { criterionId: 'c', status: 'waived', waiverId: 'w1' },
        { criterionId: 'd', status: 'conflicting', waiverId: null },
        { criterionId: 'e', status: 'met', waiverId: null },
      ],
      { conflictingCriterionIds: new Set(['b']), resetCriterionIds: new Set(['e']) },
    );
    expect(out.map((o) => `${o.criterionId}:${o.status}`)).toEqual(['a:met', 'b:conflicting', 'c:waived', 'd:unmet', 'e:unmet']);
    expect(out.find((o) => o.criterionId === 'c')!.waiverId).toBe('w1');
  });
});

describe('gate RAG and waivers [REQ-LCY-012, REQ-LCY-013]', () => {
  it('RAG is red for unmet blocking criteria, conflicts or a flagged approval — never from task progress', () => {
    const blocked = evaluateGate({ criteria: [crit({})], prerequisites: [] });
    expect(gateRag('in_assessment', blocked, false)).toBe('red');
    expect(gateRag('approved', readyEval(), false)).toBe('green');
    expect(gateRag('approved', readyEval(), true)).toBe('red');
    const amber = evaluateGate({ criteria: [crit({ blocking: false })], prerequisites: [] });
    expect(gateRag('in_assessment', amber, false)).toBe('amber');
  });
  it('a waiver is effective only when approved and not expired', () => {
    expect(waiverIsEffective({ status: 'approved', expiresOn: null }, '2026-10-01')).toBe(true);
    expect(waiverIsEffective({ status: 'approved', expiresOn: '2026-09-30' }, '2026-10-01')).toBe(false);
    expect(waiverIsEffective({ status: 'requested', expiresOn: null }, '2026-10-01')).toBe(false);
    expect(waiverIsEffective(null, '2026-10-01')).toBe(false);
  });
  it('waivability determinations need a basis and an authority able to approve', () => {
    expect(() => assertWaivabilityDetermination({ waivable: true, waiverAuthorityRole: null, basis: 'x', authorityRoleCanApprove: false })).toThrow(/authority role/);
    expect(() => assertWaivabilityDetermination({ waivable: true, waiverAuthorityRole: 'contributor', basis: 'x', authorityRoleCanApprove: false })).toThrow(/cannot approve/);
    expect(() => assertWaivabilityDetermination({ waivable: false, waiverAuthorityRole: null, basis: ' ', authorityRoleCanApprove: false })).toThrow(/basis/);
    expect(() => assertWaivabilityDetermination({ waivable: true, waiverAuthorityRole: 'committee_chair', basis: 'Ops specialist (demo)', authorityRoleCanApprove: true })).not.toThrow();
  });
});

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
  assertWaivabilityDeterminer,
  designatedWaivabilityRole,
  decidedCriterionReassessment,
  evidenceRejectedSinceAcceptance,
  gateApprovalDecisionIssue,
  gateAuthorityOf,
  gateDecisionTypeIssue,
  CriterionState,
  GateDecisionAuthority,
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
  // DOM-P2-01: a decision backs a gate only when raised for it, of a type the deciding committee's matrix assigns to it.
  const op: GateDecisionAuthority = { matrixVersionId: 'm1', decisionType: { key: 'gate_decision_operational', gateKeys: ['G1', 'G2', 'G3', 'G4', 'G7'], withinCommitteeAuthority: true } };
  const g1 = { ...base, gateKey: 'G1', decisionTypeKey: 'gate_decision_operational' };
  it('assertGateDecisionAllowed re-evaluates readiness and the decision at decision time', () => {
    const args = { gateKey: 'G1', outcome: 'approve' as const, decision: g1, authority: op, decisionIdsUsedByPriorCycles: [], note: 'ok' };
    expect(() => assertGateDecisionAllowed({ ...args, evaluation: readyEval() })).not.toThrow();
    expect(() => assertGateDecisionAllowed({ ...args, evaluation: evaluateGate({ criteria: [crit({})], prerequisites: [] }) })).toThrow(/not ready/);
    expect(() => assertGateDecisionAllowed({ ...args, evaluation: readyEval(), decision: { ...g1, status: 'recommended' } })).toThrow(/pending the external authority/);
    expect(() => assertGateDecisionAllowed({ ...args, evaluation: readyEval(), decision: null })).toThrow(/No approved governance decision/);
    expect(() => assertGateDecisionAllowed({ ...args, evaluation: readyEval(), decisionIdsUsedByPriorCycles: ['d1'] })).toThrow(/fresh decision/);
  });
  it('exceptions: approve_with_exceptions only with waivers; plain approve not when waivers exist', () => {
    const args = { gateKey: 'G1', decision: g1, authority: op, decisionIdsUsedByPriorCycles: [], note: 'ok' };
    expect(() => assertGateDecisionAllowed({ ...args, outcome: 'approve_with_exceptions', evaluation: readyEval() })).toThrow(/at least one approved waiver/);
    expect(() => assertGateDecisionAllowed({ ...args, outcome: 'approve', evaluation: readyEval({ hasWaivers: true }) })).toThrow(/approved with exceptions/);
    expect(() => assertGateDecisionAllowed({ ...args, outcome: 'approve_with_exceptions', evaluation: readyEval({ hasWaivers: true }) })).not.toThrow();
  });
  it('rejection needs a reason but no readiness', () => {
    const e = evaluateGate({ criteria: [crit({})], prerequisites: [] });
    expect(() => assertGateDecisionAllowed({ gateKey: 'G1', outcome: 'reject', evaluation: e, decision: null, authority: null, decisionIdsUsedByPriorCycles: [], note: ' ' })).toThrow(/reason/);
    expect(() => assertGateDecisionAllowed({ gateKey: 'G1', outcome: 'reject', evaluation: e, decision: null, authority: null, decisionIdsUsedByPriorCycles: [], note: 'Evidence insufficient' })).not.toThrow();
  });
});

describe('DOM-P2-01 — the decision backing a gate: gate key, decision type assigned by the approved matrix, deciding body [REQ-GOV-003, REQ-GOV-022, REQ-GOV-023, AT-04]', () => {
  const approved = { id: 'd1', status: 'approved' as const, authorityOutcome: 'within_mandate' as const };
  const mandate: GateDecisionAuthority = { matrixVersionId: 'm1', decisionType: { key: 'gate_decision_mandate', gateKeys: ['G0'], withinCommitteeAuthority: false } };
  const op: GateDecisionAuthority = { matrixVersionId: 'm1', decisionType: { key: 'gate_decision_operational', gateKeys: ['G1', 'G2', 'G3', 'G4', 'G7'], withinCommitteeAuthority: true } };
  const code = (b: ReturnType<typeof gateApprovalDecisionIssue>) => b?.messageI18n[0]?.code ?? null;

  it('the operational gate decision type (G1–G4, G7) can never back G0 — the committee cannot approve its own mandate', () => {
    const d = { ...approved, gateKey: 'G0', decisionTypeKey: 'gate_decision_operational' };
    expect(code(gateApprovalDecisionIssue(d, 'G0', op))).toBe('gate.blocker.decision_type_not_for_gate');
    expect(() =>
      assertGateDecisionAllowed({ gateKey: 'G0', outcome: 'approve', evaluation: readyEval(), decision: d, authority: op, decisionIdsUsedByPriorCycles: [], note: 'x' }),
    ).toThrow(expect.objectContaining({ code: 'gates.decide.decision_not_for_gate' }));
  });
  it('a decision without a gate key (e.g. a baseline approval) backs no gate', () => {
    const d = { ...approved, gateKey: null, decisionTypeKey: 'baseline_approval' };
    const bl = gateAuthorityOf({ id: 'm1', policy: { decisionTypes: [{ key: 'baseline_approval', withinCommitteeAuthority: true }] } }, 'baseline_approval');
    expect(code(gateApprovalDecisionIssue(d, 'G1', bl))).toBe('gate.blocker.decision_no_gate');
    expect(code(gateDecisionTypeIssue(d, 'G1', op))).toBe('gate.blocker.decision_no_gate');
  });
  it('no approved matrix of the deciding committee, no / unknown decision type → blocked (fail closed)', () => {
    const d = { ...approved, gateKey: 'G1', decisionTypeKey: 'gate_decision_operational' };
    expect(code(gateApprovalDecisionIssue(d, 'G1', null))).toBe('gate.blocker.decision_no_matrix');
    expect(code(gateApprovalDecisionIssue(d, 'G1', { matrixVersionId: null, decisionType: null }))).toBe('gate.blocker.decision_no_matrix');
    expect(code(gateApprovalDecisionIssue({ ...d, decisionTypeKey: null }, 'G1', op))).toBe('gate.blocker.decision_type_missing');
    expect(code(gateApprovalDecisionIssue({ ...d, decisionTypeKey: 'invented' }, 'G1', gateAuthorityOf({ id: 'm1', policy: { decisionTypes: [] } }, 'invented')))).toBe('gate.blocker.decision_type_unknown');
    // A matrix row without gate keys (a matrix approved before gate assignments existed) approves no gate.
    const legacy = gateAuthorityOf({ id: 'm1', policy: { decisionTypes: [{ key: 'gate_decision_operational', withinCommitteeAuthority: true }] } }, 'gate_decision_operational');
    expect(legacy.decisionType?.gateKeys).toEqual([]);
    expect(code(gateApprovalDecisionIssue(d, 'G1', legacy))).toBe('gate.blocker.decision_type_not_for_gate');
    expect(gateApprovalDecisionIssue(d, 'G1', op)).toBeNull();
  });
  it('a type reserved to a higher authority backs the gate only through the recorded external approval (deciding body)', () => {
    const d = { ...approved, gateKey: 'G0', decisionTypeKey: 'gate_decision_mandate' };
    expect(code(gateApprovalDecisionIssue(d, 'G0', mandate))).toBe('gate.blocker.decision_body_not_authorized');
    expect(code(gateApprovalDecisionIssue({ ...d, status: 'recommended', authorityOutcome: 'pending_external_authority' }, 'G0', mandate))).toBe('gate.blocker.decision_recommended');
    expect(gateApprovalDecisionIssue({ ...d, authorityOutcome: 'pending_external_authority', externalAuthorityReference: 'DEMO-REF (synthetic)' }, 'G0', mandate)).toBeNull();
  });
  it('finality is reported before the type (a pending decision of the right type shows its real blocker); another gate is refused first', () => {
    expect(code(gateApprovalDecisionIssue({ ...approved, status: 'under_review', gateKey: 'G1', decisionTypeKey: 'gate_decision_operational' }, 'G1', op))).toBe('gate.blocker.decision_not_approved');
    expect(code(gateApprovalDecisionIssue({ ...approved, gateKey: 'G2', decisionTypeKey: 'gate_decision_operational' }, 'G1', op))).toBe('gate.blocker.decision_other_gate');
    expect(code(gateApprovalDecisionIssue(null, 'G1', op))).toBe('gate.blocker.no_decision');
  });
});

describe('DOM-P2-05 — evidence found defective or superseded after an approval triggers a controlled reassessment [REQ-LCY-015, REQ-DAT-014, AT-14]', () => {
  const L = (id: string, status: 'active' | 'conflicting' | 'rejected' | 'superseded', createdAtMs = 1, reviewedAtMs: number | null = null) => ({ id, status, createdAtMs, reviewedAtMs });
  it('decided cycle: conflicting → evidence_conflict; relied-upon link rejected → evidence_defective; superseded → evidence_superseded', () => {
    const met = { status: 'met' as const, evidenceRequired: true, reliedLinkIds: ['a'] };
    expect(decidedCriterionReassessment({ ...met, links: [L('a', 'active')] })).toBeNull();
    expect(decidedCriterionReassessment({ ...met, links: [L('a', 'conflicting'), L('b', 'conflicting')] })).toEqual({ reason: 'evidence_conflict', linkIds: ['a', 'b'] });
    expect(decidedCriterionReassessment({ ...met, links: [L('a', 'rejected')] })).toEqual({ reason: 'evidence_defective', linkIds: ['a'] });
    // Even when other active evidence exists, the evidence relied upon at the decision was found defective.
    expect(decidedCriterionReassessment({ ...met, links: [L('a', 'rejected'), L('c', 'active')] })).toEqual({ reason: 'evidence_defective', linkIds: ['a'] });
    expect(decidedCriterionReassessment({ ...met, links: [L('a', 'superseded'), L('c', 'active')] })).toEqual({ reason: 'evidence_superseded', linkIds: ['a'] });
    // A link rejected BEFORE the decision (not relied upon) does not flag the approval.
    expect(decidedCriterionReassessment({ ...met, links: [L('a', 'active'), L('z', 'rejected')] })).toBeNull();
  });
  it('only criteria that relied on evidence are concerned (waived / not applicable / unmet are not)', () => {
    for (const status of ['waived', 'not_applicable', 'unmet'] as const) {
      expect(decidedCriterionReassessment({ status, evidenceRequired: true, reliedLinkIds: ['a'], links: [L('a', 'rejected')] })).toBeNull();
    }
    expect(decidedCriterionReassessment({ status: 'evidence_submitted', evidenceRequired: true, reliedLinkIds: ['a'], links: [L('a', 'rejected')] })?.reason).toBe('evidence_defective');
  });
  it('cycles decided before relied-upon link ids were recorded: required evidence with no active link left is flagged', () => {
    const legacy = { status: 'met' as const, evidenceRequired: true, reliedLinkIds: null };
    expect(decidedCriterionReassessment({ ...legacy, links: [L('a', 'active'), L('b', 'rejected')] })).toBeNull();
    expect(decidedCriterionReassessment({ ...legacy, links: [L('a', 'rejected')] })).toEqual({ reason: 'evidence_defective', linkIds: ['a'] });
    expect(decidedCriterionReassessment({ ...legacy, links: [L('a', 'superseded')] })).toEqual({ reason: 'evidence_superseded', linkIds: ['a'] });
    expect(decidedCriterionReassessment({ ...legacy, evidenceRequired: false, links: [] })).toBeNull();
  });
  it('undecided cycle: a met criterion whose accepted evidence was rejected afterwards must be re-reviewed', () => {
    // accepted at t=10; link a (added t=1) rejected at t=20 → relied upon and now defective
    expect(evidenceRejectedSinceAcceptance({ status: 'met', assessedAtMs: 10, links: [L('a', 'rejected', 1, 20)] })).toEqual(['a']);
    // rejected before the acceptance (t=5): the reviewer did not rely on it
    expect(evidenceRejectedSinceAcceptance({ status: 'met', assessedAtMs: 10, links: [L('a', 'rejected', 1, 5)] })).toEqual([]);
    // added after the acceptance: not relied upon
    expect(evidenceRejectedSinceAcceptance({ status: 'met', assessedAtMs: 10, links: [L('a', 'rejected', 15, 20)] })).toEqual([]);
    expect(evidenceRejectedSinceAcceptance({ status: 'evidence_submitted', assessedAtMs: 10, links: [L('a', 'rejected', 1, 20)] })).toEqual([]);
  });
});

describe('DOM-P2-15 — waivability is determined by the designated specialist while the cycle is being assessed [REQ-LCY-005]', () => {
  const specialists = ['functional_approver', 'finance_restricted', 'legal_restricted'];
  it('the designated specialist is the criterion reviewer role when it is a specialist, otherwise the functional approver', () => {
    expect(designatedWaivabilityRole('finance_restricted', specialists)).toBe('finance_restricted');
    expect(designatedWaivabilityRole('legal_restricted', specialists)).toBe('legal_restricted');
    expect(designatedWaivabilityRole('secretary_cpmo', specialists)).toBe('functional_approver');
  });
  it('another specialist is refused (403); a ready or decided gate is refused (422)', () => {
    const ok = { criterionKey: 'G5-C01', designatedRole: 'finance_restricted', actorRoles: ['finance_restricted'], gateKey: 'G5', gateStatus: 'in_assessment' as const };
    expect(() => assertWaivabilityDeterminer(ok)).not.toThrow();
    expect(() => assertWaivabilityDeterminer({ ...ok, actorRoles: ['legal_restricted', 'functional_approver'] })).toThrow(
      expect.objectContaining({ kind: 'forbidden', code: 'gates.waivability.not_designated_specialist' }),
    );
    for (const gateStatus of ['ready_for_decision', 'approved', 'approved_with_exceptions', 'rejected'] as const) {
      expect(() => assertWaivabilityDeterminer({ ...ok, gateStatus })).toThrow(expect.objectContaining({ code: 'gates.assessment.not_editable' }));
    }
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

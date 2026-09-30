import { describe, expect, it } from 'vitest';
import { DomainError } from './errors';
import {
  CP_LONG_STOP_EXTENSION_DECISION_TYPE_KEYS,
  CP_LONG_STOP_WARN_DAYS,
  SIGNING_GATE_KEY,
  assertCpDatesEditable,
  assertCpLongStopExtension,
  assertCpWaivabilityDetermination,
  assertDdEvidencePinned,
  assertG7Passed,
  assertProgramClosureAllowed,
  assertSigningGatePassed,
  assessCpLongStop,
  type GateCycleState,
  type LinkedDecisionState,
} from './jv';
import { computeStatusDimensions, DIMENSION_MESSAGES_EN, type DimensionInput } from './carveout';
import { BENEFIT_MACHINE, assertBenefitDefinitionEditable, assertReconcilable } from './finance';
import { CONDITION_MACHINE, transition } from './workflows';
import { renderMessagesEn } from './messages';

/**
 * Unit tests of the P4 domain-review fixes (docs/reviews/P4-domain-review.md): DOM-P4-02 (signing after G5), -03 (CP
 * blocking status), -04 (CP validity / long-stop), -05 (DD evidence pinned), -10 (jv_transaction states), -11 (G7 under
 * reassessment), -12 (benefit re-acceptance), -16 (reconciliation separation of duties).
 */
const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (e instanceof DomainError) return e.code;
    throw e;
  }
  return 'no error';
};

const approvedG5: GateCycleState = { assessmentId: 'a1', status: 'approved', underReassessment: false, decisionId: 'd-g5' };

describe('DOM-P4-02 — a signing needs the approved G5 cycle and its decision [REQ-LCY-009]', () => {
  it('refuses while G5 is not assessed, in assessment, ready or rejected', () => {
    expect(SIGNING_GATE_KEY).toBe('G5');
    expect(code(() => assertSigningGatePassed({ gate: null, decisionId: 'd-g5' }))).toBe('jv.signing.g5_not_passed');
    for (const status of ['not_started', 'in_assessment', 'ready_for_decision', 'rejected', 'reopened'] as const) {
      expect(code(() => assertSigningGatePassed({ gate: { ...approvedG5, status }, decisionId: 'd-g5' })), status).toBe('jv.signing.g5_not_passed');
    }
  });
  it('refuses an approval flagged for controlled reassessment', () => {
    expect(code(() => assertSigningGatePassed({ gate: { ...approvedG5, underReassessment: true }, decisionId: 'd-g5' }))).toBe('jv.signing.g5_under_reassessment');
  });
  it('refuses any decision other than the one that approved the current G5 cycle', () => {
    expect(code(() => assertSigningGatePassed({ gate: approvedG5, decisionId: 'd-other' }))).toBe('jv.signing.decision_not_g5');
    expect(code(() => assertSigningGatePassed({ gate: approvedG5, decisionId: null }))).toBe('jv.signing.decision_not_g5');
    expect(code(() => assertSigningGatePassed({ gate: { ...approvedG5, decisionId: null }, decisionId: 'd-g5' }))).toBe('jv.signing.decision_not_g5');
  });
  it('accepts the approved (or approved with exceptions) G5 cycle on its own decision', () => {
    expect(code(() => assertSigningGatePassed({ gate: approvedG5, decisionId: 'd-g5' }))).toBe('no error');
    expect(code(() => assertSigningGatePassed({ gate: { ...approvedG5, status: 'approved_with_exceptions' }, decisionId: 'd-g5' }))).toBe('no error');
  });
});

describe('DOM-P4-03 — a determination never releases a blocking CP [REQ-JV-013, AT-13]', () => {
  const base = { waivable: false, waiverAuthorityRole: null, basis: 'Specialist basis (synthetic)' };
  it('non-waivable blocking CP: blocking → non-blocking is refused', () => {
    expect(code(() => assertCpWaivabilityDetermination({ ...base, blocking: false, current: { blocking: true, waivable: false } }))).toBe('jv.cp.blocking_release_not_allowed');
  });
  it('waivable blocking CP: released only through the waiver register', () => {
    expect(code(() => assertCpWaivabilityDetermination({ waivable: true, waiverAuthorityRole: 'sponsor', basis: 'x', blocking: false, current: { blocking: true, waivable: true } }))).toBe('jv.cp.blocking_release_not_allowed');
  });
  it('raising or keeping the blocking status, and the existing rules, still hold', () => {
    expect(code(() => assertCpWaivabilityDetermination({ ...base, blocking: true, current: { blocking: false, waivable: false } }))).toBe('no error');
    expect(code(() => assertCpWaivabilityDetermination({ ...base, blocking: true, current: { blocking: true, waivable: false } }))).toBe('no error');
    expect(code(() => assertCpWaivabilityDetermination({ ...base, blocking: false, current: { blocking: false, waivable: false } }))).toBe('no error');
    expect(code(() => assertCpWaivabilityDetermination({ ...base, basis: ' ', blocking: false, current: { blocking: true, waivable: false } }))).toBe('jv.cp.waivability_basis_required');
    expect(code(() => assertCpWaivabilityDetermination({ waivable: true, waiverAuthorityRole: null, basis: 'x' }))).toBe('jv.cp.waiver_authority_required');
  });
});

describe('DOM-P4-04 — CP validity and long-stop dates [REQ-JV-013, REQ-JV-018]', () => {
  const dates = { validTo: '2026-09-29', longStopDate: '2026-12-31' };
  it('the validity of a verified or waived CP changes only after it is reopened', () => {
    for (const status of ['verified', 'waived'] as const) {
      expect(code(() => assertCpDatesEditable({ status, current: dates, next: { validTo: '2026-12-01' } })), status).toBe('jv.cp.validity_locked');
      expect(code(() => assertCpDatesEditable({ status, current: dates, next: { validTo: null } })), status).toBe('jv.cp.validity_locked');
      expect(code(() => assertCpDatesEditable({ status, current: dates, next: { validTo: dates.validTo } })), status).toBe('no error');
    }
    for (const status of ['open', 'evidence_submitted', 'lapsed'] as const) expect(code(() => assertCpDatesEditable({ status, current: dates, next: { validTo: '2026-12-01' } })), status).toBe('no error');
  });
  it('a long-stop date is set freely and may be brought forward; later, cleared or on a lapsed CP needs an approved extension', () => {
    expect(code(() => assertCpDatesEditable({ status: 'open', current: { ...dates, longStopDate: null }, next: { longStopDate: '2027-01-31' } }))).toBe('no error');
    expect(code(() => assertCpDatesEditable({ status: 'open', current: dates, next: { longStopDate: '2026-11-30' } }))).toBe('no error');
    expect(code(() => assertCpDatesEditable({ status: 'open', current: dates, next: { longStopDate: '2027-01-31' } }))).toBe('jv.cp.long_stop_extension_required');
    expect(code(() => assertCpDatesEditable({ status: 'verified', current: dates, next: { longStopDate: null } }))).toBe('jv.cp.long_stop_extension_required');
    expect(code(() => assertCpDatesEditable({ status: 'lapsed', current: dates, next: { longStopDate: '2026-11-30' } }))).toBe('jv.cp.long_stop_extension_required');
  });
  const finalClosingDecision: LinkedDecisionState = { status: 'approved', authorityOutcome: 'pending_external_authority', externalAuthorityReference: 'Board resolution (synthetic)', decisionTypeKey: 'jv_closing_confirmation' };
  const ext = { status: 'lapsed' as const, currentLongStop: '2026-09-01', newLongStop: '2026-12-31', today: '2026-09-30', decisionId: 'd1', decision: finalClosingDecision, previousExtensionDecisionId: null };
  it('an extension needs a later, current date and a FINAL decision of the proposed type, not reused', () => {
    expect(CP_LONG_STOP_EXTENSION_DECISION_TYPE_KEYS).toEqual(['jv_closing_confirmation']);
    expect(code(() => assertCpLongStopExtension(ext))).toBe('no error');
    expect(code(() => assertCpLongStopExtension({ ...ext, status: 'open' }))).toBe('no error');
    expect(code(() => assertCpLongStopExtension({ ...ext, status: 'verified' }))).toBe('jv.cp.extension_invalid_state');
    expect(code(() => assertCpLongStopExtension({ ...ext, currentLongStop: null }))).toBe('jv.cp.extension_no_long_stop');
    expect(code(() => assertCpLongStopExtension({ ...ext, newLongStop: '2026-08-31' }))).toBe('jv.cp.extension_date_invalid');
    expect(code(() => assertCpLongStopExtension({ ...ext, newLongStop: '2026-09-15' }))).toBe('jv.cp.extension_date_invalid'); // later but in the past
    expect(code(() => assertCpLongStopExtension({ ...ext, decision: { ...finalClosingDecision, status: 'recommended' } }))).toBe('jv.cp.extension_decision_not_final');
    expect(code(() => assertCpLongStopExtension({ ...ext, decision: { ...finalClosingDecision, decisionTypeKey: 'partner_outreach_and_access' } }))).toBe('jv.cp.extension_decision_not_final');
    expect(code(() => assertCpLongStopExtension({ ...ext, decision: null }))).toBe('jv.cp.extension_decision_not_final');
    expect(code(() => assertCpLongStopExtension({ ...ext, previousExtensionDecisionId: 'd1' }))).toBe('jv.cp.extension_decision_already_used');
  });
  it('a lapsed CP reopens only through the extension command', () => {
    expect(transition('closing_condition', CONDITION_MACHINE, 'lapsed', 'extend_long_stop')).toBe('open');
    expect(() => transition('closing_condition', CONDITION_MACHINE, 'lapsed', 'reopen')).toThrow();
    expect(() => transition('closing_condition', CONDITION_MACHINE, 'lapsed', 'verify')).toThrow();
    expect(() => transition('closing_condition', CONDITION_MACHINE, 'lapsed', 'waive')).toThrow();
  });
  it('long-stop scan: lapse past the date, escalate an open CP without evidence inside the (proposed) window', () => {
    expect(CP_LONG_STOP_WARN_DAYS).toBe(30);
    const today = '2026-09-30';
    expect(assessCpLongStop({ status: 'open', longStopDate: '2026-09-29', activeEvidence: 1, today })).toEqual({ action: 'mark_lapsed', daysPast: 1 });
    expect(assessCpLongStop({ status: 'evidence_submitted', longStopDate: '2026-09-20', activeEvidence: 1, today })).toEqual({ action: 'mark_lapsed', daysPast: 10 });
    expect(assessCpLongStop({ status: 'open', longStopDate: '2026-09-30', activeEvidence: 0, today })).toEqual({ action: 'escalate_approaching', daysLeft: 0 });
    expect(assessCpLongStop({ status: 'open', longStopDate: '2026-10-30', activeEvidence: 0, today })).toEqual({ action: 'escalate_approaching', daysLeft: 30 });
    expect(assessCpLongStop({ status: 'open', longStopDate: '2026-10-31', activeEvidence: 0, today })).toEqual({ action: 'none' });
    expect(assessCpLongStop({ status: 'open', longStopDate: '2026-10-10', activeEvidence: 1, today })).toEqual({ action: 'none' });
    expect(assessCpLongStop({ status: 'evidence_submitted', longStopDate: '2026-10-10', activeEvidence: 1, today })).toEqual({ action: 'none' });
    for (const status of ['verified', 'waived', 'failed'] as const) expect(assessCpLongStop({ status, longStopDate: '2026-09-01', activeEvidence: 0, today })).toEqual({ action: 'none' });
    expect(assessCpLongStop({ status: 'lapsed', longStopDate: '2026-09-01', activeEvidence: 0, today })).toEqual({ action: 'ensure_escalation', daysPast: 29 });
    expect(assessCpLongStop({ status: 'open', longStopDate: null, activeEvidence: 0, today })).toEqual({ action: 'none' });
  });
});

describe('DOM-P4-05 — DD evidence pinned at submission [REQ-JV-010]', () => {
  const pinned = [{ documentId: 'doc1', versionId: 'v1' }];
  it('every evidence document needs its pinned version; a newer current version refuses the review', () => {
    expect(code(() => assertDdEvidencePinned({ evidenceDocumentIds: ['doc1'], pinned }))).toBe('no error');
    expect(code(() => assertDdEvidencePinned({ evidenceDocumentIds: ['doc1'], pinned, currentVersionByDocument: { doc1: 'v1' } }))).toBe('no error');
    expect(code(() => assertDdEvidencePinned({ evidenceDocumentIds: ['doc1'], pinned, currentVersionByDocument: { doc1: 'v2' } }))).toBe('jv.dd.evidence_changed');
    expect(code(() => assertDdEvidencePinned({ evidenceDocumentIds: ['doc1', 'doc2'], pinned }))).toBe('jv.dd.evidence_not_pinned');
    expect(code(() => assertDdEvidencePinned({ evidenceDocumentIds: [], pinned: [] }))).toBe('no error');
  });
});

describe('DOM-P4-10 — jv_transaction states as documented (business-gates.md §1) [REQ-LCY-007, REQ-LCY-009]', () => {
  const base: DimensionInput = { newcoIncorporation: null, perimeter: [], readiness: [], standaloneAccepted: false, closings: [] };
  const jv = (over: Partial<DimensionInput>) => computeStatusDimensions({ ...base, ...over }).find((d) => d.key === 'jv_transaction')!;
  it('walks the documented states', () => {
    expect(jv({}).state).toBe('not_started');
    expect(jv({ partners: [{ stage: 'nda' }] }).state).toBe('partner_preparation');
    expect(jv({ partners: [{ stage: 'dd' }] }).state).toBe('diligence_and_negotiation');
    expect(jv({ partners: [{ stage: 'materials_access' }], closings: [{ kind: 'signing', status: 'in_preparation' }] }).state).toBe('diligence_and_negotiation');
    expect(jv({ partners: [{ stage: 'negotiation' }], signingGatePassed: true }).state).toBe('signing_ready');
    expect(jv({ closings: [{ kind: 'signing', status: 'confirmed' }, { kind: 'closing', status: 'planned' }] }).state).toBe('signed');
    expect(jv({ closings: [{ kind: 'signing', status: 'confirmed' }, { kind: 'closing', status: 'in_preparation' }] }).state).toBe('closing_conditions_in_progress');
    expect(jv({ closings: [{ kind: 'signing', status: 'confirmed' }, { kind: 'closing', status: 'confirmed' }, { kind: 'closing', status: 'planned' }] }).state).toBe('partially_closed');
    expect(jv({ closings: [{ kind: 'signing', status: 'confirmed' }, { kind: 'closing', status: 'confirmed' }] }).state).toBe('closed');
  });
  it('aborted events are not counted (one confirmed + one aborted closing is closed) and are disclosed', () => {
    const d = jv({ closings: [{ kind: 'signing', status: 'confirmed' }, { kind: 'closing', status: 'confirmed' }, { kind: 'closing', status: 'aborted' }] });
    expect(d.state).toBe('closed');
    expect(d.explanationI18n).toEqual([
      { code: 'dimension.jv.closed', params: { closings: 1 } },
      { code: 'dimension.jv.aborted_excluded', params: { aborted: 1 } },
    ]);
    expect(d.explanation).toBe(renderMessagesEn(d.explanationI18n, DIMENSION_MESSAGES_EN));
  });
  it('terminated when every partner withdrew and every event was aborted', () => {
    expect(jv({ partners: [{ stage: 'withdrawn' }] }).state).toBe('terminated');
    expect(jv({ partners: [{ stage: 'withdrawn' }], closings: [{ kind: 'signing', status: 'aborted' }] }).state).toBe('terminated');
    expect(jv({ partners: [{ stage: 'withdrawn' }, { stage: 'nda' }] }).state).toBe('partner_preparation');
    expect(jv({ closings: [{ kind: 'signing', status: 'confirmed' }, { kind: 'closing', status: 'aborted' }] }).state).toBe('signed');
  });
  it('a G5 flag does not override a recorded signing', () => {
    expect(jv({ signingGatePassed: true, closings: [{ kind: 'signing', status: 'confirmed' }] }).state).toBe('signed');
  });
});

describe('DOM-P4-11 — program closure respects a G7 approval flagged for reassessment [REQ-JV-019]', () => {
  it('refuses a flagged approval', () => {
    expect(code(() => assertG7Passed('approved'))).toBe('no error');
    expect(code(() => assertG7Passed('approved', true))).toBe('jv.program_closure.g7_under_reassessment');
    expect(code(() => assertG7Passed('in_assessment', true))).toBe('jv.program_closure.g7_not_passed');
    expect(code(() => assertProgramClosureAllowed({ g7Status: 'approved', g7UnderReassessment: true, confirmerUserId: 'b', requesterUserId: 'a' }))).toBe('jv.program_closure.g7_under_reassessment');
    expect(code(() => assertProgramClosureAllowed({ g7Status: 'approved', confirmerUserId: 'b', requesterUserId: 'a' }))).toBe('no error');
  });
});

describe('DOM-P4-12 — benefit definition, baseline and target need re-acceptance [REQ-FIN-009]', () => {
  it('accepted fields are locked after acceptance; other fields stay editable', () => {
    for (const status of ['approved', 'tracking'] as const) {
      for (const f of ['measurementDefinition', 'baselineValue', 'targetValue', 'unit', 'valueAmount']) expect(code(() => assertBenefitDefinitionEditable(status, [f])), `${status}:${f}`).toBe('finance.benefit.accepted_definition_locked');
      expect(code(() => assertBenefitDefinitionEditable(status, ['title', 'realizationDate', 'ownerUserId']))).toBe('no error');
    }
    expect(code(() => assertBenefitDefinitionEditable('realized_unverified', ['targetValue']))).toBe('finance.benefit.realization_pending');
    expect(code(() => assertBenefitDefinitionEditable('proposed', ['targetValue', 'measurementDefinition']))).toBe('no error');
  });
  it('revision returns the benefit to proposed (fresh acceptance)', () => {
    expect(transition('benefit', BENEFIT_MACHINE, 'approved', 'revise_definition')).toBe('proposed');
    expect(transition('benefit', BENEFIT_MACHINE, 'tracking', 'revise_definition')).toBe('proposed');
    expect(() => transition('benefit', BENEFIT_MACHINE, 'realized_unverified', 'revise_definition')).toThrow();
    expect(() => transition('benefit', BENEFIT_MACHINE, 'realized_verified', 'revise_definition')).toThrow();
  });
});

describe('DOM-P4-16 — reconciliation review is independent of the creator and the last preparer [REQ-FIN-004]', () => {
  const m = (amount: string) => ({ amount, currency: 'SAR', unitScale: 1 as const });
  const base = { our: m('1000'), their: m('1000'), status: 'open' as const, explanation: null, preparedBy: 'editor', createdBy: 'creator' };
  it('refuses the creator, the last preparer; accepts a third person', () => {
    expect(code(() => assertReconcilable(base, { kind: 'user', userId: 'creator' }))).toBe('finance.recon.self');
    expect(code(() => assertReconcilable(base, { kind: 'user', userId: 'editor' }))).toBe('finance.recon.self');
    expect(code(() => assertReconcilable(base, { kind: 'user', userId: 'reviewer' }))).toBe('no error');
  });
});

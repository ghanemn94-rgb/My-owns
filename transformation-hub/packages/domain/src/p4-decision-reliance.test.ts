import { describe, expect, it } from 'vitest';
import { DECISION_USE_KINDS, DECISION_USE_SUBJECT_TYPE, decisionRelianceIssue, type DecisionRelianceInput } from './decision-reliance';
import { assertBudgetApprovalWithinDecision } from './finance';
import { JV_DECISION_ISSUE_CODES } from './jv';
import { LINKED_DECISION_ISSUE_CODES } from './readiness';

/**
 * P4 domain review, part 2 (docs/reviews/P4-domain-review.md): DOM-P4-01 (one closing-confirmation decision per closing),
 * DOM-P4-06 (one valuation decision per model version), DOM-P4-07 (one budget decision per budget line, within its STATED
 * amount), DOM-P4-08 (external-approval evidence re-checked wherever JV and finance rely on a decision). Synthetic values.
 */

const VERIFIED = { linkId: 'l1', status: 'active', verified: true };
const closingDecision = {
  id: 'd1',
  code: 'DEC-101',
  status: 'approved',
  authorityOutcome: 'pending_external_authority',
  externalAuthorityReference: 'DEMO-BOARD-RESOLUTION (synthetic)',
  decisionTypeKey: 'jv_closing_confirmation',
  subjectType: null,
  subjectId: null,
  externalEvidence: VERIFIED,
};
const closingRule = (over: Partial<DecisionRelianceInput> = {}): DecisionRelianceInput => ({
  decision: closingDecision,
  use: { kind: 'closing', subjectType: 'closing', subjectId: 'clo2' },
  uses: [],
  subjectRule: 'if_set',
  decisionTypeKeys: ['jv_closing_confirmation'],
  codePrefix: 'jv.closing',
  ...over,
});
const code = (i: DecisionRelianceInput) => decisionRelianceIssue(i)?.code ?? null;

describe('DOM-P4-01 / -06 / -07 — the decision-use registry covers closings, valuation versions and budget lines', () => {
  it('registers the P4 kinds with the record type they back; a signing is not a kind (it relies on the G5 cycle use)', () => {
    expect(DECISION_USE_KINDS).toEqual(expect.arrayContaining(['closing', 'financial_model_version', 'budget_line']));
    expect(DECISION_USE_SUBJECT_TYPE.closing).toBe('closing');
    expect(DECISION_USE_SUBJECT_TYPE.financial_model_version).toBe('financial_model_version');
    expect(DECISION_USE_SUBJECT_TYPE.budget_line).toBe('budget_line');
    expect(DECISION_USE_KINDS as readonly string[]).not.toContain('signing');
  });

  it('DOM-P4-01: a closing-confirmation decision that confirmed closing #1 is refused for closing #2; the gate-cycle use of a G6 paper does not block', () => {
    expect(code(closingRule())).toBeNull();
    expect(code(closingRule({ uses: [{ kind: 'closing', subjectType: 'closing', subjectId: 'clo1' }] }))).toBe('jv.closing.decision_already_used');
    // Re-evaluating the same closing (its own use) is not a reuse.
    expect(code(closingRule({ uses: [{ kind: 'closing', subjectType: 'closing', subjectId: 'clo2' }] }))).toBeNull();
    // A decision may back a gate cycle AND one closing (different kinds).
    expect(code(closingRule({ uses: [{ kind: 'gate_cycle', subjectType: 'gate_assessment', subjectId: 'g6c1' }] }))).toBeNull();
    // if_set: a decision raised for another record never confirms this closing.
    expect(code(closingRule({ decision: { ...closingDecision, subjectType: 'change_request', subjectId: 'cr1' } }))).toBe('jv.closing.decision_other_subject');
  });

  it('DOM-P4-06: the valuation decision that approved v1 is refused for v2', () => {
    const v = (uses: DecisionRelianceInput['uses']) =>
      code({
        decision: { ...closingDecision, decisionTypeKey: 'valuation_and_ownership_terms' },
        use: { kind: 'financial_model_version', subjectType: 'financial_model_version', subjectId: 'v2' },
        uses,
        subjectRule: 'if_set',
        decisionTypeKeys: ['valuation_and_ownership_terms'],
        codePrefix: 'finance.model',
      });
    expect(v([])).toBeNull();
    expect(v([{ kind: 'financial_model_version', subjectType: 'financial_model_version', subjectId: 'v1' }])).toBe('finance.model.decision_already_used');
  });

  it('DOM-P4-07: a budget decision recorded on line A is refused for line B, whatever record the paper was raised for (subject rule none)', () => {
    const b = (uses: DecisionRelianceInput['uses']) =>
      code({
        decision: { ...closingDecision, decisionTypeKey: 'change_request_budget', subjectType: 'change_request', subjectId: 'cr1' },
        use: { kind: 'budget_line', subjectType: 'budget_line', subjectId: 'lineB' },
        uses,
        subjectRule: 'none',
        decisionTypeKeys: ['baseline_approval', 'change_request_budget', 'separation_spend_commitment'],
        codePrefix: 'finance.budget',
      });
    // The change request it approved is a use of another kind: the budget line may record the amount of that approval once.
    expect(b([{ kind: 'change_request', subjectType: 'change_request', subjectId: 'cr1' }])).toBeNull();
    expect(b([{ kind: 'budget_line', subjectType: 'budget_line', subjectId: 'lineA' }])).toBe('finance.budget.decision_already_used');
  });
});

describe('DOM-P4-08 — external-approval evidence re-checked wherever JV and finance rely on a decision', () => {
  it('rejected / superseded / conflicting / unverified / missing evidence refuses the reliance with the caller prefix', () => {
    for (const ev of [
      { linkId: 'l1', status: 'rejected', verified: true },
      { linkId: 'l1', status: 'superseded', verified: true },
      { linkId: 'l1', status: 'conflicting', verified: true },
      { linkId: 'l1', status: 'active', verified: false },
      null,
    ]) {
      expect(code(closingRule({ decision: { ...closingDecision, externalEvidence: ev } }))).toBe('jv.closing.decision_evidence_invalid');
      expect(code(closingRule({ decision: { ...closingDecision, externalEvidence: ev }, use: { kind: null, subjectType: 'closing', subjectId: 'sig1' }, subjectRule: 'none', codePrefix: 'jv.signing' }))).toBe(
        'jv.signing.decision_evidence_invalid',
      );
    }
    // Within the committee mandate: no external approval, nothing to evidence.
    expect(code(closingRule({ decision: { ...closingDecision, authorityOutcome: 'within_mandate', externalAuthorityReference: null, externalEvidence: null } }))).toBeNull();
  });

  it('linking before finality (requireFinal false): a pending decision passes, but a used one or one on rejected evidence does not', () => {
    const pending = { ...closingDecision, status: 'under_review', authorityOutcome: 'pending', externalAuthorityReference: null, externalEvidence: null };
    expect(code(closingRule({ decision: pending }))).toBe('jv.closing.decision_not_final');
    expect(code(closingRule({ decision: pending, requireFinal: false }))).toBeNull();
    expect(code(closingRule({ decision: pending, requireFinal: false, uses: [{ kind: 'closing', subjectType: 'closing', subjectId: 'clo1' }] }))).toBe('jv.closing.decision_already_used');
    expect(code(closingRule({ decision: { ...closingDecision, externalEvidence: { linkId: 'l1', status: 'rejected', verified: true } }, requireFinal: false }))).toBe('jv.closing.decision_evidence_invalid');
  });

  it('the JV decision issue codes extend the linked-decision codes (the web translates every one)', () => {
    for (const c of LINKED_DECISION_ISSUE_CODES) expect(JV_DECISION_ISSUE_CODES as readonly string[]).toContain(c);
    expect(JV_DECISION_ISSUE_CODES).toEqual(expect.arrayContaining(['evidence_invalid', 'already_used', 'other_subject']));
  });
});

describe('DOM-P4-07 — a budget approval stays within the amount its decision STATES (fail closed) [REQ-FIN-003]', () => {
  const sar = (amount: string, unitScale = 1) => ({ amount, currency: 'SAR', unitScale });
  const check = (decisionAmount: ReturnType<typeof sar> | { amount: string; currency: string; unitScale: number } | null, approved: ReturnType<typeof sar>) => {
    try {
      assertBudgetApprovalWithinDecision({ decisionCode: 'DEC-7', decisionAmount, approved });
      return null;
    } catch (e) {
      return (e as { code: string }).code;
    }
  };

  it('a decision without a stated amount sets no limit, so it backs no (non-zero) approval', () => {
    expect(check(null, sar('1'))).toBe('finance.budget.decision_amount_missing');
    expect(check(null, sar('100000'))).toBe('finance.budget.decision_amount_missing');
    // Nothing is approved beyond zero (as change control: no monetary impact needs no decision amount).
    expect(check(null, sar('0'))).toBeNull();
  });

  it('same currency AND unit scale (no conversion, AT-29), within the amount', () => {
    expect(check(sar('100000'), sar('100000'))).toBeNull();
    expect(check(sar('100000'), sar('99999.9999'))).toBeNull();
    expect(check(sar('100000'), sar('100000.0001'))).toBe('finance.budget.exceeds_decision');
    expect(check({ amount: '100000', currency: 'USD', unitScale: 1 }, sar('10'))).toBe('finance.budget.decision_unit_mismatch');
    expect(check(sar('100000'), sar('100', 1000))).toBe('finance.budget.decision_unit_mismatch');
  });
});

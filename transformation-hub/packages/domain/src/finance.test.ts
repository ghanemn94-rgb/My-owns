import { describe, expect, it } from 'vitest';
import {
  aggregateFigures,
  applyAssumptionChanges,
  assertBenefitVerifiable,
  assertFigureApprovable,
  assertFigureValidatable,
  assertLineConsistency,
  assertNotDeclassified,
  assertOutputs,
  assertRealizationRecordable,
  assertReconcilable,
  assertSnapshotSource,
  assertTsaLink,
  budgetPosition,
  compareOutputs,
  financeDomainClearance,
  FINANCE_MESSAGES_EN,
  outputFindings,
  parseFinancialPeriod,
  reconciliationState,
  renderFinanceMessages,
  separationCostView,
  snapshotDoubleCountFindings,
  BENEFIT_MACHINE,
  FIGURE_APPROVAL_MACHINE,
  FigureFacts,
  ModelOutput,
} from './finance';
import { assertConversionBasis, assertSameUnit, parseMoney, subtractMoney, sumMoney, valueBasisFindings } from './money';
import { transition } from './workflows';
import { DomainError } from './errors';

const sar = (amount: string, unitScale = 1) => parseMoney({ amount, currency: 'SAR', unitScale });
const usd = (amount: string, unitScale = 1) => parseMoney({ amount, currency: 'USD', unitScale });
const basis = { from: 'USD', to: 'SAR', rate: '3.75', source: 'Test rate table (synthetic)', asOf: '2026-09-30' };

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof DomainError) return `${e.kind}:${e.code}`;
    throw e;
  }
  return 'no error';
}

describe('REQ-DAT-004 / AT-29 — aggregation never mixes currencies, units or kinds silently', () => {
  it('SAR + USD without a basis is rejected', () => {
    expect(code(() => aggregateFigures([{ kind: 'actual', money: sar('10') }, { kind: 'actual', money: usd('10') }], {}))).toBe('rule_violation:money.mixed_currency');
  });
  it('with an explicit basis the result shows the basis and its source', () => {
    const r = aggregateFigures([{ kind: 'actual', money: sar('10') }, { kind: 'actual', money: usd('10') }], { targetCurrency: 'SAR', conversions: [basis] });
    expect(r.total).toEqual({ amount: '47.5000', currency: 'SAR', unitScale: 1 });
    expect(r.basis).toEqual([{ code: 'finance.aggregate.converted', params: { from: 'USD', to: 'SAR', rate: '3.75', source: 'Test rate table (synthetic)', asOf: '2026-09-30' } }]);
    expect(r.basisText).toContain('Test rate table (synthetic)');
  });
  it('mixed unit scales are rejected unless normalization is explicit — and then disclosed', () => {
    const items = [
      { kind: 'baseline', money: sar('1.5', 1_000_000) },
      { kind: 'baseline', money: sar('500', 1000) },
    ];
    expect(code(() => aggregateFigures(items, {}))).toBe('rule_violation:money.mixed_unit_scale');
    const r = aggregateFigures(items, { targetUnitScale: 1000, normalizeUnits: true });
    expect(r.total).toEqual({ amount: '2000.0000', currency: 'SAR', unitScale: 1000 });
    expect(r.basis.map((b) => b.code)).toEqual(['finance.aggregate.units_normalized']);
  });
  it('baseline, forecast and actual are never added together', () => {
    expect(code(() => aggregateFigures([{ kind: 'baseline', money: sar('1') }, { kind: 'actual', money: sar('1') }], {}))).toBe('rule_violation:finance.aggregate.mixed_kinds');
  });
  it('a same-basis sum says so', () => {
    const r = aggregateFigures([{ kind: 'forecast', money: sar('1') }, { kind: 'forecast', money: sar('2') }], {});
    expect(r.basis).toEqual([{ code: 'finance.aggregate.same_basis', params: { count: 2, currency: 'SAR', unitScale: 1 } }]);
  });
  it('a conversion basis must name its source and date, and be positive (never invented)', () => {
    expect(code(() => assertConversionBasis({ ...basis, source: ' ' }))).toBe('invalid:money.conversion_source_required');
    expect(code(() => assertConversionBasis({ ...basis, asOf: '2026-02-30' }))).toBe('invalid:money.conversion_date_required');
    expect(code(() => assertConversionBasis({ ...basis, rate: '0' }))).toBe('invalid:money.invalid_rate');
    expect(code(() => assertConversionBasis({ ...basis, to: 'USD' }))).toBe('invalid:money.invalid_conversion');
    expect(code(() => sumMoney([sar('1'), usd('1')], { conversions: [{ ...basis, source: '' }] }))).toBe('invalid:money.conversion_source_required');
  });
  it('an empty sum needs an explicit currency (no default currency is assumed)', () => {
    expect(code(() => sumMoney([]))).toBe('invalid:money.currency_required');
    expect(sumMoney([], { targetCurrency: 'SAR' }).total.amount).toBe('0.0000');
  });
  it('amounts booked together must share currency AND unit scale', () => {
    expect(code(() => assertSameUnit(sar('1', 1000), sar('1', 1_000_000), 'Line'))).toBe('rule_violation:money.mixed_unit_scale');
    expect(code(() => assertSameUnit(sar('1'), usd('1'), 'Line'))).toBe('rule_violation:money.mixed_currency');
    expect(subtractMoney(sar('10'), sar('2.5')).amount).toBe('7.5000');
  });
});

describe('REQ-FIN-007 — EV vs equity and unit/currency confusion', () => {
  const out = (o: Partial<ModelOutput> & { key: string }): ModelOutput => ({ label: o.key, measure: 'money', amount: '100', currency: 'SAR', unitScale: 1_000_000, basis: 'other', sheet: null, cell: null, ...o });
  it('EV compared with equity value is flagged (a check, not a valuation)', () => {
    const f = outputFindings([out({ key: 'ev', basis: 'enterprise_value' }), out({ key: 'eq', basis: 'equity_value' })]);
    expect(f.map((m) => m.code)).toEqual(['finance.value.ev_equity_mix']);
    expect(renderFinanceMessages(f)).toMatch(/not a professional valuation/);
  });
  it('EV vs equity for the same key is not compared; mixed units are rejected; currencies need a basis', () => {
    const a = [out({ key: 'headline', basis: 'enterprise_value' }), out({ key: 'cash', amount: '5' }), out({ key: 'debt', amount: '7', currency: 'USD' }), out({ key: 'share', measure: 'percent', amount: '40', currency: null, unitScale: null })];
    const b = [out({ key: 'headline', basis: 'equity_value' }), out({ key: 'cash', amount: '5000', unitScale: 1000 }), out({ key: 'debt', amount: '7', currency: 'SAR' }), out({ key: 'share', measure: 'percent', amount: '35', currency: null, unitScale: null })];
    const r = compareOutputs(a, b);
    const st = Object.fromEntries(r.rows.map((x) => [x.key, [x.status, x.difference]]));
    expect(st).toEqual({ headline: ['basis_mismatch', null], cash: ['unit_mismatch', null], debt: ['currency_without_basis', null], share: ['compared', '5.0000'] });
    const withBasis = compareOutputs([out({ key: 'debt', amount: '10', currency: 'SAR' })], [out({ key: 'debt', amount: '2', currency: 'USD' })], [basis]);
    expect(withBasis.rows[0]).toMatchObject({ status: 'compared', difference: '2.5000' });
    expect(withBasis.rows[0]!.messages[0]!.code).toBe('finance.compare.converted');
  });
  it('value findings flag mixed currencies and unit scales', () => {
    const f = valueBasisFindings([
      { label: 'a', basis: 'other', money: sar('1', 1000) },
      { label: 'b', basis: 'other', money: usd('1', 1_000_000) },
    ]);
    expect(f.map((m) => m.code)).toEqual(['finance.value.currency_mix', 'finance.value.unit_mix']);
  });
  it('outputs: money needs currency + unit, percent has neither and stays within 0..100, imports keep sheet/cell', () => {
    expect(code(() => assertOutputs([out({ key: 'a', currency: null })], { requireCellReferences: false }))).toBe('invalid:finance.output.money_unit_required');
    expect(code(() => assertOutputs([out({ key: 'p', measure: 'percent', amount: '120', currency: null, unitScale: null })], { requireCellReferences: false }))).toBe('invalid:finance.output.percent_range');
    expect(code(() => assertOutputs([out({ key: 'p', measure: 'percent', amount: '50' })], { requireCellReferences: false }))).toBe('invalid:finance.output.percent_has_currency');
    expect(code(() => assertOutputs([out({ key: 'a' }), out({ key: 'a' })], { requireCellReferences: false }))).toBe('invalid:finance.output.duplicate');
    expect(code(() => assertOutputs([out({ key: 'a' })], { requireCellReferences: true }))).toBe('invalid:finance.source.cell_reference_required');
    expect(code(() => assertOutputs([out({ key: 'a', sheet: 'Valuation', cell: 'B12' })], { requireCellReferences: true }))).toBe('no error');
    expect(code(() => assertOutputs([out({ key: 'a', sheet: 'Valuation', cell: 'B 12;' })], { requireCellReferences: true }))).toBe('invalid:finance.source.invalid_cell');
  });
  it('every emitted finance code has an English template', () => {
    for (const c of ['finance.value.ev_equity_mix', 'finance.compare.basis_mismatch', 'finance.recon.unreconciled_difference', 'finance.tsa.counted_in_line']) expect(FINANCE_MESSAGES_EN[c]).toBeTruthy();
  });
});

describe('REQ-FIN-001 / REQ-FIN-008 — figures carry period, source and (for imports) the cell reference', () => {
  it('periods: accepted formats and rejects', () => {
    expect(parseFinancialPeriod('2026-Q4')).toMatchObject({ granularity: 'quarter', start: '2026-10-01', end: '2026-12-31' });
    expect(parseFinancialPeriod('2028-02')).toMatchObject({ granularity: 'month', end: '2028-02-29' });
    expect(parseFinancialPeriod('2026-H1')).toMatchObject({ granularity: 'half', end: '2026-06-30' });
    expect(parseFinancialPeriod('FY2027')).toMatchObject({ granularity: 'fiscal_year', start: null, end: null });
    for (const bad of ['2026-13', 'Q4-2026', '26', '', '2026-Q5']) expect(code(() => parseFinancialPeriod(bad)), bad).toBe('invalid:finance.period.invalid');
  });
  it('a figure without any source is rejected; an import keeps document + sheet + cell', () => {
    const base = { sourceType: 'manual_entry', sourceRef: null, sourceDocumentId: null, sourceSheet: null, sourceCell: null };
    expect(code(() => assertSnapshotSource(base))).toBe('invalid:finance.source.required');
    expect(code(() => assertSnapshotSource({ ...base, sourceRef: 'Finance memo FM-12 (synthetic)' }))).toBe('no error');
    expect(code(() => assertSnapshotSource({ ...base, sourceType: 'excel', sourceDocumentId: 'd', sourceSheet: 'P&L' }))).toBe('invalid:finance.source.cell_reference_required');
    expect(code(() => assertSnapshotSource({ ...base, sourceType: 'excel', sourceDocumentId: 'd', sourceSheet: 'P&L', sourceCell: 'C7' }))).toBe('no error');
  });
});

describe('REQ-FIN-002 — separation cost categories without double counting', () => {
  const line = (id: string, category: string, committed: string, tsaServiceId: string | null = null, approved: string | null = null) => ({
    id,
    code: id.toUpperCase(),
    category: category as never,
    approved: approved ? sar(approved) : null,
    committed: sar(committed),
    spent: sar('0'),
    tsaServiceId,
  });
  it('UT: TSA charge counted once across TSA and cost views', () => {
    const v = separationCostView([line('bl-1', 'tsa_charge', '1000', 'tsa-1'), line('bl-2', 'one_off_separation', '500', null, '800')], [
      { id: 'tsa-1', code: 'TSA-001', charge: sar('1000') },
      { id: 'tsa-2', code: 'TSA-002', charge: sar('250') },
    ]);
    const tsaGroup = v.groups.find((g) => g.category === 'tsa_charge')!;
    expect(tsaGroup.committed.amount).toBe('1000.0000'); // not 2000: the register charge is not added again
    expect(v.tsa.find((t) => t.tsaCode === 'TSA-001')).toMatchObject({ countedIn: 'budget_line', budgetLineCode: 'BL-1' });
    // A register charge without a budget line is listed but excluded from the totals.
    const t2 = v.tsa.find((t) => t.tsaCode === 'TSA-002')!;
    expect(t2.countedIn).toBe('none');
    expect(t2.messages[0]!.code).toBe('finance.tsa.not_in_cost_view');
    expect(v.groups.reduce((n, g) => n + g.lineCount, 0)).toBe(2);
  });
  it('a second line on the same TSA is excluded and flagged (defence in depth; the database prevents it)', () => {
    const v = separationCostView([line('bl-1', 'tsa_charge', '1000', 'tsa-1'), line('bl-9', 'tsa_charge', '1000', 'tsa-1')], [{ id: 'tsa-1', code: 'TSA-001', charge: sar('1000') }]);
    expect(v.groups[0]!.committed.amount).toBe('1000.0000');
    expect(v.findings.map((f) => f.code)).toEqual(['finance.double_count.tsa_multiple_lines']);
  });
  it('different currencies / unit scales are totalled separately, never mixed', () => {
    const v = separationCostView(
      [line('a', 'stranded', '1'), { ...line('b', 'stranded', '1'), committed: usd('1'), spent: usd('0') }, { ...line('c', 'stranded', '1'), committed: sar('1', 1000), spent: sar('0', 1000) }],
      [],
    );
    expect(v.groups.map((g) => `${g.currency}/${g.unitScale}:${g.committed.amount}`)).toEqual(['SAR/1:1.0000', 'SAR/1000:1.0000', 'USD/1:1.0000']);
  });
  it('TSA charge link rules and line consistency', () => {
    expect(code(() => assertTsaLink('tsa_charge', null))).toBe('rule_violation:finance.tsa_charge.link_required');
    expect(code(() => assertTsaLink('stranded', 'tsa-1'))).toBe('rule_violation:finance.tsa_charge.category_required');
    expect(code(() => assertLineConsistency({ lineRef: 'L1', category: 'stranded', tsaServiceId: null }, [{ lineRef: 'L1', category: 'one_off_separation', tsaServiceId: null }]))).toBe(
      'rule_violation:finance.double_count.category_conflict',
    );
    expect(code(() => assertLineConsistency({ lineRef: 'L2', category: 'tsa_charge', tsaServiceId: 't1' }, [{ lineRef: 'L1', category: 'tsa_charge', tsaServiceId: 't1' }]))).toBe(
      'rule_violation:finance.double_count.tsa_line_conflict',
    );
    expect(snapshotDoubleCountFindings([{ lineRef: 'X', category: 'stranded' }, { lineRef: 'X', category: 'opex' }]).map((f) => f.code)).toEqual(['finance.double_count.category_conflict']);
  });
});

describe('REQ-FIN-003 — committed vs spent tracked separately', () => {
  it('UT: committed and spent tracked separately', () => {
    const p = budgetPosition({ approved: sar('1000'), committed: sar('600'), spent: sar('250') });
    expect(p.openCommitment.amount).toBe('350.0000');
    expect(p.uncommitted!.amount).toBe('400.0000');
    expect(p.flags).toEqual([]);
  });
  it('flags spend above commitments, commitments above the approved budget, and a missing approved budget', () => {
    expect(budgetPosition({ approved: sar('100'), committed: sar('150'), spent: sar('200') }).flags.map((f) => f.code)).toEqual(['finance.budget.spent_exceeds_committed', 'finance.budget.committed_exceeds_approved']);
    const none = budgetPosition({ approved: null, committed: sar('1'), spent: sar('0') });
    expect(none.uncommitted).toBeNull();
    expect(none.flags.map((f) => f.code)).toEqual(['finance.budget.no_approved_budget']);
  });
  it('mixed units inside one line are rejected', () => {
    expect(code(() => budgetPosition({ approved: sar('1', 1_000_000), committed: sar('1', 1000), spent: sar('0', 1000) }))).toBe('rule_violation:money.mixed_unit_scale');
  });
});

describe('REQ-FIN-004 — intercompany reconciliation flags unreconciled differences', () => {
  it('UT: unreconciled intercompany difference flagged', () => {
    const r = reconciliationState({ code: 'IC-001', our: sar('1000'), their: sar('950'), status: 'open' });
    expect(r).toMatchObject({ flag: 'unreconciled_difference', unreconciled: true });
    expect(r.difference!.amount).toBe('50.0000');
    expect(reconciliationState({ code: 'IC-002', our: sar('1'), their: null, status: 'open' }).flag).toBe('counterparty_missing');
    expect(reconciliationState({ code: 'IC-003', our: sar('1'), their: sar('1'), status: 'open' })).toMatchObject({ flag: 'matched_pending_review', unreconciled: true });
    expect(reconciliationState({ code: 'IC-004', our: sar('1'), their: sar('1'), status: 'reconciled' })).toMatchObject({ flag: 'reconciled', unreconciled: false });
  });
  it('reconciling needs the counterparty balance, an explanation of any difference and an independent human reviewer', () => {
    const human = { kind: 'user' as const, userId: 'reviewer' };
    const base = { our: sar('1000'), their: sar('950'), status: 'open' as const, explanation: null, preparedBy: 'preparer' };
    expect(code(() => assertReconcilable({ ...base, their: null }, human))).toBe('rule_violation:finance.recon.counterparty_missing');
    expect(code(() => assertReconcilable(base, human))).toBe('rule_violation:finance.recon.unexplained_difference');
    expect(code(() => assertReconcilable({ ...base, explanation: 'Invoice INV-9 in transit (synthetic)' }, { kind: 'user', userId: 'preparer' }))).toBe('forbidden:finance.recon.self');
    expect(code(() => assertReconcilable({ ...base, explanation: 'Invoice INV-9 in transit (synthetic)' }, { kind: 'service', userId: null }))).toBe('forbidden:finance.human_required');
    expect(code(() => assertReconcilable({ ...base, explanation: 'Invoice INV-9 in transit (synthetic)' }, human))).toBe('no error');
    expect(code(() => assertReconcilable({ ...base, their: usd('950') }, human))).toBe('rule_violation:money.mixed_currency');
  });
});

describe('REQ-FIN-005 — a new version preserves prior assumptions', () => {
  it('UT: new version preserves prior assumptions', () => {
    const prior = Object.freeze([Object.freeze({ key: 'growth', value: '3', unit: '%', source: 'BP v1 (synthetic)' }), Object.freeze({ key: 'capex', value: '10', unit: 'SAR m', source: null })]);
    const r = applyAssumptionChanges(prior, { set: [{ key: 'growth', value: '4', unit: '%', source: 'BP v2 (synthetic)' }, { key: 'churn', value: '1', unit: '%' }], remove: ['capex'] });
    expect(r.assumptions.map((a) => [a.key, a.value])).toEqual([
      ['growth', '4'],
      ['churn', '1'],
    ]);
    expect(r.diff).toEqual({ added: ['churn'], changed: ['growth'], removed: ['capex'], unchanged: 0 });
    expect(prior[0]!.value).toBe('3'); // prior version untouched (frozen)
    expect(prior).toHaveLength(2);
    expect(code(() => applyAssumptionChanges(prior, { remove: ['nope'] }))).toBe('invalid:finance.assumption.unknown');
    expect(code(() => applyAssumptionChanges(prior, { set: [{ key: 'a', value: '1' }, { key: 'a', value: '2' }] }))).toBe('invalid:finance.assumption.duplicate');
  });
});

describe('REQ-FIN-010 — human financial validation before approval', () => {
  const f = (o: Partial<FigureFacts> = {}): FigureFacts => ({ state: 'proposed', createdBy: 'prep', preparedBy: 'prep', validatedBy: null, validatedHash: null, currentHash: 'h1', ...o });
  const user = (id: string) => ({ kind: 'user' as const, userId: id });
  it('UT: approve without validation rejected; service identity cannot validate', () => {
    expect(code(() => assertFigureApprovable(f(), user('appr'), 'Snapshot'))).toBe('rule_violation:finance.approval.not_validated');
    expect(code(() => assertFigureValidatable(f(), { kind: 'service', userId: null }, 'Snapshot'))).toBe('forbidden:finance.human_required');
    expect(code(() => assertFigureApprovable(f({ state: 'under_review', validatedBy: 'val', validatedHash: 'h1' }), { kind: 'service', userId: null }, 'Snapshot'))).toBe('forbidden:finance.human_required');
  });
  it('separation of duties: preparer cannot validate; validator and preparer cannot approve', () => {
    expect(code(() => assertFigureValidatable(f(), user('prep'), 'Snapshot'))).toBe('forbidden:finance.validation.self');
    const validated = f({ state: 'under_review', validatedBy: 'val', validatedHash: 'h1' });
    expect(code(() => assertFigureApprovable(validated, user('val'), 'Snapshot'))).toBe('forbidden:finance.approval.validator');
    expect(code(() => assertFigureApprovable(validated, user('prep'), 'Snapshot'))).toBe('forbidden:finance.approval.self');
    expect(code(() => assertFigureApprovable(validated, user('appr'), 'Snapshot'))).toBe('no error');
  });
  it('an approval binds to the validated content', () => {
    expect(code(() => assertFigureApprovable(f({ state: 'under_review', validatedBy: 'val', validatedHash: 'h0' }), user('appr'), 'Snapshot'))).toBe('rule_violation:finance.approval.validation_stale');
  });
  it('lifecycle: approved figures reopen, validated figures invalidate on change', () => {
    expect(transition('figure', FIGURE_APPROVAL_MACHINE, 'approved', 'reopen')).toBe('proposed');
    expect(transition('figure', FIGURE_APPROVAL_MACHINE, 'under_review', 'invalidate')).toBe('proposed');
    expect(code(() => transition('figure', FIGURE_APPROVAL_MACHINE, 'proposed', 'approve'))).toBe('rule_violation:figure.invalid_transition');
  });
});

describe('REQ-FIN-009 — benefits realisation needs a verification source and an independent verifier', () => {
  it('UT: benefit realization requires verification source', () => {
    expect(code(() => assertRealizationRecordable({ actualValue: '12', realizedOn: '2026-09-01', verificationSource: '  ', today: '2026-09-30' }))).toBe('rule_violation:finance.benefit.verification_source_required');
    expect(code(() => assertRealizationRecordable({ actualValue: '12', realizedOn: '2026-10-01', verificationSource: 'Billing report (synthetic)', today: '2026-09-30' }))).toBe('rule_violation:finance.benefit.realized_in_future');
    expect(code(() => assertRealizationRecordable({ actualValue: '12', realizedOn: '2026-09-01', verificationSource: 'Billing report (synthetic)', today: '2026-09-30' }))).toBe('no error');
  });
  it('the owner and the reporter cannot verify; service identities never verify', () => {
    const b = { status: 'realized_unverified' as const, ownerUserId: 'owner', realizationRecordedBy: 'rep', verificationSource: 'Billing report (synthetic)' };
    expect(code(() => assertBenefitVerifiable(b, { kind: 'user', userId: 'owner' }))).toBe('forbidden:finance.benefit.verify_self');
    expect(code(() => assertBenefitVerifiable(b, { kind: 'user', userId: 'rep' }))).toBe('forbidden:finance.benefit.verify_self');
    expect(code(() => assertBenefitVerifiable(b, { kind: 'service', userId: null }))).toBe('forbidden:finance.human_required');
    expect(code(() => assertBenefitVerifiable({ ...b, status: 'tracking' }, { kind: 'user', userId: 'v' }))).toBe('rule_violation:finance.benefit.not_realized');
    expect(code(() => assertBenefitVerifiable(b, { kind: 'user', userId: 'v' }))).toBe('no error');
    expect(transition('benefit', BENEFIT_MACHINE, 'realized_unverified', 'verify')).toBe('realized_verified');
    expect(code(() => transition('benefit', BENEFIT_MACHINE, 'tracking', 'verify'))).toBe('rule_violation:benefit.invalid_transition');
  });
});

describe('Classification — finance domain clearance per the access matrix (§2.3)', () => {
  it('finance_restricted reads finance-domain records up to strictly_confidential; other roles keep their clearance', () => {
    expect(financeDomainClearance('confidential', ['finance_restricted', 'functional_approver'])).toBe('strictly_confidential');
    expect(financeDomainClearance('confidential', ['project_manager'])).toBe('confidential');
    expect(financeDomainClearance('restricted', ['committee_chair'])).toBe('restricted');
    expect(financeDomainClearance('confidential', ['legal_restricted'])).toBe('confidential'); // legal domain only
  });
  it('lowering a classification is a declassification', () => {
    expect(code(() => assertNotDeclassified('restricted', 'confidential', 'the snapshot'))).toBe('rule_violation:finance.declassification');
    expect(code(() => assertNotDeclassified('restricted', 'strictly_confidential', 'the snapshot'))).toBe('no error');
  });
});

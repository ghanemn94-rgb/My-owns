import Decimal from 'decimal.js';
import { forbidden, invalid, ruleViolation } from './errors';
import { BENEFIT_STATUSES, CLASSIFICATIONS } from './enums';
import type { ApprovalState, Classification, FinancialCategory, RoleKey } from './enums';
import { POLICY_MATRIX } from './policy';
import { assertIsoDate } from './calendar';
import {
  assertConversionBasis,
  assertSameUnit,
  isNegativeMoney,
  isZeroMoney,
  subtractMoney,
  sumMoney,
  toBaseUnits,
  valueBasisFindings,
  ConversionBasis,
  Money,
  ValueBasis,
  VALUE_BASIS_MESSAGES_EN,
} from './money';
import { renderMessagesEn, serverMessage, ServerMessage } from './messages';
import type { Machine } from './workflows';

/**
 * Finance & value rules (spec §7.5; REQ-FIN-001..010, REQ-DAT-004, AT-29). Pure functions: the API applies them inside
 * the request transaction. The platform tracks figures supplied by people and imported from the original models; it is
 * not a valuation engine, never invents amounts, rates, valuations, ownership percentages or approvals, and never
 * aggregates across currencies or units without an explicit, disclosed basis.
 */

// ---------------------------------------------------------------------------------------------------------
// Classification (access-matrix §2.3)

const rank = (c: Classification) => CLASSIFICATIONS.indexOf(c);

/** Proposed default classification per finance record type (access-matrix §2.3; to be confirmed by Data Governance). */
export const FINANCE_DEFAULT_CLASSIFICATION = {
  financial_snapshot: 'restricted',
  budget_line: 'confidential',
  business_plan: 'restricted',
  valuation: 'strictly_confidential',
  intercompany_reconciliation: 'restricted',
  benefit: 'confidential',
  kpi: 'confidential',
} as const satisfies Record<string, Classification>;

/**
 * Effective clearance for FINANCE-domain records (access-matrix §2.3): the maximum of the principal's clearance and, for
 * each project-wide role, `role.domainClearance.finance` (e.g. finance_restricted → strictly_confidential). Roles without
 * a finance domain clearance add nothing; room-scoped roles must not be passed (they apply only inside their rooms).
 */
export function financeDomainClearance(base: Classification, projectRoles: Iterable<RoleKey>): Classification {
  let best = base;
  for (const r of projectRoles) {
    const dc = (POLICY_MATRIX.roles[r] as { domainClearance?: Partial<Record<string, Classification>> } | undefined)?.domainClearance?.['finance'];
    if (dc && rank(dc) > rank(best)) best = dc;
  }
  return best;
}

/** Lowering a record's classification is a declassification decision, never an edit. */
export function assertNotDeclassified(current: Classification, next: Classification | undefined, what: string): void {
  if (next && rank(next) < rank(current)) {
    throw ruleViolation('finance.declassification', `Lowering the classification of ${what} is a declassification decision outside this command`, { current, requested: next });
  }
}

// ---------------------------------------------------------------------------------------------------------
// Periods

export type PeriodGranularity = 'year' | 'half' | 'quarter' | 'month' | 'fiscal_year';

/**
 * Reporting period of a figure (mandatory, REQ-FIN-001): `2026` (calendar year), `2026-H1`, `2026-Q3`, `2026-09`, or
 * `FY2026` (fiscal year — its boundaries depend on the entity's fiscal calendar, to be confirmed, so no dates are derived).
 */
export function parseFinancialPeriod(input: string): { period: string; granularity: PeriodGranularity; start: string | null; end: string | null } {
  const p = input.trim();
  let m: RegExpExecArray | null;
  const lastDay = (y: number, mo: number) => new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  if ((m = /^(\d{4})$/.exec(p))) return { period: p, granularity: 'year', start: `${m[1]}-01-01`, end: `${m[1]}-12-31` };
  if ((m = /^(\d{4})-H([12])$/.exec(p))) {
    const h = Number(m[2]);
    return { period: p, granularity: 'half', start: `${m[1]}-${h === 1 ? '01' : '07'}-01`, end: `${m[1]}-${h === 1 ? '06-30' : '12-31'}` };
  }
  if ((m = /^(\d{4})-Q([1-4])$/.exec(p))) {
    const y = Number(m[1]);
    const q = Number(m[2]);
    const endMonth = q * 3;
    return { period: p, granularity: 'quarter', start: `${m[1]}-${pad(endMonth - 2)}-01`, end: `${m[1]}-${pad(endMonth)}-${pad(lastDay(y, endMonth))}` };
  }
  if ((m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(p))) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    return { period: p, granularity: 'month', start: `${m[1]}-${m[2]}-01`, end: `${m[1]}-${m[2]}-${pad(lastDay(y, mo))}` };
  }
  if ((m = /^FY(\d{4})$/.exec(p))) return { period: p, granularity: 'fiscal_year', start: null, end: null };
  throw invalid('finance.period.invalid', `Period must be YYYY, YYYY-H1/H2, YYYY-Q1..Q4, YYYY-MM or FYYYYY (got "${input}")`, { period: input });
}

// ---------------------------------------------------------------------------------------------------------
// Figures (financial snapshots, model versions): human validation before approval (REQ-FIN-010)

/** Figure approval lifecycle: validate (human Finance) → approve (a different person) | reject; approved → reopen. */
export type FigureCommand = 'validate' | 'approve' | 'reject' | 'reopen' | 'invalidate' | 'supersede';
export const FIGURE_APPROVAL_MACHINE: Machine<ApprovalState, FigureCommand> = {
  validate: { from: ['proposed', 'rejected'], to: 'under_review', description: 'Human financial validation of the current content (not by its preparer)' },
  approve: { from: ['under_review'], to: 'approved', description: 'Approval of the validated content by a person who neither prepared nor validated it' },
  reject: { from: ['under_review'], to: 'rejected', description: 'Validated content rejected (reason required); may be corrected and validated again' },
  reopen: { from: ['approved'], to: 'proposed', description: 'An approved figure is reopened for correction (reason required); the approval stays in history' },
  invalidate: { from: ['under_review'], to: 'proposed', description: 'The content changed after validation: the validation no longer applies' },
  supersede: { from: ['proposed', 'under_review', 'rejected'], to: 'superseded', description: 'A newer version replaced this unapproved version' },
};

export interface Actor {
  kind: 'user' | 'service';
  userId: string | null;
}

/** Validation and approval are human acts: service identities (worker, AI runtime) can never perform them. */
export function assertHumanActor(actor: Actor, what: string): asserts actor is { kind: 'user'; userId: string } {
  if (actor.kind !== 'user' || !actor.userId) {
    throw forbidden('finance.human_required', `${what} requires a human Finance user; service identities (worker, AI runtime) can never perform it`);
  }
}

export interface FigureFacts {
  state: ApprovalState;
  createdBy: string | null;
  /** Last person who changed the content (the preparer of the content being validated/approved). */
  preparedBy: string | null;
  validatedBy: string | null;
  /** Content hash bound at validation; approval requires it to equal the current content hash. */
  validatedHash: string | null;
  currentHash: string;
}

/** Human financial validation: not by the creator or the preparer of the content (separation of duties). */
export function assertFigureValidatable(f: FigureFacts, actor: Actor, what: string): void {
  assertHumanActor(actor, `Financial validation of ${what}`);
  if (!FIGURE_APPROVAL_MACHINE.validate.from.includes(f.state)) {
    throw ruleViolation('finance.validation.invalid_state', `${what} cannot be validated while ${f.state}`, { state: f.state });
  }
  if (actor.userId === f.preparedBy || actor.userId === f.createdBy) {
    throw forbidden('finance.validation.self', `Separation of duties: the preparer of ${what} cannot validate it`);
  }
}

/**
 * Approval (REQ-FIN-010): rejected unless the CURRENT content was validated by a human Finance user; the approver is a
 * third person (neither preparer nor validator).
 */
export function assertFigureApprovable(f: FigureFacts, actor: Actor, what: string): void {
  assertHumanActor(actor, `Approval of ${what}`);
  if (!f.validatedBy || f.state === 'proposed' || f.state === 'rejected') {
    throw ruleViolation('finance.approval.not_validated', `${what} has no human financial validation: validate it before approval`, { state: f.state });
  }
  if (f.state !== 'under_review') {
    throw ruleViolation('finance.approval.invalid_state', `${what} cannot be approved while ${f.state}`, { state: f.state });
  }
  if (f.validatedHash !== f.currentHash) {
    throw ruleViolation('finance.approval.validation_stale', `${what} changed after its validation: validate the current content again`);
  }
  if (actor.userId === f.preparedBy || actor.userId === f.createdBy) {
    throw forbidden('finance.approval.self', `Separation of duties: the preparer of ${what} cannot approve it`);
  }
  if (actor.userId === f.validatedBy) {
    throw forbidden('finance.approval.validator', `Separation of duties: the validator of ${what} cannot also approve it`);
  }
}

// ---------------------------------------------------------------------------------------------------------
// Snapshots (REQ-FIN-001, REQ-FIN-002, REQ-FIN-004, REQ-FIN-008)

export const SEPARATION_COST_CATEGORIES = ['one_off_separation', 'recurring_standalone', 'stranded', 'tsa_charge'] as const satisfies readonly FinancialCategory[];
export type SeparationCostCategory = (typeof SEPARATION_COST_CATEGORIES)[number];

export interface SnapshotSource {
  sourceType: string;
  sourceRef: string | null;
  sourceDocumentId: string | null;
  sourceSheet: string | null;
  sourceCell: string | null;
}

/**
 * Every figure keeps its source (REQ-FIN-001): a manual entry names its source reference; an imported model output keeps
 * the source document AND the sheet/cell it came from (REQ-FIN-008).
 */
export function assertSnapshotSource(s: SnapshotSource): void {
  if (!s.sourceDocumentId && !s.sourceRef?.trim()) {
    throw invalid('finance.source.required', 'A financial figure needs its source: a source reference or a source document');
  }
  if (s.sourceType === 'excel' && (!s.sourceDocumentId || !s.sourceSheet?.trim() || !s.sourceCell?.trim())) {
    throw invalid('finance.source.cell_reference_required', 'An imported model output keeps its source document, sheet and cell reference');
  }
  if (s.sourceType === 'csv' && (!s.sourceDocumentId || !s.sourceCell?.trim())) {
    throw invalid('finance.source.cell_reference_required', 'An imported output keeps its source document and row/column reference');
  }
}

/** Cell references as written in the source workbook: `B12`, `$B$12`, `B12:D12`, or a named range. */
export function assertCellReference(cell: string): void {
  if (!/^(\$?[A-Z]{1,3}\$?\d{1,7}(:\$?[A-Z]{1,3}\$?\d{1,7})?|[A-Za-z_][A-Za-z0-9_.]{0,63})$/.test(cell.trim())) {
    throw invalid('finance.source.invalid_cell', `Invalid cell reference "${cell}" (e.g. B12, $B$12, B12:D12 or a named range)`);
  }
}

/** TSA charges are linked to exactly the TSA service they are charged for; other categories never are (REQ-FIN-002). */
export function assertTsaLink(category: FinancialCategory, tsaServiceId: string | null | undefined): void {
  if (category === 'tsa_charge' && !tsaServiceId) {
    throw ruleViolation('finance.tsa_charge.link_required', 'A TSA charge must be linked to its TSA service so that it is counted once across the TSA and cost views');
  }
  if (category !== 'tsa_charge' && tsaServiceId) {
    throw ruleViolation('finance.tsa_charge.category_required', 'Only a TSA charge line can be linked to a TSA service');
  }
}

/**
 * Double counting at write time: a line reference keeps one category across kinds and periods, and a TSA service is
 * charged under one line reference only.
 */
export function assertLineConsistency(
  line: { lineRef: string; category: FinancialCategory; tsaServiceId: string | null },
  existing: { lineRef: string; category: FinancialCategory; tsaServiceId: string | null }[],
): void {
  for (const e of existing) {
    if (e.lineRef === line.lineRef && e.category !== line.category) {
      throw ruleViolation('finance.double_count.category_conflict', `Line ${line.lineRef} is already recorded as ${e.category}; the same line cannot also be ${line.category} (double counting)`, {
        lineRef: line.lineRef,
        existingCategory: e.category,
        category: line.category,
      });
    }
    if (line.tsaServiceId && e.tsaServiceId === line.tsaServiceId && e.lineRef !== line.lineRef) {
      throw ruleViolation('finance.double_count.tsa_line_conflict', `This TSA service is already charged under line ${e.lineRef}; use that line reference (a TSA charge is counted once)`, {
        lineRef: e.lineRef,
      });
    }
    if (line.tsaServiceId && e.lineRef === line.lineRef && e.tsaServiceId && e.tsaServiceId !== line.tsaServiceId) {
      throw ruleViolation('finance.double_count.tsa_line_conflict', `Line ${line.lineRef} already carries the charge of another TSA service`, { lineRef: line.lineRef });
    }
  }
}

// ---------------------------------------------------------------------------------------------------------
// Aggregation (REQ-DAT-004, AT-29)

export const FINANCE_MESSAGES_EN: Readonly<Record<string, string>> = {
  ...VALUE_BASIS_MESSAGES_EN,
  'finance.aggregate.converted': '{from} amounts converted to {to} at {rate} — source: {source}, rate date {asOf}.',
  'finance.aggregate.units_normalized': 'Unit scales {scales} were normalized to unit scale {target} at the caller’s explicit request.',
  'finance.aggregate.same_basis': 'All {count} amounts share currency {currency} and unit scale {unitScale}; no conversion was applied.',
  'finance.budget.no_approved_budget': 'No approved budget is recorded for this line yet.',
  'finance.budget.spent_exceeds_committed': 'Spent ({spent}) exceeds the recorded commitments ({committed}): record the missing commitment or correct the actuals.',
  'finance.budget.committed_exceeds_approved': 'Commitments ({committed}) exceed the approved budget ({approved}).',
  'finance.tsa.counted_in_line': 'TSA {tsaCode} is counted once, in budget line {lineCode}; its register charge is not added again.',
  'finance.tsa.not_in_cost_view': 'TSA {tsaCode} has a register charge but no budget line: it is listed here and excluded from the cost totals.',
  'finance.tsa.no_charge_recorded': 'TSA {tsaCode} has no charge recorded in the TSA register.',
  'finance.tsa.charge_differs': 'TSA {tsaCode}: the register charge differs from the commitment in budget line {lineCode}; reconcile the two.',
  'finance.tsa.unit_differs': 'TSA {tsaCode}: the register charge is in {registerCurrency} / unit scale {registerUnitScale} but budget line {lineCode} is in {lineCurrency} / unit scale {lineUnitScale}; not compared.',
  'finance.double_count.tsa_multiple_lines': 'TSA {tsaCode} is linked from several budget lines ({lineCodes}); it is counted once (in {lineCode}).',
  'finance.double_count.category_conflict': 'Line {lineRef} is recorded under several categories ({categories}): possible double counting.',
  'finance.recon.counterparty_missing': '{code}: the counterparty balance is not recorded yet.',
  'finance.recon.unreconciled_difference': '{code}: unreconciled difference of {difference} ({currency}, unit scale {unitScale}).',
  'finance.recon.disputed': '{code}: the balance is disputed with the counterparty.',
  'finance.recon.matched_pending_review': '{code}: balances agree; the reconciliation awaits review.',
  'finance.recon.explained_difference': '{code}: reconciled with an explained difference of {difference} ({currency}, unit scale {unitScale}).',
  'finance.recon.reconciled': '{code}: reconciled.',
  'finance.compare.basis_mismatch': '{key}: {basisA} is compared with {basisB}; not comparable without a documented bridge.',
  'finance.compare.currency_without_basis': '{key}: {currencyA} vs {currencyB}; no conversion basis given, not compared.',
  'finance.compare.unit_mismatch': '{key}: unit scale {scaleA} vs {scaleB}; mixed units are not compared.',
  'finance.compare.measure_mismatch': '{key}: a {measureA} value is compared with a {measureB} value; not comparable.',
  'finance.compare.missing': '{key}: present in only one of the compared versions.',
  'finance.compare.converted': '{key}: {from} converted to {to} at {rate} (source: {source}, rate date {asOf}).',
};

export const renderFinanceMessages = (m: readonly ServerMessage[]) => renderMessagesEn(m, FINANCE_MESSAGES_EN);

export interface AggregateOptions {
  targetCurrency?: string;
  targetUnitScale?: number;
  normalizeUnits?: boolean;
  conversions?: ConversionBasis[];
}

/**
 * Aggregate of figures (REQ-DAT-004 / AT-29): one kind only (baseline, forecast and actual are never added together);
 * mixed currencies need an explicit conversion basis per currency, mixed unit scales an explicit normalization; the
 * result discloses the basis (codes + English sentence).
 */
export function aggregateFigures(items: { kind: string; money: Money }[], opts: AggregateOptions) {
  const kinds = [...new Set(items.map((i) => i.kind))];
  if (kinds.length > 1) {
    throw ruleViolation('finance.aggregate.mixed_kinds', `Baseline, forecast and actual figures are never added together (got ${kinds.sort().join(', ')})`, { kinds });
  }
  const r = sumMoney(
    items.map((i) => i.money),
    opts,
  );
  const basis: ServerMessage[] = [];
  for (const c of r.conversions) basis.push(serverMessage('finance.aggregate.converted', { from: c.from, to: c.to, rate: c.rate, source: c.source, asOf: c.asOf }));
  if (r.normalizedUnitScales.length) basis.push(serverMessage('finance.aggregate.units_normalized', { scales: r.normalizedUnitScales.join(', '), target: r.total.unitScale }));
  if (!basis.length) basis.push(serverMessage('finance.aggregate.same_basis', { count: r.count, currency: r.total.currency, unitScale: r.total.unitScale }));
  return { ...r, kind: kinds[0] ?? null, basis, basisText: renderFinanceMessages(basis) };
}

// ---------------------------------------------------------------------------------------------------------
// Budget lines: committed vs spent (REQ-FIN-003)

/**
 * Convention (documented for Finance to confirm): `committed` is the total contractually committed to date INCLUDING the
 * part already spent; `spent` is what has actually been spent (invoiced / paid). Open commitment = committed − spent;
 * uncommitted budget = approved − committed. Both are tracked separately and never inferred from each other.
 */
export function budgetPosition(b: { approved: Money | null; committed: Money; spent: Money }) {
  assertSameUnit(b.committed, b.spent, 'Budget line');
  if (b.approved) assertSameUnit(b.committed, b.approved, 'Budget line');
  const flags: ServerMessage[] = [];
  const openCommitment = subtractMoney(b.committed, b.spent);
  const uncommitted = b.approved ? subtractMoney(b.approved, b.committed) : null;
  if (!b.approved) flags.push(serverMessage('finance.budget.no_approved_budget'));
  if (isNegativeMoney(openCommitment)) flags.push(serverMessage('finance.budget.spent_exceeds_committed', { spent: b.spent.amount, committed: b.committed.amount }));
  if (uncommitted && isNegativeMoney(uncommitted)) flags.push(serverMessage('finance.budget.committed_exceeds_approved', { committed: b.committed.amount, approved: b.approved!.amount }));
  return { openCommitment, uncommitted, flags };
}

export function assertNonNegative(m: Money | null | undefined, field: string): void {
  if (m && isNegativeMoney(m)) throw invalid('finance.amount.negative', `${field} cannot be negative`, { field });
}

// ---------------------------------------------------------------------------------------------------------
// Separation cost view: TSA charge counted once across the TSA and cost views (REQ-FIN-002)

export interface CostLine {
  id: string;
  code: string;
  category: FinancialCategory;
  approved: Money | null;
  committed: Money;
  spent: Money;
  tsaServiceId: string | null;
}

export interface TsaChargeRef {
  id: string;
  code: string;
  charge: Money | null;
}

interface GroupTotal {
  category: SeparationCostCategory;
  currency: string;
  unitScale: number;
  lineCount: number;
  linesWithoutApprovedBudget: number;
  approved: Money;
  committed: Money;
  spent: Money;
}

/**
 * Cost view of the separation categories. Totals are grouped per category AND currency/unit scale (never mixed). Each
 * TSA service is counted once: through the budget line that carries its charge; a register charge without a budget
 * line is listed but excluded from the totals; a second line on the same TSA (prevented by the database) is excluded.
 */
export function separationCostView(lines: CostLine[], tsas: TsaChargeRef[]) {
  const findings: ServerMessage[] = [];
  const byTsa = new Map<string, CostLine[]>();
  for (const l of lines) if (l.tsaServiceId) (byTsa.get(l.tsaServiceId) ?? byTsa.set(l.tsaServiceId, []).get(l.tsaServiceId)!).push(l);
  const excluded = new Set<string>();
  const tsaCode = new Map(tsas.map((t) => [t.id, t.code]));
  for (const [tsaId, ls] of byTsa) {
    if (ls.length > 1) {
      const sorted = [...ls].sort((a, b) => a.code.localeCompare(b.code));
      for (const extra of sorted.slice(1)) excluded.add(extra.id);
      findings.push(serverMessage('finance.double_count.tsa_multiple_lines', { tsaCode: tsaCode.get(tsaId) ?? tsaId, lineCodes: sorted.map((l) => l.code).join(', '), lineCode: sorted[0]!.code }));
    }
  }
  const groups = new Map<string, GroupTotal>();
  const zero = (m: Money): Money => ({ amount: '0.0000', currency: m.currency, unitScale: m.unitScale });
  const add = (a: Money, b: Money): Money => ({ amount: new Decimal(a.amount).add(b.amount).toFixed(4), currency: a.currency, unitScale: a.unitScale });
  for (const l of lines) {
    if (excluded.has(l.id) || !(SEPARATION_COST_CATEGORIES as readonly string[]).includes(l.category)) continue;
    const key = `${l.category}|${l.committed.currency}|${l.committed.unitScale}`;
    const g = groups.get(key) ?? {
      category: l.category as SeparationCostCategory,
      currency: l.committed.currency,
      unitScale: l.committed.unitScale,
      lineCount: 0,
      linesWithoutApprovedBudget: 0,
      approved: zero(l.committed),
      committed: zero(l.committed),
      spent: zero(l.committed),
    };
    g.lineCount++;
    if (l.approved) g.approved = add(g.approved, l.approved);
    else g.linesWithoutApprovedBudget++;
    g.committed = add(g.committed, l.committed);
    g.spent = add(g.spent, l.spent);
    groups.set(key, g);
  }
  const tsaRows = tsas.map((t) => {
    const ls = (byTsa.get(t.id) ?? []).filter((l) => !excluded.has(l.id));
    const line = ls[0] ?? null;
    const messages: ServerMessage[] = [];
    if (line) {
      messages.push(serverMessage('finance.tsa.counted_in_line', { tsaCode: t.code, lineCode: line.code }));
      if (t.charge) {
        if (t.charge.currency !== line.committed.currency || t.charge.unitScale !== line.committed.unitScale) {
          messages.push(
            serverMessage('finance.tsa.unit_differs', {
              tsaCode: t.code,
              lineCode: line.code,
              registerCurrency: t.charge.currency,
              registerUnitScale: t.charge.unitScale,
              lineCurrency: line.committed.currency,
              lineUnitScale: line.committed.unitScale,
            }),
          );
        } else if (!toBaseUnits(t.charge).eq(toBaseUnits(line.committed))) {
          messages.push(serverMessage('finance.tsa.charge_differs', { tsaCode: t.code, lineCode: line.code }));
        }
      }
    } else if (t.charge) {
      messages.push(serverMessage('finance.tsa.not_in_cost_view', { tsaCode: t.code }));
    } else {
      messages.push(serverMessage('finance.tsa.no_charge_recorded', { tsaCode: t.code }));
    }
    return { tsaServiceId: t.id, tsaCode: t.code, registerCharge: t.charge, budgetLineId: line?.id ?? null, budgetLineCode: line?.code ?? null, countedIn: line ? ('budget_line' as const) : ('none' as const), messages };
  });
  return {
    groups: [...groups.values()].sort((a, b) => SEPARATION_COST_CATEGORIES.indexOf(a.category) - SEPARATION_COST_CATEGORIES.indexOf(b.category) || a.currency.localeCompare(b.currency) || a.unitScale - b.unitScale),
    tsa: tsaRows,
    findings,
  };
}

/** Lines recorded under several categories across kinds/periods (defence in depth for data written before the rule). */
export function snapshotDoubleCountFindings(rows: { lineRef: string; category: FinancialCategory }[]): ServerMessage[] {
  const cats = new Map<string, Set<string>>();
  for (const r of rows) (cats.get(r.lineRef) ?? cats.set(r.lineRef, new Set()).get(r.lineRef)!).add(r.category);
  return [...cats.entries()]
    .filter(([, c]) => c.size > 1)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([lineRef, c]) => serverMessage('finance.double_count.category_conflict', { lineRef, categories: [...c].sort().join(', ') }));
}

// ---------------------------------------------------------------------------------------------------------
// Intercompany reconciliation (REQ-FIN-004)

export const RECONCILIATION_STATUSES = ['open', 'reconciled', 'disputed'] as const;
export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];
export const RECONCILIATION_FLAGS = ['counterparty_missing', 'unreconciled_difference', 'disputed', 'matched_pending_review', 'explained_difference', 'reconciled'] as const;
export type ReconciliationFlag = (typeof RECONCILIATION_FLAGS)[number];

export function reconciliationState(r: { code: string; our: Money; their: Money | null; status: ReconciliationStatus }) {
  const difference = r.their ? subtractMoney(r.our, r.their) : null;
  let flag: ReconciliationFlag;
  if (r.status === 'reconciled') flag = difference && !isZeroMoney(difference) ? 'explained_difference' : 'reconciled';
  else if (r.status === 'disputed') flag = 'disputed';
  else if (!difference) flag = 'counterparty_missing';
  else flag = isZeroMoney(difference) ? 'matched_pending_review' : 'unreconciled_difference';
  const p = { code: r.code, difference: difference?.amount ?? '', currency: r.our.currency, unitScale: r.our.unitScale };
  const messages: ServerMessage[] = [
    flag === 'counterparty_missing'
      ? serverMessage('finance.recon.counterparty_missing', { code: r.code })
      : flag === 'unreconciled_difference'
        ? serverMessage('finance.recon.unreconciled_difference', p)
        : flag === 'disputed'
          ? serverMessage('finance.recon.disputed', { code: r.code })
          : flag === 'matched_pending_review'
            ? serverMessage('finance.recon.matched_pending_review', { code: r.code })
            : flag === 'explained_difference'
              ? serverMessage('finance.recon.explained_difference', p)
              : serverMessage('finance.recon.reconciled', { code: r.code }),
  ];
  return { difference, flag, unreconciled: r.status !== 'reconciled', messages };
}

/**
 * Marking a reconciliation reconciled: the counterparty balance is recorded in the same currency and unit; a non-zero
 * difference needs an explanation (reconciling items); the reviewer is a human who did not prepare it.
 */
export function assertReconcilable(
  r: {
    our: Money;
    their: Money | null;
    status: ReconciliationStatus;
    explanation: string | null;
    preparedBy: string | null;
    createdBy?: string | null;
    /** DOM-P34R-09: every person who created or edited the reconciliation (its record history) — none of them reviews it. */
    editorUserIds?: readonly (string | null)[];
  },
  actor: Actor,
): void {
  assertHumanActor(actor, 'Reconciliation review');
  if (r.status === 'reconciled') throw ruleViolation('finance.recon.already_reconciled', 'The reconciliation is already reconciled');
  if (!r.their) throw ruleViolation('finance.recon.counterparty_missing', 'Record the counterparty balance before reconciling');
  const diff = subtractMoney(r.our, r.their);
  if (!isZeroMoney(diff) && !(r.explanation && r.explanation.trim().length >= 10)) {
    throw ruleViolation('finance.recon.unexplained_difference', `A difference of ${diff.amount} remains unexplained: explain the reconciling items before reconciling`, { difference: diff.amount });
  }
  if (actor.userId === r.preparedBy) throw forbidden('finance.recon.self', 'Separation of duties: the preparer cannot review the reconciliation');
  // DOM-P4-16: `preparedBy` is the LAST editor; the person who recorded the balance prepared it too and is never its reviewer.
  if (r.createdBy && actor.userId === r.createdBy) throw forbidden('finance.recon.self', 'Separation of duties: the person who recorded the balance cannot review the reconciliation');
  if (actor.userId && (r.editorUserIds ?? []).includes(actor.userId)) {
    throw forbidden('finance.recon.self', 'Separation of duties: a person who edited the reconciliation cannot review it');
  }
}

// ---------------------------------------------------------------------------------------------------------
// Business plans / valuation versions (REQ-FIN-005..008)

export interface Assumption {
  key: string;
  value: string;
  unit?: string | null;
  source?: string | null;
}

/**
 * A new version starts from the prior version's assumptions and applies explicit changes; the prior version itself is
 * never modified (it stays frozen as recorded). Returns the diff for the audit trail.
 */
export function applyAssumptionChanges(prior: readonly Assumption[], changes: { set?: Assumption[]; remove?: string[] }) {
  const map = new Map(prior.map((a) => [a.key, { ...a }]));
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  const setKeys = new Set<string>();
  for (const a of changes.set ?? []) {
    if (setKeys.has(a.key)) throw invalid('finance.assumption.duplicate', `Assumption ${a.key} is set twice`, { key: a.key });
    setKeys.add(a.key);
    const cur = map.get(a.key);
    const next = { key: a.key, value: a.value, unit: a.unit ?? null, source: a.source ?? null };
    if (!cur) added.push(a.key);
    else if (cur.value !== next.value || (cur.unit ?? null) !== next.unit || (cur.source ?? null) !== next.source) changed.push(a.key);
    map.set(a.key, next);
  }
  for (const k of changes.remove ?? []) {
    if (setKeys.has(k)) throw invalid('finance.assumption.conflicting_change', `Assumption ${k} is both set and removed`, { key: k });
    if (!map.has(k)) throw invalid('finance.assumption.unknown', `Assumption ${k} does not exist in the prior version`, { key: k });
    map.delete(k);
    removed.push(k);
  }
  const assumptions = [...map.values()].map((a) => ({ key: a.key, value: a.value, unit: a.unit ?? null, source: a.source ?? null }));
  return { assumptions, diff: { added, changed, removed, unchanged: assumptions.length - added.length - changed.length } };
}

export const OUTPUT_MEASURES = ['money', 'percent'] as const;
export type OutputMeasure = (typeof OUTPUT_MEASURES)[number];

/** A model output (proposed value): money (currency + unit scale) or a percentage (e.g. an ownership share). */
export interface ModelOutput {
  key: string;
  label: string;
  measure: OutputMeasure;
  amount: string;
  currency: string | null;
  unitScale: number | null;
  basis: ValueBasis;
  sheet: string | null;
  cell: string | null;
}

export function outputMoney(o: ModelOutput): Money | null {
  return o.measure === 'money' && o.currency && o.unitScale ? { amount: o.amount, currency: o.currency, unitScale: o.unitScale } : null;
}

/** Output rules: unique keys; money carries currency + unit; a percentage carries neither and lies in [0, 100]. */
export function assertOutputs(outputs: readonly ModelOutput[], opts: { requireCellReferences: boolean }): void {
  const keys = new Set<string>();
  for (const o of outputs) {
    if (keys.has(o.key)) throw invalid('finance.output.duplicate', `Output ${o.key} appears twice`, { key: o.key });
    keys.add(o.key);
    if (o.measure === 'money') {
      if (!o.currency || !o.unitScale) throw invalid('finance.output.money_unit_required', `Output ${o.key}: a money value needs its currency and unit scale`, { key: o.key });
    } else {
      if (o.currency || o.unitScale) throw invalid('finance.output.percent_has_currency', `Output ${o.key}: a percentage has no currency or unit scale`, { key: o.key });
      const v = new Decimal(o.amount);
      if (v.lt(0) || v.gt(100)) throw invalid('finance.output.percent_range', `Output ${o.key}: a percentage lies between 0 and 100`, { key: o.key });
      if (o.basis !== 'other') throw invalid('finance.output.percent_basis', `Output ${o.key}: EV / equity bases apply to money values only`, { key: o.key });
    }
    if (opts.requireCellReferences && (!o.sheet?.trim() || !o.cell?.trim())) {
      throw invalid('finance.source.cell_reference_required', `Output ${o.key}: an imported output keeps its sheet and cell reference`, { key: o.key });
    }
    if (o.cell) assertCellReference(o.cell);
  }
}

/** EV/equity/currency/unit findings of one version's money outputs (REQ-FIN-007). */
export function outputFindings(outputs: readonly ModelOutput[]): ServerMessage[] {
  const values = outputs.flatMap((o) => {
    const m = outputMoney(o);
    return m ? [{ label: o.label, basis: o.basis, money: m }] : [];
  });
  return valueBasisFindings(values);
}

export type ComparisonStatus = 'compared' | 'basis_mismatch' | 'currency_without_basis' | 'unit_mismatch' | 'measure_mismatch' | 'missing';

/**
 * Compares two versions' outputs key by key (REQ-FIN-007): EV vs equity, different currencies without an explicit basis,
 * different unit scales, or money vs percent are NOT compared (no difference is produced) and are reported.
 */
export function compareOutputs(a: readonly ModelOutput[], b: readonly ModelOutput[], conversions: ConversionBasis[] = []) {
  for (const c of conversions) assertConversionBasis(c);
  const bm = new Map(b.map((o) => [o.key, o]));
  const keys = [...new Set([...a.map((o) => o.key), ...b.map((o) => o.key)])];
  const am = new Map(a.map((o) => [o.key, o]));
  const rows = keys.map((key) => {
    const x = am.get(key) ?? null;
    const y = bm.get(key) ?? null;
    const messages: ServerMessage[] = [];
    let status: ComparisonStatus = 'compared';
    let difference: string | null = null;
    if (!x || !y) {
      status = 'missing';
      messages.push(serverMessage('finance.compare.missing', { key }));
    } else if (x.measure !== y.measure) {
      status = 'measure_mismatch';
      messages.push(serverMessage('finance.compare.measure_mismatch', { key, measureA: x.measure, measureB: y.measure }));
    } else if (x.measure === 'percent') {
      difference = new Decimal(x.amount).sub(y.amount).toFixed(4);
    } else if (x.basis !== y.basis) {
      status = 'basis_mismatch';
      messages.push(serverMessage('finance.compare.basis_mismatch', { key, basisA: x.basis, basisB: y.basis }));
    } else if (x.unitScale !== y.unitScale) {
      status = 'unit_mismatch';
      messages.push(serverMessage('finance.compare.unit_mismatch', { key, scaleA: x.unitScale ?? '', scaleB: y.unitScale ?? '' }));
    } else if (x.currency !== y.currency) {
      const basis = conversions.find((c) => c.from === y.currency && c.to === x.currency);
      if (!basis) {
        status = 'currency_without_basis';
        messages.push(serverMessage('finance.compare.currency_without_basis', { key, currencyA: x.currency ?? '', currencyB: y.currency ?? '' }));
      } else {
        difference = new Decimal(x.amount).sub(new Decimal(y.amount).mul(basis.rate)).toFixed(4);
        messages.push(serverMessage('finance.compare.converted', { key, from: basis.from, to: basis.to, rate: basis.rate, source: basis.source, asOf: basis.asOf }));
      }
    } else {
      difference = new Decimal(x.amount).sub(y.amount).toFixed(4);
    }
    return { key, label: x?.label ?? y?.label ?? key, a: x, b: y, status, difference, messages };
  });
  return { rows, findings: [...outputFindings(a), ...outputFindings(b)] };
}

/** Governance decision types (DEMO authority matrix keys) that approve valuation / ownership values (REQ-FIN-006). */
export const VALUATION_DECISION_TYPE_KEYS: readonly string[] = ['valuation_and_ownership_terms'];
/** Decision types that approve an opening balance sheet figure (REQ-FIN-004 / REQ-FIN-010). */
export const OPENING_BALANCE_DECISION_TYPE_KEYS: readonly string[] = ['opening_balance_sheet'];
/** Decision types whose final approval may set a budget line's approved amount (change control, spec §7.5 / §9). */
export const BUDGET_DECISION_TYPE_KEYS: readonly string[] = ['baseline_approval', 'change_request_budget', 'separation_spend_commitment'];

/**
 * DOM-P4-07 (REQ-FIN-003; spec §4 "decisions within approved limits"): the approved budget recorded on a line from a
 * governance decision stays within the amount the decision STATES. The same rule as change control's decision amount
 * (`change_control.decision_amount_missing` / `_currency` / `_insufficient`), in the finance code family:
 *  - an approved amount other than zero needs a decision that states its amount — a decision without a stated amount sets
 *    no limit, so it cannot back a budget approval (fail closed: `finance.budget.decision_amount_missing`);
 *  - the amounts are in the same currency AND unit scale — no conversion or unit normalization is applied to a booked
 *    amount (AT-29; stricter than change control, which normalizes unit scales): `finance.budget.decision_unit_mismatch`;
 *  - the approved amount does not exceed the decision's amount: `finance.budget.exceeds_decision`.
 * One decision backs ONE budget line (decision-use registry, kind `budget_line`), so the approvals recorded from one decision
 * never exceed its amount in total.
 */
export function assertBudgetApprovalWithinDecision(i: { decisionCode: string; decisionAmount: Money | null; approved: Money }): void {
  if (isZeroMoney(i.approved)) return;
  const decided = i.decisionAmount;
  if (!decided) {
    throw ruleViolation(
      'finance.budget.decision_amount_missing',
      `Decision ${i.decisionCode} states no amount: it sets no limit, so it cannot back an approved budget of ${i.approved.amount} ${i.approved.currency} (unit ${i.approved.unitScale}) — the decision paper must state the approved amount`,
      { approvedAmount: i.approved.amount, currency: i.approved.currency, unitScale: i.approved.unitScale },
    );
  }
  if (decided.currency !== i.approved.currency || decided.unitScale !== i.approved.unitScale) {
    throw ruleViolation(
      'finance.budget.decision_unit_mismatch',
      `Decision ${i.decisionCode} states its amount in ${decided.currency} / unit scale ${decided.unitScale}; the line is kept in ${i.approved.currency} / unit scale ${i.approved.unitScale} — no conversion is applied`,
      { decisionCurrency: decided.currency, decisionUnitScale: decided.unitScale },
    );
  }
  if (new Decimal(i.approved.amount).gt(new Decimal(decided.amount))) {
    throw ruleViolation('finance.budget.exceeds_decision', `The approved amount exceeds the amount of decision ${i.decisionCode}`, { decisionAmount: decided.amount });
  }
}

// ---------------------------------------------------------------------------------------------------------
// Benefits register (REQ-FIN-009)

export type BenefitStatus = (typeof BENEFIT_STATUSES)[number];
export type BenefitCommand = 'approve' | 'start_tracking' | 'record_realization' | 'verify' | 'reject_realization' | 'cancel' | 'revise_definition';

export const BENEFIT_MACHINE: Machine<BenefitStatus, BenefitCommand> = {
  approve: { from: ['proposed'], to: 'approved', description: 'Benefit definition accepted into the register by an independent Finance reviewer' },
  start_tracking: { from: ['approved'], to: 'tracking', description: 'Measurement started' },
  record_realization: { from: ['tracking'], to: 'realized_unverified', description: 'Realization reported with its verification source' },
  verify: { from: ['realized_unverified'], to: 'realized_verified', description: 'Realization verified against the source by a person independent of owner and reporter' },
  reject_realization: { from: ['realized_unverified'], to: 'tracking', description: 'Reported realization not supported by the source' },
  cancel: { from: ['proposed', 'approved', 'tracking', 'realized_unverified'], to: 'cancelled', description: 'Benefit withdrawn (reason required)' },
  revise_definition: { from: ['approved', 'tracking'], to: 'proposed', description: 'Definition, baseline or target reopened for revision — needs a fresh independent acceptance (DOM-P4-12)' },
};

/**
 * What an independent Finance reviewer accepts into the register (spec §7.5 "measurement definition, baseline, target";
 * G7-C04 "baselined"): the measurement definition, the baseline and target values, their unit and the estimated value.
 */
export const BENEFIT_ACCEPTED_FIELDS = ['measurementDefinition', 'baselineValue', 'targetValue', 'unit', 'valueAmount', 'valueCurrency', 'valueUnitScale'] as const;

/**
 * DOM-P4-12: once accepted (approved / tracking / realization reported) the accepted fields are not edited in place — the
 * benefit is first reopened for revision (explicit command, reason required: back to `proposed`) and accepted again by
 * an independent reviewer. While a realization awaits verification the definition is fixed (reject the realization first).
 */
export function assertBenefitDefinitionEditable(status: BenefitStatus, changedFields: readonly string[]): void {
  const touched = changedFields.filter((f) => (BENEFIT_ACCEPTED_FIELDS as readonly string[]).includes(f));
  if (!touched.length || status === 'proposed') return;
  if (status === 'approved' || status === 'tracking') {
    throw ruleViolation(
      'finance.benefit.accepted_definition_locked',
      'The measurement definition, baseline, target and value of an accepted benefit change only through a revision: reopen the definition (with a reason) and have it accepted again',
      { fields: touched },
    );
  }
  if (status === 'realized_unverified') {
    throw ruleViolation('finance.benefit.realization_pending', 'The definition, baseline and target are fixed while a reported realization awaits verification', { fields: touched });
  }
}

/** Recording a realization needs the measured value, its date (not in the future) and the verification source. */
export function assertRealizationRecordable(r: { actualValue: string | null | undefined; realizedOn: string; verificationSource: string | null | undefined; today: string }): void {
  if (!r.verificationSource?.trim()) {
    throw ruleViolation('finance.benefit.verification_source_required', 'A benefit realization needs the verification source it will be verified against');
  }
  if (!r.actualValue?.trim()) throw invalid('finance.benefit.actual_required', 'Record the measured (actual) value');
  assertIsoDate(r.realizedOn);
  if (r.realizedOn > r.today) throw ruleViolation('finance.benefit.realized_in_future', `A realization cannot be dated after today (${r.today})`, { realizedOn: r.realizedOn, today: r.today });
}

/** Verification: a human who is neither the benefit owner nor the person who reported the realization; source present. */
export function assertBenefitVerifiable(
  b: { status: BenefitStatus; ownerUserId: string | null; realizationRecordedBy: string | null; verificationSource: string | null; evidenceLinkerUserIds: readonly string[] },
  actor: Actor,
): void {
  assertHumanActor(actor, 'Benefit verification');
  if (b.status !== 'realized_unverified') throw ruleViolation('finance.benefit.not_realized', `Only a reported realization can be verified (the benefit is ${b.status})`, { status: b.status });
  if (!b.verificationSource?.trim()) throw ruleViolation('finance.benefit.verification_source_required', 'A benefit realization needs its verification source');
  // access-matrix §5.1 (SEC-P34-01): the owner, the reporter of the realization and whoever linked its active evidence.
  if (actor.userId === b.ownerUserId || actor.userId === b.realizationRecordedBy || (!!actor.userId && b.evidenceLinkerUserIds.includes(actor.userId))) {
    throw forbidden('finance.benefit.verify_self', 'Separation of duties: the benefit owner, the person who reported the realization or who linked or uploaded its evidence cannot verify it');
  }
}

/** Money triple of a register field: all three parts or none. */
export function optionalMoney(amount: string | null, currency: string | null, unitScale: number | null): Money | null {
  if (amount === null && currency === null && unitScale === null) return null;
  if (amount === null || currency === null || unitScale === null) return null;
  return { amount, currency, unitScale };
}

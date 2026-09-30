'use client';

import { useEffect, useState } from 'react';
import { financeRoutes } from '@hub/contracts';
import { BUDGET_DECISION_TYPE_KEYS, FINANCE_DEFAULT_CLASSIFICATION, FINANCIAL_CATEGORIES, type Classification, type FinancialCategory } from '@hub/domain';
import { SelectField, TextAreaField, TextField } from '@/components/Field';
import { useToast } from '@/components/Toast';
import { hint } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { defaultClassification, useFinanceRefresh, useWritableClassifications, type BudgetLineDetail } from '@/lib/finance';
import { useProjectContext } from '@/lib/project-context';
import { ClassificationSelect, DecisionSelect, FinCommandDialog, FinFormDialog, MoneyFields, TsaSelect, WorkstreamSelect, currencyValid, decimalValid, emptyMoney, moneyFormOf, moneyOf, moneyValid, useUnitLabel } from './fin';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** A budget line: approved, committed and spent are kept separate (REQ-FIN-003); a TSA-charge line links its TSA (REQ-FIN-002). */
export function CreateBudgetLineDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: (id: string) => void }) {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useFinanceRefresh();
  const toast = useToast();
  const unit = useUnitLabel();
  const writable = useWritableClassifications();
  const proposed = FINANCE_DEFAULT_CLASSIFICATION.budget_line as Classification;
  const blank = () => ({
    name: '',
    category: 'one_off_separation' as FinancialCategory,
    currency: '',
    unitScale: '1',
    proposed: '',
    committed: '',
    spent: '',
    actualsAsOf: '',
    actualsSourceRef: '',
    tsaServiceId: '',
    workstreamId: '',
    sourceRef: '',
    classification: defaultClassification(proposed, writable),
  });
  const [f, setF] = useState(blank);
  useEffect(() => {
    if (open) setF(blank());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const nonNeg = (s: string) => !s.trim() || (decimalValid(s) && !s.trim().startsWith('-'));
  const hasActuals = !!f.committed.trim() || !!f.spent.trim();
  const valid =
    f.name.trim().length > 0 &&
    currencyValid(f.currency) &&
    nonNeg(f.proposed) &&
    nonNeg(f.committed) &&
    nonNeg(f.spent) &&
    (!hasActuals || (!!f.actualsAsOf && f.actualsSourceRef.trim().length > 0)) &&
    (f.category !== 'tsa_charge' || !!f.tsaServiceId);
  return (
    <FinFormDialog
      open={open}
      onClose={onClose}
      size="lg"
      testId="budget-form"
      title={t('finance.budget.create.title')}
      submitLabel={t('finance.budget.create.confirm')}
      disabled={!valid}
      onSubmit={async () => {
        const r = await api(financeRoutes.createBudgetLine, {
          params: { projectId },
          body: {
            name: f.name.trim(),
            category: f.category,
            currency: f.currency.trim().toUpperCase(),
            unitScale: Number(f.unitScale) as 1 | 1000 | 1000000,
            ...(f.proposed.trim() ? { proposedAmount: f.proposed.trim() } : {}),
            ...(f.committed.trim() ? { committedAmount: f.committed.trim() } : {}),
            ...(f.spent.trim() ? { spentAmount: f.spent.trim() } : {}),
            ...(f.actualsAsOf ? { actualsAsOf: f.actualsAsOf } : {}),
            ...(f.actualsSourceRef.trim() ? { actualsSourceRef: f.actualsSourceRef.trim() } : {}),
            ...(f.category === 'tsa_charge' && f.tsaServiceId ? { tsaServiceId: f.tsaServiceId } : {}),
            ...(f.workstreamId ? { workstreamId: f.workstreamId } : {}),
            ...(f.sourceRef.trim() ? { sourceRef: f.sourceRef.trim() } : {}),
            classification: f.classification,
          },
        });
        await refresh();
        toast.show('success', t('finance.budget.create.done', { code: r.code }));
        onClose();
        onCreated?.(r.id);
      }}
    >
      <p className={hint}>{t('finance.budget.create.hint')}</p>
      <TextField label={t('finance.budget.name')} required maxLength={300} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="budget-name" />
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField label={t('finance.snapshots.category')} required value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as FinancialCategory })} data-testid="budget-category">
          {FINANCIAL_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {tStatus('financialCategories', c)}
            </option>
          ))}
        </SelectField>
        <TextField label={t('finance.money.currency')} required dir="ltr" maxLength={3} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} data-testid="budget-currency" />
        <SelectField label={t('finance.money.unitScale')} required value={f.unitScale} onChange={(e) => setF({ ...f, unitScale: e.target.value })}>
          {([1, 1000, 1_000_000] as const).map((n) => (
            <option key={n} value={String(n)}>
              {unit(n)}
            </option>
          ))}
        </SelectField>
      </div>
      <p className={hint}>{t('finance.budget.create.unitHint')}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField label={t('finance.budget.proposed')} dir="ltr" inputMode="decimal" value={f.proposed} onChange={(e) => setF({ ...f, proposed: e.target.value })} error={nonNeg(f.proposed) ? null : t('finance.money.amountInvalid')} />
        <TextField label={t('finance.budget.committed')} dir="ltr" inputMode="decimal" value={f.committed} onChange={(e) => setF({ ...f, committed: e.target.value })} error={nonNeg(f.committed) ? null : t('finance.money.amountInvalid')} />
        <TextField label={t('finance.budget.spent')} dir="ltr" inputMode="decimal" value={f.spent} onChange={(e) => setF({ ...f, spent: e.target.value })} error={nonNeg(f.spent) ? null : t('finance.money.amountInvalid')} />
      </div>
      {hasActuals ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label={t('finance.budget.actualsAsOf')} required type="date" dir="ltr" max={today()} value={f.actualsAsOf} onChange={(e) => setF({ ...f, actualsAsOf: e.target.value })} />
          <TextField label={t('finance.budget.actualsSource')} required maxLength={2000} value={f.actualsSourceRef} onChange={(e) => setF({ ...f, actualsSourceRef: e.target.value })} />
        </div>
      ) : null}
      <p className={hint}>{t('finance.budget.approvedByDecision')}</p>
      {f.category === 'tsa_charge' ? <TsaSelect required value={f.tsaServiceId} onChange={(tsaServiceId) => setF({ ...f, tsaServiceId })} /> : null}
      <TextAreaField label={t('finance.budget.sourceRef')} rows={2} maxLength={2000} value={f.sourceRef} onChange={(e) => setF({ ...f, sourceRef: e.target.value })} />
      <div className="grid gap-3 sm:grid-cols-2">
        <WorkstreamSelect value={f.workstreamId} onChange={(workstreamId) => setF({ ...f, workstreamId })} />
        <ClassificationSelect value={f.classification} proposed={proposed} onChange={(classification) => setF({ ...f, classification })} />
      </div>
    </FinFormDialog>
  );
}

export function EditBudgetLineDialog({ line, open, onClose }: { line: BudgetLineDetail; open: boolean; onClose: () => void }) {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useFinanceRefresh();
  const toast = useToast();
  const writable = useWritableClassifications();
  const init = () => ({ name: line.name, proposed: line.proposed ? moneyFormOf(line.proposed).amount : '', sourceRef: line.sourceRef ?? '', workstreamId: line.workstreamId ?? '', classification: line.classification as Classification });
  const [f, setF] = useState(init);
  useEffect(() => {
    if (open) setF(init());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, line.version]);
  const valid = f.name.trim().length > 0 && (!f.proposed.trim() || (decimalValid(f.proposed) && !f.proposed.trim().startsWith('-')));
  const raiseOnly = writable.filter((c) => writable.indexOf(c) >= writable.indexOf(line.classification as Classification));
  return (
    <FinFormDialog
      open={open}
      onClose={onClose}
      testId="budget-edit-form"
      title={t('finance.budget.edit.title', { code: line.code })}
      submitLabel={t('common.actions.save')}
      disabled={!valid}
      onReload={() => void refresh()}
      onSubmit={async () => {
        const r = await api(financeRoutes.updateBudgetLine, {
          params: { projectId, budgetLineId: line.id },
          body: {
            expectedVersion: line.version,
            name: f.name.trim(),
            proposedAmount: f.proposed.trim() ? { amount: f.proposed.trim(), currency: line.currency, unitScale: line.unitScale as 1 | 1000 | 1000000 } : null,
            sourceRef: f.sourceRef.trim() || null,
            workstreamId: f.workstreamId || null,
            classification: f.classification,
          },
        });
        await refresh();
        toast.show('success', r.version === line.version ? t('finance.common.noChanges') : t('finance.common.saved'));
        onClose();
      }}
    >
      <p className={hint}>{t('finance.budget.edit.hint')}</p>
      <TextField label={t('finance.budget.name')} required maxLength={300} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <TextField label={t('finance.budget.proposedIn', { currency: line.currency })} dir="ltr" inputMode="decimal" value={f.proposed} onChange={(e) => setF({ ...f, proposed: e.target.value })} />
      <TextAreaField label={t('finance.budget.sourceRef')} rows={2} maxLength={2000} value={f.sourceRef} onChange={(e) => setF({ ...f, sourceRef: e.target.value })} />
      <WorkstreamSelect value={f.workstreamId} onChange={(workstreamId) => setF({ ...f, workstreamId })} />
      <SelectField label={t('finance.common.classification')} required value={f.classification} onChange={(e) => setF({ ...f, classification: e.target.value as Classification })} hint={t('finance.common.raiseOnly')}>
        {raiseOnly.map((c) => (
          <option key={c} value={c}>
            {tStatus('classifications', c)}
          </option>
        ))}
      </SelectField>
    </FinFormDialog>
  );
}

/** Commitments and spend as of a business date with their source, in the line's own currency and unit scale. */
export function RecordActualsDialog({ line, open, onClose }: { line: BudgetLineDetail; open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useFinanceRefresh();
  const toast = useToast();
  const unitOf = () => emptyMoney(line.currency, String(line.unitScale));
  const [committed, setCommitted] = useState(unitOf);
  const [spent, setSpent] = useState(unitOf);
  const [asOf, setAsOf] = useState('');
  const [sourceRef, setSourceRef] = useState('');
  useEffect(() => {
    if (!open) return;
    setCommitted(unitOf());
    setSpent(unitOf());
    setAsOf('');
    setSourceRef('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const any = !!committed.amount.trim() || !!spent.amount.trim();
  const valid = any && moneyValid(committed, false) && moneyValid(spent, false) && !!asOf && sourceRef.trim().length > 0;
  return (
    <FinCommandDialog
      open={open}
      onClose={onClose}
      expectedVersion={line.version}
      onReload={() => void refresh()}
      title={t('finance.budget.actuals.title', { code: line.code })}
      confirmLabel={t('finance.budget.actuals.confirm')}
      confirmDisabled={!valid}
      consequences={[t('finance.budget.actuals.effect'), t('common.command.audited')]}
      onConfirm={async ({ note }) => {
        const c = moneyOf(committed);
        const s = moneyOf(spent);
        await api(financeRoutes.recordBudgetActuals, {
          params: { projectId, budgetLineId: line.id },
          body: { expectedVersion: line.version, ...(c ? { committed: c } : {}), ...(s ? { spent: s } : {}), asOf, sourceRef: sourceRef.trim(), ...(note ? { note } : {}) },
        });
        await refresh();
        toast.show('success', t('finance.budget.actuals.done'));
        onClose();
      }}
    >
      <MoneyFields legend={t('finance.budget.committed')} lockUnit value={committed} onChange={setCommitted} hint={t('finance.budget.actuals.committedHint')} testId="actuals-committed" />
      <MoneyFields legend={t('finance.budget.spent')} lockUnit value={spent} onChange={setSpent} testId="actuals-spent" />
      <TextField label={t('finance.budget.actualsAsOf')} required type="date" dir="ltr" max={today()} min={line.actualsAsOf ?? undefined} value={asOf} onChange={(e) => setAsOf(e.target.value)} />
      <TextField label={t('finance.budget.actualsSource')} required maxLength={2000} value={sourceRef} onChange={(e) => setSourceRef(e.target.value)} />
    </FinCommandDialog>
  );
}

/** The approved budget is recorded from a FINAL governance decision (change control) — never set here on its own. */
export function RecordBudgetApprovalDialog({ line, open, onClose }: { line: BudgetLineDetail; open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useFinanceRefresh();
  const toast = useToast();
  const [decisionId, setDecisionId] = useState('');
  const [amount, setAmount] = useState(() => emptyMoney(line.currency, String(line.unitScale)));
  useEffect(() => {
    if (!open) return;
    setDecisionId('');
    setAmount(emptyMoney(line.currency, String(line.unitScale)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const valid = !!decisionId && moneyValid(amount, true) && !amount.amount.trim().startsWith('-');
  return (
    <FinCommandDialog
      open={open}
      onClose={onClose}
      expectedVersion={line.version}
      onReload={() => void refresh()}
      title={t('finance.budget.approval.title', { code: line.code })}
      confirmLabel={t('finance.budget.approval.confirm')}
      confirmDisabled={!valid}
      consequences={[t('finance.budget.approval.effect'), t('finance.budget.approval.unitRule'), t('common.command.audited')]}
      onConfirm={async ({ note }) => {
        await api(financeRoutes.recordBudgetApproval, { params: { projectId, budgetLineId: line.id }, body: { expectedVersion: line.version, decisionId, approvedAmount: moneyOf(amount)!, ...(note ? { note } : {}) } });
        await refresh();
        toast.show('success', t('finance.budget.approval.done'));
        onClose();
      }}
    >
      <DecisionSelect typeKeys={BUDGET_DECISION_TYPE_KEYS} value={decisionId} onChange={setDecisionId} />
      <MoneyFields legend={t('finance.budget.approvedAmount')} required lockUnit value={amount} onChange={setAmount} testId="approved-amount" />
    </FinCommandDialog>
  );
}

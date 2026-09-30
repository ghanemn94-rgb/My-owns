'use client';

import { useEffect, useState } from 'react';
import { financeRoutes } from '@hub/contracts';
import type { Classification } from '@hub/domain';
import { SelectField, TextAreaField, TextField } from '@/components/Field';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { hint } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { useFinanceRefresh, useWritableClassifications, type Reconciliation, type ReconciliationDetail } from '@/lib/finance';
import { useProjectContext } from '@/lib/project-context';
import { FinCommandDialog, FinFormDialog, MoneyFields, emptyMoney, moneyFormOf, moneyOf, moneyValid } from './fin';

export function ReconFlagBadge({ r }: { r: Pick<Reconciliation, 'flag' | 'unreconciled'> }) {
  const { t } = useI18n();
  const tone = r.flag === 'reconciled' || r.flag === 'explained_difference' ? 'success' : r.flag === 'unreconciled_difference' || r.flag === 'disputed' ? 'danger' : 'warning';
  return (
    <span data-testid="recon-flag" data-flag={r.flag}>
      <StatusBadge enumName="approvalStates" value={r.flag} tone={tone} label={t(`finance.recon.flags.${r.flag}`)} />
    </span>
  );
}

/** Counterparty balance / explanation (never the status; not once reconciled). A change makes the editor the preparer. */
export function EditReconciliationDialog({ r, open, onClose }: { r: ReconciliationDetail; open: boolean; onClose: () => void }) {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useFinanceRefresh();
  const toast = useToast();
  const writable = useWritableClassifications();
  const init = () => ({
    counterpartyLabel: r.counterpartyLabel,
    their: r.theirBalance ? moneyFormOf(r.theirBalance) : emptyMoney(r.ourBalance.currency, String(r.ourBalance.unitScale)),
    explanation: r.explanation ?? '',
    sourceRef: r.sourceRef ?? '',
    classification: r.classification as Classification,
  });
  const [f, setF] = useState(init);
  useEffect(() => {
    if (open) setF(init());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, r.version]);
  const valid = f.counterpartyLabel.trim() && f.sourceRef.trim() && moneyValid(f.their, false);
  const raiseOnly = writable.filter((c) => writable.indexOf(c) >= writable.indexOf(r.classification as Classification));
  return (
    <FinFormDialog
      open={open}
      onClose={onClose}
      testId="recon-edit-form"
      title={t('finance.recon.edit.title', { code: r.code })}
      submitLabel={t('common.actions.save')}
      disabled={!valid}
      onReload={() => void refresh()}
      onSubmit={async () => {
        const res = await api(financeRoutes.updateReconciliation, {
          params: { projectId, reconciliationId: r.id },
          body: {
            expectedVersion: r.version,
            counterpartyLabel: f.counterpartyLabel.trim(),
            theirBalance: moneyOf({ ...f.their, currency: r.ourBalance.currency, unitScale: String(r.ourBalance.unitScale) }),
            explanation: f.explanation.trim() || null,
            sourceRef: f.sourceRef.trim(),
            classification: f.classification,
          },
        });
        await refresh();
        toast.show('success', res.version === r.version ? t('finance.common.noChanges') : t('finance.recon.edit.done', { flag: t(`finance.recon.flags.${res.flag}`) }));
        onClose();
      }}
    >
      <p className={hint}>{t('finance.recon.edit.hint')}</p>
      <TextField label={t('finance.recon.counterparty')} required maxLength={300} value={f.counterpartyLabel} onChange={(e) => setF({ ...f, counterpartyLabel: e.target.value })} />
      <MoneyFields legend={t('finance.recon.theirBalance')} lockUnit value={f.their} onChange={(their) => setF({ ...f, their })} hint={t('finance.recon.sameUnitHint')} testId="recon-edit-their" />
      <TextAreaField label={t('finance.recon.explanation')} rows={3} maxLength={4000} value={f.explanation} onChange={(e) => setF({ ...f, explanation: e.target.value })} hint={t('finance.recon.explanationHint')} data-testid="recon-edit-explanation" />
      <TextAreaField label={t('finance.recon.sourceRef')} required rows={2} maxLength={2000} value={f.sourceRef} onChange={(e) => setF({ ...f, sourceRef: e.target.value })} />
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

export type ReconCommand = 'reconcile' | 'dispute' | 'reopen';

export function ReconCommandDialog({ r, cmd, onClose }: { r: ReconciliationDetail; cmd: ReconCommand | null; onClose: () => void }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useFinanceRefresh();
  const toast = useToast();
  if (!cmd) return null;
  const params = { projectId, reconciliationId: r.id };
  const v = r.version;
  const done = async (flag: Reconciliation['flag']) => {
    await refresh();
    toast.show('success', t('finance.recon.commandDone', { flag: t(`finance.recon.flags.${flag}`) }));
    onClose();
  };
  const common = { open: true, onClose, expectedVersion: v, onReload: () => void refresh() };
  if (cmd === 'reconcile') {
    return (
      <FinCommandDialog
        {...common}
        title={t('finance.recon.reconcile.title', { code: r.code })}
        confirmLabel={t('finance.recon.reconcile.confirm')}
        consequences={[t('finance.recon.reconcile.effect'), t('finance.recon.reconcile.sod'), t('common.command.audited')]}
        onConfirm={async ({ note }) => {
          const res = await api(financeRoutes.reconcile, { params, body: { expectedVersion: v, ...(note ? { note } : {}) } });
          await done(res.flag);
        }}
      />
    );
  }
  if (cmd === 'dispute') {
    return (
      <FinCommandDialog
        {...common}
        danger
        title={t('finance.recon.dispute.title', { code: r.code })}
        confirmLabel={t('finance.recon.dispute.confirm')}
        noteMode="required"
        noteLabel={t('finance.common.reason')}
        consequences={[t('finance.recon.dispute.effect'), t('common.command.audited')]}
        onConfirm={async ({ note }) => {
          const res = await api(financeRoutes.disputeReconciliation, { params, body: { expectedVersion: v, note } });
          await done(res.flag);
        }}
      />
    );
  }
  return (
    <FinCommandDialog
      {...common}
      title={t('finance.recon.reopen.title', { code: r.code })}
      confirmLabel={t('finance.recon.reopen.confirm')}
      noteMode="required"
      noteLabel={t('finance.common.reason')}
      consequences={[t('finance.recon.reopen.effect'), t('common.command.audited')]}
      onConfirm={async ({ note }) => {
        const res = await api(financeRoutes.reopenReconciliation, { params, body: { expectedVersion: v, note } });
        await done(res.flag);
      }}
    />
  );
}

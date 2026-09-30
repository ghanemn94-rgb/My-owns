'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { financeRoutes } from '@hub/contracts';
import { FINANCE_DEFAULT_CLASSIFICATION, type Classification } from '@hub/domain';
import { DataTable, type Column } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { TextAreaField, TextField } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { SearchInput } from '@/components/SearchInput';
import { useToast } from '@/components/Toast';
import { btn, cx, hint } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { RECONCILIATION_STATUS_VALUES, defaultClassification, finHref, useFinanceRefresh, useReconciliations, useWritableClassifications, type Reconciliation } from '@/lib/finance';
import { useProjectContext } from '@/lib/project-context';
import { Amount, ClassificationSelect, FilterBar, FilterSelect, FinFormDialog, MessageList, MoneyFields, emptyMoney, moneyOf, moneyValid, useUrlState, PeriodHint } from '../_components/fin';
import { ReconFlagBadge } from '../_components/recon';
import { periodValid } from '../_components/snapshot-forms';

const PAGE_SIZE = 25;
const FILTERS = ['q', 'status', 'unreconciled'] as const;

function CreateReconciliationDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useFinanceRefresh();
  const toast = useToast();
  const writable = useWritableClassifications();
  const proposed = FINANCE_DEFAULT_CLASSIFICATION.intercompany_reconciliation as Classification;
  const blank = () => ({ counterpartyLabel: '', period: '', our: emptyMoney(), their: emptyMoney(), explanation: '', sourceRef: '', classification: defaultClassification(proposed, writable) });
  const [f, setF] = useState(blank);
  useEffect(() => {
    if (open) setF(blank());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const valid = f.counterpartyLabel.trim() && periodValid(f.period) && moneyValid(f.our, true) && moneyValid(f.their, false) && f.sourceRef.trim();
  return (
    <FinFormDialog
      open={open}
      onClose={onClose}
      size="lg"
      testId="recon-form"
      title={t('finance.recon.create.title')}
      submitLabel={t('finance.recon.create.confirm')}
      disabled={!valid}
      onSubmit={async () => {
        const their = moneyOf(f.their);
        const r = await api(financeRoutes.createReconciliation, {
          params: { projectId },
          body: {
            counterpartyLabel: f.counterpartyLabel.trim(),
            period: f.period.trim(),
            ourBalance: moneyOf(f.our)!,
            ...(their ? { theirBalance: their } : {}),
            ...(f.explanation.trim() ? { explanation: f.explanation.trim() } : {}),
            sourceRef: f.sourceRef.trim(),
            classification: f.classification,
          },
        });
        await refresh();
        toast.show('success', t('finance.recon.create.done', { code: r.code }));
        onClose();
        onCreated(r.id);
      }}
    >
      <p className={hint}>{t('finance.recon.create.hint')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={t('finance.recon.counterparty')} required maxLength={300} value={f.counterpartyLabel} onChange={(e) => setF({ ...f, counterpartyLabel: e.target.value })} data-testid="recon-counterparty" />
        <TextField
          label={t('finance.snapshots.period')}
          required
          dir="ltr"
          maxLength={16}
          value={f.period}
          onChange={(e) => setF({ ...f, period: e.target.value })}
          hint={<PeriodHint />}
          error={f.period.trim() && !periodValid(f.period) ? t('finance.snapshots.periodInvalid') : null}
        />
      </div>
      <MoneyFields legend={t('finance.recon.ourBalance')} required value={f.our} onChange={(our) => setF({ ...f, our })} testId="recon-our" />
      <MoneyFields legend={t('finance.recon.theirBalance')} value={f.their} onChange={(their) => setF({ ...f, their })} hint={t('finance.recon.sameUnitHint')} testId="recon-their" />
      <TextAreaField label={t('finance.recon.explanation')} rows={2} maxLength={4000} value={f.explanation} onChange={(e) => setF({ ...f, explanation: e.target.value })} />
      <TextAreaField label={t('finance.recon.sourceRef')} required rows={2} maxLength={2000} value={f.sourceRef} onChange={(e) => setF({ ...f, sourceRef: e.target.value })} data-testid="recon-source" />
      <ClassificationSelect value={f.classification} proposed={proposed} onChange={(classification) => setF({ ...f, classification })} />
    </FinFormDialog>
  );
}

/** Intercompany reconciliations (REQ-FIN-004): differences flagged until reconciled by a reviewer who did not prepare them. */
export default function ReconciliationsPage() {
  const { t } = useI18n();
  const { projectId, can } = useProjectContext();
  const router = useRouter();
  const { values, page, set, clear, active } = useUrlState(FILTERS);
  const [createOpen, setCreateOpen] = useState(false);
  const base = finHref(projectId);
  const query = {
    page,
    pageSize: PAGE_SIZE,
    q: values.q || undefined,
    status: (values.status || undefined) as (typeof RECONCILIATION_STATUS_VALUES)[number] | undefined,
    unreconciled: (values.unreconciled || undefined) as 'true' | 'false' | undefined,
  };
  const list = useReconciliations(query);
  const columns: Column<Reconciliation>[] = [
    {
      key: 'code',
      header: t('finance.recon.code'),
      isRowHeader: true,
      sortValue: (x) => x.code,
      cell: (x) => (
        <span className="flex flex-wrap items-center gap-1">
          <Link href={`${base}/reconciliations/${x.id}`} className={cx(btn.link, 'whitespace-nowrap')} dir="ltr" data-testid="recon-link">
            {x.code}
          </Link>
          {x.isDemo ? <DemoBadge /> : null}
        </span>
      ),
    },
    { key: 'counterparty', header: t('finance.recon.counterparty'), sortValue: (x) => x.counterpartyLabel, cell: (x) => <span dir="auto">{x.counterpartyLabel}</span> },
    { key: 'period', header: t('finance.snapshots.period'), sortValue: (x) => x.period, cell: (x) => <span dir="ltr" className="tabular">{x.period}</span> },
    { key: 'our', header: t('finance.recon.ourBalance'), cell: (x) => <Amount value={x.ourBalance} /> },
    { key: 'their', header: t('finance.recon.theirBalance'), cell: (x) => <Amount value={x.theirBalance} /> },
    { key: 'diff', header: t('finance.recon.difference'), cell: (x) => <Amount value={x.difference} className={x.unreconciled && x.flag === 'unreconciled_difference' ? 'font-semibold text-danger' : undefined} /> },
    { key: 'flag', header: t('finance.recon.flag'), sortValue: (x) => x.flag, cell: (x) => <ReconFlagBadge r={x} /> },
    { key: 'notes', header: t('finance.recon.notes'), cell: (x) => <MessageList messages={x.notesI18n} fallback={x.notes} /> },
  ];
  return (
    <>
      <PageHeader
        title={t('finance.recon.title')}
        description={t('finance.recon.subtitle')}
        actions={
          can('finance.budget.manage') ? (
            <button type="button" className={btn.primary} onClick={() => setCreateOpen(true)} data-testid="create-recon">
              <Plus aria-hidden="true" className="size-4" />
              {t('finance.recon.create.action')}
            </button>
          ) : null
        }
      />
      <FilterBar onClear={clear} active={active}>
        <SearchInput className="w-full sm:w-64" label={t('finance.recon.search')} value={values.q} onChange={(v) => set({ q: v })} />
        <FilterSelect label={t('finance.recon.status')} value={values.status} onChange={(v) => set({ status: v })} options={RECONCILIATION_STATUS_VALUES.map((s) => ({ value: s, label: t(`finance.recon.statuses.${s}`) }))} />
        <FilterSelect
          label={t('finance.recon.unreconciledFilter')}
          value={values.unreconciled}
          onChange={(v) => set({ unreconciled: v })}
          options={[
            { value: 'true', label: t('finance.recon.onlyUnreconciled') },
            { value: 'false', label: t('finance.recon.onlyReconciled') },
          ]}
          testId="filter-unreconciled"
        />
      </FilterBar>
      <DataTable
        caption={t('finance.recon.title')}
        columns={columns}
        rows={list.data?.items}
        rowKey={(x) => x.id}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        emptyTitle={active ? t('finance.recon.emptySearch') : t('finance.recon.empty')}
        emptyHint={active ? undefined : t('finance.recon.emptyHint')}
        pagination={list.data ? { page, pageSize: PAGE_SIZE, total: list.data.total, onPageChange: (p) => set({ page: p }) } : undefined}
        testId="recons-table"
      />
      <CreateReconciliationDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={(id) => router.push(`${base}/reconciliations/${id}`)} />
    </>
  );
}

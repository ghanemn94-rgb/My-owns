'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Calculator, FileUp, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { APPROVAL_STATES, FINANCIAL_CATEGORIES, FINANCIAL_KINDS, type ApprovalState } from '@hub/domain';
import { DataTable, type Column } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { Dialog } from '@/components/Dialog';
import { PageHeader } from '@/components/PageHeader';
import { SearchInput } from '@/components/SearchInput';
import { StatusBadge } from '@/components/StatusBadge';
import { btn, cx } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import { finHref, useSnapshots, type Snapshot } from '@/lib/finance';
import { useProjectContext } from '@/lib/project-context';
import { AggregatePanel } from '../_components/aggregate';
import { Amount, FilterBar, FilterSelect, SourceText, useUrlState } from '../_components/fin';
import { CreateSnapshotDialog, ImportSnapshotsDialog } from '../_components/snapshot-forms';

const PAGE_SIZE = 25;
const FILTERS = ['q', 'kind', 'category', 'period', 'approvalState'] as const;

/** Baseline / forecast / actual figures (REQ-FIN-001): currency, unit, period, source and approval date on every row. */
export default function SnapshotsPage() {
  const { t, tStatus, formatDate } = useI18n();
  const { projectId, can } = useProjectContext();
  const router = useRouter();
  const { values, page, set, clear, active } = useUrlState(FILTERS);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [totalOpen, setTotalOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const base = finHref(projectId);
  const query = {
    page,
    pageSize: PAGE_SIZE,
    q: values.q || undefined,
    kind: (values.kind || undefined) as (typeof FINANCIAL_KINDS)[number] | undefined,
    category: (values.category || undefined) as (typeof FINANCIAL_CATEGORIES)[number] | undefined,
    period: values.period || undefined,
    approvalState: (values.approvalState || undefined) as ApprovalState | undefined,
  };
  const list = useSnapshots(query);
  const toggle = (id: string, on: boolean) => setSelected((s) => (on ? [...new Set([...s, id])] : s.filter((x) => x !== id)));
  const columns: Column<Snapshot>[] = [
    {
      key: 'select',
      header: t('finance.snapshots.selectColumn'),
      headerHidden: true,
      cell: (x) => (
        <input
          type="checkbox"
          className="size-4"
          checked={selected.includes(x.id)}
          onChange={(e) => toggle(x.id, e.target.checked)}
          aria-label={t('finance.snapshots.selectRow', { line: x.lineRef, period: x.period })}
          data-testid="snapshot-select"
          data-line-ref={x.lineRef}
        />
      ),
    },
    {
      key: 'lineRef',
      header: t('finance.snapshots.lineRef'),
      isRowHeader: true,
      sortValue: (x) => x.lineRef,
      cell: (x) => (
        <span className="flex flex-wrap items-center gap-1">
          <Link href={`${base}/snapshots/${x.id}`} className={cx(btn.link, 'whitespace-nowrap')} dir="ltr" data-testid="snapshot-link">
            {x.lineRef}
          </Link>
          {x.isDemo ? <DemoBadge /> : null}
        </span>
      ),
    },
    { key: 'label', header: t('finance.snapshots.label'), sortValue: (x) => x.label, cell: (x) => <span dir="auto">{x.label}</span> },
    { key: 'kind', header: t('finance.snapshots.kind'), sortValue: (x) => x.kind, cell: (x) => tStatus('financialKinds', x.kind) },
    { key: 'category', header: t('finance.snapshots.category'), sortValue: (x) => x.category, cell: (x) => tStatus('financialCategories', x.category) },
    { key: 'period', header: t('finance.snapshots.period'), sortValue: (x) => x.period, cell: (x) => <span dir="ltr" className="tabular">{x.period}</span> },
    { key: 'amount', header: t('finance.snapshots.amount'), cell: (x) => <Amount value={x.amount} showUnits /> },
    { key: 'source', header: t('finance.snapshots.source'), cell: (x) => <SourceText compact sourceType={x.sourceType} sourceRef={x.sourceRef} sourceDocumentId={x.sourceDocumentId} sheet={x.sourceSheet} cell={x.sourceCell} /> },
    {
      key: 'state',
      header: t('finance.snapshots.approvalState'),
      sortValue: (x) => x.approvalState,
      cell: (x) => (
        <span className="flex flex-col gap-0.5">
          <StatusBadge enumName="approvalStates" value={x.approvalState} />
          {x.approvalDate ? <span className="text-xs text-muted">{t('finance.snapshots.approvedOn', { date: formatDate(x.approvalDate) })}</span> : null}
        </span>
      ),
    },
  ];
  return (
    <>
      <PageHeader
        title={t('finance.snapshots.title')}
        description={t('finance.snapshots.subtitle')}
        actions={
          <>
            {can('finance.budget.manage') ? (
              <button type="button" className={btn.primary} onClick={() => setCreateOpen(true)} data-testid="create-snapshot">
                <Plus aria-hidden="true" className="size-4" />
                {t('finance.snapshots.create.action')}
              </button>
            ) : null}
            {can('finance.model.manage') ? (
              <button type="button" className={btn.secondary} onClick={() => setImportOpen(true)} data-testid="import-snapshots">
                <FileUp aria-hidden="true" className="size-4" />
                {t('finance.snapshots.import.action')}
              </button>
            ) : null}
          </>
        }
      />
      <FilterBar onClear={clear} active={active}>
        <SearchInput className="w-full sm:w-64" label={t('finance.snapshots.search')} value={values.q} onChange={(v) => set({ q: v })} />
        <FilterSelect label={t('finance.snapshots.kind')} value={values.kind} onChange={(v) => set({ kind: v })} options={FINANCIAL_KINDS.map((k) => ({ value: k, label: tStatus('financialKinds', k) }))} testId="filter-kind" />
        <FilterSelect label={t('finance.snapshots.category')} value={values.category} onChange={(v) => set({ category: v })} options={FINANCIAL_CATEGORIES.map((c) => ({ value: c, label: tStatus('financialCategories', c) }))} />
        <FilterSelect label={t('finance.snapshots.approvalState')} value={values.approvalState} onChange={(v) => set({ approvalState: v })} options={APPROVAL_STATES.map((s) => ({ value: s, label: tStatus('approvalStates', s) }))} testId="filter-state" />
        <PeriodFilter value={values.period} onChange={(v) => set({ period: v })} />
      </FilterBar>
      <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="selection-bar">
        <button type="button" className={btn.secondary} disabled={selected.length === 0} onClick={() => setTotalOpen(true)} data-testid="total-selected">
          <Calculator aria-hidden="true" className="size-4" />
          {t('finance.snapshots.totalSelected', { count: selected.length })}
        </button>
        {selected.length ? (
          <button type="button" className={btn.ghost} onClick={() => setSelected([])}>
            {t('finance.snapshots.clearSelection')}
          </button>
        ) : null}
        <span className="text-xs text-muted">{t('finance.snapshots.selectionHint')}</span>
      </div>
      <DataTable
        caption={t('finance.snapshots.title')}
        columns={columns}
        rows={list.data?.items}
        rowKey={(x) => x.id}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        emptyTitle={active ? t('finance.snapshots.emptySearch') : t('finance.snapshots.empty')}
        emptyHint={active ? undefined : t('finance.snapshots.emptyHint')}
        pagination={list.data ? { page, pageSize: PAGE_SIZE, total: list.data.total, onPageChange: (p) => set({ page: p }) } : undefined}
        testId="snapshots-table"
      />
      <CreateSnapshotDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={(id) => router.push(`${base}/snapshots/${id}`)} />
      <ImportSnapshotsDialog open={importOpen} onClose={() => setImportOpen(false)} />
      <Dialog open={totalOpen} onClose={() => setTotalOpen(false)} title={t('finance.aggregate.selectedTitle', { count: selected.length })} size="lg">
        {totalOpen ? <AggregatePanel snapshotIds={selected} framed={false} testId="aggregate-selected" /> : null}
      </Dialog>
    </>
  );
}

function PeriodFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onChange(draft.trim());
      }}
    >
      <label className="flex min-w-32 flex-col gap-1 text-sm font-medium text-ink">
        {t('finance.snapshots.period')}
        <input className="block min-h-10 w-32 rounded-md border border-line-strong bg-surface px-3 py-2 text-sm" dir="ltr" value={draft} maxLength={16} onChange={(e) => setDraft(e.target.value)} onBlur={() => onChange(draft.trim())} data-testid="filter-period" />
      </label>
    </form>
  );
}

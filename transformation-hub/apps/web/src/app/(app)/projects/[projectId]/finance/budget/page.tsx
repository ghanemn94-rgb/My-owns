'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { APPROVAL_STATES, FINANCIAL_CATEGORIES, type ApprovalState } from '@hub/domain';
import { DataTable, type Column } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { ScrollRegion } from '@/components/ScrollRegion';
import { SearchInput } from '@/components/SearchInput';
import { StatusBadge } from '@/components/StatusBadge';
import { btn, cx } from '@/components/ui';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { finHref, useBudgetLines, useSeparationCosts, type BudgetLine } from '@/lib/finance';
import { useProjectContext } from '@/lib/project-context';
import { CreateBudgetLineDialog } from '../_components/budget-forms';
import { Amount, FilterBar, FilterSelect, MessageList, Panel, useUnitLabel, useUrlState } from '../_components/fin';

const PAGE_SIZE = 25;
const FILTERS = ['q', 'category', 'approvalState'] as const;

/** Separation cost view (REQ-FIN-002): per category AND currency / unit scale; each TSA charge counted once. */
function SeparationCostView() {
  const { t, tStatus, formatNumber } = useI18n();
  const { projectId } = useProjectContext();
  const unit = useUnitLabel();
  const q = useSeparationCosts();
  const base = finHref(projectId);
  return (
    <Panel title={t('finance.costs.title')} testId="separation-costs">
      <p className="mb-3 text-sm text-muted">{t('finance.costs.explain')}</p>
      {q.isLoading ? <LoadingState compact /> : null}
      {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
      {q.data ? (
        <div className="space-y-4">
          {q.data.groups.length === 0 ? (
            <p className="text-sm text-muted">{t('finance.costs.noGroups')}</p>
          ) : (
            <ScrollRegion label={t('finance.costs.groupsCaption')} className="overflow-x-auto">
              <table className="w-full border-collapse text-sm" data-testid="cost-groups">
                <caption className="sr-only">{t('finance.costs.groupsCaption')}</caption>
                <thead className="bg-surface-muted">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-start font-semibold">{t('finance.snapshots.category')}</th>
                    <th scope="col" className="px-3 py-2 text-start font-semibold">{t('finance.summary.currencyUnit')}</th>
                    <th scope="col" className="px-3 py-2 text-start font-semibold">{t('finance.summary.lineCount')}</th>
                    <th scope="col" className="px-3 py-2 text-start font-semibold">{t('finance.costs.withoutApproved')}</th>
                    <th scope="col" className="px-3 py-2 text-start font-semibold">{t('finance.budget.approvedRecorded')}</th>
                    <th scope="col" className="px-3 py-2 text-start font-semibold">{t('finance.budget.committed')}</th>
                    <th scope="col" className="px-3 py-2 text-start font-semibold">{t('finance.budget.spent')}</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.groups.map((g) => (
                    <tr key={`${g.category}-${g.currency}-${g.unitScale}`} className="border-t border-line" data-category={g.category}>
                      <th scope="row" className="px-3 py-2 text-start font-medium">
                        <Link className={btn.link} href={`${base}/budget?category=${g.category}`}>
                          {tStatus('financialCategories', g.category)}
                        </Link>
                      </th>
                      <td className="px-3 py-2">
                        <span dir="ltr">{g.currency}</span> · {unit(g.unitScale)}
                      </td>
                      <td className="px-3 py-2 tabular">{formatNumber(g.lineCount)}</td>
                      <td className={cx('px-3 py-2 tabular', g.linesWithoutApprovedBudget > 0 && 'text-warning')}>{formatNumber(g.linesWithoutApprovedBudget)}</td>
                      <td className="px-3 py-2">
                        <Amount value={g.approved} />
                      </td>
                      <td className="px-3 py-2">
                        <Amount value={g.committed} />
                      </td>
                      <td className="px-3 py-2">
                        <Amount value={g.spent} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          )}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink">{t('finance.costs.tsaTitle')}</h3>
            {q.data.tsa.length === 0 ? (
              <p className="text-sm text-muted">{t('finance.costs.noTsa')}</p>
            ) : (
              <ul className="space-y-2" data-testid="cost-tsa">
                {q.data.tsa.map((x) => (
                  <li key={x.tsaServiceId} className="rounded-md border border-line p-3 text-sm" data-counted-in={x.countedIn}>
                    <p className="flex flex-wrap items-center gap-2">
                      <Link className={btn.link} href={`/projects/${projectId}/readiness/tsa/${x.tsaServiceId}`} dir="ltr">
                        {x.tsaCode}
                      </Link>
                      <span dir="auto">{x.tsaName}</span>
                      <StatusBadge
                        enumName="approvalStates"
                        value={x.countedIn === 'budget_line' ? 'approved' : 'proposed'}
                        tone={x.countedIn === 'budget_line' ? 'success' : 'warning'}
                        label={x.countedIn === 'budget_line' ? t('finance.costs.countedOnce') : t('finance.costs.notCounted')}
                      />
                      {x.budgetLineId ? (
                        <Link className={btn.link} href={`${base}/budget/${x.budgetLineId}`} dir="ltr">
                          {x.budgetLineCode}
                        </Link>
                      ) : null}
                      <span className="text-muted">
                        {t('finance.costs.registerCharge')}: <Amount value={x.registerCharge} />
                      </span>
                    </p>
                    <MessageList messages={x.notesI18n} fallback={x.notes} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <MessageList messages={q.data.findingsI18n} fallback={q.data.findings} tone="warning" testId="cost-findings" />
        </div>
      ) : null}
    </Panel>
  );
}

/** Budget lines (REQ-FIN-003): approved (from a governance decision), committed and spent kept separate. */
export default function BudgetPage() {
  const { t, tStatus, formatDate } = useI18n();
  const { projectId, can } = useProjectContext();
  const router = useRouter();
  const { values, page, set, clear, active } = useUrlState(FILTERS);
  const [createOpen, setCreateOpen] = useState(false);
  const base = finHref(projectId);
  const query = {
    page,
    pageSize: PAGE_SIZE,
    q: values.q || undefined,
    category: (values.category || undefined) as (typeof FINANCIAL_CATEGORIES)[number] | undefined,
    approvalState: (values.approvalState || undefined) as ApprovalState | undefined,
  };
  const list = useBudgetLines(query);
  const columns: Column<BudgetLine>[] = [
    {
      key: 'code',
      header: t('finance.budget.code'),
      isRowHeader: true,
      sortValue: (x) => x.code,
      cell: (x) => (
        <span className="flex flex-wrap items-center gap-1">
          <Link href={`${base}/budget/${x.id}`} className={cx(btn.link, 'whitespace-nowrap')} dir="ltr" data-testid="budget-link">
            {x.code}
          </Link>
          {x.isDemo ? <DemoBadge /> : null}
        </span>
      ),
    },
    { key: 'name', header: t('finance.budget.name'), sortValue: (x) => x.name, cell: (x) => <span dir="auto" className="block min-w-56">{x.name}</span> },
    {
      key: 'category',
      header: t('finance.snapshots.category'),
      sortValue: (x) => x.category,
      cell: (x) => (
        <span className="flex min-w-32 flex-col gap-0.5">
          <span>{tStatus('financialCategories', x.category)}</span>
          {x.tsaServiceId ? <span className="text-xs text-muted">{t('finance.budget.tsaLinked')}</span> : null}
        </span>
      ),
    },
    {
      key: 'approved',
      header: t('finance.budget.approved'),
      cell: (x) => (
        <span className="flex flex-col gap-0.5">
          {x.approved ? (
            <Amount value={x.approved} showUnits />
          ) : (
            <span className="text-sm whitespace-nowrap text-muted" data-testid="no-approved-budget">
              {t('finance.budget.notApproved')}
            </span>
          )}
          {x.proposed ? (
            <span className="text-xs text-muted">
              {t('finance.budget.proposed')}: <Amount value={x.proposed} />
            </span>
          ) : null}
        </span>
      ),
    },
    { key: 'committed', header: t('finance.budget.committed'), cell: (x) => <Amount value={x.committed} showUnits /> },
    { key: 'spent', header: t('finance.budget.spent'), cell: (x) => <Amount value={x.spent} showUnits /> },
    { key: 'open', header: t('finance.budget.openCommitment'), cell: (x) => <Amount value={x.openCommitment} showUnits /> },
    {
      key: 'asof',
      header: t('finance.budget.actualsAsOf'),
      cell: (x) => (x.actualsAsOf ? <span className="tabular whitespace-nowrap">{formatDate(x.actualsAsOf)}</span> : <span className="text-muted">{EM_DASH}</span>),
    },
    {
      key: 'flags',
      header: t('finance.budget.flags'),
      cell: (x) => {
        // "No approved budget" is already shown in the Approved column; the other flags are problems.
        const idx = x.flagsI18n.map((m, i) => (m.code === 'finance.budget.no_approved_budget' ? -1 : i)).filter((i) => i >= 0);
        return idx.length ? (
          <span className="block min-w-56">
            <MessageList messages={idx.map((i) => x.flagsI18n[i]!)} fallback={idx.map((i) => x.flags[i] ?? '')} tone="danger" testId="budget-row-flags" />
          </span>
        ) : (
          <span className="text-muted">{EM_DASH}</span>
        );
      },
    },
  ];
  return (
    <>
      <PageHeader
        title={t('finance.budget.title')}
        description={t('finance.budget.subtitle')}
        actions={
          can('finance.budget.manage') ? (
            <button type="button" className={btn.primary} onClick={() => setCreateOpen(true)} data-testid="create-budget-line">
              <Plus aria-hidden="true" className="size-4" />
              {t('finance.budget.create.action')}
            </button>
          ) : null
        }
      />
      <FilterBar onClear={clear} active={active}>
        <SearchInput className="w-full sm:w-64" label={t('finance.budget.search')} value={values.q} onChange={(v) => set({ q: v })} />
        <FilterSelect label={t('finance.snapshots.category')} value={values.category} onChange={(v) => set({ category: v })} options={FINANCIAL_CATEGORIES.map((c) => ({ value: c, label: tStatus('financialCategories', c) }))} testId="filter-budget-category" />
        <FilterSelect label={t('finance.budget.approvalState')} value={values.approvalState} onChange={(v) => set({ approvalState: v })} options={APPROVAL_STATES.map((s) => ({ value: s, label: tStatus('approvalStates', s) }))} />
      </FilterBar>
      <DataTable
        caption={t('finance.budget.title')}
        columns={columns}
        rows={list.data?.items}
        rowKey={(x) => x.id}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        emptyTitle={active ? t('finance.budget.emptySearch') : t('finance.budget.empty')}
        pagination={list.data ? { page, pageSize: PAGE_SIZE, total: list.data.total, onPageChange: (p) => set({ page: p }) } : undefined}
        testId="budget-table"
      />
      <div className="mt-6">
        <SeparationCostView />
      </div>
      <CreateBudgetLineDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={(id) => router.push(`${base}/budget/${id}`)} />
    </>
  );
}

'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { MODEL_KINDS } from '@hub/domain';
import { DataTable, type Column } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { PageHeader } from '@/components/PageHeader';
import { SearchInput } from '@/components/SearchInput';
import { StatusBadge } from '@/components/StatusBadge';
import { btn, cx } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import { finHref, useModels, type FinancialModel } from '@/lib/finance';
import { useProjectContext } from '@/lib/project-context';
import { Callout, FilterBar, FilterSelect, useUrlState } from '../_components/fin';
import { CreateModelDialog } from '../_components/model-forms';

const PAGE_SIZE = 25;
const FILTERS = ['q', 'kind'] as const;

/** Business plans and valuation models (REQ-FIN-005..008): references to the original models, versioned per case. */
export default function ModelsPage() {
  const { t, tStatus } = useI18n();
  const { projectId, can } = useProjectContext();
  const router = useRouter();
  const { values, page, set, clear, active } = useUrlState(FILTERS);
  const [createOpen, setCreateOpen] = useState(false);
  const base = finHref(projectId);
  const list = useModels({ page, pageSize: PAGE_SIZE, q: values.q || undefined, kind: (values.kind || undefined) as (typeof MODEL_KINDS)[number] | undefined });
  const columns: Column<FinancialModel>[] = [
    {
      key: 'code',
      header: t('finance.models.code'),
      isRowHeader: true,
      sortValue: (x) => x.code,
      cell: (x) => (
        <span className="flex flex-wrap items-center gap-1">
          <Link href={`${base}/models/${x.id}`} className={cx(btn.link, 'whitespace-nowrap')} dir="ltr" data-testid="model-link">
            {x.code}
          </Link>
          {x.isDemo ? <DemoBadge /> : null}
        </span>
      ),
    },
    { key: 'name', header: t('finance.models.name'), sortValue: (x) => x.name, cell: (x) => <span dir="auto">{x.name}</span> },
    { key: 'kind', header: t('finance.models.kind'), sortValue: (x) => x.kind, cell: (x) => tStatus('modelKinds', x.kind) },
    {
      key: 'latest',
      header: t('finance.models.latest'),
      cell: (x) =>
        x.latest.length === 0 ? (
          <span className="text-sm text-muted">{t('finance.models.noVersions')}</span>
        ) : (
          <ul className="flex flex-col gap-1">
            {x.latest.map((l) => (
              <li key={l.modelCase} className="flex flex-wrap items-center gap-1 text-xs">
                <Link className={btn.link} href={`${base}/models/${x.id}/versions/${l.versionId}`}>
                  {t('finance.models.caseVersion', { case: tStatus('modelCases', l.modelCase), version: l.versionNo })}
                </Link>
                <StatusBadge enumName="approvalStates" value={l.approvalState} />
              </li>
            ))}
          </ul>
        ),
    },
    { key: 'classification', header: t('finance.common.classification'), cell: (x) => tStatus('classifications', x.classification) },
  ];
  return (
    <>
      <PageHeader
        title={t('finance.models.title')}
        description={t('finance.models.subtitle')}
        actions={
          can('finance.model.manage') ? (
            <button type="button" className={btn.primary} onClick={() => setCreateOpen(true)} data-testid="create-model">
              <Plus aria-hidden="true" className="size-4" />
              {t('finance.models.create.action')}
            </button>
          ) : null
        }
      />
      <Callout testId="models-proposed-vs-approved">{t('finance.models.proposedVsApproved')}</Callout>
      <div className="mt-4">
        <FilterBar onClear={clear} active={active}>
          <SearchInput className="w-full sm:w-64" label={t('finance.models.search')} value={values.q} onChange={(v) => set({ q: v })} />
          <FilterSelect label={t('finance.models.kind')} value={values.kind} onChange={(v) => set({ kind: v })} options={MODEL_KINDS.map((k) => ({ value: k, label: tStatus('modelKinds', k) }))} />
        </FilterBar>
      </div>
      <DataTable
        caption={t('finance.models.title')}
        columns={columns}
        rows={list.data?.items}
        rowKey={(x) => x.id}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        emptyTitle={active ? t('finance.models.emptySearch') : t('finance.models.empty')}
        emptyHint={active ? undefined : t('finance.models.emptyHint')}
        pagination={list.data ? { page, pageSize: PAGE_SIZE, total: list.data.total, onPageChange: (p) => set({ page: p }) } : undefined}
        testId="models-table"
      />
      <CreateModelDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={(id) => router.push(`${base}/models/${id}`)} />
    </>
  );
}

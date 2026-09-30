'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { BENEFIT_STATUSES, type BenefitStatus } from '@hub/domain';
import { DataTable, type Column } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { PageHeader } from '@/components/PageHeader';
import { SearchInput } from '@/components/SearchInput';
import { StatusBadge } from '@/components/StatusBadge';
import { btn, cx } from '@/components/ui';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { finHref, useBenefits, useKpis, type Benefit, type Kpi } from '@/lib/finance';
import { useLocalized } from '@/lib/i18n-data';
import { useProjectContext } from '@/lib/project-context';
import { BenefitFormDialog, CreateKpiDialog } from '../_components/benefit-forms';
import { Amount, FilterBar, FilterSelect, useUrlState } from '../_components/fin';

const PAGE_SIZE = 25;
const KPI_PAGE_SIZE = 25;
const FILTERS = ['q', 'status'] as const;

function KpiSection() {
  const { t, tStatus, formatNumber } = useI18n();
  const { projectId, can } = useProjectContext();
  const router = useRouter();
  const loc = useLocalized();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const list = useKpis({ page, pageSize: KPI_PAGE_SIZE, q: q || undefined });
  const base = finHref(projectId);
  const columns: Column<Kpi>[] = [
    {
      key: 'key',
      header: t('finance.kpis.key'),
      isRowHeader: true,
      sortValue: (x) => x.key,
      cell: (x) => (
        <span className="flex flex-wrap items-center gap-1">
          <Link href={`${base}/kpis/${x.id}`} className={cx(btn.link, 'whitespace-nowrap')} dir="ltr" data-testid="kpi-link">
            {x.key}
          </Link>
          {x.isDemo ? <DemoBadge /> : null}
        </span>
      ),
    },
    { key: 'name', header: t('finance.kpis.name'), sortValue: (x) => loc(x.name, x.nameAr), cell: (x) => <span dir="auto" className="block min-w-40">{loc(x.name, x.nameAr)}</span> },
    { key: 'unit', header: t('finance.kpis.unit'), cell: (x) => <span dir="auto">{x.unit}</span> },
    { key: 'direction', header: t('finance.kpis.direction'), cell: (x) => tStatus('kpiDirections', x.direction) },
    { key: 'target', header: t('finance.kpis.target'), cell: (x) => <span dir="auto">{x.target ?? EM_DASH}</span> },
    {
      key: 'latest',
      header: t('finance.kpis.latest'),
      cell: (x) =>
        x.latestObservation ? (
          <span className="flex flex-col gap-0.5 text-sm">
            <span dir="ltr" className="tabular">
              {x.latestObservation.value ?? EM_DASH}
            </span>
            <span className="text-xs text-muted">
              <span dir="ltr">{x.latestObservation.period}</span> · {t(`finance.kpis.quality.${x.latestObservation.dataQuality}`)}
            </span>
          </span>
        ) : (
          <span className="text-sm text-muted">{t('finance.kpis.noObservation')}</span>
        ),
    },
    { key: 'verification', header: t('finance.kpis.verification'), cell: (x) => <StatusBadge enumName="verificationStatuses" value={x.verificationStatus} /> },
  ];
  return (
    <section id="kpis" aria-labelledby="kpis-heading" className="scroll-mt-4 space-y-3" data-testid="kpi-section">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="kpis-heading" className="text-lg font-semibold text-ink">
          {t('finance.kpis.title')}
        </h2>
        {can('finance.kpi.manage') ? (
          <button type="button" className={btn.secondary} onClick={() => setCreateOpen(true)} data-testid="create-kpi">
            <Plus aria-hidden="true" className="size-4" />
            {t('finance.kpis.create.action')}
          </button>
        ) : null}
      </div>
      <p className="text-sm text-muted">{t('finance.kpis.subtitle', { count: formatNumber(list.data?.total ?? null) })}</p>
      <SearchInput
        className="w-full sm:w-64"
        label={t('finance.kpis.search')}
        value={q}
        onChange={(v) => {
          setQ(v);
          setPage(1);
        }}
      />
      <DataTable
        caption={t('finance.kpis.title')}
        columns={columns}
        rows={list.data?.items}
        rowKey={(x) => x.id}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        emptyTitle={q ? t('finance.kpis.emptySearch') : t('finance.kpis.empty')}
        pagination={list.data ? { page, pageSize: KPI_PAGE_SIZE, total: list.data.total, onPageChange: setPage } : undefined}
        testId="kpis-table"
      />
      <CreateKpiDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={(id) => router.push(`${base}/kpis/${id}`)} />
    </section>
  );
}

/** Benefits register (REQ-FIN-009) and KPIs: definition, baseline, target, owner, realization date, verification source. */
export default function BenefitsPage() {
  const { t, tStatus, formatDate } = useI18n();
  const { projectId, can } = useProjectContext();
  const router = useRouter();
  const { values, page, set, clear, active } = useUrlState(FILTERS);
  const [createOpen, setCreateOpen] = useState(false);
  const base = finHref(projectId);
  const list = useBenefits({ page, pageSize: PAGE_SIZE, q: values.q || undefined, status: (values.status || undefined) as BenefitStatus | undefined });
  const columns: Column<Benefit>[] = [
    {
      key: 'code',
      header: t('finance.benefits.code'),
      isRowHeader: true,
      sortValue: (x) => x.code,
      cell: (x) => (
        <span className="flex flex-wrap items-center gap-1">
          <Link href={`${base}/benefits/${x.id}`} className={cx(btn.link, 'whitespace-nowrap')} dir="ltr" data-testid="benefit-link">
            {x.code}
          </Link>
          {x.isDemo ? <DemoBadge /> : null}
        </span>
      ),
    },
    { key: 'title', header: t('finance.benefits.titleField'), sortValue: (x) => x.title, cell: (x) => <span dir="auto" className="block min-w-56">{x.title}</span> },
    { key: 'baseline', header: t('finance.benefits.baseline'), cell: (x) => <span dir="auto">{x.baselineValue ?? EM_DASH}</span> },
    { key: 'target', header: t('finance.benefits.target'), cell: (x) => <span dir="auto">{x.targetValue ?? EM_DASH}</span> },
    { key: 'actual', header: t('finance.benefits.actual'), cell: (x) => <span dir="auto">{x.actualValue ?? EM_DASH}</span> },
    { key: 'value', header: t('finance.benefits.value'), cell: (x) => <Amount value={x.value} /> },
    { key: 'date', header: t('finance.benefits.realizationDate'), sortValue: (x) => x.realizationDate ?? '', cell: (x) => <span className="tabular">{formatDate(x.realizationDate)}</span> },
    { key: 'status', header: t('finance.benefits.status'), sortValue: (x) => x.status, cell: (x) => <StatusBadge enumName="benefitStatuses" value={x.status} /> },
    { key: 'source', header: t('finance.benefits.verificationSource'), cell: (x) => <span dir="auto" className="line-clamp-2 block min-w-40 text-xs">{x.verificationSource ?? EM_DASH}</span> },
  ];
  return (
    <>
      <PageHeader
        title={t('finance.benefits.title')}
        description={t('finance.benefits.subtitle')}
        actions={
          can('finance.benefit.manage') ? (
            <button type="button" className={btn.primary} onClick={() => setCreateOpen(true)} data-testid="create-benefit">
              <Plus aria-hidden="true" className="size-4" />
              {t('finance.benefits.create.action')}
            </button>
          ) : null
        }
      />
      <FilterBar onClear={clear} active={active}>
        <SearchInput className="w-full sm:w-64" label={t('finance.benefits.search')} value={values.q} onChange={(v) => set({ q: v })} />
        <FilterSelect label={t('finance.benefits.status')} value={values.status} onChange={(v) => set({ status: v })} options={BENEFIT_STATUSES.map((s) => ({ value: s, label: tStatus('benefitStatuses', s) }))} testId="filter-benefit-status" />
      </FilterBar>
      <DataTable
        caption={t('finance.benefits.title')}
        columns={columns}
        rows={list.data?.items}
        rowKey={(x) => x.id}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        emptyTitle={active ? t('finance.benefits.emptySearch') : t('finance.benefits.empty')}
        pagination={list.data ? { page, pageSize: PAGE_SIZE, total: list.data.total, onPageChange: (p) => set({ page: p }) } : undefined}
        testId="benefits-table"
      />
      <div className="mt-8">
        <KpiSection />
      </div>
      <BenefitFormDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={(id) => router.push(`${base}/benefits/${id}`)} />
    </>
  );
}

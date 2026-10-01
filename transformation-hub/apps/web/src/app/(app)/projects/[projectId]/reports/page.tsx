'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FilePlus2 } from 'lucide-react';
import { useState } from 'react';
import { REPORT_KINDS, type ReportKind } from '@hub/domain';
import { DataTable, type Column } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { PageHeader } from '@/components/PageHeader';
import { RestrictedState } from '@/components/RestrictedState';
import { StatusBadge } from '@/components/StatusBadge';
import { btn, cx } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import { useProjectContext } from '@/lib/project-context';
import { reportsHref, scopeText, useReportLabels, useReportSnapshots, type SnapshotSummary } from '@/lib/reports';
import { FilterBar, FilterSelect, GenerateReportDialog, useUrlState } from './_components/rp';

const PAGE_SIZE = 25;
const FILTERS = ['kind'] as const;

/**
 * Report snapshots of the project (REQ-RPT-001..008): every snapshot the caller may open now, newest first. Partial views
 * (sections outside the caller's current access) are marked; the server already left out snapshots with no readable section.
 */
export default function ReportsPage() {
  const { t, tStatus, formatDate, formatDateTime, formatNumber } = useI18n();
  const { projectId, project, can } = useProjectContext();
  const router = useRouter();
  const { values, page, set, clear, active } = useUrlState(FILTERS);
  const [generateOpen, setGenerateOpen] = useState(false);
  const L = useReportLabels(project.timezone);
  const canRead = can('reports.snapshot.read');
  const canGenerate = can('reports.report.generate');
  const list = useReportSnapshots({ page, pageSize: PAGE_SIZE, kind: (values.kind || undefined) as ReportKind | undefined });
  const base = reportsHref(projectId);
  const columns: Column<SnapshotSummary>[] = [
    {
      key: 'report',
      header: t('reports.list.columns.report'),
      isRowHeader: true,
      cell: (s) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <Link
            href={`${base}/${s.id}`}
            className={btn.link}
            data-testid="snapshot-link"
            data-kind={s.kind}
            aria-label={t('reports.list.open', { report: tStatus('reportKinds', s.kind), date: formatDate(s.asOfLocalDate) })}
          >
            {tStatus('reportKinds', s.kind)}
          </Link>
          {s.includesDemoData ? <DemoBadge /> : null}
        </span>
      ),
    },
    { key: 'asOf', header: t('reports.list.columns.asOf'), cell: (s) => <span className="whitespace-nowrap tabular">{formatDate(s.asOfLocalDate)}</span> },
    { key: 'scope', header: t('reports.list.columns.scope'), cell: (s) => <span dir="auto">{scopeText(L, s)}</span> },
    { key: 'classification', header: t('reports.list.columns.classification'), cell: (s) => <StatusBadge enumName="classifications" value={s.classification} tone="neutral" /> },
    {
      key: 'sections',
      header: t('reports.list.columns.sections'),
      cell: (s) => (
        <span className="flex flex-col gap-0.5" data-testid="snapshot-sections" data-complete={s.complete}>
          <span className="tabular">{t('reports.list.sectionsOf', { included: formatNumber(s.includedSectionCount), total: formatNumber(s.sectionCount) })}</span>
          {!s.complete ? <span className="text-xs font-medium text-warning">{t('reports.list.partial')}</span> : null}
        </span>
      ),
    },
    { key: 'generatedBy', header: t('reports.list.columns.generatedBy'), cell: (s) => <span dir="auto">{s.generatedByName ?? L.meta('none')}</span> },
    { key: 'generatedAt', header: t('reports.list.columns.generatedAt'), cell: (s) => <span className="whitespace-nowrap">{formatDateTime(s.generatedAt)}</span> },
  ];
  return (
    <>
      <PageHeader
        title={t('reports.list.title')}
        description={t('reports.list.subtitle')}
        actions={
          canGenerate ? (
            <button type="button" className={btn.primary} onClick={() => setGenerateOpen(true)} data-testid="generate-report-open">
              <FilePlus2 aria-hidden="true" className="size-4" />
              {t('reports.list.generate')}
            </button>
          ) : null
        }
      />
      {canRead ? (
        <>
          <FilterBar onClear={clear} active={active}>
            <FilterSelect label={t('reports.list.filterKind')} value={values.kind} onChange={(v) => set({ kind: v })} options={REPORT_KINDS.filter((k) => k !== 'register_export').map((k) => ({ value: k, label: tStatus('reportKinds', k) }))} testId="filter-kind" />
          </FilterBar>
          <DataTable
            caption={t('reports.list.caption')}
            columns={columns}
            rows={list.data?.items}
            rowKey={(s) => s.id}
            isLoading={list.isLoading}
            error={list.error}
            onRetry={() => list.refetch()}
            emptyTitle={active ? t('reports.list.emptyFiltered') : t('reports.list.empty')}
            emptyHint={!active && canGenerate ? t('reports.list.emptyHint') : undefined}
            pagination={list.data ? { page, pageSize: PAGE_SIZE, total: list.data.total, onPageChange: (p) => set({ page: p }) } : undefined}
            className={cx(list.isFetching && list.data && 'opacity-80')}
            testId="reports-table"
          />
        </>
      ) : (
        <RestrictedState showHomeLink={false} />
      )}
      <GenerateReportDialog open={generateOpen} onClose={() => setGenerateOpen(false)} onCreated={(id) => router.push(`${base}/${id}`)} />
    </>
  );
}

'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ActivityHistory } from '@/components/ActivityHistory';
import { DataTable, type Column } from '@/components/DataTable';
import { PageHeader } from '@/components/PageHeader';
import { SearchInput } from '@/components/SearchInput';
import { SectionGuard } from '@/components/SectionGuard';
import { btn } from '@/components/ui';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { useProjectContext } from '@/lib/project-context';
import { useWorkstreams } from '@/lib/queries';
import { accountableFunction, workstreamName, workstreamNameLang, type Workstream } from '@/lib/workstreams';

export default function WorkstreamsPage() {
  const { t, locale, formatNumber } = useI18n();
  const { projectId, project } = useProjectContext();
  const ws = useWorkstreams(projectId);
  const [q, setQ] = useState('');

  const rows = useMemo(() => {
    const items = ws.data?.items;
    if (!items || !q) return items;
    const needle = q.toLocaleLowerCase();
    return items.filter((w) => [w.code, w.name, w.nameAr ?? '', w.leadName ?? '', w.proposedLeadFunction ?? ''].some((s) => s.toLocaleLowerCase().includes(needle)));
  }, [ws.data, q]);

  const columns: Column<Workstream>[] = [
    {
      key: 'code',
      header: t('project.workstreams.code'),
      isRowHeader: true,
      sortValue: (w) => w.code,
      cell: (w) => (
        <Link href={`/projects/${projectId}/workstreams/${w.id}`} className={btn.link} dir="ltr">
          {w.code}
        </Link>
      ),
    },
    {
      key: 'name',
      header: t('project.workstreams.name'),
      sortValue: (w) => workstreamName(w, locale),
      cell: (w) => (
        <Link href={`/projects/${projectId}/workstreams/${w.id}`} className="text-ink hover:text-primary hover:underline" {...workstreamNameLang(w, locale)}>
          {workstreamName(w, locale)}
        </Link>
      ),
    },
    {
      key: 'lead',
      header: t('project.workstreams.lead'),
      sortValue: (w) => w.leadName ?? '',
      cell: (w) =>
        w.leadName ? (
          <span dir="auto">{w.leadName}</span>
        ) : (
          <span className="text-muted">
            {t('project.workstreams.unassigned')}
            {w.proposedLeadFunction ? (
              <>
                {' — '}
                {t('project.workstreams.proposedFunction', { fn: w.proposedLeadFunction })}
              </>
            ) : null}
          </span>
        ),
    },
    { key: 'accountable', header: t('project.workstreams.accountable'), cell: (w) => <span dir="auto">{accountableFunction(w) ?? EM_DASH}</span> },
    { key: 'tasks', header: t('project.metrics.tasks'), sortValue: (w) => w.counts.tasks, cell: (w) => <span className="tabular">{formatNumber(w.counts.tasks)}</span> },
    {
      key: 'deliverables',
      header: t('project.metrics.deliverables'),
      sortValue: (w) => w.counts.deliverables,
      cell: (w) => <span className="tabular">{formatNumber(w.counts.deliverables)}</span>,
    },
    { key: 'risks', header: t('portfolio.openRisks'), sortValue: (w) => w.counts.openRisks, cell: (w) => <span className="tabular">{formatNumber(w.counts.openRisks)}</span> },
    { key: 'gates', header: t('project.workstreams.gates'), cell: (w) => <span dir="ltr">{w.linkedGateKeys.join(', ') || EM_DASH}</span> },
  ];

  return (
    <SectionGuard section="workstreams">
      <PageHeader
        eyebrow={<span dir="auto">{project.code}</span>}
        title={t('project.workstreams.title')}
        description={t('project.workstreams.subtitle')}
      />
      <div className="mb-4 sm:w-80">
        <SearchInput label={t('project.workstreams.search')} value={q} onChange={setQ} />
      </div>
      <DataTable
        caption={t('project.workstreams.title')}
        columns={columns}
        rows={rows}
        rowKey={(w) => w.id}
        isLoading={ws.isLoading}
        error={ws.error}
        onRetry={() => ws.refetch()}
        emptyTitle={q ? t('project.workstreams.emptySearch') : t('project.workstreams.empty')}
        clientPageSize={25}
        testId="workstreams-table"
      />
      <p className="mt-2 text-xs text-muted">{t('project.workstreams.countsHint')}</p>
      <ActivityHistory className="mt-6" projectId={projectId} entityType="workstream" />
    </SectionGuard>
  );
}

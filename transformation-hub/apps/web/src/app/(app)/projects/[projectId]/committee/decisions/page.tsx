'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FilePlus } from 'lucide-react';
import { useState } from 'react';
import { DECISION_AUTHORITY_OUTCOMES, DECISION_STATUSES } from '@hub/domain';
import { DataTable, type Column } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { PageHeader } from '@/components/PageHeader';
import { SearchInput } from '@/components/SearchInput';
import { StatusBadge } from '@/components/StatusBadge';
import { btn } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import { useProjectContext } from '@/lib/project-context';
import { DecisionPaperDialog } from '../_components/dialogs';
import { FilterBar, FilterSelect, UText, hubHref, useCommitteeList, useDecisionList, useUrlState, type Decision } from '../_components/gov';

const PAGE_SIZE = 20;
const FILTERS = ['q', 'status', 'authorityOutcome', 'committeeId', 'meetingId'] as const;
type Status = (typeof DECISION_STATUSES)[number];
type Authority = (typeof DECISION_AUTHORITY_OUTCOMES)[number];

export default function DecisionsPage() {
  const { t, tStatus, formatDate, formatDateTime } = useI18n();
  const { projectId, can } = useProjectContext();
  const router = useRouter();
  const { values, page, set, clear, active } = useUrlState(FILTERS);
  const [createOpen, setCreateOpen] = useState(false);
  const committees = useCommitteeList();
  const base = hubHref(projectId);
  const list = useDecisionList({
    page,
    pageSize: PAGE_SIZE,
    q: values.q || undefined,
    status: (values.status || undefined) as Status | undefined,
    authorityOutcome: (values.authorityOutcome || undefined) as Authority | undefined,
    committeeId: values.committeeId || undefined,
    meetingId: values.meetingId || undefined,
  });
  const committeeName = (id: string) => committees.data?.items.find((c) => c.id === id)?.name ?? null;

  const columns: Column<Decision>[] = [
    {
      key: 'code',
      header: t('governance.decisions.columns.code'),
      isRowHeader: true,
      sortValue: (d) => d.code,
      cell: (d) => (
        <Link href={`${base}/decisions/${d.id}`} className="font-medium text-primary hover:underline" dir="ltr" data-testid="decision-link">
          {d.code}
        </Link>
      ),
    },
    {
      key: 'title',
      header: t('governance.decisions.columns.title'),
      sortValue: (d) => d.title,
      cell: (d) => (
        <span className="flex flex-col gap-1">
          <Link href={`${base}/decisions/${d.id}`} className="hover:underline" dir="auto">
            {d.title}
          </Link>
          <span className="flex flex-wrap items-center gap-1 text-xs text-muted">
            <UText value={committeeName(d.committeeId)} />
            {d.isDemo ? <DemoBadge /> : null}
          </span>
        </span>
      ),
    },
    { key: 'status', header: t('governance.decisions.columns.status'), sortValue: (d) => d.status, cell: (d) => <StatusBadge enumName="decisionStatuses" value={d.status} /> },
    {
      key: 'authority',
      header: t('governance.decisions.columns.authority'),
      sortValue: (d) => d.authorityOutcome,
      cell: (d) => (d.authorityOutcome === 'not_assessed' ? <span className="text-muted">{tStatus('decisionAuthorityOutcomes', d.authorityOutcome)}</span> : <StatusBadge enumName="decisionAuthorityOutcomes" value={d.authorityOutcome} />),
    },
    { key: 'requester', header: t('governance.decisions.columns.requester'), sortValue: (d) => d.requesterName ?? '', cell: (d) => <UText value={d.requesterName} /> },
    { key: 'lsd', header: t('governance.decisions.columns.latestSafeDate'), sortValue: (d) => d.latestSafeDate ?? '', cell: (d) => <span className="tabular">{formatDate(d.latestSafeDate)}</span> },
    { key: 'updated', header: t('governance.decisions.columns.updatedAt'), sortValue: (d) => d.updatedAt, cell: (d) => <span className="tabular">{formatDateTime(d.updatedAt)}</span> },
  ];

  return (
    <>
      <PageHeader
        title={t('governance.decisions.title')}
        description={t('governance.decisions.subtitle')}
        actions={
          can('governance.decision.draft') ? (
            <button type="button" className={btn.primary} onClick={() => setCreateOpen(true)} data-testid="new-decision">
              <FilePlus aria-hidden="true" className="size-4" />
              {t('governance.decisions.create.action')}
            </button>
          ) : null
        }
      />
      <FilterBar onClear={clear} active={active}>
        <SearchInput className="w-full sm:w-72" label={t('governance.decisions.search')} value={values.q} onChange={(v) => set({ q: v })} />
        <FilterSelect
          label={t('governance.common.status')}
          value={values.status}
          onChange={(v) => set({ status: v })}
          options={DECISION_STATUSES.map((s) => ({ value: s, label: tStatus('decisionStatuses', s) }))}
          testId="filter-status"
        />
        <FilterSelect
          label={t('governance.decisions.filterAuthority')}
          value={values.authorityOutcome}
          onChange={(v) => set({ authorityOutcome: v })}
          options={DECISION_AUTHORITY_OUTCOMES.map((s) => ({ value: s, label: tStatus('decisionAuthorityOutcomes', s) }))}
        />
        {committees.data ? (
          <FilterSelect
            label={t('governance.common.committee')}
            value={values.committeeId}
            onChange={(v) => set({ committeeId: v })}
            options={committees.data.items.map((c) => ({ value: c.id, label: c.name }))}
          />
        ) : null}
      </FilterBar>
      <DataTable
        className="relative"
        caption={t('governance.decisions.title')}
        columns={columns}
        rows={list.data?.items}
        rowKey={(d) => d.id}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        emptyTitle={active ? t('governance.decisions.emptySearch') : t('governance.decisions.empty')}
        pagination={list.data ? { page, pageSize: PAGE_SIZE, total: list.data.total, onPageChange: (p) => set({ page: p }) } : undefined}
        testId="decisions-table"
      />
      {can('governance.decision.draft') ? (
        <DecisionPaperDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          decision={null}
          defaultCommitteeId={values.committeeId || undefined}
          onCreated={(id) => router.push(`${base}/decisions/${id}`)}
        />
      ) : null}
    </>
  );
}

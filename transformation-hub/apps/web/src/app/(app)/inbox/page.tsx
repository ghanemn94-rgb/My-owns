'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { MY_WORK_TYPES } from '@hub/contracts';
import { DataTable, type Column } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { Main } from '@/components/Main';
import { PageHeader } from '@/components/PageHeader';
import { SearchInput } from '@/components/SearchInput';
import { StatusBadge } from '@/components/StatusBadge';
import { cx } from '@/components/ui';
import { DateText, FilterSelect, FilterToggle } from '@/components/planning/bits';
import { useI18n, type StatusEnum } from '@/i18n/provider';
import { useMyWork, type MyWorkItem } from '@/lib/planning';

type WorkType = (typeof MY_WORK_TYPES)[number];

const STATUS_ENUM: Record<WorkType, StatusEnum> = {
  task_accountable: 'taskStatuses',
  task_acceptance: 'taskStatuses',
  deliverable_acceptance: 'deliverableStatuses',
  milestone_verification: 'milestoneStatuses',
  status_update_review: 'updateStatuses',
  rag_override_review: 'approvalRequestStatuses',
  change_request_assess: 'changeRequestStatuses',
  change_request_approve: 'changeRequestStatuses',
  baseline_approval: 'baselineStatuses',
  action_item: 'actionItemStatuses',
  decision_vote: 'decisionStatuses',
};

/** Screen 15 — My Work / Inbox: what needs the caller's action across their projects (server-filtered by permission). */
export default function InboxPage() {
  const { t, formatNumber, formatDateTime } = useI18n();
  const work = useMyWork();
  const [type, setType] = useState('');
  const [project, setProject] = useState('');
  const [overdue, setOverdue] = useState(false);
  const [q, setQ] = useState('');

  const projects = useMemo(() => [...new Set((work.data?.items ?? []).map((i) => i.projectCode))].sort(), [work.data]);
  const rows = useMemo(() => {
    const needle = q.toLocaleLowerCase();
    return (work.data?.items ?? []).filter(
      (i) => (!type || i.type === type) && (!project || i.projectCode === project) && (!overdue || i.overdue) && (!needle || `${i.code ?? ''} ${i.title}`.toLocaleLowerCase().includes(needle)),
    );
  }, [work.data, type, project, overdue, q]);

  const columns: Column<MyWorkItem>[] = [
    { key: 'type', header: t('planning.inbox.type'), sortValue: (i) => i.type, cell: (i) => <span className="text-sm font-medium">{t(`planning.inbox.type_${i.type}`)}</span> },
    { key: 'project', header: t('planning.inbox.project'), sortValue: (i) => i.projectCode, cell: (i) => <span dir="ltr" className="text-sm">{i.projectCode}</span> },
    {
      key: 'item',
      header: t('planning.inbox.item'),
      isRowHeader: true,
      sortValue: (i) => i.title,
      cell: (i) => (
        <Link href={i.linkPath} className="group inline-flex flex-col" data-testid="inbox-link">
          {i.code ? (
            <span className="font-medium text-primary group-hover:underline" dir="ltr">
              {i.code}
            </span>
          ) : null}
          <span className="text-ink group-hover:text-primary" dir="auto">
            {/* The server titles baselines generically in English; show the translated wording instead. */}
            {i.type === 'baseline_approval' ? t('planning.inbox.baselineTitle') : i.title}
          </span>
        </Link>
      ),
    },
    { key: 'status', header: t('planning.common.status'), cell: (i) => <StatusBadge enumName={STATUS_ENUM[i.type]} value={i.status} /> },
    { key: 'due', header: t('planning.common.due'), sortValue: (i) => i.dueDate ?? '9999', cell: (i) => <DateText value={i.dueDate} overdue={i.overdue} /> },
    { key: 'demo', header: t('common.table.demoColumn'), headerHidden: true, cell: (i) => (i.isDemo ? <DemoBadge /> : null) },
  ];

  return (
    <Main>
      <PageHeader title={t('nav.inbox')} description={t('planning.inbox.subtitle')} />
      {work.isLoading ? (
        <LoadingState />
      ) : work.error ? (
        <ErrorState error={work.error} onRetry={() => work.refetch()} />
      ) : (
        <div className="space-y-4" data-testid="inbox">
          <ul className="flex flex-wrap gap-2" aria-label={t('planning.inbox.summary')}>
            {MY_WORK_TYPES.filter((k) => (work.data?.counts[k] ?? 0) > 0).map((k) => (
              <li key={k}>
                <button
                  type="button"
                  aria-pressed={type === k}
                  onClick={() => setType(type === k ? '' : k)}
                  className={cx('inline-flex min-h-10 items-center gap-2 rounded-full border px-3 py-1 text-sm', type === k ? 'border-primary bg-primary-soft text-primary' : 'border-line bg-surface text-ink hover:border-primary')}
                  data-testid={`inbox-chip-${k}`}
                >
                  {t(`planning.inbox.type_${k}`)}
                  <span className="tabular rounded-full bg-surface-muted px-2 text-xs font-semibold">{formatNumber(work.data?.counts[k] ?? 0)}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-end gap-3">
            <SearchInput className="w-full sm:w-64" label={t('planning.inbox.search')} value={q} onChange={setQ} />
            <FilterSelect label={t('planning.inbox.type')} value={type} onChange={setType} className="w-full sm:w-64">
              <option value="">{t('planning.common.all')}</option>
              {MY_WORK_TYPES.map((k) => (
                <option key={k} value={k}>
                  {t(`planning.inbox.type_${k}`)}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect label={t('planning.inbox.project')} value={project} onChange={setProject} className="w-full sm:w-48">
              <option value="">{t('planning.common.all')}</option>
              {projects.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </FilterSelect>
            <FilterToggle label={t('planning.common.onlyOverdue')} checked={overdue} onChange={setOverdue} />
          </div>
          <DataTable
            caption={t('nav.inbox')}
            columns={columns}
            rows={rows}
            rowKey={(i) => `${i.type}-${i.entityId}`}
            emptyTitle={work.data?.items.length ? t('planning.inbox.emptyFiltered') : t('planning.inbox.empty')}
            emptyHint={work.data?.items.length ? undefined : t('planning.inbox.emptyHint')}
            clientPageSize={25}
            testId="inbox-table"
          />
          <p className="text-xs text-muted">{t('planning.inbox.generated', { at: formatDateTime(work.data?.generatedAt) })}</p>
        </div>
      )}
    </Main>
  );
}

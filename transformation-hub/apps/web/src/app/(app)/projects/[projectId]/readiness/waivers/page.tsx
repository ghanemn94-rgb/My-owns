'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { readinessRoutes } from '@hub/contracts';
import { WAIVER_STATUSES } from '@hub/domain';
import { DataTable, type Column } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { PageHeader } from '@/components/PageHeader';
import { btn } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { useProjectContext } from '@/lib/project-context';
import { rdHref, rk, type ReadinessWaiver } from '@/lib/readiness';
import { FilterBar, FilterSelect, Person, useUrlState } from '../_components/rd';
import { AuthorityRole, WaiverDecisionButtons, WaiverStatus, WaiverText } from '../_components/waivers';

const FILTERS = ['status'] as const;
type WaiverStatusValue = (typeof WAIVER_STATUSES)[number];

/** Readiness waivers (gates WaiverService rules: non-waivable never, specialist-set authority role, basis + impact). */
export default function ReadinessWaiversPage() {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const { values, set, clear, active } = useUrlState(FILTERS);
  const status = (values.status || undefined) as WaiverStatusValue | undefined;
  const list = useQuery({
    queryKey: rk.waivers(projectId, { status }),
    queryFn: ({ signal }) => api(readinessRoutes.listReadinessWaivers, { params: { projectId }, query: status ? { status } : {}, signal }),
  });
  const people = list.data?.people;
  const base = rdHref(projectId);
  const columns: Column<ReadinessWaiver>[] = [
    {
      key: 'check',
      header: t('readiness.waivers.columns.check'),
      isRowHeader: true,
      sortValue: (w) => w.checkCode ?? '',
      cell: (w) => (
        <span className="flex flex-wrap items-center gap-1">
          <Link className={btn.link} href={`${base}/checks/${w.checkId}`} dir="ltr">
            {w.checkCode ?? `#${w.checkId.slice(-6)}`}
          </Link>
          {w.isDemo ? <DemoBadge /> : null}
        </span>
      ),
    },
    { key: 'text', header: t('readiness.waivers.columns.basis'), cell: (w) => <WaiverText w={w} /> },
    { key: 'authority', header: t('readiness.waivers.columns.authority'), cell: (w) => <AuthorityRole role={w.authorityRole} /> },
    { key: 'requested', header: t('readiness.waivers.columns.requested'), cell: (w) => <Person id={w.requestedBy} people={people} /> },
    { key: 'status', header: t('readiness.waivers.columns.status'), sortValue: (w) => w.status, cell: (w) => <WaiverStatus w={w} people={people} /> },
    { key: 'commands', header: t('readiness.waivers.columns.commands'), cell: (w) => <WaiverDecisionButtons w={w} code={w.checkCode ?? ''} /> },
  ];
  return (
    <>
      <PageHeader title={t('readiness.waivers.title')} description={t('readiness.waivers.subtitle')} />
      <FilterBar onClear={clear} active={active}>
        <FilterSelect label={t('readiness.waivers.filterStatus')} value={values.status} onChange={(v) => set({ status: v })} options={WAIVER_STATUSES.map((s) => ({ value: s, label: tStatus('waiverStatuses', s) }))} />
      </FilterBar>
      <DataTable
        caption={t('readiness.waivers.title')}
        columns={columns}
        rows={list.data?.items}
        rowKey={(w) => w.id}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        emptyTitle={t('readiness.waivers.empty')}
        clientPageSize={25}
        testId="waivers-table"
      />
    </>
  );
}

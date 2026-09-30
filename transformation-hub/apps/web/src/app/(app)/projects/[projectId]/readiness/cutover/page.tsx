'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { readinessRoutes } from '@hub/contracts';
import { CUTOVER_STATUSES } from '@hub/domain';
import { DataTable, type Column } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { SearchInput } from '@/components/SearchInput';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn, cx } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { useProjectContext } from '@/lib/project-context';
import { rdHref, usePlans, useReadinessRefresh, type CutoverPlan } from '@/lib/readiness';
import { FilterBar, FilterSelect, Person, RdCommandDialog, useUrlState, useScopeLabels } from '../_components/rd';
import { PlanFields, emptyPlanForm, planBody, type PlanForm } from '../_components/plan-form';

const PAGE_SIZE = 25;
const FILTERS = ['q', 'status'] as const;
type CutoverStatus = (typeof CUTOVER_STATUSES)[number];

function CreatePlanDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useReadinessRefresh();
  const toast = useToast();
  const [form, setForm] = useState<PlanForm>(emptyPlanForm());
  return (
    <RdCommandDialog
      open
      onClose={onClose}
      title={t('readiness.cutover.create.title')}
      confirmLabel={t('readiness.cutover.create.confirm')}
      noteMode="none"
      confirmDisabled={!form.title.trim()}
      consequences={[t('readiness.cutover.create.effect'), t('common.command.audited')]}
      onConfirm={async () => {
        const r = await api(readinessRoutes.createCutoverPlan, { params: { projectId }, body: { ...planBody(form, null), title: form.title.trim() } });
        await refresh();
        toast.show('success', t('readiness.cutover.create.done', { code: r.code }));
        onClose();
      }}
    >
      <PlanFields form={form} onChange={setForm} />
    </RdCommandDialog>
  );
}

export default function CutoverPlansPage() {
  const { t, tStatus, formatDateTime } = useI18n();
  const { projectId, can } = useProjectContext();
  const { values, page, set, clear, active } = useUrlState(FILTERS);
  const { siteName } = useScopeLabels();
  const [createOpen, setCreateOpen] = useState(false);
  const base = rdHref(projectId);
  const query = { page, pageSize: PAGE_SIZE, q: values.q || undefined, status: (values.status || undefined) as CutoverStatus | undefined };
  const list = usePlans(query);
  const people = list.data?.people;
  const columns: Column<CutoverPlan>[] = [
    {
      key: 'code',
      header: t('readiness.cutover.columns.code'),
      isRowHeader: true,
      sortValue: (p) => p.code,
      cell: (p) => (
        <span className="flex flex-wrap items-center gap-1">
          <Link href={`${base}/cutover/${p.id}`} className={cx(btn.link, 'whitespace-nowrap')} dir="ltr">
            {p.code}
          </Link>
          {p.isDemo ? <DemoBadge /> : null}
        </span>
      ),
    },
    { key: 'title', header: t('readiness.cutover.columns.title'), sortValue: (p) => p.title, cell: (p) => <span dir="auto">{p.title}</span> },
    { key: 'scope', header: t('readiness.cutover.columns.scope'), cell: (p) => <span className="text-xs">{p.siteId ? siteName(p.siteId) : t('readiness.cutover.projectWide')}</span> },
    { key: 'status', header: t('readiness.cutover.columns.status'), sortValue: (p) => p.status, cell: (p) => <StatusBadge enumName="cutoverStatuses" value={p.status} /> },
    { key: 'go', header: t('readiness.cutover.columns.goNoGo'), cell: (p) => <StatusBadge enumName="goNoGo" value={p.goNoGo} /> },
    {
      key: 'window',
      header: t('readiness.cutover.columns.window'),
      cell: (p) => (
        <span className="tabular text-xs">
          {formatDateTime(p.windowStart)} – {formatDateTime(p.windowEnd)}
        </span>
      ),
    },
    { key: 'owner', header: t('readiness.cutover.columns.owner'), cell: (p) => <Person id={p.accountableUserId} people={people} /> },
  ];
  return (
    <>
      <PageHeader
        title={t('readiness.cutover.title')}
        description={t('readiness.cutover.subtitle')}
        actions={
          can('readiness.cutover.manage') ? (
            <button type="button" className={btn.primary} onClick={() => setCreateOpen(true)} data-testid="create-plan">
              <Plus aria-hidden="true" className="size-4" />
              {t('readiness.cutover.create.action')}
            </button>
          ) : null
        }
      />
      <FilterBar onClear={clear} active={active}>
        <SearchInput className="w-full sm:w-64" label={t('readiness.cutover.search')} value={values.q} onChange={(v) => set({ q: v })} />
        <FilterSelect label={t('readiness.cutover.filterStatus')} value={values.status} onChange={(v) => set({ status: v })} options={CUTOVER_STATUSES.map((s) => ({ value: s, label: tStatus('cutoverStatuses', s) }))} />
      </FilterBar>
      <DataTable
        caption={t('readiness.cutover.title')}
        columns={columns}
        rows={list.data?.items}
        rowKey={(p) => p.id}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        emptyTitle={active ? t('readiness.cutover.emptySearch') : t('readiness.cutover.empty')}
        pagination={list.data ? { page, pageSize: PAGE_SIZE, total: list.data.total, onPageChange: (p) => set({ page: p }) } : undefined}
        testId="plans-table"
      />
      {createOpen ? <CreatePlanDialog onClose={() => setCreateOpen(false)} /> : null}
    </>
  );
}

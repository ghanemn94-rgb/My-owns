'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { readinessRoutes } from '@hub/contracts';
import { TSA_STATUSES, type TsaStatus } from '@hub/domain';
import { DataTable, type Column } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { PageHeader } from '@/components/PageHeader';
import { SearchInput } from '@/components/SearchInput';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { useProjectContext } from '@/lib/project-context';
import { rdHref, useReadinessRefresh, useTsas, type TsaService } from '@/lib/readiness';
import { FilterBar, FilterSelect, Person, RdCommandDialog, useUrlState } from '../_components/rd';
import { ExpiryBadge, TsaFields, emptyTsaForm, tsaBody, type TsaForm } from '../_components/tsa-form';

const PAGE_SIZE = 25;
const FILTERS = ['q', 'status', 'enduring'] as const;

function CreateTsaDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useReadinessRefresh();
  const toast = useToast();
  const [form, setForm] = useState<TsaForm>(emptyTsaForm());
  return (
    <RdCommandDialog
      open
      onClose={onClose}
      title={t('readiness.tsa.create.title')}
      confirmLabel={t('readiness.tsa.create.confirm')}
      noteMode="none"
      confirmDisabled={!form.name.trim()}
      consequences={[t('readiness.tsa.create.effect'), t('common.command.audited')]}
      onConfirm={async () => {
        const r = await api(readinessRoutes.createTsaService, { params: { projectId }, body: { ...tsaBody(form, null), name: form.name.trim() } });
        await refresh();
        toast.show('success', t('readiness.tsa.create.done', { code: r.code }));
        onClose();
      }}
    >
      <TsaFields form={form} onChange={setForm} />
    </RdCommandDialog>
  );
}

export default function TsaRegisterPage() {
  const { t, tStatus, formatDate } = useI18n();
  const { projectId, can } = useProjectContext();
  const { values, page, set, clear, active } = useUrlState(FILTERS);
  const [createOpen, setCreateOpen] = useState(false);
  const base = rdHref(projectId);
  const query = {
    page,
    pageSize: PAGE_SIZE,
    q: values.q || undefined,
    status: (values.status || undefined) as TsaStatus | undefined,
    enduring: (values.enduring || undefined) as 'true' | 'false' | undefined,
  };
  const list = useTsas(query);
  const people = list.data?.people;
  const columns: Column<TsaService>[] = [
    {
      key: 'code',
      header: t('readiness.tsa.columns.code'),
      isRowHeader: true,
      sortValue: (x) => x.code,
      cell: (x) => (
        <span className="flex flex-wrap items-center gap-1">
          <Link href={`${base}/tsa/${x.id}`} className={btn.link} dir="ltr">
            {x.code}
          </Link>
          {x.isDemo ? <DemoBadge /> : null}
        </span>
      ),
    },
    {
      key: 'name',
      header: t('readiness.tsa.columns.name'),
      sortValue: (x) => x.name,
      cell: (x) => (
        <span className="flex flex-col gap-0.5">
          <span dir="auto">{x.name}</span>
          <span className="text-xs text-muted">{x.isEnduringArrangement ? t('readiness.tsa.enduring') : t('readiness.tsa.transitional')}</span>
        </span>
      ),
    },
    { key: 'status', header: t('readiness.tsa.columns.status'), sortValue: (x) => x.status, cell: (x) => <StatusBadge enumName="tsaStatuses" value={x.status} /> },
    { key: 'owner', header: t('readiness.tsa.columns.owner'), cell: (x) => <Person id={x.ownerUserId} people={people} /> },
    { key: 'end', header: t('readiness.tsa.columns.endDate'), sortValue: (x) => x.endDate ?? '', cell: (x) => <span className="tabular">{formatDate(x.endDate)}</span> },
    { key: 'expiry', header: t('readiness.tsa.columns.expiry'), cell: (x) => <ExpiryBadge expiry={x.expiry} /> },
    {
      key: 'replacement',
      header: t('readiness.tsa.columns.replacement'),
      cell: (x) => (
        <span className="flex flex-col gap-0.5 text-xs">
          <span dir="auto">{x.replacementService ?? '—'}</span>
          <span className={x.replacementAccepted ? 'text-success' : 'text-muted'}>{x.replacementAccepted ? t('readiness.tsa.replacementAccepted') : t('readiness.tsa.replacementOpen')}</span>
        </span>
      ),
    },
  ];
  return (
    <>
      <PageHeader
        title={t('readiness.tsa.title')}
        description={t('readiness.tsa.subtitle')}
        actions={
          can('readiness.tsa.manage') ? (
            <button type="button" className={btn.primary} onClick={() => setCreateOpen(true)} data-testid="create-tsa">
              <Plus aria-hidden="true" className="size-4" />
              {t('readiness.tsa.create.action')}
            </button>
          ) : null
        }
      />
      <FilterBar onClear={clear} active={active}>
        <SearchInput className="w-full sm:w-64" label={t('readiness.tsa.search')} value={values.q} onChange={(v) => set({ q: v })} />
        <FilterSelect label={t('readiness.tsa.filterStatus')} value={values.status} onChange={(v) => set({ status: v })} options={TSA_STATUSES.map((s) => ({ value: s, label: tStatus('tsaStatuses', s) }))} testId="filter-tsa-status" />
        <FilterSelect
          label={t('readiness.tsa.filterType')}
          value={values.enduring}
          onChange={(v) => set({ enduring: v })}
          options={[
            { value: 'false', label: t('readiness.tsa.transitional') },
            { value: 'true', label: t('readiness.tsa.enduring') },
          ]}
        />
      </FilterBar>
      <DataTable
        caption={t('readiness.tsa.title')}
        columns={columns}
        rows={list.data?.items}
        rowKey={(x) => x.id}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        emptyTitle={active ? t('readiness.tsa.emptySearch') : t('readiness.tsa.empty')}
        pagination={list.data ? { page, pageSize: PAGE_SIZE, total: list.data.total, onPageChange: (p) => set({ page: p }) } : undefined}
        testId="tsa-table"
      />
      {createOpen ? <CreateTsaDialog onClose={() => setCreateOpen(false)} /> : null}
    </>
  );
}

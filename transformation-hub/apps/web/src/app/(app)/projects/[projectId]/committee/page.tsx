'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { governanceRoutes, type RouteQuery } from '@hub/contracts';
import { CLASSIFICATIONS, COMMITTEE_KINDS, COMMITTEE_STATUSES, clearanceAllows } from '@hub/domain';
import { DataTable, type Column } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { SelectField, TextAreaField, TextField } from '@/components/Field';
import { MetricCard } from '@/components/MetricCard';
import { PageHeader } from '@/components/PageHeader';
import { RestrictedState } from '@/components/RestrictedState';
import { SearchInput } from '@/components/SearchInput';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { useProjectContext } from '@/lib/project-context';
import { FilterBar, FilterSelect, GovCommandDialog, gk, hubHref, useGovRefresh, useUrlState, type Committee } from './_components/gov';

const PAGE_SIZE = 20;
const FILTERS = ['q', 'kind', 'status'] as const;
type CommitteeKind = (typeof COMMITTEE_KINDS)[number];
type CommitteeStatus = (typeof COMMITTEE_STATUSES)[number];

/** Count of a filtered list (null = the caller may not read it → "—"). */
function useCount<R extends typeof governanceRoutes.listDecisions | typeof governanceRoutes.listActions | typeof governanceRoutes.listEscalations>(
  route: R,
  query: RouteQuery<R>,
  permission: string,
) {
  const { projectId, can } = useProjectContext();
  const allowed = can(permission);
  const q = useQuery({
    queryKey: [...gk.root(projectId), 'count', route.id, query],
    queryFn: ({ signal }) => api(route, { params: { projectId }, query: { ...query, page: 1, pageSize: 1 } as RouteQuery<R>, signal }),
    enabled: allowed,
  });
  return allowed ? (q.data?.total ?? undefined) : null;
}

function CreateCommitteeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, tStatus } = useI18n();
  const { projectId, me } = useProjectContext();
  const refresh = useGovRefresh();
  const toast = useToast();
  const [kind, setKind] = useState<CommitteeKind>('program_steering');
  const [name, setName] = useState('');
  const [classification, setClassification] = useState<(typeof CLASSIFICATIONS)[number]>('confidential');
  const [purpose, setPurpose] = useState('');
  const classes = CLASSIFICATIONS.filter((c) => clearanceAllows(me.user.clearance, c));
  return (
    <GovCommandDialog
      open={open}
      onClose={onClose}
      title={t('governance.committees.create.title')}
      confirmLabel={t('governance.committees.create.confirm')}
      noteMode="none"
      confirmDisabled={!name.trim()}
      consequences={[t('governance.committees.create.effect'), t('common.command.audited')]}
      onConfirm={async () => {
        await api(governanceRoutes.createCommittee, {
          params: { projectId },
          body: { kind, name: name.trim(), classification, charter: { cadenceIsProposal: true, ...(purpose.trim() ? { purpose: purpose.trim() } : {}) } },
        });
        await refresh();
        toast.show('success', t('governance.committees.create.done'));
        setName('');
        setPurpose('');
        onClose();
      }}
    >
      <div className="space-y-4">
        <SelectField label={t('governance.committees.create.kind')} required value={kind} onChange={(e) => setKind(e.target.value as CommitteeKind)} hint={t('governance.committees.create.kindHint')}>
          {COMMITTEE_KINDS.map((k) => (
            <option key={k} value={k}>
              {tStatus('committeeKinds', k)}
            </option>
          ))}
        </SelectField>
        <TextField label={t('governance.committees.create.name')} required value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
        <SelectField label={t('governance.common.classification')} required value={classification} onChange={(e) => setClassification(e.target.value as typeof classification)}>
          {classes.map((c) => (
            <option key={c} value={c}>
              {tStatus('classifications', c)}
            </option>
          ))}
        </SelectField>
        <TextAreaField label={t('governance.committees.create.purpose')} value={purpose} maxLength={8000} onChange={(e) => setPurpose(e.target.value)} />
      </div>
    </GovCommandDialog>
  );
}

export default function CommitteeHubPage() {
  const { t, tStatus, formatNumber } = useI18n();
  const { projectId, project, can } = useProjectContext();
  const { values, page, set, clear, active } = useUrlState(FILTERS);
  const [createOpen, setCreateOpen] = useState(false);
  const base = hubHref(projectId);

  const query = {
    page,
    pageSize: PAGE_SIZE,
    q: values.q || undefined,
    kind: (values.kind || undefined) as CommitteeKind | undefined,
    status: (values.status || undefined) as CommitteeStatus | undefined,
  };
  const list = useQuery({
    queryKey: gk.committees(projectId, query),
    queryFn: ({ signal }) => api(governanceRoutes.listCommittees, { params: { projectId }, query, signal }),
    enabled: can('governance.committee.read'),
    placeholderData: (prev) => prev,
  });

  const underReview = useCount(governanceRoutes.listDecisions, { status: 'under_review' }, 'governance.decision.read');
  const recommended = useCount(governanceRoutes.listDecisions, { status: 'recommended' }, 'governance.decision.read');
  const implPending = useCount(governanceRoutes.listDecisions, { status: 'implementation_pending' }, 'governance.decision.read');
  const openActions = useCount(governanceRoutes.listActions, { status: 'open' }, 'governance.decision.read');
  const overdue = useCount(governanceRoutes.listActions, { overdue: 'true' }, 'governance.decision.read');
  const escOpen = useCount(governanceRoutes.listEscalations, { status: 'open' }, 'governance.decision.read');
  const escRequested = useCount(governanceRoutes.listEscalations, { status: 'decision_requested' }, 'governance.decision.read');
  const escalations = escOpen === null || escRequested === null ? null : escOpen === undefined || escRequested === undefined ? undefined : escOpen + escRequested;

  const columns: Column<Committee>[] = [
    {
      key: 'name',
      header: t('governance.committees.columns.name'),
      isRowHeader: true,
      sortValue: (c) => c.name,
      cell: (c) => (
        <span className="flex flex-wrap items-center gap-2">
          <Link href={`${base}/committees/${c.id}`} className="font-medium text-primary hover:underline" dir="auto">
            {c.name}
          </Link>
          {c.isDemo ? <DemoBadge /> : null}
        </span>
      ),
    },
    { key: 'kind', header: t('governance.committees.columns.kind'), sortValue: (c) => c.kind, cell: (c) => tStatus('committeeKinds', c.kind) },
    { key: 'status', header: t('governance.committees.columns.status'), sortValue: (c) => c.status, cell: (c) => <StatusBadge enumName="committeeStatuses" value={c.status} /> },
    {
      key: 'seats',
      header: t('governance.committees.columns.seats'),
      sortValue: (c) => c.memberCount,
      cell: (c) => (
        <Link href={`${base}/committees/${c.id}#seats`} className="tabular font-medium text-primary hover:underline">
          {formatNumber(c.memberCount)}
        </Link>
      ),
    },
    {
      key: 'matrix',
      header: t('governance.committees.columns.matrix'),
      cell: (c) =>
        c.activeMatrix ? (
          <span className="flex flex-wrap items-center gap-1">
            <StatusBadge
              enumName="authorityMatrixStatuses"
              value={c.activeMatrix.usable ? 'approved' : 'superseded'}
              tone={c.activeMatrix.usable ? 'success' : 'warning'}
              label={t(c.activeMatrix.usable ? 'governance.committees.matrixUsable' : 'governance.committees.matrixNotUsable', { version: c.activeMatrix.versionNo })}
            />
            {c.activeMatrix.isDemoPolicy ? <DemoBadge /> : null}
          </span>
        ) : (
          <span className="text-muted">{t('governance.committees.matrixNone')}</span>
        ),
    },
    {
      key: 'charter',
      header: t('governance.committees.columns.charter'),
      cell: (c) =>
        c.charterApprovedVersionNo
          ? t('governance.committees.charterState', { version: c.charterVersionNo, approved: c.charterApprovedVersionNo })
          : t('governance.committees.charterUnapproved', { version: c.charterVersionNo }),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow={<span dir="ltr">{project.code}</span>}
        title={t('governance.hub.title')}
        description={t('governance.hub.subtitle')}
        actions={
          can('governance.committee.manage') ? (
            <button type="button" className={btn.primary} onClick={() => setCreateOpen(true)} data-testid="create-committee">
              <Plus aria-hidden="true" className="size-4" />
              {t('governance.committees.create.action')}
            </button>
          ) : null
        }
      />

      <section aria-labelledby="gov-metrics" className="mb-6">
        <h2 id="gov-metrics" className="sr-only">
          {t('governance.hub.metrics.title')}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="gov-metrics">
          <MetricCard label={t('governance.hub.metrics.underReview')} value={underReview} href={`${base}/decisions?status=under_review`} />
          <MetricCard label={t('governance.hub.metrics.recommended')} value={recommended} href={`${base}/decisions?status=recommended`} />
          <MetricCard label={t('governance.hub.metrics.implementationPending')} value={implPending} href={`${base}/decisions?status=implementation_pending`} />
          <MetricCard label={t('governance.hub.metrics.openActions')} value={openActions} href={`${base}/actions?status=open`} />
          <MetricCard label={t('governance.hub.metrics.overdueActions')} value={overdue} href={`${base}/actions?overdue=true`} />
          <MetricCard label={t('governance.hub.metrics.escalations')} value={escalations} href={`${base}/escalations`} />
        </div>
      </section>

      <section aria-labelledby="gov-committees" className="space-y-3">
        <h2 id="gov-committees" className="text-lg font-semibold text-ink">
          {t('governance.committees.title')}
        </h2>
        <p className="text-sm text-muted">{t('governance.committees.distinct')}</p>
        <FilterBar onClear={clear} active={active}>
          <SearchInput className="w-full sm:w-72" label={t('governance.committees.search')} value={values.q} onChange={(v) => set({ q: v })} />
          <FilterSelect
            label={t('governance.committees.filterKind')}
            value={values.kind}
            onChange={(v) => set({ kind: v })}
            options={COMMITTEE_KINDS.map((k) => ({ value: k, label: tStatus('committeeKinds', k) }))}
          />
          <FilterSelect
            label={t('governance.common.status')}
            value={values.status}
            onChange={(v) => set({ status: v })}
            options={COMMITTEE_STATUSES.map((s) => ({ value: s, label: tStatus('committeeStatuses', s) }))}
          />
        </FilterBar>
        {can('governance.committee.read') ? (
        <DataTable
          caption={t('governance.committees.title')}
          columns={columns}
          rows={list.data?.items}
          rowKey={(c) => c.id}
          isLoading={list.isLoading}
          error={list.error}
          onRetry={() => list.refetch()}
          emptyTitle={active ? t('governance.committees.emptySearch') : t('governance.committees.empty')}
          pagination={list.data ? { page, pageSize: PAGE_SIZE, total: list.data.total, onPageChange: (p) => set({ page: p }) } : undefined}
          testId="committees-table"
        />
        ) : (
          <RestrictedState showHomeLink={false} />
        )}
        <p className="text-xs text-muted">{t('governance.hub.internalApprovals')}</p>
      </section>

      {can('governance.committee.manage') ? <CreateCommitteeDialog open={createOpen} onClose={() => setCreateOpen(false)} /> : null}
    </>
  );
}

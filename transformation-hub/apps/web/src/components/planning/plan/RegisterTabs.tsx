'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { planningRoutes as P } from '@hub/contracts';
import { DELIVERABLE_STATUSES, MILESTONE_STATUSES } from '@hub/domain';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { deliverableHref, milestoneHref, pk, useRefreshPlanning, type Deliverable, type Milestone } from '@/lib/planning';
import { useProjectContext } from '@/lib/project-context';
import { useWorkstreams } from '@/lib/queries';
import { workstreamName } from '@/lib/workstreams';
import { ConfirmCommandDialog } from '../../ConfirmCommandDialog';
import { DataTable, type Column } from '../../DataTable';
import { DemoBadge } from '../../DemoBadge';
import { SelectField, TextField } from '../../Field';
import { SearchInput } from '../../SearchInput';
import { StatusBadge } from '../../StatusBadge';
import { useToast } from '../../Toast';
import { btn, cx } from '../../ui';
import { CodeLink, DateText, FilterSelect, FilterToggle } from '../bits';
import { FormDialog } from '../dialogs';

const PAGE = 25;

function useWsOptions() {
  const { locale } = useI18n();
  const { projectId } = useProjectContext();
  const ws = useWorkstreams(projectId);
  return (ws.data?.items ?? []).map((w) => ({ id: w.id, label: `${w.code} — ${workstreamName(w, locale)}` }));
}

/** Milestones register — filters, pagination, overdue/critical; commands live on the detail page. */
export function MilestonesTab({ workstreamId: fixedWs }: { workstreamId?: string }) {
  const { t, tStatus } = useI18n();
  const { projectId, can } = useProjectContext();
  const wsOptions = useWsOptions();
  const [q, setQ] = useState('');
  const [ws, setWs] = useState(fixedWs ?? '');
  const [status, setStatus] = useState('');
  const [overdue, setOverdue] = useState(false);
  const [critical, setCritical] = useState(false);
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  useEffect(() => setPage(1), [q, ws, status, overdue, critical]);
  const query = { page, pageSize: PAGE, q: q || undefined, workstreamId: ws || undefined, status: status || undefined, overdue: overdue ? ('true' as const) : undefined, critical: critical ? ('true' as const) : undefined };
  const list = useQuery({ queryKey: pk.milestones(projectId, query), queryFn: ({ signal }) => api(P.listMilestones, { params: { projectId }, query, signal }), placeholderData: keepPreviousData });

  const columns: Column<Milestone>[] = [
    { key: 'code', header: t('planning.common.code'), isRowHeader: true, cell: (m) => <CodeLink href={milestoneHref(projectId, m.id)} code={m.code} title={m.title} /> },
    { key: 'status', header: t('planning.common.status'), cell: (m) => <StatusBadge enumName="milestoneStatuses" value={m.status} /> },
    { key: 'planned', header: t('planning.milestone.plannedDate'), cell: (m) => <DateText value={m.plannedDate} overdue={m.overdue} /> },
    { key: 'forecast', header: t('planning.milestone.forecastDate'), cell: (m) => <DateText value={m.forecastDate} /> },
    { key: 'gate', header: t('planning.common.gate'), cell: (m) => <span dir="ltr">{m.gateKey ?? '—'}</span> },
    { key: 'critical', header: t('planning.milestone.critical'), cell: (m) => (m.isCritical ? t('planning.common.yes') : t('planning.common.no')) },
    { key: 'owner', header: t('planning.common.owner'), cell: (m) => (m.ownerName ? <span dir="auto">{m.ownerName}</span> : <span className="text-muted">{t('planning.common.unassigned')}</span>) },
    { key: 'evidence', header: t('planning.common.evidence'), cell: (m) => <span className="tabular">{m.evidenceCount}</span> },
    { key: 'demo', header: t('common.table.demoColumn'), headerHidden: true, cell: (m) => (m.isDemo ? <DemoBadge /> : null) },
  ];

  return (
    <div className="space-y-4" data-testid="milestones-tab">
      <div className="flex flex-wrap items-end gap-3">
        <SearchInput className="w-full sm:w-64" label={t('planning.milestone.search')} value={q} onChange={setQ} />
        {!fixedWs ? (
          <FilterSelect label={t('planning.common.workstream')} value={ws} onChange={setWs} className="w-full sm:w-56">
            <option value="">{t('planning.common.allWorkstreams')}</option>
            {wsOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </FilterSelect>
        ) : null}
        <FilterSelect label={t('planning.common.status')} value={status} onChange={setStatus} className="w-full sm:w-48">
          <option value="">{t('planning.common.allStatuses')}</option>
          {MILESTONE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {tStatus('milestoneStatuses', s)}
            </option>
          ))}
        </FilterSelect>
        <FilterToggle label={t('planning.common.onlyOverdue')} checked={overdue} onChange={setOverdue} />
        <FilterToggle label={t('planning.milestone.onlyCritical')} checked={critical} onChange={setCritical} />
        {can('planning.wbs.manage') ? (
          <button type="button" className={cx(btn.primary, 'ms-auto')} onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden="true" className="size-4" />
            {t('planning.milestone.create')}
          </button>
        ) : null}
      </div>
      <DataTable
        caption={t('planning.tabs.milestones')}
        columns={columns}
        rows={list.data?.items}
        rowKey={(m) => m.id}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        emptyTitle={t('planning.milestone.empty')}
        pagination={list.data ? { page, pageSize: PAGE, total: list.data.total, onPageChange: setPage } : undefined}
        testId="milestones-table"
      />
      <CreateMilestoneDialog open={createOpen} onClose={() => setCreateOpen(false)} defaultWs={ws} />
    </div>
  );
}

function CreateMilestoneDialog({ open, onClose, defaultWs }: { open: boolean; onClose: () => void; defaultWs: string }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useRefreshPlanning(projectId);
  const toast = useToast();
  const wsOptions = useWsOptions();
  const [f, setF] = useState({ workstreamId: '', title: '', plannedDate: '', gateKey: '', isCritical: false });
  useEffect(() => {
    if (open) setF({ workstreamId: defaultWs, title: '', plannedDate: '', gateKey: '', isCritical: false });
  }, [open, defaultWs]);
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={t('planning.milestone.create')}
      submitLabel={t('planning.common.create')}
      disabled={!f.title.trim()}
      onSubmit={async () => {
        const r = await api(P.createMilestone, {
          params: { projectId },
          body: { workstreamId: f.workstreamId || undefined, title: f.title.trim(), plannedDate: f.plannedDate || undefined, gateKey: f.gateKey.trim() || undefined, isCritical: f.isCritical },
        });
        toast.show('success', t('planning.common.createdCode', { code: r.code ?? '' }));
        await refresh();
        onClose();
      }}
    >
      <SelectField label={t('planning.common.workstream')} value={f.workstreamId} onChange={(e) => setF({ ...f, workstreamId: e.target.value })}>
        <option value="">{t('planning.common.none')}</option>
        {wsOptions.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </SelectField>
      <TextField label={t('planning.common.title')} required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={300} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={t('planning.milestone.plannedDate')} type="date" value={f.plannedDate} onChange={(e) => setF({ ...f, plannedDate: e.target.value })} dir="ltr" />
        <TextField label={t('planning.common.gate')} value={f.gateKey} onChange={(e) => setF({ ...f, gateKey: e.target.value })} dir="ltr" maxLength={16} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4" checked={f.isCritical} onChange={(e) => setF({ ...f, isCritical: e.target.checked })} />
        {t('planning.milestone.critical')}
      </label>
    </FormDialog>
  );
}

/** Deliverables register with weights (only approved weights count toward progress). */
export function DeliverablesTab({ workstreamId: fixedWs }: { workstreamId?: string }) {
  const { t, tStatus, formatNumber } = useI18n();
  const { projectId, can, me } = useProjectContext();
  const refresh = useRefreshPlanning(projectId);
  const toast = useToast();
  const wsOptions = useWsOptions();
  const [q, setQ] = useState('');
  const [ws, setWs] = useState(fixedWs ?? '');
  const [status, setStatus] = useState('');
  const [unapproved, setUnapproved] = useState(false);
  const [page, setPage] = useState(1);
  const [approveOpen, setApproveOpen] = useState(false);
  useEffect(() => setPage(1), [q, ws, status, unapproved]);
  const query = { page, pageSize: PAGE, q: q || undefined, workstreamId: ws || undefined, status: status || undefined, weightApproved: unapproved ? ('false' as const) : undefined };
  const list = useQuery({ queryKey: pk.deliverables(projectId, query), queryFn: ({ signal }) => api(P.listDeliverables, { params: { projectId }, query, signal }), placeholderData: keepPreviousData });
  // Weight approval: baseline-approval authority, never by the person who set the weight (not_self).
  const approvable = (list.data?.items ?? []).filter((d) => !d.weightApproved && d.status !== 'cancelled' && d.weightSetBy !== me.user.id);

  const columns: Column<Deliverable>[] = [
    { key: 'code', header: t('planning.common.code'), isRowHeader: true, cell: (d) => <CodeLink href={deliverableHref(projectId, d.id)} code={d.code} title={d.title} /> },
    { key: 'status', header: t('planning.common.status'), cell: (d) => <StatusBadge enumName="deliverableStatuses" value={d.status} /> },
    {
      key: 'weight',
      header: t('planning.common.weight'),
      cell: (d) => (
        <span className="inline-flex items-center gap-1.5">
          <span className="tabular">{formatNumber(d.weight)}</span>
          <StatusBadge enumName="approvalStates" value={d.weightApproved ? 'approved' : 'proposed'} />
        </span>
      ),
    },
    { key: 'due', header: t('planning.common.due'), cell: (d) => <DateText value={d.dueDate} overdue={d.overdue} /> },
    { key: 'ws', header: t('planning.common.workstream'), cell: (d) => <span dir="ltr">{d.workstreamCode ?? '—'}</span> },
    { key: 'owner', header: t('planning.common.owner'), cell: (d) => (d.ownerName ? <span dir="auto">{d.ownerName}</span> : <span className="text-muted">{t('planning.common.unassigned')}</span>) },
    { key: 'evidence', header: t('planning.common.evidence'), cell: (d) => <span className="tabular">{d.evidenceCount}</span> },
    { key: 'demo', header: t('common.table.demoColumn'), headerHidden: true, cell: (d) => (d.isDemo ? <DemoBadge /> : null) },
  ];

  return (
    <div className="space-y-4" data-testid="deliverables-tab">
      <div className="flex flex-wrap items-end gap-3">
        <SearchInput className="w-full sm:w-64" label={t('planning.deliverable.search')} value={q} onChange={setQ} />
        {!fixedWs ? (
          <FilterSelect label={t('planning.common.workstream')} value={ws} onChange={setWs} className="w-full sm:w-56">
            <option value="">{t('planning.common.allWorkstreams')}</option>
            {wsOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </FilterSelect>
        ) : null}
        <FilterSelect label={t('planning.common.status')} value={status} onChange={setStatus} className="w-full sm:w-48">
          <option value="">{t('planning.common.allStatuses')}</option>
          {DELIVERABLE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {tStatus('deliverableStatuses', s)}
            </option>
          ))}
        </FilterSelect>
        <FilterToggle label={t('planning.deliverable.onlyUnapproved')} checked={unapproved} onChange={setUnapproved} />
        {can('planning.baseline.approve') && approvable.length > 0 ? (
          <button type="button" className={cx(btn.secondary, 'ms-auto')} onClick={() => setApproveOpen(true)} data-testid="approve-weights">
            {t('planning.deliverable.approveWeights', { count: approvable.length })}
          </button>
        ) : null}
      </div>
      <p className="text-xs text-muted">{t('planning.deliverable.weightHint')}</p>
      <DataTable
        caption={t('planning.tabs.deliverables')}
        columns={columns}
        rows={list.data?.items}
        rowKey={(d) => d.id}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        emptyTitle={t('planning.deliverable.empty')}
        pagination={list.data ? { page, pageSize: PAGE, total: list.data.total, onPageChange: setPage } : undefined}
        testId="deliverables-table"
      />
      <ConfirmCommandDialog
        open={approveOpen}
        onClose={() => setApproveOpen(false)}
        title={t('planning.deliverable.approveWeightsTitle')}
        confirmLabel={t('planning.deliverable.approveWeights', { count: approvable.length })}
        consequences={[t('planning.deliverable.approveWeightsEffect', { count: approvable.length }), t('planning.commands.notSelf'), t('common.command.audited')]}
        onReload={() => void refresh()}
        onConfirm={async ({ note }) => {
          const r = await api(P.approveDeliverableWeights, { params: { projectId }, body: { items: approvable.map((d) => ({ id: d.id, expectedVersion: d.version })), note: note || undefined } });
          await refresh();
          toast.show('success', t('planning.deliverable.weightsApproved', { count: r.approved }));
          setApproveOpen(false);
        }}
      />
    </div>
  );
}

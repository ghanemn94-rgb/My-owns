'use client';

import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { planningRoutes as P } from '@hub/contracts';
import { DEPENDENCY_TYPES } from '@hub/domain';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import {
  baselineHref,
  nodeHref,
  pk,
  useBaselines,
  useRefreshPlanning,
  useSchedule,
  type Baseline,
  type Dependency,
  type LookAheadItem,
  type ScheduleNode,
} from '@/lib/planning';
import { useProjectContext } from '@/lib/project-context';
import { useWorkstreams } from '@/lib/queries';
import { workstreamName } from '@/lib/workstreams';
import { ApiErrorNotice } from '../../ApiErrorNotice';
import { ConfirmCommandDialog } from '../../ConfirmCommandDialog';
import { DataTable, type Column } from '../../DataTable';
import { EmptyState } from '../../EmptyState';
import { ErrorState } from '../../ErrorState';
import { SelectField, TextAreaField, TextField } from '../../Field';
import { LoadingState } from '../../LoadingState';
import { StatusBadge } from '../../StatusBadge';
import { useToast } from '../../Toast';
import { btn, card, cx } from '../../ui';
import { CodeLink, DateText, FilterSelect, ForecastLabel, Section } from '../bits';
import { FormDialog } from '../dialogs';

function nodeLabel(n: Pick<ScheduleNode, 'code' | 'title'>) {
  return `${n.code} — ${n.title}`;
}

// =============================================================================================================
// Dependencies

export function DependenciesTab() {
  const { t, tStatus } = useI18n();
  const { projectId, can } = useProjectContext();
  const refresh = useRefreshPlanning(projectId);
  const toast = useToast();
  const [nodeId, setNodeId] = useState('');
  const deps = useQuery({ queryKey: pk.dependencies(projectId, nodeId || undefined), queryFn: ({ signal }) => api(P.listDependencies, { params: { projectId }, query: nodeId ? { nodeId } : {}, signal }) });
  const sched = useSchedule(projectId);
  const nodes = sched.data?.nodes ?? [];
  const [createOpen, setCreateOpen] = useState(false);
  const [remove, setRemove] = useState<Dependency | null>(null);
  const canManage = can('planning.dependency.manage');

  const columns: Column<Dependency>[] = [
    { key: 'pred', header: t('planning.dependency.predecessor'), isRowHeader: true, cell: (d) => <CodeLink href={nodeHref(projectId, d.predecessorType, d.predecessorId)} code={d.predecessorCode} title={d.predecessorTitle} /> },
    { key: 'succ', header: t('planning.dependency.successor'), cell: (d) => <CodeLink href={nodeHref(projectId, d.successorType, d.successorId)} code={d.successorCode} title={d.successorTitle} /> },
    { key: 'type', header: t('planning.dependency.type'), cell: (d) => tStatus('dependencyTypes', d.type) },
    { key: 'lag', header: t('planning.dependency.lag'), cell: (d) => <span className="tabular">{d.lagDays}</span> },
    ...(canManage
      ? [
          {
            key: 'remove',
            header: t('planning.common.actions'),
            cell: (d: Dependency) => (
              <button type="button" className={cx(btn.ghost, 'min-h-8 px-2 py-1')} onClick={() => setRemove(d)} aria-label={t('planning.dependency.removeLabel', { pred: d.predecessorCode, succ: d.successorCode })}>
                <Trash2 aria-hidden="true" className="size-4" />
              </button>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-4" data-testid="dependencies-tab">
      <div className="flex flex-wrap items-end gap-3">
        <FilterSelect label={t('planning.dependency.around')} value={nodeId} onChange={setNodeId} className="w-full sm:w-96">
          <option value="">{t('planning.dependency.all')}</option>
          {nodes.map((n) => (
            <option key={n.id} value={n.id}>
              {nodeLabel(n)}
            </option>
          ))}
        </FilterSelect>
        {canManage ? (
          <button type="button" className={cx(btn.primary, 'ms-auto')} onClick={() => setCreateOpen(true)} data-testid="dependency-create">
            <Plus aria-hidden="true" className="size-4" />
            {t('planning.dependency.create')}
          </button>
        ) : null}
      </div>
      <p className="text-xs text-muted">{t('planning.dependency.rules')}</p>
      <DataTable
        caption={t('planning.tabs.dependencies')}
        columns={columns}
        rows={deps.data?.items}
        rowKey={(d) => d.id}
        isLoading={deps.isLoading}
        error={deps.error}
        onRetry={() => deps.refetch()}
        emptyTitle={t('planning.dependency.empty')}
        clientPageSize={25}
        testId="dependencies-table"
      />
      <CreateDependencyDialog open={createOpen} onClose={() => setCreateOpen(false)} nodes={nodes} />
      {remove ? (
        <ConfirmCommandDialog
          open
          onClose={() => setRemove(null)}
          title={t('planning.dependency.removeTitle')}
          confirmLabel={t('planning.dependency.remove')}
          danger
          consequences={[t('planning.dependency.removeEffect', { pred: remove.predecessorCode, succ: remove.successorCode }), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            await api(P.removeDependency, { params: { projectId, dependencyId: remove.id }, body: { reason: note || undefined } });
            await refresh();
            toast.show('success', t('planning.dependency.removed'));
            setRemove(null);
          }}
        />
      ) : null}
    </div>
  );
}

function CreateDependencyDialog({ open, onClose, nodes }: { open: boolean; onClose: () => void; nodes: ScheduleNode[] }) {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useRefreshPlanning(projectId);
  const toast = useToast();
  const [f, setF] = useState({ pred: '', succ: '', type: 'FS', lag: '0', note: '' });
  useEffect(() => {
    if (open) setF({ pred: '', succ: '', type: 'FS', lag: '0', note: '' });
  }, [open]);
  const pred = nodes.find((n) => n.id === f.pred);
  const succ = nodes.find((n) => n.id === f.succ);
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      testId="dependency-form"
      title={t('planning.dependency.create')}
      submitLabel={t('planning.common.create')}
      disabled={!pred || !succ}
      onSubmit={async () => {
        if (!pred || !succ) return;
        await api(P.createDependency, {
          params: { projectId },
          body: { predecessorType: pred.type, predecessorId: pred.id, successorType: succ.type, successorId: succ.id, type: f.type as 'FS', lagDays: Number(f.lag) || 0, note: f.note.trim() || undefined },
        });
        toast.show('success', t('planning.dependency.created'));
        await refresh();
        onClose();
      }}
    >
      <SelectField label={t('planning.dependency.predecessor')} required value={f.pred} onChange={(e) => setF({ ...f, pred: e.target.value })}>
        <option value="">{t('planning.common.choose')}</option>
        {nodes.map((n) => (
          <option key={n.id} value={n.id}>
            {nodeLabel(n)}
          </option>
        ))}
      </SelectField>
      <SelectField label={t('planning.dependency.successor')} required value={f.succ} onChange={(e) => setF({ ...f, succ: e.target.value })}>
        <option value="">{t('planning.common.choose')}</option>
        {nodes.map((n) => (
          <option key={n.id} value={n.id}>
            {nodeLabel(n)}
          </option>
        ))}
      </SelectField>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label={t('planning.dependency.type')} required value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} hint={t('planning.dependency.typeHint')}>
          {DEPENDENCY_TYPES.map((d) => (
            <option key={d} value={d}>
              {tStatus('dependencyTypes', d)}
            </option>
          ))}
        </SelectField>
        <TextField label={t('planning.dependency.lag')} type="number" min={-60} max={365} value={f.lag} onChange={(e) => setF({ ...f, lag: e.target.value })} dir="ltr" />
      </div>
      <TextAreaField label={t('common.command.note')} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} rows={2} maxLength={1000} />
    </FormDialog>
  );
}

// =============================================================================================================
// Baselines

export function BaselinesTab() {
  const { t, formatDateTime, formatNumber } = useI18n();
  const { projectId, can } = useProjectContext();
  const bl = useBaselines(projectId);
  const [open, setOpen] = useState(false);
  const columns: Column<Baseline>[] = [
    { key: 'v', header: t('planning.baseline.version'), isRowHeader: true, cell: (b) => <CodeLink href={baselineHref(projectId, b.id)} code={`v${b.versionNo}`} /> },
    { key: 'status', header: t('planning.common.status'), cell: (b) => <StatusBadge enumName="baselineStatuses" value={b.status} /> },
    { key: 'by', header: t('planning.baseline.proposedBy'), cell: (b) => <span dir="auto">{b.proposedByName ?? '—'}</span> },
    { key: 'at', header: t('planning.baseline.createdAt'), cell: (b) => formatDateTime(b.createdAt) },
    { key: 'approved', header: t('planning.baseline.approvedAt'), cell: (b) => formatDateTime(b.approvedAt) },
    { key: 'counts', header: t('planning.baseline.contents'), cell: (b) => t('planning.baseline.counts', { tasks: formatNumber(b.counts.tasks), milestones: formatNumber(b.counts.milestones), deliverables: formatNumber(b.counts.deliverables), perimeter: formatNumber(b.counts.perimeterItems) }) },
    { key: 'hash', header: t('planning.baseline.hash'), cell: (b) => <code dir="ltr" className="text-xs" title={b.snapshotHash}>{b.snapshotHash.slice(0, 12)}…</code> },
    { key: 'cr', header: t('planning.baseline.changeRequest'), cell: (b) => (b.changeRequestId ? <Link className={btn.link} href={`/projects/${projectId}/raid/changes/${b.changeRequestId}`}>{t('planning.baseline.viewCr')}</Link> : '—') },
  ];
  const pending = bl.data?.items.some((b) => b.status === 'proposed');
  return (
    <div className="space-y-4" data-testid="baselines-tab">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-3xl text-sm text-muted">{t('planning.baseline.hint')}</p>
        {can('planning.baseline.propose') && !pending ? (
          <button type="button" className={btn.primary} onClick={() => setOpen(true)} data-testid="baseline-propose">
            {t('planning.baseline.propose')}
          </button>
        ) : null}
      </div>
      <DataTable caption={t('planning.tabs.baselines')} columns={columns} rows={bl.data?.items} rowKey={(b) => b.id} isLoading={bl.isLoading} error={bl.error} onRetry={() => bl.refetch()} emptyTitle={t('planning.baseline.empty')} testId="baselines-table" />
      <ProposeBaselineDialog open={open} onClose={() => setOpen(false)} hasApproved={!!bl.data?.items.some((b) => b.status === 'approved')} />
    </div>
  );
}

function ProposeBaselineDialog({ open, onClose, hasApproved }: { open: boolean; onClose: () => void; hasApproved: boolean }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useRefreshPlanning(projectId);
  const toast = useToast();
  const [note, setNote] = useState('');
  const [cr, setCr] = useState('');
  const crs = useQuery({
    queryKey: pk.changeRequests(projectId, { status: 'approved', purpose: 'rebaseline' }),
    queryFn: ({ signal }) => api(P.listChangeRequests, { params: { projectId }, query: { status: 'approved', pageSize: 100 }, signal }),
    enabled: open && hasApproved,
  });
  useEffect(() => {
    if (open) {
      setNote('');
      setCr('');
    }
  }, [open]);
  const options = (crs.data?.items ?? []).filter((c) => c.rebaseline && !c.linkedBaselineId);
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      testId="baseline-form"
      title={t('planning.baseline.propose')}
      submitLabel={t('planning.baseline.propose')}
      disabled={hasApproved && !cr}
      onSubmit={async () => {
        const r = await api(P.proposeBaseline, { params: { projectId }, body: { note: note.trim() || undefined, changeRequestId: cr || undefined } });
        toast.show('success', t('planning.baseline.proposed', { version: r.versionNo }));
        await refresh();
        onClose();
      }}
    >
      <ul className="list-disc space-y-1 ps-5 text-sm">
        <li>{t('planning.baseline.proposeEffect')}</li>
        <li>{t('planning.baseline.proposeApproval')}</li>
      </ul>
      {hasApproved ? (
        <SelectField label={t('planning.baseline.changeRequest')} required value={cr} onChange={(e) => setCr(e.target.value)} hint={t('planning.baseline.rebaselineHint')}>
          <option value="">{options.length ? t('planning.common.choose') : t('planning.baseline.noApprovedCr')}</option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} — {c.title}
            </option>
          ))}
        </SelectField>
      ) : null}
      <TextAreaField label={t('common.command.note')} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={4000} />
    </FormDialog>
  );
}

// =============================================================================================================
// Look-ahead

export function LookAheadTab() {
  const { t, locale } = useI18n();
  const { projectId } = useProjectContext();
  const ws = useWorkstreams(projectId);
  const [weeks, setWeeks] = useState<2 | 4 | 8>(2);
  const [wsId, setWsId] = useState('');
  const la = useQuery({
    queryKey: pk.lookAhead(projectId, { weeks, wsId }),
    queryFn: ({ signal }) => api(P.lookAhead, { params: { projectId }, query: { weeks, workstreamId: wsId || undefined }, signal }),
  });
  return (
    <div className="space-y-4" data-testid="lookahead-tab">
      <div className="flex flex-wrap items-end gap-3">
        <div role="group" aria-label={t('planning.lookAhead.window')} className="flex gap-1">
          {([2, 4, 8] as const).map((w) => (
            <button key={w} type="button" aria-pressed={weeks === w} className={cx(btn.secondary, weeks === w && 'border-primary bg-primary-soft text-primary')} onClick={() => setWeeks(w)} data-testid={`weeks-${w}`}>
              {t('planning.lookAhead.weeks', { count: w })}
            </button>
          ))}
        </div>
        <FilterSelect label={t('planning.common.workstream')} value={wsId} onChange={setWsId} className="w-full sm:w-56">
          <option value="">{t('planning.common.allWorkstreams')}</option>
          {ws.data?.items.map((w) => (
            <option key={w.id} value={w.id}>
              {w.code} — {workstreamName(w, locale)}
            </option>
          ))}
        </FilterSelect>
      </div>
      {la.isLoading ? (
        <LoadingState />
      ) : la.error ? (
        <ErrorState error={la.error} onRetry={() => la.refetch()} />
      ) : la.data ? (
        <>
          <p className="text-sm text-muted">{t('planning.lookAhead.range', { from: la.data.window.from, to: la.data.window.to })}</p>
          <div className="grid gap-4 lg:grid-cols-3">
            <LookList id="la-overdue" title={t('planning.lookAhead.overdue')} items={la.data.overdue} tone="danger" />
            <LookList id="la-due" title={t('planning.lookAhead.due')} items={la.data.due} />
            <LookList id="la-starting" title={t('planning.lookAhead.starting')} items={la.data.starting} />
          </div>
        </>
      ) : null}
    </div>
  );
}

function LookList({ id, title, items, tone }: { id: string; title: string; items: LookAheadItem[]; tone?: 'danger' }) {
  const { t, tStatus, formatNumber } = useI18n();
  const { projectId } = useProjectContext();
  return (
    <Section id={id} title={`${title} (${formatNumber(items.length)})`}>
      {items.length === 0 ? (
        <EmptyState title={t('planning.lookAhead.none')} className="py-4" />
      ) : (
        <ul className="divide-y divide-line" data-testid={id}>
          {items.map((i) => (
            <li key={`${i.type}-${i.id}-${i.dateKind}`} className="flex items-start justify-between gap-2 py-2">
              <CodeLink href={nodeHref(projectId, i.type, i.id)} code={i.code} title={i.title} />
              <div className="flex shrink-0 flex-col items-end gap-1 text-xs">
                <DateText value={i.date} overdue={tone === 'danger'} />
                <span className="text-muted">
                  {tStatus(i.type === 'task' ? 'taskStatuses' : i.type === 'milestone' ? 'milestoneStatuses' : 'deliverableStatuses', i.status)}
                  {i.critical ? ` · ${t('planning.gantt.critical')}` : ''}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// =============================================================================================================
// What-if: delay impact (AT-15)

export function WhatIfTab({ initialNodeId }: { initialNodeId?: string }) {
  const { t, formatDate, formatNumber } = useI18n();
  const { projectId } = useProjectContext();
  const sched = useSchedule(projectId);
  const nodes = useMemo(() => (sched.data?.nodes ?? []).filter((n) => n.status !== 'cancelled'), [sched.data]);
  const [nodeId, setNodeId] = useState(initialNodeId ?? '');
  const [target, setTarget] = useState('');
  const [days, setDays] = useState('5');
  const run = useMutation({ mutationFn: () => api(P.delayImpact, { params: { projectId }, body: { nodeId, delayWorkingDays: Number(days), targetNodeId: target || undefined } }) });
  const d = run.data;
  const valid = !!nodeId && Number.isInteger(Number(days)) && Number(days) >= 1 && Number(days) <= 365;
  return (
    <div className="space-y-4" data-testid="whatif-tab">
      <div className={cx(card, 'space-y-3 p-4')}>
        <div className="flex flex-wrap items-center gap-2">
          <ForecastLabel />
          <p className="text-sm text-muted">{t('planning.whatIf.hint')}</p>
        </div>
        <form
          className="grid gap-3 md:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) run.mutate();
          }}
        >
          <SelectField className="md:col-span-2" label={t('planning.whatIf.activity')} required value={nodeId} onChange={(e) => setNodeId(e.target.value)}>
            <option value="">{t('planning.common.choose')}</option>
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {nodeLabel(n)}
              </option>
            ))}
          </SelectField>
          <TextField label={t('planning.whatIf.days')} type="number" min={1} max={365} required value={days} onChange={(e) => setDays(e.target.value)} dir="ltr" />
          <SelectField label={t('planning.whatIf.target')} value={target} onChange={(e) => setTarget(e.target.value)} hint={t('planning.whatIf.targetHint')}>
            <option value="">{t('planning.schedule.wholeProject')}</option>
            {nodes
              .filter((n) => n.type === 'milestone')
              .map((n) => (
                <option key={n.id} value={n.id}>
                  {nodeLabel(n)}
                </option>
              ))}
          </SelectField>
          <div className="md:col-span-4">
            <button type="submit" className={btn.primary} disabled={!valid || run.isPending} data-testid="whatif-run">
              {run.isPending ? t('common.actions.working') : t('planning.whatIf.run')}
            </button>
          </div>
        </form>
        <ApiErrorNotice error={run.error} />
      </div>
      {d ? (
        <section aria-labelledby="whatif-result" className={cx(card, 'space-y-3 p-4')} data-testid="whatif-result" data-status={d.status}>
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="whatif-result" className="text-lg font-semibold">
              {t('planning.whatIf.result')}
            </h2>
            <ForecastLabel />
            <StatusBadge enumName="ragStatuses" value={d.status} tone={d.status === 'computed' ? 'info' : 'warning'} label={t(`planning.whatIf.status_${d.status}`)} />
          </div>
          <p className="text-sm">
            {t('planning.whatIf.summary', { code: d.delayedNode.code, days: formatNumber(d.delayWorkingDays) })}
          </p>
          {d.status === 'computed' ? (
            <dl className="grid gap-3 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted">{t('planning.whatIf.before')}</dt>
                <dd className="tabular text-lg font-semibold">{formatDate(d.finishBeforeDelay)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">{t('planning.whatIf.after')}</dt>
                <dd className="tabular text-lg font-semibold">{formatDate(d.forecastFinish)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">{t('planning.whatIf.slip')}</dt>
                <dd className={cx('tabular text-lg font-semibold', (d.projectSlipWorkingDays ?? 0) > 0 && 'text-danger')} data-testid="whatif-slip">
                  {t('planning.whatIf.slipDays', { count: d.projectSlipWorkingDays ?? 0 })}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-warning">{t('planning.whatIf.incomplete', { count: d.issues.length })}</p>
          )}
          {d.affectedGateKeys.length ? (
            <p className="text-sm">
              {t('planning.whatIf.gates')}: <span dir="ltr">{d.affectedGateKeys.join(', ')}</span>
            </p>
          ) : null}
          {d.affected.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">{t('planning.whatIf.affected')}</caption>
                <thead className="bg-surface-muted">
                  <tr>
                    {[t('planning.gantt.activity'), t('planning.whatIf.before'), t('planning.whatIf.after'), t('planning.whatIf.slip')].map((h) => (
                      <th key={h} scope="col" className="px-3 py-2 text-start font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.affected.map((a) => (
                    <tr key={a.id} className="border-b border-line">
                      <th scope="row" className="px-3 py-2 text-start font-normal">
                        <CodeLink href={nodeHref(projectId, a.type, a.id)} code={a.code} title={a.title} />
                        {a.critical ? <span className="ms-2 text-xs font-semibold text-danger">{t('planning.gantt.critical')}</span> : null}
                      </th>
                      <td className="px-3 py-2">
                        <DateText value={a.earlyFinishBefore} />
                      </td>
                      <td className="px-3 py-2">
                        <DateText value={a.earlyFinishAfter} />
                      </td>
                      <td className="tabular px-3 py-2">{formatNumber(a.slipWorkingDays)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <details>
            <summary className="cursor-pointer text-sm text-primary">{t('planning.schedule.assumptions', { count: d.assumptions.length })}</summary>
            <ul className="mt-2 list-disc space-y-0.5 ps-5 text-xs text-muted" lang="en" dir="ltr">
              {d.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </details>
          <p className="text-xs text-muted">{t('planning.common.noProbability')}</p>
        </section>
      ) : null}
    </div>
  );
}

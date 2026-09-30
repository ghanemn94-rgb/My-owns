'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { planningRoutes as P } from '@hub/contracts';
import { TASK_STATUSES } from '@hub/domain';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { raidHref, taskHref, useProgress, useRefreshPlanning, useTasks, type Task } from '@/lib/planning';
import { useProjectContext } from '@/lib/project-context';
import type { Workstream } from '@/lib/workstreams';
import { workstreamName } from '@/lib/workstreams';
import { ConfirmCommandDialog } from '../ConfirmCommandDialog';
import { DataTable, type Column } from '../DataTable';
import { DemoBadge } from '../DemoBadge';
import { ErrorState } from '../ErrorState';
import { LoadingState } from '../LoadingState';
import { SearchInput } from '../SearchInput';
import { StatusBadge } from '../StatusBadge';
import { useToast } from '../Toast';
import { btn, cx } from '../ui';
import { CodeLink, DateText, FilterSelect, FilterToggle, RagBadge, Section } from './bits';
import { TaskFormDialog } from './dialogs';
import { RagTriple, WeightedProgressBlock } from './plan/HealthTab';

const PAGE = 25;

/** Workstream tasks: server-side filters and pagination; bulk confirmation of Draft activities. */
export function WorkstreamTasks({ ws }: { ws: Workstream }) {
  const { t, tStatus, formatNumber, locale } = useI18n();
  const { projectId, can } = useProjectContext();
  const refresh = useRefreshPlanning(projectId);
  const toast = useToast();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [overdue, setOverdue] = useState(false);
  const [mine, setMine] = useState(false);
  const [page, setPage] = useState(1);
  const [create, setCreate] = useState(false);
  const [activate, setActivate] = useState(false);
  useEffect(() => setPage(1), [q, status, overdue, mine]);
  const list = useTasks(projectId, { page, pageSize: PAGE, workstreamId: ws.id, q: q || undefined, status: status || undefined, overdue: overdue ? 'true' : undefined, ownerUserId: mine ? 'me' : undefined, sort: 'wbs' });
  const drafts = useTasks(projectId, { page: 1, pageSize: 1, workstreamId: ws.id, status: 'draft' });
  const draftCount = drafts.data?.total ?? 0;
  const canManage = can('planning.task.manage');

  const columns: Column<Task>[] = [
    { key: 'code', header: t('planning.common.code'), isRowHeader: true, cell: (x) => <CodeLink href={taskHref(projectId, x.id)} code={x.wbsCode} title={x.title} titleAr={x.titleAr} testId={`task-link-${x.wbsCode}`} /> },
    { key: 'status', header: t('planning.common.status'), cell: (x) => <StatusBadge enumName="taskStatuses" value={x.status} /> },
    { key: 'owner', header: t('planning.common.accountable'), cell: (x) => (x.accountableName ? <span dir="auto">{x.accountableName}</span> : <span className="text-muted">{t('planning.common.unassigned')}</span>) },
    { key: 'finish', header: t('planning.task.plannedFinish'), cell: (x) => <DateText value={x.plannedFinish} overdue={x.overdue} /> },
    { key: 'progress', header: t('planning.task.progressShort'), cell: (x) => <span className="tabular whitespace-nowrap">{formatNumber(x.reportedProgress)}% <span className="text-xs text-muted">/ {formatNumber(x.verifiedProgress)}%</span></span> },
    { key: 'demo', header: t('common.table.demoColumn'), headerHidden: true, cell: (x) => (x.isDemo ? <DemoBadge /> : null) },
  ];
  return (
    <div className="space-y-3" data-testid="ws-tasks">
      <div className="flex flex-wrap items-end gap-3">
        <SearchInput className="w-full sm:w-64" label={t('planning.wbs.search')} value={q} onChange={setQ} />
        <FilterSelect label={t('planning.common.status')} value={status} onChange={setStatus} className="w-full sm:w-48" testId="ws-task-status">
          <option value="">{t('planning.common.allStatuses')}</option>
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {tStatus('taskStatuses', s)}
            </option>
          ))}
        </FilterSelect>
        <FilterToggle label={t('planning.common.onlyOverdue')} checked={overdue} onChange={setOverdue} />
        <FilterToggle label={t('planning.common.onlyMine')} checked={mine} onChange={setMine} />
        <div className="ms-auto flex flex-wrap gap-2">
          {canManage && draftCount > 0 ? (
            <button type="button" className={btn.secondary} onClick={() => setActivate(true)} data-testid="ws-activate-all">
              {t('planning.wbs.activateAllCount', { count: formatNumber(draftCount) })}
            </button>
          ) : null}
          {canManage ? (
            <button type="button" className={btn.primary} onClick={() => setCreate(true)}>
              <Plus aria-hidden="true" className="size-4" />
              {t('planning.task.create')}
            </button>
          ) : null}
        </div>
      </div>
      <DataTable
        caption={t('planning.ws.tasks')}
        columns={columns}
        rows={list.data?.items}
        rowKey={(x) => x.id}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        emptyTitle={t('planning.wbs.emptyFiltered')}
        pagination={list.data ? { page, pageSize: PAGE, total: list.data.total, onPageChange: setPage } : undefined}
        testId="ws-tasks-table"
      />
      <p className="text-xs text-muted">{t('planning.wbs.progressLegend')}</p>
      <TaskFormDialog open={create} onClose={() => setCreate(false)} defaultWorkstreamId={ws.id} />
      <ConfirmCommandDialog
        open={activate}
        onClose={() => setActivate(false)}
        title={t('planning.wbs.activateAllTitle', { ws: `${ws.code} — ${workstreamName(ws, locale)}` })}
        confirmLabel={t('planning.wbs.activateAll')}
        consequences={[t('planning.wbs.activateAllEffect', { count: draftCount }), t('planning.wbs.activateAllScope'), t('common.command.audited')]}
        onConfirm={async ({ note }) => {
          const r = await api(P.activateWorkstreamTasks, { params: { projectId, workstreamId: ws.id }, body: { note: note || undefined } });
          await refresh();
          toast.show('success', t('planning.wbs.activated', { count: r.activated }));
          setActivate(false);
        }}
      />
    </div>
  );
}

/** Workstream progress & health: weighted progress, calculated vs effective vs reported RAG, blockers, data quality. */
export function WorkstreamProgress({ ws }: { ws: Workstream }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const prog = useProgress(projectId);
  if (prog.isLoading) return <LoadingState />;
  if (prog.error) return <ErrorState error={prog.error} onRetry={() => prog.refetch()} />;
  const h = prog.data?.workstreams.find((w) => w.id === ws.id);
  if (!h) return null;
  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid="ws-progress">
      <Section id="wsp-progress" title={t('planning.health.progress')} hint={t('planning.health.progressHint')}>
        <WeightedProgressBlock p={h.progress} label={t('planning.health.progress')} />
        {h.reportedProgressAvg !== null ? <p className="mt-2 text-xs text-muted">{t('planning.ws.reportedAvg', { value: h.reportedProgressAvg })}</p> : null}
      </Section>
      <Section id="wsp-rag" title={t('planning.health.calculated')} hint={t('planning.health.ruleHint')}>
        <RagTriple rag={h.rag} />
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted">{t('planning.health.reported')}</dt>
            <dd>{h.rag.reported ? <RagBadge value={h.rag.reported} /> : '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">{t('planning.health.lastUpdate')}</dt>
            <dd>{h.lastAcceptedUpdate ? <DateText value={h.lastAcceptedUpdate.periodEnd} /> : <RagBadge value="not_updated" />}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">{t('planning.health.baselineFinish')}</dt>
            <dd>
              <DateText value={h.baselineFinish} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">{t('planning.health.forecastFinish')}</dt>
            <dd>
              <DateText value={h.forecastFinish} />
            </dd>
          </div>
        </dl>
        <Link className={cx(btn.link, 'mt-3 inline-block text-sm')} href={`/projects/${projectId}/plan?tab=health`}>
          {t('planning.ws.overrides')}
        </Link>
      </Section>
      <Section id="wsp-blockers" title={t('planning.health.blockers')}>
        {h.openBlockers.length === 0 ? (
          <p className="text-sm text-muted">{t('planning.ws.noBlockers')}</p>
        ) : (
          <ul className="space-y-1 text-sm" data-testid="ws-blockers">
            {h.openBlockers.map((b) => (
              <li key={b.id}>
                <CodeLink href={b.type === 'task' ? taskHref(projectId, b.id) : raidHref(projectId, 'issues', b.id)} code={b.code} title={b.title} />
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section id="wsp-dq" title={t('planning.health.dataQuality')}>
        {h.dataQuality.length === 0 ? (
          <p className="text-sm text-success">{t('planning.health.noGaps')}</p>
        ) : (
          <ul className="list-disc space-y-0.5 ps-5 text-sm text-muted" lang="en" dir="ltr">
            {h.dataQuality.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

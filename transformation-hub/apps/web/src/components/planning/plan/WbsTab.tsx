'use client';

import Link from 'next/link';
import { ChevronDown, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { planningRoutes as P } from '@hub/contracts';
import { TASK_STATUSES } from '@hub/domain';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { taskHref, useAllTasks, useRefreshPlanning, type Task } from '@/lib/planning';
import { useProjectContext } from '@/lib/project-context';
import { useWorkstreams } from '@/lib/queries';
import { workstreamName, type Workstream as Ws } from '@/lib/workstreams';
import { ConfirmCommandDialog } from '../../ConfirmCommandDialog';
import { EmptyState } from '../../EmptyState';
import { ErrorState } from '../../ErrorState';
import { LoadingState } from '../../LoadingState';
import { SearchInput } from '../../SearchInput';
import { StatusBadge } from '../../StatusBadge';
import { useToast } from '../../Toast';
import { btn, card, cx } from '../../ui';
import { DemoBadge } from '../../DemoBadge';
import { VerificationBadge } from '../../VerificationBadge';
import { DateText, FilterSelect, FilterToggle } from '../bits';
import { TaskFormDialog } from '../dialogs';

function ActivateAllDialog({ open, onClose, ws, drafts }: { open: boolean; onClose: () => void; ws: Ws; drafts: number }) {
  const { t, locale } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useRefreshPlanning(projectId);
  const toast = useToast();
  return (
    <ConfirmCommandDialog
      open={open}
      onClose={onClose}
      title={t('planning.wbs.activateAllTitle', { ws: `${ws.code} — ${workstreamName(ws, locale)}` })}
      confirmLabel={t('planning.wbs.activateAll')}
      consequences={[t('planning.wbs.activateAllEffect', { count: drafts }), t('planning.wbs.activateAllScope'), t('common.command.audited')]}
      onConfirm={async ({ note }) => {
        const r = await api(P.activateWorkstreamTasks, { params: { projectId, workstreamId: ws.id }, body: { note: note || undefined } });
        await refresh();
        toast.show('success', t('planning.wbs.activated', { count: r.activated }));
        onClose();
      }}
    />
  );
}

/** Integrated WBS: tasks grouped by workstream, nested by parent; Draft (proposed) activities are marked as such. */
export function WbsTab() {
  const { t, tStatus, locale, formatNumber } = useI18n();
  const { projectId, can } = useProjectContext();
  const ws = useWorkstreams(projectId);
  const [q, setQ] = useState('');
  const [workstreamId, setWorkstreamId] = useState('');
  const [status, setStatus] = useState('');
  const [overdue, setOverdue] = useState(false);
  const [mine, setMine] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [activate, setActivate] = useState<{ ws: Ws; drafts: number } | null>(null);
  const query = { q: q || undefined, workstreamId: workstreamId || undefined, status: status || undefined, overdue: overdue ? ('true' as const) : undefined, ownerUserId: mine ? 'me' : undefined, sort: 'wbs' as const };
  const tasks = useAllTasks(projectId, query);
  const canManage = can('planning.task.manage');

  const groups = useMemo(() => {
    const byWs = new Map<string, Task[]>();
    for (const tk of tasks.data?.items ?? []) {
      const k = tk.workstreamId ?? 'none';
      (byWs.get(k) ?? byWs.set(k, []).get(k)!).push(tk);
    }
    const order = (ws.data?.items ?? []).map((w) => w.id);
    return [...byWs.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  }, [tasks.data, ws.data]);

  /** Depth-first order with indentation by parent. */
  const nest = (items: Task[]) => {
    const ids = new Set(items.map((x) => x.id));
    const kids = new Map<string, Task[]>();
    const roots: Task[] = [];
    for (const x of items) {
      if (x.parentId && ids.has(x.parentId)) (kids.get(x.parentId) ?? kids.set(x.parentId, []).get(x.parentId)!).push(x);
      else roots.push(x);
    }
    const out: { task: Task; depth: number }[] = [];
    const walk = (x: Task, d: number) => {
      out.push({ task: x, depth: d });
      for (const c of kids.get(x.id) ?? []) walk(c, d + 1);
    };
    roots.forEach((r) => walk(r, 0));
    return out;
  };

  return (
    <div className="space-y-4" data-testid="wbs-tab">
      <div className="flex flex-wrap items-end gap-3">
        <SearchInput className="w-full sm:w-64" label={t('planning.wbs.search')} value={q} onChange={setQ} />
        <FilterSelect label={t('planning.common.workstream')} value={workstreamId} onChange={setWorkstreamId} className="w-full sm:w-56" testId="wbs-filter-ws">
          <option value="">{t('planning.common.allWorkstreams')}</option>
          {ws.data?.items.map((w) => (
            <option key={w.id} value={w.id}>
              {w.code} — {workstreamName(w, locale)}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label={t('planning.common.status')} value={status} onChange={setStatus} className="w-full sm:w-48" testId="wbs-filter-status">
          <option value="">{t('planning.common.allStatuses')}</option>
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {tStatus('taskStatuses', s)}
            </option>
          ))}
        </FilterSelect>
        <FilterToggle label={t('planning.common.onlyOverdue')} checked={overdue} onChange={setOverdue} />
        <FilterToggle label={t('planning.common.onlyMine')} checked={mine} onChange={setMine} />
        {canManage ? (
          <button type="button" className={cx(btn.primary, 'ms-auto')} onClick={() => setCreateOpen(true)} data-testid="task-create">
            <Plus aria-hidden="true" className="size-4" />
            {t('planning.task.create')}
          </button>
        ) : null}
      </div>
      <p className="text-xs text-muted">{t('planning.wbs.draftHint')}</p>

      {tasks.isLoading ? (
        <LoadingState />
      ) : tasks.error ? (
        <ErrorState error={tasks.error} onRetry={() => tasks.refetch()} />
      ) : groups.length === 0 ? (
        <div className={card}>
          <EmptyState title={q || status || workstreamId || overdue || mine ? t('planning.wbs.emptyFiltered') : t('planning.wbs.empty')} />
        </div>
      ) : (
        <div className={cx(card, 'overflow-x-auto')}>
          <table className="w-full border-collapse text-sm" data-testid="wbs-table">
            <caption className="sr-only">{t('planning.wbs.title')}</caption>
            <thead className="bg-surface-muted">
              <tr>
                {[t('planning.common.code'), t('planning.common.title'), t('planning.common.status'), t('planning.common.accountable'), t('planning.task.duration'), t('planning.task.plannedFinish'), t('planning.task.progressShort')].map((h) => (
                  <th key={h} scope="col" className="border-b border-line px-3 py-2 text-start font-semibold whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            {groups.map(([wsId, items]) => {
              const w = ws.data?.items.find((x) => x.id === wsId);
              const open = !collapsed[wsId];
              const drafts = items.filter((x) => x.status === 'draft').length;
              return (
                <tbody key={wsId} data-ws={w?.code}>
                  <tr className="bg-primary-soft/40">
                    <th colSpan={7} scope="rowgroup" className="border-b border-line px-3 py-2 text-start">
                      <div className="flex flex-wrap items-center gap-2">
                        <button type="button" aria-expanded={open} className="inline-flex items-center gap-1 font-semibold text-ink" onClick={() => setCollapsed((c) => ({ ...c, [wsId]: open }))}>
                          <ChevronDown aria-hidden="true" className={cx('size-4 transition-transform', !open && '-rotate-90 rtl:rotate-90')} />
                          <span dir="ltr">{w?.code ?? EM_DASH}</span>
                          <span dir="auto">{w ? workstreamName(w, locale) : t('planning.wbs.noWorkstream')}</span>
                        </button>
                        <span className="text-xs font-normal text-muted">{t('planning.wbs.groupCount', { count: items.length, drafts })}</span>
                        {w && canManage && drafts > 0 ? (
                          <button type="button" className={cx(btn.secondary, 'ms-auto min-h-8 px-2 py-1 text-xs')} onClick={() => setActivate({ ws: w, drafts })} data-testid={`activate-${w.code}`}>
                            {t('planning.wbs.activateAll')}
                          </button>
                        ) : null}
                      </div>
                    </th>
                  </tr>
                  {open
                    ? nest(items).map(({ task: x, depth }) => (
                        <tr key={x.id} className="border-b border-line last:border-b-0 hover:bg-surface-muted/60" data-task={x.wbsCode}>
                          <td className="px-3 py-2 align-top whitespace-nowrap" style={{ paddingInlineStart: `${0.75 + depth * 1.25}rem` }}>
                            <Link href={taskHref(projectId, x.id)} className={btn.link} dir="ltr">
                              {x.wbsCode}
                            </Link>
                          </td>
                          <td className="min-w-56 px-3 py-2 align-top">
                            <Link href={taskHref(projectId, x.id)} className="text-ink hover:text-primary hover:underline" dir="auto">
                              {locale === 'ar' && x.titleAr ? x.titleAr : x.title}
                            </Link>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {x.status === 'draft' ? <VerificationBadge value={x.verificationStatus} /> : null}
                              {x.isDemo ? <DemoBadge /> : null}
                            </div>
                          </td>
                          <td className="px-3 py-2 align-top">
                            <StatusBadge enumName="taskStatuses" value={x.status} />
                          </td>
                          <td className="px-3 py-2 align-top">
                            {x.accountableName ? <span dir="auto">{x.accountableName}</span> : <span className="text-muted">{t('planning.common.unassigned')}</span>}
                          </td>
                          <td className="tabular px-3 py-2 align-top">{x.durationDays === null ? <span className="text-muted">{t('planning.task.tbd')}</span> : formatNumber(x.durationDays)}</td>
                          <td className="px-3 py-2 align-top">
                            <DateText value={x.plannedFinish} overdue={x.overdue} />
                          </td>
                          <td className="tabular px-3 py-2 align-top whitespace-nowrap">
                            {formatNumber(x.reportedProgress)}% <span className="text-xs text-muted">/ {formatNumber(x.verifiedProgress)}%</span>
                          </td>
                        </tr>
                      ))
                    : null}
                </tbody>
              );
            })}
          </table>
          <p className="border-t border-line px-3 py-2 text-xs text-muted">{t('planning.wbs.progressLegend')}</p>
        </div>
      )}
      {tasks.data ? <p className="text-xs text-muted">{t('planning.wbs.total', { count: tasks.data.total })}</p> : null}
      <TaskFormDialog open={createOpen} onClose={() => setCreateOpen(false)} defaultWorkstreamId={workstreamId || undefined} />
      {activate ? <ActivateAllDialog open onClose={() => setActivate(null)} ws={activate.ws} drafts={activate.drafts} /> : null}
    </div>
  );
}

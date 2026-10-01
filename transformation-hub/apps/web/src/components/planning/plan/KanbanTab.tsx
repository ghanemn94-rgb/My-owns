'use client';

import Link from 'next/link';
import { ChevronDown, GripVertical } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { TASK_MACHINE, TASK_STATUSES, type TaskStatus } from '@hub/domain';
import { useI18n } from '@/i18n/provider';
import { taskHref, useAllTasks, useRefreshPlanning, type Task } from '@/lib/planning';
import { useProjectContext } from '@/lib/project-context';
import { useWorkstreams } from '@/lib/queries';
import { workstreamName } from '@/lib/workstreams';
import { DemoBadge } from '../../DemoBadge';
import { EmptyState } from '../../EmptyState';
import { ErrorState } from '../../ErrorState';
import { LoadingState } from '../../LoadingState';
import { ScrollRegion } from '../../ScrollRegion';
import { SearchInput } from '../../SearchInput';
import { StatusBadge } from '../../StatusBadge';
import { VerificationBadge } from '../../VerificationBadge';
import { btn, card, cx } from '../../ui';
import { CommandConfirmDialog, usableCommands, type CommandSpec } from '../CommandBar';
import { DateText, FilterSelect, FilterToggle } from '../bits';
import { useTaskCommands } from '../commands';

/** Cards shown per column before "show more" (the board reads every task of the filters, like the WBS table). */
const COLUMN_PAGE = 20;
const MACHINE = TASK_MACHINE as Record<string, { from: readonly TaskStatus[]; to: TaskStatus }>;

/** Column a task command moves a task to (TASK_MACHINE) — a move is always one of the task's own status commands. */
export function targetOf(command: string): TaskStatus | null {
  return MACHINE[command]?.to ?? null;
}

interface Move {
  command: CommandSpec;
  to: TaskStatus;
}

/** The moves a task offers this caller: its allowed commands (server state machine), granted and not hidden. */
function useMoves(task: Task | undefined): Move[] {
  const { can } = useProjectContext();
  const specs = useTaskCommands(task);
  if (!task) return [];
  return usableCommands(specs, task.allowedCommands, can)
    .map((command) => ({ command, to: targetOf(command.key) }))
    .filter((m): m is Move => m.to !== null && m.to !== task.status);
}

function KanbanCard({
  task,
  wsLabel,
  focusMe,
  onFocused,
  onMove,
  onDragStart,
  onDragEnd,
}: {
  task: Task;
  wsLabel: string | null;
  focusMe: boolean;
  onFocused: () => void;
  onMove: (task: Task, move: Move) => void;
  onDragStart: (task: Task) => void;
  onDragEnd: () => void;
}) {
  const { t, tStatus, locale } = useI18n();
  const { projectId } = useProjectContext();
  const moves = useMoves(task);
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const linkRef = useRef<HTMLAnchorElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  // After a move the card re-renders in its new column: focus follows it (keyboard users keep their place).
  useEffect(() => {
    if (!focusMe) return;
    const raf = requestAnimationFrame(() => {
      linkRef.current?.focus();
      onFocused();
    });
    return () => cancelAnimationFrame(raf);
  }, [focusMe, onFocused]);
  const title = locale === 'ar' && task.titleAr ? task.titleAr : task.title;
  const onMenuKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape' && open) {
      e.stopPropagation();
      setOpen(false);
      toggleRef.current?.focus();
    }
  };
  const draggable = moves.length > 0;
  return (
    <li
      className={cx(card, 'p-2.5 shadow-sm', draggable && 'cursor-grab active:cursor-grabbing')}
      data-testid="kanban-card"
      data-task={task.wbsCode}
      data-task-id={task.id}
      data-status={task.status}
      draggable={draggable}
      onDragStart={(e: DragEvent<HTMLLIElement>) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', task.id);
        onDragStart(task);
      }}
      onDragEnd={onDragEnd}
      onKeyDown={onMenuKey}
    >
      <div className="flex items-start gap-1.5">
        {draggable ? <GripVertical aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted" /> : null}
        <div className="min-w-0 flex-1">
          <Link ref={linkRef} href={taskHref(projectId, task.id)} className="group block min-w-0 break-words" data-testid="kanban-card-link">
            <span className="block text-xs font-semibold text-primary group-hover:underline" dir="ltr">
              {task.wbsCode}
            </span>
            {/* A title typed by a planner (no template activity) is shown as entered; template titles are bilingual. */}
            <span className="block text-sm text-ink" dir="auto" data-user-text={task.templateActivityId ? undefined : ''}>
              {title}
            </span>
          </Link>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
            {wsLabel ? <span dir="ltr">{wsLabel}</span> : null}
            <span dir="auto">{task.accountableName ?? t('planning.common.unassigned')}</span>
            {task.plannedFinish ? <DateText value={task.plannedFinish} overdue={task.overdue} /> : null}
          </div>
          {task.status === 'draft' || task.isDemo ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {task.status === 'draft' ? <VerificationBadge value={task.verificationStatus} /> : null}
              {task.isDemo ? <DemoBadge /> : null}
            </div>
          ) : null}
        </div>
      </div>
      {moves.length > 0 ? (
        <div className="mt-2 border-t border-line pt-2">
          <button
            ref={toggleRef}
            type="button"
            className={cx(btn.secondary, 'min-h-8 w-full justify-between px-2 py-1 text-xs')}
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpen((o) => !o)}
            data-testid="kanban-move"
          >
            {t('planning.kanban.move')}
            <span className="sr-only"> {task.wbsCode}</span>
            <ChevronDown aria-hidden="true" className={cx('size-3.5 transition-transform', open && 'rotate-180')} />
          </button>
          {open ? (
            <ul id={menuId} className="mt-1.5 space-y-1" aria-label={t('planning.kanban.movesFor', { code: task.wbsCode })}>
              {moves.map((m) => (
                <li key={m.command.key}>
                  <button
                    type="button"
                    className={cx(btn.ghost, 'min-h-8 w-full justify-start px-2 py-1 text-start text-xs')}
                    data-testid="kanban-move-to"
                    data-target={m.to}
                    data-command={m.command.key}
                    onClick={() => {
                      setOpen(false);
                      onMove(task, m);
                    }}
                  >
                    {t('planning.kanban.moveTo', { column: tStatus('taskStatuses', m.to), action: m.command.label })}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/**
 * Kanban view of the plan's tasks (REQ-PLN-002): one column per task status, over the same persisted tasks as the WBS
 * table and the timeline. A move is the task's own status command (activate, start, block, submit for acceptance, …)
 * confirmed with its consequences and sent with `expectedVersion` — never a generic edit — so the WBS, the timeline and
 * the task's history show it. Every move is available from the keyboard ("Move" on each card); dragging a card onto a
 * column is a pointer shortcut to the same confirmation. Columns follow the reading direction (right-to-left in Arabic).
 */
export function KanbanTab() {
  const { t, tStatus, locale, formatNumber } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useRefreshPlanning(projectId);
  const ws = useWorkstreams(projectId);
  const [q, setQ] = useState('');
  const [workstreamId, setWorkstreamId] = useState('');
  const [overdue, setOverdue] = useState(false);
  const [mine, setMine] = useState(false);
  const [shown, setShown] = useState<Partial<Record<TaskStatus, number>>>({});
  const [pending, setPending] = useState<{ task: Task; move: Move } | null>(null);
  const [dragging, setDragging] = useState<Task | null>(null);
  const [dropTarget, setDropTarget] = useState<TaskStatus | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const moved = useRef<string | null>(null);
  const focused = useCallback(() => setFocusId(null), []);
  const query = { q: q || undefined, workstreamId: workstreamId || undefined, overdue: overdue ? ('true' as const) : undefined, ownerUserId: mine ? 'me' : undefined, sort: 'wbs' as const };
  const tasks = useAllTasks(projectId, query);
  const dragMoves = useMoves(dragging ?? undefined);
  const filtered = Boolean(q || workstreamId || overdue || mine);

  const columns = useMemo(() => {
    const by = new Map<TaskStatus, Task[]>(TASK_STATUSES.map((s) => [s, []]));
    for (const x of tasks.data?.items ?? []) by.get(x.status as TaskStatus)?.push(x);
    return TASK_STATUSES.map((status) => ({ status, items: by.get(status) ?? [] }));
  }, [tasks.data]);
  const wsCode = useMemo(() => new Map((ws.data?.items ?? []).map((w) => [w.id, w.code])), [ws.data]);

  const startMove = (task: Task, move: Move) => {
    setPending({ task, move });
  };
  const dropMove = (status: TaskStatus) => dragMoves.find((m) => m.to === status) ?? null;
  const onDrop = (status: TaskStatus) => (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    const m = dropMove(status);
    if (dragging && m) startMove(dragging, m);
    setDragging(null);
    setDropTarget(null);
  };

  return (
    <div className="space-y-4" data-testid="kanban-tab">
      <div className="flex flex-wrap items-end gap-3">
        <SearchInput className="w-full sm:w-64" label={t('planning.wbs.search')} value={q} onChange={setQ} />
        <FilterSelect label={t('planning.common.workstream')} value={workstreamId} onChange={setWorkstreamId} className="w-full sm:w-56" testId="kanban-filter-ws">
          <option value="">{t('planning.common.allWorkstreams')}</option>
          {ws.data?.items.map((w) => (
            <option key={w.id} value={w.id}>
              {w.code} — {workstreamName(w, locale)}
            </option>
          ))}
        </FilterSelect>
        <FilterToggle label={t('planning.common.onlyOverdue')} checked={overdue} onChange={setOverdue} />
        <FilterToggle label={t('planning.common.onlyMine')} checked={mine} onChange={setMine} />
      </div>
      <p className="text-xs text-muted">{t('planning.kanban.hint')}</p>

      {tasks.isLoading ? (
        <LoadingState />
      ) : tasks.error ? (
        <ErrorState error={tasks.error} onRetry={() => tasks.refetch()} />
      ) : (tasks.data?.items.length ?? 0) === 0 ? (
        <div className={card}>
          <EmptyState title={filtered ? t('planning.wbs.emptyFiltered') : t('planning.wbs.empty')} />
        </div>
      ) : (
        <ScrollRegion label={t('planning.kanban.title')} className="overflow-x-auto pb-2">
          <div className="flex items-start gap-3" data-testid="kanban-board">
            {columns.map(({ status, items }) => {
              const limit = shown[status] ?? COLUMN_PAGE;
              const visible = items.slice(0, limit);
              const more = items.length - visible.length;
              const headingId = `kanban-col-${status}`;
              const canDrop = dragging !== null && dropMove(status) !== null;
              return (
                <section
                  key={status}
                  aria-labelledby={headingId}
                  className={cx('flex w-64 shrink-0 flex-col rounded-lg border bg-surface-muted/60', canDrop && dropTarget === status ? 'border-primary ring-2 ring-primary' : canDrop ? 'border-primary/60' : 'border-line')}
                  data-testid="kanban-column"
                  data-status={status}
                  data-count={items.length}
                  onDragOver={(e) => {
                    if (!canDrop) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (dropTarget !== status) setDropTarget(status);
                  }}
                  onDragLeave={() => setDropTarget((d) => (d === status ? null : d))}
                  onDrop={onDrop(status)}
                >
                  <h3 id={headingId} className="flex items-center justify-between gap-2 border-b border-line px-2.5 py-2 text-sm font-semibold">
                    <StatusBadge enumName="taskStatuses" value={status} />
                    <span className="tabular text-muted" aria-hidden="true">
                      {formatNumber(items.length)}
                    </span>
                    <span className="sr-only">{t('planning.kanban.columnCount', { count: formatNumber(items.length) })}</span>
                  </h3>
                  {items.length === 0 ? (
                    <p className="px-2.5 py-3 text-xs text-muted" data-testid="kanban-column-empty">
                      {t('planning.kanban.columnEmpty')}
                    </p>
                  ) : (
                    <ol className="space-y-2 p-2" aria-labelledby={headingId}>
                      {visible.map((x) => (
                        <KanbanCard
                          key={x.id}
                          task={x}
                          wsLabel={x.workstreamId ? (wsCode.get(x.workstreamId) ?? x.workstreamCode) : null}
                          focusMe={focusId === x.id}
                          onFocused={focused}
                          onMove={startMove}
                          onDragStart={setDragging}
                          onDragEnd={() => {
                            setDragging(null);
                            setDropTarget(null);
                          }}
                        />
                      ))}
                    </ol>
                  )}
                  {more > 0 ? (
                    <button type="button" className={cx(btn.ghost, 'm-2 mt-0 min-h-8 text-xs')} onClick={() => setShown((s) => ({ ...s, [status]: limit + COLUMN_PAGE }))} data-testid="kanban-show-more">
                      {t('planning.kanban.showMore', { count: formatNumber(Math.min(more, COLUMN_PAGE)), total: formatNumber(more) })}
                    </button>
                  ) : null}
                </section>
              );
            })}
          </div>
        </ScrollRegion>
      )}
      {tasks.data ? (
        <p className="text-xs text-muted" data-testid="kanban-total" data-total={tasks.data.total}>
          {tasks.data.items.length < tasks.data.total
            ? t('planning.kanban.partial', { shown: formatNumber(tasks.data.items.length), total: formatNumber(tasks.data.total) })
            : t('planning.wbs.total', { count: tasks.data.total })}
        </p>
      ) : null}
      {pending ? (
        <CommandConfirmDialog
          command={pending.move.command}
          expectedVersion={pending.task.version}
          context={[t('planning.kanban.moveContext', { code: pending.task.wbsCode, from: tStatus('taskStatuses', pending.task.status), to: tStatus('taskStatuses', pending.move.to) })]}
          onClose={() => {
            // Focus moves to the card only once the modal dialog is gone (the page behind a modal is inert).
            if (moved.current) setFocusId(moved.current);
            moved.current = null;
            setPending(null);
          }}
          onDone={async () => {
            moved.current = pending.task.id;
            await refresh();
          }}
          onReload={() => void tasks.refetch()}
        />
      ) : null}
    </div>
  );
}

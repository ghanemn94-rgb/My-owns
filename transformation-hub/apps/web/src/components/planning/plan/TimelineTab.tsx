'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { localToday, nodeHref, useSchedule, type Schedule } from '@/lib/planning';
import { useProjectContext } from '@/lib/project-context';
import { useWorkstreams } from '@/lib/queries';
import { workstreamName, workstreamNameLang } from '@/lib/workstreams';
import { ErrorState } from '../../ErrorState';
import { LoadingState } from '../../LoadingState';
import { StatusBadge } from '../../StatusBadge';
import { card, cx } from '../../ui';
import { FilterSelect, FilterToggle, ForecastLabel } from '../bits';
import { Gantt, type GanttRow } from '../Gantt';
import { langAttrs, localized, localizedLang, useLocalized } from '@/lib/i18n-data';

const ISSUES = ['missing_duration', 'unsupported_dependency_type', 'cycle', 'unknown_node', 'negative_duration', 'invalid_date', 'missing_project_start'] as const;
type IssueCode = (typeof ISSUES)[number];

/** Schedule status block: complete / incomplete / invalid, gaps, assumptions and the critical path (REQ-PLN-008/009). */
export function ScheduleStatus({ s }: { s: Schedule }) {
  const { t, formatDate } = useI18n();
  const loc = useLocalized();
  const { projectId } = useProjectContext();
  const tone = s.status === 'complete' ? 'success' : s.status === 'invalid' ? 'danger' : 'warning';
  return (
    <div className={cx(card, 'space-y-3 p-4')} data-testid="schedule-status" data-status={s.status}>
      <div className="flex flex-wrap items-center gap-2">
        <ForecastLabel />
        <StatusBadge enumName="ragStatuses" value={s.status} tone={tone} label={t(`planning.schedule.status_${s.status}`)} size="md" />
        {s.status === 'complete' ? (
          <span className="text-sm">
            {t('planning.schedule.finish')}: <strong className="tabular">{formatDate(s.projectFinish)}</strong>
          </span>
        ) : null}
        <span className="text-xs text-muted">{t('planning.schedule.scope', { count: s.scope.nodeCount, edges: s.scope.edgeCount })}</span>
      </div>
      {s.status !== 'complete' ? (
        <div>
          <p className="text-sm font-medium text-warning">{t('planning.schedule.incompleteHint', { count: s.issues.length })}</p>
          <ul className="mt-1 max-h-40 list-disc space-y-0.5 overflow-y-auto ps-5 text-sm" data-testid="schedule-issues">
            {s.issues.slice(0, 50).map((i, k) => {
              const n = s.nodes.find((x) => x.id === i.nodeIds[0]);
              return (
                <li key={k}>
                  {n ? (
                    <>
                      <Link href={nodeHref(projectId, n.type, n.id)} className="font-medium text-primary hover:underline" dir="ltr">
                        {n.code}
                      </Link>{' '}
                    </>
                  ) : null}
                  {(ISSUES as readonly string[]).includes(i.code) ? t(`planning.schedule.issue_${i.code as IssueCode}`) : <span dir="ltr">{i.message}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      ) : s.criticalPath && s.criticalPath.length ? (
        <div>
          <p className="text-sm font-medium">{t('planning.schedule.criticalPath')}</p>
          <ol className="mt-1 flex flex-wrap items-center gap-1 text-sm" data-testid="critical-path">
            {s.criticalPath.map((n, i) => (
              <li key={n.id} className="inline-flex items-center gap-1">
                {i > 0 ? (
                  <span aria-hidden="true" className="text-muted rtl:rotate-180">
                    →
                  </span>
                ) : null}
                <Link href={nodeHref(projectId, n.type, n.id)} className="rounded bg-danger-soft px-1.5 py-0.5 font-medium text-danger hover:underline" dir="ltr" title={loc(n.title, n.titleAr)}>
                  {n.code}
                </Link>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      <details>
        <summary className="cursor-pointer text-sm text-primary">{t('planning.schedule.assumptions', { count: s.assumptions.length })}</summary>
        <ul className="mt-2 list-disc space-y-0.5 ps-5 text-xs text-muted" lang="en" dir="ltr">
          {s.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

export function TimelineTab() {
  const { t, locale } = useI18n();
  const { projectId, project } = useProjectContext();
  const [target, setTarget] = useState('');
  const [wsFilter, setWsFilter] = useState('');
  const [datedOnly, setDatedOnly] = useState(true);
  const whole = useSchedule(projectId);
  const scoped = useSchedule(projectId, target || undefined, !!target);
  const s = target ? scoped : whole;
  const ws = useWorkstreams(projectId);

  const rows: GanttRow[] = useMemo(() => {
    const data = s.data;
    if (!data) return [];
    const complete = data.status === 'complete';
    return data.nodes
      .filter((n) => !wsFilter || n.workstreamCode === wsFilter)
      .map((n) => ({
        id: n.id,
        type: n.type,
        code: n.code,
        title: localized(locale, n.title, n.titleAr),
        titleLang: langAttrs(locale, localized(locale, n.title, n.titleAr), !(locale === 'ar' && n.titleAr)),
        // Complete schedule → early dates (schedule-based forecast); otherwise the planned dates only.
        start: complete ? n.earlyStart : n.type === 'milestone' ? n.plannedFinish : n.plannedStart,
        finish: complete ? n.earlyFinish : n.plannedFinish,
        baselineFinish: n.baselineFinish,
        critical: complete ? n.critical : null,
        proposed: n.proposed,
        href: nodeHref(projectId, n.type, n.id),
      }))
      .filter((r) => !datedOnly || !!r.finish)
      .sort((a, b) => (a.start ?? a.finish ?? '9999').localeCompare(b.start ?? b.finish ?? '9999') || a.code.localeCompare(b.code));
  }, [s.data, wsFilter, datedOnly, projectId, locale]);

  const targets = (whole.data?.nodes ?? []).filter((n) => n.type === 'milestone' || n.status !== 'draft');

  return (
    <div className="space-y-4" data-testid="timeline-tab">
      <div className="flex flex-wrap items-end gap-3">
        <FilterSelect label={t('planning.schedule.target')} value={target} onChange={setTarget} className="w-full sm:w-80" testId="timeline-target">
          <option value="">{t('planning.schedule.wholeProject')}</option>
          {targets.map((n) => (
            <option key={n.id} value={n.id} lang={localizedLang(locale, n.title, n.titleAr)}>
              {n.code} — {localized(locale, n.title, n.titleAr)}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label={t('planning.common.workstream')} value={wsFilter} onChange={setWsFilter} className="w-full sm:w-56">
          <option value="">{t('planning.common.allWorkstreams')}</option>
          {ws.data?.items.map((w) => (
            <option key={w.id} value={w.code} lang={workstreamNameLang(w, locale).lang}>
              {w.code} — {workstreamName(w, locale)}
            </option>
          ))}
        </FilterSelect>
        <FilterToggle label={t('planning.schedule.datedOnly')} checked={datedOnly} onChange={setDatedOnly} />
      </div>
      <p className="text-xs text-muted">{t('planning.schedule.targetHint')}</p>
      {s.isLoading ? (
        <LoadingState />
      ) : s.error ? (
        <ErrorState error={s.error} onRetry={() => s.refetch()} />
      ) : s.data ? (
        <>
          <ScheduleStatus s={s.data} />
          {s.data.status !== 'complete' ? <p className="text-sm text-muted">{t('planning.schedule.plannedOnly')}</p> : null}
          {rows.length ? (
            <Gantt rows={rows} today={localToday(project.timezone)} caption={t('planning.gantt.caption')} testId="gantt" />
          ) : (
            <p className={cx(card, 'p-4 text-sm text-muted')}>{t('planning.gantt.empty')}</p>
          )}
        </>
      ) : null}
    </div>
  );
}

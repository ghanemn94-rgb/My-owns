'use client';

import Link from 'next/link';
import { Timer } from 'lucide-react';
import { useI18n } from '@/i18n/provider';
import { useProgress, useSchedule, workstreamHref } from '@/lib/planning';
import { useProjectContext } from '@/lib/project-context';
import { LoadingState } from '../LoadingState';
import { btn, card, cx } from '../ui';
import { DateText, ForecastLabel } from './bits';
import { useLocalized } from '@/lib/i18n-data';

/**
 * Cockpit tile (Screen 2): schedule-based forecast signals — whole-plan schedule status and the workstreams whose
 * forecast finish is later than the approved baseline (calendar working days). No probabilities are shown.
 */
export function DelayImpactTile() {
  const { t, formatNumber, formatDate } = useI18n();
  const loc = useLocalized();
  const { projectId } = useProjectContext();
  const prog = useProgress(projectId);
  const sched = useSchedule(projectId);
  const slips = (prog.data?.workstreams ?? [])
    .filter((w) => (w.rag.calculated.slipDays ?? 0) > 0)
    .sort((a, b) => (b.rag.calculated.slipDays ?? 0) - (a.rag.calculated.slipDays ?? 0))
    .slice(0, 3);
  return (
    <section aria-labelledby="delay-tile" className={cx(card, 'flex flex-col gap-3 p-4')} data-testid="delay-impact-tile">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="delay-tile" className="flex items-center gap-2 font-semibold">
          <Timer aria-hidden="true" className="size-5 text-primary" />
          {t('project.cockpit.delayImpact')}
        </h3>
        <ForecastLabel />
      </div>
      {prog.isLoading || sched.isLoading ? (
        <LoadingState compact />
      ) : (
        <>
          {sched.data ? (
            <p className="text-sm" data-testid="delay-tile-schedule">
              {sched.data.status === 'complete'
                ? t('planning.tile.scheduleComplete', { date: formatDate(sched.data.projectFinish) })
                : t('planning.tile.scheduleIncomplete', { count: formatNumber(sched.data.issues.length) })}
            </p>
          ) : null}
          {prog.data ? (
            slips.length === 0 ? (
              <p className="text-sm text-muted">{prog.data.baseline ? t('planning.tile.noSlip', { version: prog.data.baseline.versionNo }) : t('planning.health.noBaseline')}</p>
            ) : (
              <ul className="space-y-2 text-sm" data-testid="delay-tile-slips">
                {slips.map((w) => (
                  <li key={w.id} className="flex items-start justify-between gap-2">
                    <Link href={workstreamHref(projectId, w.id, 'progress')} className="min-w-0 hover:text-primary hover:underline">
                      <span dir="ltr" className="font-medium">
                        {w.code}
                      </span>{' '}
                      <span dir="auto">{loc(w.name, w.nameAr)}</span>
                    </Link>
                    <span className="shrink-0 text-end text-xs">
                      <span className="font-semibold text-danger">{t('planning.tile.slip', { days: formatNumber(w.rag.calculated.slipDays ?? 0) })}</span>
                      <br />
                      <DateText value={w.baselineFinish} /> → <DateText value={w.forecastFinish} />
                    </span>
                  </li>
                ))}
              </ul>
            )
          ) : null}
          <div className="mt-auto flex flex-wrap gap-3 text-sm">
            <Link className={btn.link} href={`/projects/${projectId}/plan?tab=whatif`}>
              {t('planning.tile.whatIf')}
            </Link>
            <Link className={btn.link} href={`/projects/${projectId}/plan?tab=timeline`}>
              {t('planning.tile.timeline')}
            </Link>
          </div>
          <p className="text-xs text-muted">{t('planning.common.noProbability')}</p>
        </>
      )}
    </section>
  );
}

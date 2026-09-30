'use client';

import { ActivityHistory } from '@/components/ActivityHistory';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { MetricCard } from '@/components/MetricCard';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge, type Tone } from '@/components/StatusBadge';
import { useI18n, type StatusEnum } from '@/i18n/provider';
import { useProjectContext } from '@/lib/project-context';
import { rdHref, useReadinessSummary } from '@/lib/readiness';
import { Callout, Panel } from './_components/rd';
import Link from 'next/link';
import { btn } from '@/components/ui';

function StatusCounts({ enumName, counts, href, testId }: { enumName: StatusEnum; counts: Record<string, number>; href: (status: string) => string; testId: string }) {
  const { t, formatNumber } = useI18n();
  const entries = Object.entries(counts).filter(([, n]) => n > 0);
  if (entries.length === 0) return <p className="text-sm text-muted">{t('readiness.overview.none')}</p>;
  return (
    <ul className="flex flex-wrap gap-2" data-testid={testId}>
      {entries.map(([status, n]) => (
        <li key={status}>
          <Link href={href(status)} className="inline-flex items-center gap-1 rounded-md hover:underline">
            <StatusBadge enumName={enumName} value={status} />
            <span className="tabular text-sm font-medium text-ink">{formatNumber(n)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Day-1 & TSA Center overview: every number links to the records that make it up (counts are scoped by the server). */
export default function ReadinessOverviewPage() {
  const { t, tStatus, formatList } = useI18n();
  const { projectId } = useProjectContext();
  const summary = useReadinessSummary();
  const base = rdHref(projectId);
  const s = summary.data;
  const tone: Tone = s && s.checks.failedBlockers > 0 ? 'danger' : 'info';
  return (
    <>
      <PageHeader title={t('readiness.overview.title')} description={t('readiness.overview.subtitle')} />
      <Callout testId="no-device-control">{t('readiness.common.noControl')}</Callout>
      {summary.isLoading ? <LoadingState /> : null}
      {summary.error ? <ErrorState error={summary.error} onRetry={() => summary.refetch()} /> : null}
      {s ? (
        <div className="mt-4 space-y-6" data-testid="readiness-summary" data-tone={tone}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label={t('readiness.overview.checksTotal')} value={s.checks.total} href={`${base}/checks`} />
            <MetricCard label={t('readiness.overview.openBlockers')} value={s.checks.openBlockers} href={`${base}/checks?blocker=true`} />
            <MetricCard label={t('readiness.overview.failedBlockers')} value={s.checks.failedBlockers} href={`${base}/checks?blocker=true&status=failed`} />
            <MetricCard label={t('readiness.overview.plansTotal')} value={s.cutover.total} href={`${base}/cutover`} />
            <MetricCard label={t('readiness.overview.tsasTotal')} value={s.tsas.total} href={`${base}/tsa`} />
            <MetricCard label={t('readiness.overview.expiringSoon')} value={s.tsas.expiringSoon} href={`${base}/tsa`} />
            <MetricCard label={t('readiness.overview.expiredUnresolved')} value={s.tsas.expiredUnresolved} href={`${base}/tsa?status=expired_unresolved`} />
            <MetricCard label={t('readiness.overview.enduring')} value={s.tsas.enduringArrangements} href={`${base}/tsa?enduring=true`} />
          </div>
          <Panel title={t('readiness.overview.coverageTitle')} testId="coverage">
            {s.checks.uncoveredAreas.length === 0 ? (
              <p className="text-sm text-ink">{t('readiness.overview.coverageAll')}</p>
            ) : (
              <p className="text-sm text-danger">{t('readiness.overview.coverageMissing', { areas: formatList(s.checks.uncoveredAreas.map((a) => tStatus('readinessAreas', a))) })}</p>
            )}
          </Panel>
          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title={t('readiness.overview.checksByStatus')}>
              <StatusCounts enumName="readinessStatuses" counts={s.checks.byStatus} href={(st) => `${base}/checks?status=${st}`} testId="checks-by-status" />
            </Panel>
            <Panel title={t('readiness.overview.plansByStatus')}>
              <StatusCounts enumName="cutoverStatuses" counts={s.cutover.byStatus} href={(st) => `${base}/cutover?status=${st}`} testId="plans-by-status" />
            </Panel>
            <Panel title={t('readiness.overview.tsasByStatus')}>
              <StatusCounts enumName="tsaStatuses" counts={s.tsas.byStatus} href={(st) => `${base}/tsa?status=${st}`} testId="tsas-by-status" />
            </Panel>
          </div>
          <p>
            <Link className={btn.link} href={`/projects/${projectId}/dimensions/operational_readiness`} data-testid="ops-dimension-link">
              {t('project.cockpit.dimensionsTitle')}
            </Link>
          </p>
          <ActivityHistory projectId={projectId} />
        </div>
      ) : null}
    </>
  );
}

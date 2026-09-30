'use client';

import Link from 'next/link';
import { PARTNER_STAGES } from '@hub/domain';
import { ActivityHistory } from '@/components/ActivityHistory';
import { DemoBadge } from '@/components/DemoBadge';
import { MetricCard } from '@/components/MetricCard';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { btn } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import { jvHref, useConditions, useDdRequests, useEvents, useFindings, useObligations, usePartners, useRooms } from '@/lib/jv';
import { useProjectContext } from '@/lib/project-context';
import { Callout, NdaNoAccessNotice, Panel, RecordOnlyNotice } from './_components/jv';

const ONE = { page: 1, pageSize: 1 } as const;

/**
 * JV & Diligence overview: every number opens the records that make it up (totals are computed by the server in the
 * caller's scope; a number the caller may not see is shown as "—", never 0).
 */
export default function JvOverviewPage() {
  const { t, tStatus, formatNumber, formatDate } = useI18n();
  const { projectId } = useProjectContext();
  const base = jvHref(projectId);
  const partners = usePartners({ page: 1, pageSize: 100 });
  const shortlisted = usePartners({ ...ONE, shortlisted: 'true' });
  const rooms = useRooms(ONE);
  const dd = useDdRequests(ONE);
  const openFindings = useFindings({ ...ONE, status: 'open' });
  const openCps = useConditions({ ...ONE, blocking: 'true', status: 'open' });
  const closings = useEvents('closing', { page: 1, pageSize: 20 });
  const signings = useEvents('signing', { page: 1, pageSize: 20 });
  const overdue = useObligations({ ...ONE, status: 'overdue' });
  const total = (q: { data?: { total: number } }) => q.data?.total ?? null;
  const byStage = new Map<string, number>();
  for (const p of partners.data?.items ?? []) byStage.set(p.stage, (byStage.get(p.stage) ?? 0) + 1);

  return (
    <>
      <PageHeader title={t('jv.overview.title')} description={t('jv.overview.subtitle')} />
      <div className="space-y-6" data-testid="jv-overview">
        <div className="grid gap-3 md:grid-cols-2">
          <Callout testId="parallel-preparation">{t('jv.overview.parallel')}</Callout>
          <NdaNoAccessNotice />
          <RecordOnlyNotice />
          <Callout tone="warning" testId="no-assumptions">
            {t('jv.overview.noAssumptions')}
          </Callout>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="jv-metrics">
          <MetricCard label={t('jv.overview.metrics.partners')} value={total(partners)} href={`${base}/partners`} />
          <MetricCard label={t('jv.overview.metrics.shortlisted')} value={total(shortlisted)} href={`${base}/partners?shortlisted=true`} />
          <MetricCard label={t('jv.overview.metrics.rooms')} value={total(rooms)} href={`${base}/rooms`} />
          <MetricCard label={t('jv.overview.metrics.ddRequests')} value={total(dd)} href={`${base}/diligence`} />
          <MetricCard label={t('jv.overview.metrics.openFindings')} value={total(openFindings)} href={`${base}/diligence?tab=findings&status=open`} />
          <MetricCard label={t('jv.overview.metrics.openBlockingCps')} value={total(openCps)} href={`${base}/closing?tab=conditions&blocking=true&status=open`} />
          <MetricCard label={t('jv.overview.metrics.closings')} value={total(closings)} href={`${base}/closing?tab=closings`} />
          <MetricCard label={t('jv.overview.metrics.overdueObligations')} value={total(overdue)} href={`${base}/obligations?status=overdue`} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title={t('jv.overview.stagesTitle')} description={t('jv.overview.stagesHint')} testId="stage-summary">
            {partners.data && partners.data.items.length === 0 ? (
              <p className="text-sm text-muted">{t('jv.partners.empty')}</p>
            ) : (
              <ol className="grid gap-1.5 sm:grid-cols-2">
                {PARTNER_STAGES.map((s) => (
                  <li key={s} className="text-sm">
                    {/* The whole row is the link: "<stage> <count>" opens the partners at that stage. */}
                    <Link href={`${base}/partners?stage=${s}`} className="flex items-center justify-between gap-2 rounded hover:underline" data-stage={s}>
                      <StatusBadge enumName="partnerStages" value={s} tone="neutral" />
                      <span className="tabular font-medium text-ink">{partners.data ? formatNumber(byStage.get(s) ?? 0) : '—'}</span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
          <Panel title={t('jv.overview.eventsTitle')} description={t('jv.overview.eventsHint')} testId="event-summary">
            {(signings.data?.items.length ?? 0) + (closings.data?.items.length ?? 0) === 0 ? (
              <p className="text-sm text-muted">{t('jv.closing.empty')}</p>
            ) : (
              <ul className="space-y-2">
                {[...(signings.data?.items ?? []), ...(closings.data?.items ?? [])].map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-xs font-semibold text-muted">{tStatus('closingKinds', e.kind)}</span>
                    <Link className={btn.link} href={`${base}/closing/${e.kind === 'signing' ? 'signings' : 'closings'}/${e.id}`}>
                      <span dir="ltr">{e.code}</span> — <span dir="auto">{e.name}</span>
                    </Link>
                    <StatusBadge enumName="closingStatuses" value={e.status} />
                    {e.targetDate ? <span className="text-xs text-muted">{t('jv.closing.targetOn', { date: formatDate(e.targetDate) })}</span> : null}
                    {e.isDemo ? <DemoBadge /> : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
        <p>
          <Link className={btn.link} href={`/projects/${projectId}/dimensions/jv_transaction`} data-testid="jv-dimension-link">
            {t('jv.overview.dimensionLink')}
          </Link>
        </p>
        <ActivityHistory projectId={projectId} />
      </div>
    </>
  );
}

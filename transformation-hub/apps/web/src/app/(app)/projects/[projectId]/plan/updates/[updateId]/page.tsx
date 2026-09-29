'use client';

import { useQuery } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { planningRoutes as P } from '@hub/contracts';
import { ActivityHistory } from '@/components/ActivityHistory';
import { DemoBadge } from '@/components/DemoBadge';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { SectionGuard } from '@/components/SectionGuard';
import { StatusBadge } from '@/components/StatusBadge';
import { btn } from '@/components/ui';
import { CommandBar } from '@/components/planning/CommandBar';
import { useStatusUpdateCommands } from '@/components/planning/commands';
import { BackLink, Notice } from '@/components/planning/DetailShell';
import { Fact, RagBadge, Section } from '@/components/planning/bits';
import { StatusUpdateFormDialog } from '@/components/planning/updates';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { pk, useRefreshPlanning, workstreamHref } from '@/lib/planning';
import { useProjectContext } from '@/lib/project-context';

type Frozen = {
  computedAt?: string;
  scope?: string;
  progress?: { percent: number | null; numeratorWeight: number; denominatorWeight: number };
  rag?: { calculated?: { status: string; explanation: string }; effective?: string };
  baselineFinish?: string | null;
  forecastFinish?: string | null;
  openBlockers?: unknown[];
};

export default function StatusUpdatePage() {
  const { t, formatDateTime, formatNumber, formatDate } = useI18n();
  const { updateId } = useParams<{ updateId: string }>();
  const { projectId, can } = useProjectContext();
  const refresh = useRefreshPlanning(projectId);
  const q = useQuery({ queryKey: pk.update(projectId, updateId), queryFn: ({ signal }) => api(P.getStatusUpdate, { params: { projectId, statusUpdateId: updateId }, signal }) });
  const commands = useStatusUpdateCommands(q.data);
  const [edit, setEdit] = useState(false);
  if (q.isLoading) return <LoadingState />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const u = q.data;
  const frozen = (u.frozenSnapshot ?? null) as Frozen | null;
  const back = u.workstreamId ? workstreamHref(projectId, u.workstreamId, 'updates') : `/projects/${projectId}/plan?tab=health`;
  return (
    <SectionGuard section="plan">
      <BackLink href={back} label={t('planning.update.back')} />
      <PageHeader
        eyebrow={<span dir="ltr">{u.workstreamCode ?? t('planning.update.projectLevel')}</span>}
        title={t('planning.update.titlePeriod', { date: formatDate(u.periodEnd) })}
        badges={
          <>
            <StatusBadge enumName="updateStatuses" value={u.status} size="md" />
            {u.isDemo ? <DemoBadge /> : null}
          </>
        }
        actions={
          can('planning.status_update.submit') && ['draft', 'returned'].includes(u.status) ? (
            <button type="button" className={btn.secondary} onClick={() => setEdit(true)}>
              <Pencil aria-hidden="true" className="size-4" />
              {t('planning.common.edit')}
            </button>
          ) : null
        }
      />
      {u.status === 'accepted' ? <Notice tone="info">{t('planning.update.frozenNotice')}</Notice> : null}
      {u.status === 'returned' && u.reviewNote ? (
        <Notice tone="warning">
          {t('planning.update.returnedNotice')} <span dir="auto">{u.reviewNote}</span>
        </Notice>
      ) : null}
      <CommandBar className="mb-6" commands={commands} allowed={u.allowedCommands} expectedVersion={u.version} onDone={refresh} onReload={() => void q.refetch()} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Section id="u-content" title={t('planning.update.content')}>
          <dl className="grid gap-3">
            <Fact label={t('planning.update.summary')} wide>
              <span dir="auto" className="whitespace-pre-line">{u.summary}</span>
            </Fact>
            <Fact label={t('planning.update.achievements')} wide>
              <span dir="auto" className="whitespace-pre-line">{u.achievements ?? EM_DASH}</span>
            </Fact>
            <Fact label={t('planning.update.nextSteps')} wide>
              <span dir="auto" className="whitespace-pre-line">{u.nextSteps ?? EM_DASH}</span>
            </Fact>
            <Fact label={t('planning.update.blockers')} wide>
              <span dir="auto" className="whitespace-pre-line">{u.blockers ?? EM_DASH}</span>
            </Fact>
          </dl>
        </Section>
        <Section id="u-rag" title={t('planning.update.ragSection')} hint={t('planning.update.ragCompare')}>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Fact label={t('planning.health.reported')}>{u.ragReported ? <RagBadge value={u.ragReported} /> : EM_DASH}</Fact>
            <Fact label={t('planning.health.calculated')}>{u.ragCalculated ? <RagBadge value={u.ragCalculated} /> : EM_DASH}</Fact>
            <Fact label={t('planning.update.submittedBy')}>{u.submittedByName ? <span dir="auto">{u.submittedByName} · {formatDateTime(u.submittedAt)}</span> : EM_DASH}</Fact>
            <Fact label={t('planning.update.reviewedBy')}>{u.reviewedByName ? <span dir="auto">{u.reviewedByName} · {formatDateTime(u.reviewedAt)}</span> : EM_DASH}</Fact>
          </dl>
          {frozen ? (
            <div className="mt-4 rounded-md border border-line bg-surface-muted p-3" data-testid="frozen-snapshot">
              <h3 className="text-sm font-semibold">{t('planning.update.frozenTitle', { date: formatDateTime(frozen.computedAt ?? null) })}</h3>
              <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                <Fact label={t('planning.health.progress')}>
                  {frozen.progress?.percent === null || frozen.progress?.percent === undefined ? EM_DASH : `${formatNumber(frozen.progress.percent)}%`}
                  {frozen.progress ? <span className="text-xs text-muted"> ({formatNumber(frozen.progress.numeratorWeight)}/{formatNumber(frozen.progress.denominatorWeight)})</span> : null}
                </Fact>
                <Fact label={t('planning.health.calculated')}>{frozen.rag?.calculated ? <RagBadge value={frozen.rag.calculated.status} /> : EM_DASH}</Fact>
                <Fact label={t('planning.health.baselineVsForecast')}>
                  {formatDate(frozen.baselineFinish ?? null)} → {formatDate(frozen.forecastFinish ?? null)}
                </Fact>
                <Fact label={t('planning.health.blockers')}>{formatNumber(frozen.openBlockers?.length ?? 0)}</Fact>
              </dl>
            </div>
          ) : null}
        </Section>
      </div>
      <ActivityHistory className="mt-6" projectId={projectId} entityType="status_update" entityId={u.id} />
      <StatusUpdateFormDialog open={edit} onClose={() => setEdit(false)} update={u} workstreamId={u.workstreamId ?? undefined} />
    </SectionGuard>
  );
}

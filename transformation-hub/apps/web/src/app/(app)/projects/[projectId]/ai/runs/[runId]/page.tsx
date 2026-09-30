'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ActivityHistory } from '@/components/ActivityHistory';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { btn } from '@/components/ui';
import { EM_DASH, useI18n, type MessageKey } from '@/i18n/provider';
import { aiHref, useAiRun } from '@/lib/ai';
import { useProjectContext } from '@/lib/project-context';
import { RunOutputView } from '../../_components/answer';
import { Callout, Code, Facts, Panel, RunError, SimulatedBadge, UText } from '../../_components/bits';
import { TabGuard } from '../../_components/nav';

/**
 * One of my AI runs: inputs, tools used, outputs, cost, status and refusal reasons. The record is append-only; its
 * citations are re-checked against my CURRENT access on every read (claims whose sources I can no longer see are dropped
 * by the server before this page receives them).
 */
export default function AiRunDetailPage() {
  return (
    <TabGuard tab="runs">
      <RunDetail />
    </TabGuard>
  );
}

function RunDetail() {
  const { t, formatDateTime, formatNumber } = useI18n();
  const { projectId } = useProjectContext();
  const { runId } = useParams<{ runId: string }>();
  const q = useAiRun(runId);
  if (q.isLoading) return <LoadingState />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const r = q.data;
  return (
    <>
      <PageHeader
        title={t('ai.run.title', { kind: t(`ai.runKinds.${r.kind}` as MessageKey) })}
        eyebrow={
          <Link className={btn.link} href={aiHref(projectId, '/runs')}>
            {t('ai.run.back')}
          </Link>
        }
        badges={
          <>
            <StatusBadge enumName="aiRunStatuses" value={r.status} size="md" />
            {r.simulated ? <SimulatedBadge /> : null}
          </>
        }
      />
      <div className="space-y-6" data-testid="run-detail" data-run-id={r.id}>
        <Callout testId="run-append-only">
          <p>{t('ai.run.appendOnly')}</p>
        </Callout>
        <Panel title={t('ai.run.recordTitle')}>
          <Facts
            items={[
              { label: t('ai.common.runId'), value: <Code testId="run-id">{r.id}</Code>, wide: true },
              { label: t('ai.runs.kind'), value: t(`ai.runKinds.${r.kind}` as MessageKey) },
              { label: t('ai.runs.trigger'), value: t(`ai.triggers.${r.trigger}` as MessageKey) },
              { label: t('ai.runs.status'), value: <StatusBadge enumName="aiRunStatuses" value={r.status} /> },
              {
                label: t('ai.runs.provider'),
                value: (
                  <span className="flex flex-wrap items-center gap-2">
                    <span>{t(`ai.providers.${r.provider}` as MessageKey)}</span>
                    {r.simulated ? <SimulatedBadge /> : null}
                    {r.model ? <Code>{r.model}</Code> : null}
                  </span>
                ),
              },
              { label: t('ai.run.question'), value: r.question ? <UText value={r.question} multiline /> : <span className="text-muted">{t('ai.runs.noQuestion')}</span>, wide: true, testId: 'run-question' },
              { label: t('ai.run.language'), value: r.locale === 'ar' ? t('ai.run.languages.ar') : t('ai.run.languages.en') },
              {
                label: t('ai.run.toolsUsed'),
                value: r.toolsUsed.length ? (
                  <span className="flex flex-wrap gap-1.5" data-testid="run-tools">
                    {r.toolsUsed.map((x) => (
                      <Code key={x}>{x}</Code>
                    ))}
                  </span>
                ) : (
                  <span className="text-muted">{t('ai.run.noTools')}</span>
                ),
                wide: true,
              },
              { label: t('ai.run.tokens'), value: t('ai.runs.tokensInOut', { in: formatNumber(r.inputTokens), out: formatNumber(r.outputTokens) }) },
              { label: t('ai.run.cost'), value: <span dir="ltr">{r.costEstimate ?? EM_DASH}</span> },
              { label: t('ai.run.policyVersion'), value: r.policyVersion ? <Code>{r.policyVersion}</Code> : EM_DASH },
              { label: t('ai.run.started'), value: formatDateTime(r.startedAt) },
              { label: t('ai.run.finished'), value: formatDateTime(r.finishedAt) },
              { label: t('ai.run.error'), value: r.error ? <RunError code={r.error} /> : <span className="text-muted">{t('ai.run.noError')}</span>, wide: true, testId: 'run-error' },
            ]}
          />
          <p className="mt-3 text-xs text-muted">{t('ai.run.costNote')}</p>
        </Panel>
        <Panel title={t('ai.run.outputTitle')}>
          <RunOutputView run={r} />
        </Panel>
        <ActivityHistory projectId={projectId} entityType="ai_run" entityId={r.id} />
      </div>
    </>
  );
}

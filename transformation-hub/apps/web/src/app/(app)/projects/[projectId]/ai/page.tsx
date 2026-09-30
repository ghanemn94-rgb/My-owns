'use client';

import Link from 'next/link';
import { ActivityHistory } from '@/components/ActivityHistory';
import { DataTable, type Column } from '@/components/DataTable';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { MetricCard } from '@/components/MetricCard';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { btn, cx } from '@/components/ui';
import { INTL_LOCALE } from '@/i18n/config';
import { useI18n, type MessageKey } from '@/i18n/provider';
import { aiHref, useAiCosts, useAiProposals, useAiRuns, useAiSettings, useAiStatus, useAiTools, useDetections, type AiCosts, type AiStatus, type AiToolMatrix } from '@/lib/ai';
import { useProjectContext } from '@/lib/project-context';
import { AuthorityNotice, Callout, Code, Facts, KillSwitchBadge, ModeBadge, ModeReference, Panel, ProviderStatusBadge, RunError, SimulatedNotice, UText } from './_components/bits';

/**
 * AI PM Center — overview (spec §10 screen 14, §12.3–12.4): authority mode (Off by default), emergency stop, provider
 * and endpoint states exactly as the API reports them (the mock is "Simulated", unconfigured real endpoints "Not
 * configured" — never "Connected"), budget and cost usage, and the caller's latest runs. Every number opens its records.
 */
export default function AiOverviewPage() {
  const { t } = useI18n();
  const { projectId, can } = useProjectContext();
  const canStatus = can('ai.run.read');
  const status = useAiStatus();
  const settings = useAiSettings(!canStatus);
  const costs = useAiCosts();
  const pending = useAiProposals({ page: 1, pageSize: 1, status: 'proposed' });
  const myRuns = useAiRuns({ page: 1, pageSize: 5 });
  const detections = useDetections();
  const tools = useAiTools();
  const base = aiHref(projectId);
  const killActive = status.data?.killSwitch ?? settings.data?.killSwitch ?? false;
  const canStop = can(['ai.killswitch.activate', 'ai.killswitch.release']);

  return (
    <>
      <PageHeader title={t('ai.overview.title')} description={t('ai.overview.subtitle')} />
      <div className="space-y-6" data-testid="ai-overview">
        {killActive ? (
          <Callout tone="danger" icon="stop" testId="kill-switch-banner">
            <p className="font-semibold">{t('ai.killSwitch.bannerTitle')}</p>
            <p>{t('ai.killSwitch.bannerBody')}</p>
            {canStop ? (
              <p>
                <Link className={btn.link} href={`${base}/settings#emergency-stop`}>
                  {t('ai.killSwitch.manageLink')}
                </Link>
              </p>
            ) : null}
          </Callout>
        ) : null}
        <AuthorityNotice />

        {canStatus ? (
          <StatusPanel q={status} myRunIds={(myRuns.data?.items ?? []).map((r) => r.id)} />
        ) : can('ai.settings.manage') ? (
          <Panel title={t('ai.overview.statusTitle')} testId="ai-status">
            {settings.isLoading ? (
              <LoadingState compact />
            ) : settings.error || !settings.data ? (
              <ErrorState error={settings.error} onRetry={() => settings.refetch()} />
            ) : (
              <Facts
                items={[
                  { label: t('ai.overview.mode'), value: <ModeSummary mode={settings.data.mode} />, testId: 'fact-mode' },
                  { label: t('ai.overview.killSwitch'), value: <KillSwitchBadge active={settings.data.killSwitch} testId="kill-switch-state" />, testId: 'fact-kill-switch' },
                  {
                    label: t('ai.overview.provider'),
                    value: (
                      <span className="flex flex-wrap items-center gap-2">
                        <span>{t(`ai.providers.${settings.data.provider}` as MessageKey)}</span>
                        <ProviderStatusBadge status={settings.data.providerStatus} testId="provider-status" />
                      </span>
                    ),
                    wide: true,
                  },
                ]}
              />
            )}
            <p className="mt-3 text-sm text-muted">{t('ai.overview.statusNeedsRunRead')}</p>
          </Panel>
        ) : (
          <Callout testId="ai-status-unavailable">
            <p>{t('ai.overview.noStatusAccess')}</p>
          </Callout>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="ai-metrics">
          {can('ai.proposal.read') ? <MetricCard label={t('ai.overview.metrics.pending')} value={pending.data?.total ?? null} href={`${base}/proposals?status=proposed`} /> : null}
          {canStatus ? <MetricCard label={t('ai.overview.metrics.myRuns')} value={myRuns.data?.total ?? null} href={`${base}/runs`} /> : null}
          {can('planning.plan.read') ? <MetricCard label={t('ai.overview.metrics.detections')} value={detections.data?.items.length ?? null} href={`${base}/briefings#detections`} hint={t('ai.overview.metrics.detectionsHint')} /> : null}
        </div>

        {canStatus && status.data ? <BudgetPanel s={status.data} runsHref={`${base}/runs`} /> : null}
        {can('ai.operations.read') ? <CostsPanel q={costs} /> : null}

        {canStatus ? (
          <Panel
            title={t('ai.overview.lastRuns')}
            testId="last-runs"
            actions={
              <Link className={btn.secondary} href={`${base}/runs`}>
                {t('ai.overview.allRuns')}
              </Link>
            }
          >
            {myRuns.isLoading ? (
              <LoadingState compact />
            ) : myRuns.error ? (
              <ErrorState error={myRuns.error} onRetry={() => myRuns.refetch()} />
            ) : (myRuns.data?.items.length ?? 0) === 0 ? (
              <p className="text-sm text-muted">{t('ai.runs.empty')}</p>
            ) : (
              <ul className="space-y-2">
                {myRuns.data!.items.map((r) => (
                  <RunLine key={r.id} run={r} href={`${base}/runs/${r.id}`} />
                ))}
              </ul>
            )}
          </Panel>
        ) : null}

        {can('ai.assistant.use') ? <ToolMatrix q={tools} /> : null}

        <ModeReference />
        <ActivityHistory projectId={projectId} entityType="ai_project_settings" />
      </div>
    </>
  );
}

function ModeSummary({ mode }: { mode: string }) {
  const { t } = useI18n();
  return (
    <span className="flex flex-col gap-1">
      <ModeBadge mode={mode} testId="mode-badge" size="md" />
      <span className="text-xs text-muted">{t(`ai.modes.${mode}` as MessageKey)}</span>
    </span>
  );
}

function StatusPanel({ q, myRunIds }: { q: ReturnType<typeof useAiStatus>; myRunIds: string[] }) {
  const { t, tStatus, formatDateTime } = useI18n();
  const { projectId } = useProjectContext();
  if (q.isLoading) return <LoadingState compact />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data;
  const realEndpoints = s.endpoints.filter((e) => !e.simulated);
  const last = s.lastRun;
  return (
    <Panel title={t('ai.overview.statusTitle')} testId="ai-status">
      <div className="space-y-4">
        <Facts
          items={[
            { label: t('ai.overview.mode'), value: <ModeSummary mode={s.mode} />, testId: 'fact-mode' },
            { label: t('ai.overview.killSwitch'), value: <KillSwitchBadge active={s.killSwitch} testId="kill-switch-state" />, testId: 'fact-kill-switch' },
            {
              label: t('ai.overview.provider'),
              value: (
                <span className="flex flex-wrap items-center gap-2">
                  <span>{t(`ai.providers.${s.provider}` as MessageKey)}</span>
                  <ProviderStatusBadge status={s.providerStatus} testId="provider-status" />
                </span>
              ),
              testId: 'fact-provider',
            },
            {
              label: t('ai.overview.health'),
              value: (
                <span data-testid="health" data-health={s.health}>
                  <StatusBadge enumName="aiModes" value={s.health} tone={s.health === 'ok' ? 'success' : s.health === 'off' ? 'neutral' : s.health === 'degraded' ? 'warning' : 'danger'} label={t(`ai.health.${s.health}` as MessageKey)} />
                </span>
              ),
            },
            {
              label: t('ai.overview.lastRun'),
              value: last ? (
                <span className="flex flex-wrap items-center gap-2">
                  {myRunIds.includes(last.id) ? (
                    <Link className={btn.link} href={aiHref(projectId, `/runs/${last.id}`)}>
                      {t(`ai.runKinds.${last.kind}` as MessageKey)}
                    </Link>
                  ) : (
                    <span>{t(`ai.runKinds.${last.kind}` as MessageKey)}</span>
                  )}
                  <StatusBadge enumName="aiRunStatuses" value={last.status} />
                  <span className="text-xs text-muted">{formatDateTime(last.finishedAt)}</span>
                </span>
              ) : (
                <span className="text-muted">{t('ai.overview.noRunYet')}</span>
              ),
            },
            { label: t('ai.overview.nextRun'), value: s.nextRunAt ? formatDateTime(s.nextRunAt) : <span className="text-muted">{t('ai.overview.noSchedule')}</span> },
          ]}
        />
        {s.simulated ? <SimulatedNotice /> : null}
        <div>
          <h3 className="text-sm font-semibold text-ink">{t('ai.overview.endpointsTitle')}</h3>
          <p className="text-xs text-muted">{t('ai.overview.endpointsHint')}</p>
          <ul className="mt-2 space-y-1.5" data-testid="endpoints">
            {realEndpoints.map((e) => (
              <li key={e.provider} className="flex flex-wrap items-center gap-2 text-sm" data-testid={`endpoint-${e.provider}`}>
                <span>{t(`ai.providers.${e.provider}` as MessageKey)}</span>
                <ProviderStatusBadge status={e.status} />
              </li>
            ))}
          </ul>
        </div>
        {s.health !== 'ok' && s.health !== 'off' ? (
          <Callout tone="warning" icon="alert" testId="health-reason">
            <p>{t(`ai.health.${s.health}` as MessageKey)}</p>
            {s.circuitOpenUntil ? <p>{t('ai.overview.circuitUntil', { time: formatDateTime(s.circuitOpenUntil) })}</p> : null}
            {s.health === 'degraded' && last?.error ? (
              <p>
                <RunError code={last.error} />
              </p>
            ) : null}
          </Callout>
        ) : null}
        <Callout testId="manual-fallback">
          <p className="font-semibold">{t('ai.overview.fallbackTitle')}</p>
          <p>
            <UText value={s.manualFallback} />
          </p>
        </Callout>
        <p className="sr-only">{tStatus('aiModes', s.mode)}</p>
      </div>
    </Panel>
  );
}

/** "2026-09" → "September 2026" / "سبتمبر 2026" (a calendar month, not an instant: formatted in UTC). */
function formatMonth(locale: 'en' | 'ar', month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)));
}

function BudgetPanel({ s, runsHref }: { s: AiStatus; runsHref: string }) {
  const { t, formatNumber, locale } = useI18n();
  const b = s.budget;
  const pct = b.monthlyTokenBudget > 0 ? Math.min(100, Math.round((b.tokensUsed / b.monthlyTokenBudget) * 100)) : null;
  return (
    <Panel
      title={t('ai.overview.budgetTitle', { month: formatMonth(locale, b.month) })}
      testId="budget"
      description={t('ai.overview.budgetHint')}
      actions={
        <Link className={btn.secondary} href={runsHref}>
          {t('ai.overview.budgetRuns')}
        </Link>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-ink" data-testid="budget-tokens">
          {b.monthlyTokenBudget > 0
            ? t('ai.overview.tokensOf', { used: formatNumber(b.tokensUsed), budget: formatNumber(b.monthlyTokenBudget), pct: formatNumber(pct) })
            : t('ai.overview.tokensNoBudget', { used: formatNumber(b.tokensUsed) })}
        </p>
        {pct !== null ? (
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
            <div className={cx('h-full rounded-full', b.exhausted ? 'bg-danger' : pct >= 80 ? 'bg-warning' : 'bg-primary')} style={{ width: `${pct}%` }} />
          </div>
        ) : null}
        <p className="text-sm text-ink" data-testid="budget-cost">
          {t('ai.overview.costLine', {
            cost: [b.costUsed, b.currency].filter(Boolean).join(' '),
            budget: b.monthlyCostBudget ? `${b.monthlyCostBudget} ${b.currency ?? ''}`.trim() : t('ai.overview.noCostBudget'),
          })}
        </p>
        {b.exhausted ? (
          <Callout tone="danger" icon="alert" testId="budget-exhausted">
            <p>{t('ai.overview.budgetExhausted')}</p>
          </Callout>
        ) : null}
      </div>
    </Panel>
  );
}

function CostsPanel({ q }: { q: ReturnType<typeof useAiCosts> }) {
  const { t, formatNumber } = useI18n();
  const columns: Column<AiCosts['items'][number]>[] = [
    { key: 'month', header: t('ai.costs.month'), cell: (r) => <span dir="ltr">{r.month}</span>, isRowHeader: true, sortValue: (r) => r.month },
    { key: 'runs', header: t('ai.costs.runs'), cell: (r) => <span className="tabular">{formatNumber(r.runs)}</span>, sortValue: (r) => r.runs },
    { key: 'in', header: t('ai.costs.inputTokens'), cell: (r) => <span className="tabular">{formatNumber(r.inputTokens)}</span>, sortValue: (r) => r.inputTokens },
    { key: 'out', header: t('ai.costs.outputTokens'), cell: (r) => <span className="tabular">{formatNumber(r.outputTokens)}</span>, sortValue: (r) => r.outputTokens },
    { key: 'cost', header: t('ai.costs.cost'), cell: (r) => <span className="tabular" dir="ltr">{`${r.costEstimate}${q.data?.currency ? ` ${q.data.currency}` : ''}`}</span> },
  ];
  return (
    <Panel title={t('ai.costs.title')} testId="costs" description={t('ai.costs.note')}>
      <DataTable caption={t('ai.costs.title')} columns={columns} rows={q.data?.items} rowKey={(r) => r.month} isLoading={q.isLoading} error={q.error} onRetry={() => q.refetch()} emptyTitle={t('ai.costs.empty')} />
    </Panel>
  );
}

function RunLine({ run, href }: { run: { id: string; kind: string; status: string; simulated: boolean; question: string | null; createdAt: string }; href: string }) {
  const { t, formatDateTime } = useI18n();
  return (
    <li className="flex flex-wrap items-center gap-2 text-sm" data-testid="run-line">
      <Link className={btn.link} href={href}>
        {t(`ai.runKinds.${run.kind}` as MessageKey)}
      </Link>
      <StatusBadge enumName="aiRunStatuses" value={run.status} />
      {run.simulated ? <SimulatedTag /> : null}
      <span className="text-xs text-muted">{formatDateTime(run.createdAt)}</span>
      {run.question ? <UText value={run.question} className="min-w-0 truncate text-muted" /> : null}
    </li>
  );
}

function SimulatedTag() {
  const { t } = useI18n();
  return <span className="text-xs font-semibold text-warning">{t('ai.common.simulated')}</span>;
}

function ToolMatrix({ q }: { q: ReturnType<typeof useAiTools> }) {
  const { t, tStatus, formatList } = useI18n();
  const columns: Column<AiToolMatrix['items'][number]>[] = [
    { key: 'name', header: t('ai.tools.name'), cell: (r) => <Code>{r.name}</Code>, isRowHeader: true, sortValue: (r) => r.name },
    { key: 'kind', header: t('ai.tools.kind'), cell: (r) => t(`ai.tools.kinds.${r.kind}` as MessageKey), sortValue: (r) => r.kind },
    { key: 'permission', header: t('ai.tools.permission'), cell: (r) => (r.permission ? <Code>{r.permission}</Code> : <span className="text-muted">{t('ai.tools.noPermission')}</span>) },
    { key: 'modes', header: t('ai.tools.modes'), cell: (r) => formatList(r.modes.map((m) => tStatus('aiModes', m))) },
    { key: 'autopilot', header: t('ai.tools.autopilot'), cell: (r) => (r.autopilotEligible ? t('ai.common.yes') : t('ai.common.no')) },
  ];
  return (
    <details className="rounded-lg border border-line bg-surface" data-testid="tool-matrix">
      <summary className="cursor-pointer px-4 py-3 font-semibold text-ink">{t('ai.tools.title')}</summary>
      <div className="space-y-3 border-t border-line p-4">
        <p className="text-sm text-muted">{t('ai.tools.hint')}</p>
        <DataTable caption={t('ai.tools.title')} columns={columns} rows={q.data?.items} rowKey={(r) => r.name} isLoading={q.isLoading} error={q.error} onRetry={() => q.refetch()} emptyTitle={t('ai.tools.empty')} />
        {q.data ? (
          <div>
            <h3 className="text-sm font-semibold text-ink">{t('ai.tools.prohibited')}</h3>
            <p className="text-xs text-muted">{t('ai.tools.prohibitedHint')}</p>
            <ul className="mt-2 flex flex-wrap gap-1.5" data-testid="prohibited-actions">
              {q.data.prohibitedActions.map((a) => (
                <li key={a}>
                  <Code>{a}</Code>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted">
              {t('ai.tools.policyVersion')} <Code>{q.data.policyVersion}</Code>
            </p>
          </div>
        ) : null}
      </div>
    </details>
  );
}

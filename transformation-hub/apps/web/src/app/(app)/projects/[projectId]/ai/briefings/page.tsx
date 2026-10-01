'use client';

import Link from 'next/link';
import { useMemo, useState, type FormEvent } from 'react';
import { aiRoutes, AI_DETECTION_CODES } from '@hub/contracts';
import { DataTable, type Column } from '@/components/DataTable';
import { ErrorState } from '@/components/ErrorState';
import { SelectField, TextField } from '@/components/Field';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { SearchInput } from '@/components/SearchInput';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn, cx, input } from '@/components/ui';
import { EM_DASH, useI18n, type MessageKey } from '@/i18n/provider';
import { useLocalized, useServerMessages } from '@/lib/i18n-data';
import { api } from '@/lib/api';
import { BRIEFING_KINDS, citationHref, DETECTION_SEVERITIES, useAiRefresh, useBriefings, useDetections, type AiDetection, type BriefingSchedule } from '@/lib/ai';
import { useProjectContext } from '@/lib/project-context';
import { AiErrorNotice, Callout, Code, Panel, RunError, UText } from '../_components/bits';
import { TabGuard } from '../_components/nav';

const DEFAULT_CRON = { daily: '30 7 * * *', weekly: '0 8 * * 0' } as const;

/**
 * Scheduled briefings (durable schedules owned by the subscriber, run by the worker after the browser closes; delivered
 * to the subscriber only, under the subscriber's own access) and rules-only detections (deterministic; available even
 * with AI Off). Every detection links to its record.
 */
export default function AiBriefingsPage() {
  return (
    <TabGuard tab="briefings">
      <BriefingsScreen />
    </TabGuard>
  );
}

function BriefingsScreen() {
  const { t } = useI18n();
  const { can } = useProjectContext();
  return (
    <>
      <PageHeader title={t('ai.briefings.title')} description={t('ai.briefings.subtitle')} />
      <div className="space-y-6" data-testid="ai-briefings">
        {can('ai.briefing.subscribe') ? <Schedules /> : null}
        {can('planning.plan.read') ? <Detections /> : null}
      </div>
    </>
  );
}

function Schedules() {
  const { t, formatDateTime } = useI18n();
  const { projectId } = useProjectContext();
  const q = useBriefings();
  const refresh = useAiRefresh();
  const toast = useToast();
  const [kind, setKind] = useState<(typeof BRIEFING_KINDS)[number]>('daily');
  const [cron, setCron] = useState('');
  const [timezone, setTimezone] = useState('Asia/Riyadh');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const subscribe = async (body: { kind: 'daily' | 'weekly'; cron?: string; timezone?: string; enabled: boolean }, key: string) => {
    setBusy(key);
    setError(null);
    try {
      await api(aiRoutes.subscribeBriefing, { params: { projectId }, body });
      toast.show('success', body.enabled ? t('ai.briefings.saved') : t('ai.briefings.paused'));
      await refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void subscribe({ kind, ...(cron.trim() ? { cron: cron.trim() } : {}), timezone: timezone.trim() || 'Asia/Riyadh', enabled: true }, 'form');
  };

  const columns: Column<BriefingSchedule>[] = [
    { key: 'kind', header: t('ai.briefings.kind'), isRowHeader: true, cell: (b) => t(`ai.briefings.kinds.${b.kind}` as MessageKey) },
    {
      key: 'schedule',
      header: t('ai.briefings.schedule'),
      cell: (b) => (
        <span className="flex flex-col gap-0.5">
          <span>{b.cron === DEFAULT_CRON[b.kind] ? t(`ai.briefings.defaultSchedule.${b.kind}` as MessageKey) : t('ai.briefings.customSchedule')}</span>
          <span className="text-xs text-muted">
            <Code>{b.cron}</Code> <span dir="ltr">{b.timezone}</span>
          </span>
        </span>
      ),
    },
    {
      key: 'enabled',
      header: t('ai.briefings.state'),
      cell: (b) => <StatusBadge enumName="aiModes" value={b.enabled ? 'enabled' : 'paused'} tone={b.enabled ? 'success' : 'neutral'} label={b.enabled ? t('ai.briefings.enabled') : t('ai.briefings.pausedState')} />,
    },
    { key: 'next', header: t('ai.briefings.nextRun'), cell: (b) => (b.nextRunAt ? formatDateTime(b.nextRunAt) : EM_DASH) },
    {
      key: 'last',
      header: t('ai.briefings.lastRun'),
      cell: (b) => (
        <span className="flex flex-col gap-0.5">
          <span>{b.lastRunAt ? formatDateTime(b.lastRunAt) : EM_DASH}</span>
          {b.lastStatus ? <span className="text-xs text-muted">{t(`ai.briefings.lastStatuses.${b.lastStatus}` as MessageKey)}</span> : null}
          {b.lastError ? (
            <span className="text-xs text-danger">
              <RunError code={b.lastError} />
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'actions',
      header: t('ai.briefings.actions'),
      cell: (b) => (
        <button
          type="button"
          className={cx(btn.secondary, 'min-h-9 px-2.5 py-1')}
          disabled={busy !== null}
          onClick={() => subscribe({ kind: b.kind, cron: b.cron, timezone: b.timezone, enabled: !b.enabled }, b.id)}
          data-testid={`briefing-toggle-${b.kind}`}
        >
          {b.enabled ? t('ai.briefings.pause') : t('ai.briefings.resume')}
        </button>
      ),
    },
  ];

  return (
    <Panel title={t('ai.briefings.schedulesTitle')} testId="briefing-schedules" description={t('ai.briefings.schedulesHint')}>
      <div className="space-y-4">
        <Callout testId="briefings-delivery">
          <p>{t('ai.briefings.delivery')}</p>
        </Callout>
        <DataTable caption={t('ai.briefings.schedulesTitle')} columns={columns} rows={q.data?.items} rowKey={(b) => b.id} isLoading={q.isLoading} error={q.error} onRetry={() => q.refetch()} emptyTitle={t('ai.briefings.empty')} emptyHint={t('ai.briefings.emptyHint')} testId="briefings-table" />
        <form onSubmit={submit} className="space-y-3 rounded-md border border-line p-3" data-testid="briefing-form" noValidate>
          <h3 className="text-sm font-semibold text-ink">{t('ai.briefings.formTitle')}</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <SelectField label={t('ai.briefings.kind')} required value={kind} onChange={(e) => setKind(e.target.value as 'daily' | 'weekly')} data-testid="briefing-kind">
              {BRIEFING_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`ai.briefings.kinds.${k}` as MessageKey)}
                </option>
              ))}
            </SelectField>
            <TextField label={t('ai.briefings.cron')} hint={t('ai.briefings.cronHint', { cron: DEFAULT_CRON[kind] })} value={cron} onChange={(e) => setCron(e.target.value)} placeholder={DEFAULT_CRON[kind]} dir="ltr" data-testid="briefing-cron" />
            <TextField label={t('ai.briefings.timezone')} required value={timezone} onChange={(e) => setTimezone(e.target.value)} dir="ltr" data-testid="briefing-timezone" />
          </div>
          <button type="submit" className={btn.primary} disabled={busy !== null} aria-busy={busy === 'form'} data-testid="briefing-subscribe">
            {busy === 'form' ? t('common.actions.working') : t('ai.briefings.subscribe')}
          </button>
        </form>
        <AiErrorNotice error={error} testId="briefing-error" />
      </div>
    </Panel>
  );
}

function Detections() {
  const { t, formatDate, formatDateTime, formatNumber } = useI18n();
  const { projectId } = useProjectContext();
  const q = useDetections();
  const localize = useLocalized();
  const messages = useServerMessages();
  const [search, setSearch] = useState('');
  const [severity, setSeverity] = useState('');
  const [code, setCode] = useState('');
  // QA-P5-04: the record in the UI language (Arabic template title when it exists) and the detail from its codes.
  const rows = useMemo(() => {
    const s = search.toLocaleLowerCase();
    return (q.data?.items ?? [])
      .map((d, i) => ({ ...d, rowIndex: i, shownLabel: localize(d.label, d.labelAr), shownDetail: messages(d.detailI18n, d.detail) ?? d.detail }))
      .filter((d) => (!severity || d.severity === severity) && (!code || d.code === code) && (!s || d.shownLabel.toLocaleLowerCase().includes(s) || d.shownDetail.toLocaleLowerCase().includes(s)));
  }, [q.data, search, severity, code, localize, messages]);

  const columns: Column<AiDetection & { rowIndex: number; shownLabel: string; shownDetail: string }>[] = [
    {
      key: 'record',
      header: t('ai.detections.record'),
      isRowHeader: true,
      sortValue: (d) => d.shownLabel,
      cell: (d) => {
        const href = citationHref(projectId, { type: d.entityType, id: d.entityId, label: d.label });
        return href ? (
          <Link className={btn.link} href={href} data-testid="detection-link">
            <span dir="auto">{d.shownLabel}</span>
          </Link>
        ) : (
          <UText value={d.shownLabel} />
        );
      },
    },
    { key: 'code', header: t('ai.detections.finding'), sortValue: (d) => d.code, cell: (d) => t(`ai.detections.codes.${d.code}` as MessageKey) },
    {
      key: 'severity',
      header: t('ai.detections.severity'),
      sortValue: (d) => DETECTION_SEVERITIES.indexOf(d.severity),
      cell: (d) => <StatusBadge enumName="aiModes" value={d.severity} tone={d.severity === 'critical' ? 'danger' : d.severity === 'warning' ? 'warning' : 'info'} label={t(`ai.detections.severities.${d.severity}` as MessageKey)} />,
    },
    { key: 'detail', header: t('ai.detections.detail'), cell: (d) => <UText value={d.shownDetail} /> },
    { key: 'gate', header: t('ai.detections.gate'), sortValue: (d) => d.gateKey, cell: (d) => (d.gateKey ? <span dir="ltr">{d.gateKey}</span> : EM_DASH) },
    { key: 'due', header: t('ai.detections.dueDate'), sortValue: (d) => d.dueDate, cell: (d) => formatDate(d.dueDate) },
  ];

  return (
    <Panel title={t('ai.detections.title')} testId="detections" id="detections" description={t('ai.detections.hint')}>
      {q.isLoading ? (
        <LoadingState compact />
      ) : q.error || !q.data ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted" data-testid="detections-meta">
            {t('ai.detections.meta', { computed: formatDateTime(q.data.computedAt), today: formatDate(q.data.today), count: formatNumber(q.data.items.length) })}
          </p>
          <div className="flex flex-wrap items-end gap-3" role="group" aria-label={t('ai.common.filters')}>
            <SearchInput value={search} onChange={setSearch} label={t('ai.detections.search')} className="min-w-56 flex-1" />
            <label className="flex min-w-40 flex-col gap-1 text-sm font-medium text-ink">
              {t('ai.detections.severity')}
              <select className={cx(input, 'pe-8')} value={severity} onChange={(e) => setSeverity(e.target.value)} data-testid="detections-severity">
                <option value="">{t('ai.common.all')}</option>
                {DETECTION_SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {t(`ai.detections.severities.${s}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-48 flex-col gap-1 text-sm font-medium text-ink">
              {t('ai.detections.finding')}
              <select className={cx(input, 'pe-8')} value={code} onChange={(e) => setCode(e.target.value)} data-testid="detections-code">
                <option value="">{t('ai.common.all')}</option>
                {AI_DETECTION_CODES.map((c) => (
                  <option key={c} value={c}>
                    {t(`ai.detections.codes.${c}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <DataTable
            caption={t('ai.detections.title')}
            columns={columns}
            rows={rows}
            rowKey={(d) => String(d.rowIndex)}
            emptyTitle={q.data.items.length ? t('ai.detections.emptyFiltered') : t('ai.detections.empty')}
            clientPageSize={25}
            testId="detections-table"
          />
        </div>
      )}
    </Panel>
  );
}

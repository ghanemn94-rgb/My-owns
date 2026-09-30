'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { DataTable, type Column } from '@/components/DataTable';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { btn, cx, input } from '@/components/ui';
import { useI18n, type MessageKey } from '@/i18n/provider';
import { aiHref, RUN_SORTS, useAiRuns, type AiRunSummary } from '@/lib/ai';
import { useProjectContext } from '@/lib/project-context';
import { Callout, SimulatedBadge, UText } from '../_components/bits';
import { TabGuard } from '../_components/nav';

const PAGE_SIZE = 20;

/** My AI runs (append-only records; answers are per user and never shared — AIT-08). */
export default function AiRunsPage() {
  return (
    <TabGuard tab="runs">
      <RunsScreen />
    </TabGuard>
  );
}

function RunsScreen() {
  const { t, formatDateTime, formatNumber } = useI18n();
  const { projectId } = useProjectContext();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);
  const sortParam = params.get('sort') ?? '-createdAt';
  const sort = (RUN_SORTS as readonly string[]).includes(sortParam) ? (sortParam as (typeof RUN_SORTS)[number]) : '-createdAt';
  const q = useAiRuns({ page, pageSize: PAGE_SIZE, sort });
  const setParam = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === '') next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, router, pathname],
  );

  const columns: Column<AiRunSummary>[] = [
    {
      key: 'created',
      header: t('ai.runs.created'),
      isRowHeader: true,
      cell: (r) => (
        <Link className={btn.link} href={aiHref(projectId, `/runs/${r.id}`)} data-testid="run-link">
          {formatDateTime(r.createdAt)}
        </Link>
      ),
    },
    { key: 'kind', header: t('ai.runs.kind'), cell: (r) => t(`ai.runKinds.${r.kind}` as MessageKey) },
    { key: 'trigger', header: t('ai.runs.trigger'), cell: (r) => t(`ai.triggers.${r.trigger}` as MessageKey) },
    { key: 'status', header: t('ai.runs.status'), cell: (r) => <StatusBadge enumName="aiRunStatuses" value={r.status} /> },
    {
      key: 'provider',
      header: t('ai.runs.provider'),
      cell: (r) => (r.simulated ? <SimulatedBadge /> : <span>{t(`ai.providers.${r.provider}` as MessageKey)}</span>),
    },
    { key: 'question', header: t('ai.runs.question'), cell: (r) => (r.question ? <UText value={r.question} className="line-clamp-2" /> : <span className="text-muted">{t('ai.runs.noQuestion')}</span>) },
    { key: 'tokens', header: t('ai.runs.tokens'), cell: (r) => <span className="tabular">{t('ai.runs.tokensInOut', { in: formatNumber(r.inputTokens), out: formatNumber(r.outputTokens) })}</span> },
    { key: 'cost', header: t('ai.runs.cost'), cell: (r) => <span className="tabular" dir="ltr">{r.costEstimate ?? '—'}</span> },
  ];

  return (
    <>
      <PageHeader title={t('ai.runs.title')} description={t('ai.runs.subtitle')} />
      <div className="space-y-4" data-testid="ai-runs">
        <Callout testId="runs-append-only">
          <p>{t('ai.runs.appendOnly')}</p>
        </Callout>
        <div className="flex flex-wrap items-end gap-3" role="group" aria-label={t('ai.common.filters')}>
          <label className="flex min-w-48 flex-col gap-1 text-sm font-medium text-ink">
            {t('ai.common.sortBy')}
            <select className={cx(input, 'pe-8')} value={sort} onChange={(e) => setParam({ sort: e.target.value === '-createdAt' ? null : e.target.value, page: null })} data-testid="runs-sort">
              {RUN_SORTS.map((s) => (
                <option key={s} value={s}>
                  {t(`ai.runs.sorts.${s.replace('-', 'desc_')}` as MessageKey)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <DataTable
          caption={t('ai.runs.title')}
          columns={columns}
          rows={q.data?.items}
          rowKey={(r) => r.id}
          isLoading={q.isLoading}
          error={q.error}
          onRetry={() => q.refetch()}
          emptyTitle={t('ai.runs.empty')}
          emptyHint={t('ai.runs.emptyHint')}
          pagination={q.data ? { page, pageSize: PAGE_SIZE, total: q.data.total, onPageChange: (p) => setParam({ page: p === 1 ? null : String(p) }) } : undefined}
          testId="runs-table"
        />
      </div>
    </>
  );
}

'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { AI_PROPOSAL_STATUSES } from '@hub/domain';
import { DataTable, type Column } from '@/components/DataTable';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { btn, cx, input } from '@/components/ui';
import { useI18n, type MessageKey } from '@/i18n/provider';
import { aiHref, citationHref, PROPOSAL_SORTS, useAiProposals, useAiStatus, useMemberNames, withProposalPeople, type AiProposal } from '@/lib/ai';
import { useProjectContext } from '@/lib/project-context';
import { Callout, Person, SimulatedBadge } from '../_components/bits';
import { TabGuard } from '../_components/nav';

const PAGE_SIZE = 20;

/**
 * AI proposals awaiting review / history (spec §12.3–12.4). A proposal is only a suggestion: nothing changes until a
 * DIFFERENT authorized person approves exactly the version shown (assisted mode) and the worker executes it.
 */
export default function AiProposalsPage() {
  return (
    <TabGuard tab="proposals">
      <ProposalsScreen />
    </TabGuard>
  );
}

function ProposalsScreen() {
  const { t, tStatus, formatDateTime, formatNumber } = useI18n();
  const { projectId } = useProjectContext();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);
  const statusParam = params.get('status') ?? '';
  const statusFilter = (AI_PROPOSAL_STATUSES as readonly string[]).includes(statusParam) ? (statusParam as (typeof AI_PROPOSAL_STATUSES)[number]) : undefined;
  const sortParam = params.get('sort') ?? '-createdAt';
  const sort = (PROPOSAL_SORTS as readonly string[]).includes(sortParam) ? (sortParam as (typeof PROPOSAL_SORTS)[number]) : '-createdAt';
  const q = useAiProposals({ page, pageSize: PAGE_SIZE, sort, ...(statusFilter ? { status: statusFilter } : {}) });
  const status = useAiStatus();
  const members = useMemberNames();
  // QA-P5-05: every row names its own people (requester, recipient, approvers) — no members list needed.
  const people = useMemo(() => withProposalPeople(members, q.data?.items ?? []), [members, q.data]);
  const setParam = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === '') next.delete(k);
        else next.set(k, v);
      }
      if (!('page' in patch)) next.delete('page');
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, router, pathname],
  );

  const columns: Column<AiProposal>[] = [
    {
      key: 'action',
      header: t('ai.proposals.action'),
      isRowHeader: true,
      cell: (p) => (
        <Link className={btn.link} href={aiHref(projectId, `/proposals/${p.id}`)} data-testid="proposal-link">
          {t(`ai.actions.${p.actionType}` as MessageKey)}
        </Link>
      ),
    },
    {
      key: 'target',
      header: t('ai.proposals.target'),
      cell: (p) => {
        if (!p.targetType || !p.targetId) return <span className="text-muted">{t('ai.proposals.noTarget')}</span>;
        const href = citationHref(projectId, { type: p.targetType, id: p.targetId });
        const label = t(`ai.citationTypes.${p.targetType}` as MessageKey);
        return href ? (
          <Link className={btn.link} href={href}>
            {label}
          </Link>
        ) : (
          <span>{label}</span>
        );
      },
    },
    { key: 'status', header: t('ai.proposals.status'), cell: (p) => <StatusBadge enumName="aiProposalStatuses" value={p.status} /> },
    { key: 'requester', header: t('ai.proposals.requestedBy'), cell: (p) => <Person id={p.requestedBy} people={people} /> },
    { key: 'version', header: t('ai.proposals.version'), cell: (p) => <span className="tabular">{formatNumber(p.version)}</span> },
    { key: 'created', header: t('ai.proposals.created'), cell: (p) => formatDateTime(p.createdAt) },
    { key: 'sim', header: t('ai.proposals.origin'), cell: (p) => (p.simulated ? <SimulatedBadge /> : <span>{t('ai.proposals.realModel')}</span>) },
  ];

  return (
    <>
      <PageHeader title={t('ai.proposals.title')} description={t('ai.proposals.subtitle')} />
      <div className="space-y-4" data-testid="ai-proposals">
        {status.data?.killSwitch ? (
          <Callout tone="danger" icon="stop" testId="proposals-kill-switch">
            <p className="font-semibold">{t('ai.killSwitch.bannerTitle')}</p>
            <p>{t('ai.proposals.killSwitch')}</p>
          </Callout>
        ) : status.data && status.data.mode !== 'assisted' && status.data.mode !== 'autopilot' ? (
          <Callout tone="warning" testId="proposals-mode-note">
            <p>{t('ai.proposals.modeNote', { mode: tStatus('aiModes', status.data.mode) })}</p>
          </Callout>
        ) : null}
        <Callout testId="proposals-binding-note">
          <p>{t('ai.proposals.bindingNote')}</p>
        </Callout>
        <div className="flex flex-wrap items-end gap-3" role="group" aria-label={t('ai.common.filters')}>
          <label className="flex min-w-44 flex-col gap-1 text-sm font-medium text-ink">
            {t('ai.proposals.status')}
            <select className={cx(input, 'pe-8')} value={statusFilter ?? ''} onChange={(e) => setParam({ status: e.target.value })} data-testid="proposals-status-filter">
              <option value="">{t('ai.common.all')}</option>
              {AI_PROPOSAL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {tStatus('aiProposalStatuses', s)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-48 flex-col gap-1 text-sm font-medium text-ink">
            {t('ai.common.sortBy')}
            <select className={cx(input, 'pe-8')} value={sort} onChange={(e) => setParam({ sort: e.target.value === '-createdAt' ? null : e.target.value })} data-testid="proposals-sort">
              {PROPOSAL_SORTS.map((s) => (
                <option key={s} value={s}>
                  {t(`ai.proposals.sorts.${s.replace('-', 'desc_')}` as MessageKey)}
                </option>
              ))}
            </select>
          </label>
          {statusFilter || sort !== '-createdAt' ? (
            <button type="button" className="min-h-10 text-sm font-medium text-primary underline-offset-2 hover:underline" onClick={() => router.replace(pathname, { scroll: false })}>
              {t('ai.common.clearFilters')}
            </button>
          ) : null}
        </div>
        <DataTable
          caption={t('ai.proposals.title')}
          columns={columns}
          rows={q.data?.items}
          rowKey={(p) => p.id}
          isLoading={q.isLoading}
          error={q.error}
          onRetry={() => q.refetch()}
          emptyTitle={statusFilter ? t('ai.proposals.emptyFiltered') : t('ai.proposals.empty')}
          emptyHint={t('ai.proposals.emptyHint')}
          pagination={q.data ? { page, pageSize: PAGE_SIZE, total: q.data.total, onPageChange: (p) => setParam({ page: p === 1 ? null : String(p) }) } : undefined}
          testId="proposals-table"
        />
      </div>
    </>
  );
}

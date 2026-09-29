'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Megaphone } from 'lucide-react';
import { useState } from 'react';
import { governanceRoutes, ESCALATION_SOURCE_TYPES } from '@hub/contracts';
import { ESCALATION_STATUSES } from '@hub/domain';
import { DataTable, type Column } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { SelectField } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { SearchInput } from '@/components/SearchInput';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn, cx } from '@/components/ui';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { useProjectContext } from '@/lib/project-context';
import { RaiseEscalationDialog } from '../_components/dialogs';
import { FilterBar, FilterSelect, GovCommandDialog, UText, gk, sourceKey, hubHref, useDecisionList, useGovRefresh, useUrlState, type Escalation } from '../_components/gov';

const PAGE_SIZE = 20;
const FILTERS = ['q', 'status', 'sourceType', 'sourceId'] as const;
type Status = (typeof ESCALATION_STATUSES)[number];
type Source = (typeof ESCALATION_SOURCE_TYPES)[number];

export default function EscalationsPage() {
  const { t, tStatus, formatDate } = useI18n();
  const { projectId, can, me } = useProjectContext();
  const refresh = useGovRefresh();
  const toast = useToast();
  const { values, page, set, clear, active } = useUrlState(FILTERS);
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [resolving, setResolving] = useState<Escalation | null>(null);
  const [resolutionDecision, setResolutionDecision] = useState('');
  const base = hubHref(projectId);
  const decisions = useDecisionList({ pageSize: 100 }, resolving !== null);

  const query = {
    page,
    pageSize: PAGE_SIZE,
    q: values.q || undefined,
    status: (values.status || undefined) as Status | undefined,
    sourceType: (values.sourceType || undefined) as Source | undefined,
    sourceId: values.sourceId || undefined,
  };
  const list = useQuery({
    queryKey: gk.escalations(projectId, query),
    queryFn: ({ signal }) => api(governanceRoutes.listEscalations, { params: { projectId }, query, signal }),
    enabled: can('governance.decision.read'),
    placeholderData: (prev) => prev,
  });

  const columns: Column<Escalation>[] = [
    {
      key: 'code',
      header: t('governance.escalations.columns.code'),
      isRowHeader: true,
      sortValue: (e) => e.code,
      cell: (e) => (
        <span className="flex flex-wrap items-center gap-1">
          <span dir="ltr" className="font-medium">
            {e.code}
          </span>
          {e.isDemo ? <DemoBadge /> : null}
        </span>
      ),
    },
    {
      key: 'title',
      header: t('governance.escalations.columns.title'),
      sortValue: (e) => e.title,
      cell: (e) => (
        <span className="flex flex-col gap-1">
          <UText value={e.title} />
          <span className="text-xs text-muted">
            {t(sourceKey(e.sourceType))}
            {e.sourceType === 'decision' && e.sourceId ? (
              <>
                {' · '}
                <Link href={`${base}/decisions/${e.sourceId}`} className={btn.link}>
                  {t('governance.common.view')}
                </Link>
              </>
            ) : null}
            {e.isSystemGenerated ? ` · ${t('governance.escalations.system')}` : ''}
          </span>
        </span>
      ),
    },
    { key: 'requested', header: t('governance.escalations.columns.requestedAction'), cell: (e) => <UText value={e.requestedAction} /> },
    { key: 'deadline', header: t('governance.escalations.columns.deadline'), sortValue: (e) => e.decisionDeadline ?? '', cell: (e) => <span className="tabular">{formatDate(e.decisionDeadline)}</span> },
    {
      key: 'options',
      header: t('governance.escalations.columns.options'),
      cell: (e) =>
        e.options.length ? (
          <ol className="list-decimal space-y-0.5 ps-4 text-xs">
            {e.options.map((o, i) => (
              <li key={i}>
                <span dir="auto" className="font-medium">
                  {o.title}
                </span>
                {o.impact ? (
                  <>
                    {' — '}
                    <span dir="auto">{o.impact}</span>
                  </>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <span className="text-muted">{EM_DASH}</span>
        ),
    },
    { key: 'target', header: t('governance.escalations.columns.target'), cell: (e) => <UText value={e.target} /> },
    {
      key: 'status',
      header: t('governance.escalations.columns.status'),
      sortValue: (e) => e.status,
      cell: (e) => (
        <span className="flex flex-col items-start gap-1">
          <StatusBadge enumName="escalationStatuses" value={e.status} />
          {e.resolutionNote ? (
            <span className="text-xs text-muted" dir="auto">
              {e.resolutionNote}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'commands',
      header: t('governance.escalations.columns.commands'),
      cell: (e) =>
        can('governance.decision.record_outcome') && (e.status === 'open' || e.status === 'decision_requested') && e.raisedBy !== me.user.id ? (
          <button
            type="button"
            className={cx(btn.secondary, 'min-h-9 px-2.5 py-1')}
            onClick={() => {
              setResolutionDecision('');
              setResolving(e);
            }}
            aria-label={`${t('governance.escalations.resolve.label')} — ${e.code}`}
          >
            {t('governance.escalations.resolve.label')}
          </button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title={t('governance.escalations.title')}
        description={t('governance.escalations.subtitle')}
        actions={
          can('governance.escalation.raise') ? (
            <button type="button" className={btn.primary} onClick={() => setRaiseOpen(true)} data-testid="raise-escalation">
              <Megaphone aria-hidden="true" className="size-4 rtl:-scale-x-100" />
              {t('governance.escalations.raise.action')}
            </button>
          ) : null
        }
      />
      <FilterBar onClear={clear} active={active}>
        <SearchInput className="w-full sm:w-72" label={t('governance.escalations.search')} value={values.q} onChange={(v) => set({ q: v })} />
        <FilterSelect label={t('governance.common.status')} value={values.status} onChange={(v) => set({ status: v })} options={ESCALATION_STATUSES.map((s) => ({ value: s, label: tStatus('escalationStatuses', s) }))} />
        <FilterSelect
          label={t('governance.escalations.filterSource')}
          value={values.sourceType}
          onChange={(v) => set({ sourceType: v, sourceId: null })}
          options={ESCALATION_SOURCE_TYPES.map((s) => ({ value: s, label: t(sourceKey(s)) }))}
        />
      </FilterBar>
      <DataTable
        caption={t('governance.escalations.title')}
        columns={columns}
        rows={list.data?.items}
        rowKey={(e) => e.id}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        emptyTitle={active ? t('governance.escalations.emptySearch') : t('governance.escalations.empty')}
        pagination={list.data ? { page, pageSize: PAGE_SIZE, total: list.data.total, onPageChange: (p) => set({ page: p }) } : undefined}
        testId="escalations-table"
      />
      {resolving ? (
        <GovCommandDialog
          open
          onClose={() => setResolving(null)}
          title={t('governance.escalations.resolve.title', { code: resolving.code })}
          confirmLabel={t('governance.escalations.resolve.label')}
          noteMode="required"
          noteLabel={t('governance.common.reason')}
          expectedVersion={resolving.version}
          consequences={[t('governance.escalations.resolve.effect'), t('common.command.audited')]}
          onReload={() => {
            void refresh();
            setResolving(null);
          }}
          onConfirm={async ({ note }) => {
            await api(governanceRoutes.resolveEscalation, {
              params: { projectId, escalationId: resolving.id },
              body: { expectedVersion: resolving.version, note, ...(resolutionDecision ? { resolutionDecisionId: resolutionDecision } : {}) },
            });
            await refresh();
            toast.show('success', t('governance.escalations.resolve.done'));
            setResolving(null);
          }}
        >
          <SelectField label={t('governance.escalations.resolve.decision')} value={resolutionDecision} onChange={(e) => setResolutionDecision(e.target.value)}>
            <option value="">{t('governance.common.none')}</option>
            {(decisions.data?.items ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} — {d.title}
              </option>
            ))}
          </SelectField>
        </GovCommandDialog>
      ) : null}
      {can('governance.escalation.raise') ? <RaiseEscalationDialog open={raiseOpen} onClose={() => setRaiseOpen(false)} /> : null}
    </>
  );
}

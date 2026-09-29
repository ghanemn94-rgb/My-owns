'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import { governanceRoutes, portfolioRoutes, type RouteQuery, type RouteResponse } from '@hub/contracts';
import { ConfirmCommandDialog } from '@/components/ConfirmCommandDialog';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { Pagination } from '@/components/Pagination';
import { card, cx, input } from '@/components/ui';
import { EM_DASH, useI18n, type MessageKey } from '@/i18n/provider';
import { api, isApiError } from '@/lib/api';
import { useProjectContext } from '@/lib/project-context';

// ---------------------------------------------------------------------------------------------------------------
// Types

export type Committee = RouteResponse<typeof governanceRoutes.listCommittees>['items'][number];
export type CommitteeDetail = RouteResponse<typeof governanceRoutes.getCommittee>;
export type MatrixVersion = RouteResponse<typeof governanceRoutes.listAuthorityMatrixVersions>['items'][number];
export type Meeting = RouteResponse<typeof governanceRoutes.listMeetings>['items'][number];
export type MeetingDetail = RouteResponse<typeof governanceRoutes.getMeeting>;
export type AgendaItem = RouteResponse<typeof governanceRoutes.listAgendaRequests>['items'][number];
export type Decision = RouteResponse<typeof governanceRoutes.listDecisions>['items'][number];
export type DecisionDetail = RouteResponse<typeof governanceRoutes.getDecision>;
export type Vote = RouteResponse<typeof governanceRoutes.listVotes>['items'][number];
export type ActionItem = RouteResponse<typeof governanceRoutes.listActions>['items'][number];
export type Escalation = RouteResponse<typeof governanceRoutes.listEscalations>['items'][number];

export interface PolicyDecisionType {
  key: string;
  name?: { en: string; ar: string };
  maxAmount: string | null;
  currency: string;
  unitScale: number;
  withinCommitteeAuthority: boolean;
  escalateTo: string;
}
export interface PolicyShape {
  isDemoPolicy: boolean;
  quorum: { minVotingMembersPresent: number; minFractionPresent: number };
  approvalThreshold: { type: 'simple_majority' | 'two_thirds' };
  tieRule: 'chair_casting_vote' | 'escalate';
  decisionTypes: PolicyDecisionType[];
}

// ---------------------------------------------------------------------------------------------------------------
// Query keys and hooks — every governance query lives under ['gov', projectId] so one invalidation refreshes all.

export const gk = {
  root: (pid: string) => ['gov', pid] as const,
  committees: (pid: string, q: object) => ['gov', pid, 'committees', q] as const,
  committee: (pid: string, id: string) => ['gov', pid, 'committee', id] as const,
  charterVersions: (pid: string, id: string) => ['gov', pid, 'committee', id, 'charter'] as const,
  matrices: (pid: string, id: string) => ['gov', pid, 'committee', id, 'matrices'] as const,
  meetings: (pid: string, q: object) => ['gov', pid, 'meetings', q] as const,
  meeting: (pid: string, id: string) => ['gov', pid, 'meeting', id] as const,
  packs: (pid: string, id: string) => ['gov', pid, 'meeting', id, 'packs'] as const,
  pack: (pid: string, id: string, packId: string) => ['gov', pid, 'meeting', id, 'pack', packId] as const,
  agenda: (pid: string, q: object) => ['gov', pid, 'agenda', q] as const,
  decisions: (pid: string, q: object) => ['gov', pid, 'decisions', q] as const,
  decision: (pid: string, id: string) => ['gov', pid, 'decision', id] as const,
  votes: (pid: string, id: string) => ['gov', pid, 'decision', id, 'votes'] as const,
  actions: (pid: string, q: object) => ['gov', pid, 'actions', q] as const,
  escalations: (pid: string, q: object) => ['gov', pid, 'escalations', q] as const,
  history: (pid: string, q: object) => ['gov', pid, 'history', q] as const,
};

/** After any governance command: refresh every governance query of the project (and its activity feed). */
export function useGovRefresh() {
  const queryClient = useQueryClient();
  const { projectId } = useProjectContext();
  return useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: gk.root(projectId) }),
      queryClient.invalidateQueries({ queryKey: ['project', projectId, 'activity'] }),
    ]);
  }, [queryClient, projectId]);
}

export function useCommitteeList(enabled = true) {
  const { projectId, can } = useProjectContext();
  const q = { page: 1, pageSize: 100 };
  return useQuery({
    queryKey: gk.committees(projectId, q),
    queryFn: ({ signal }) => api(governanceRoutes.listCommittees, { params: { projectId }, query: q, signal }),
    enabled: enabled && can('governance.committee.read'),
  });
}

export function useCommittee(committeeId: string | null | undefined) {
  const { projectId, can } = useProjectContext();
  return useQuery({
    queryKey: gk.committee(projectId, committeeId ?? ''),
    queryFn: ({ signal }) => api(governanceRoutes.getCommittee, { params: { projectId, committeeId: committeeId! }, signal }),
    enabled: Boolean(committeeId) && can('governance.committee.read'),
  });
}

export function useMatrices(committeeId: string | null | undefined) {
  const { projectId, can } = useProjectContext();
  return useQuery({
    queryKey: gk.matrices(projectId, committeeId ?? ''),
    queryFn: ({ signal }) => api(governanceRoutes.listAuthorityMatrixVersions, { params: { projectId, committeeId: committeeId! }, signal }),
    enabled: Boolean(committeeId) && can('governance.committee.read'),
  });
}

/** Decision types of the approved matrix in force (for labels and the paper form). */
export function useDecisionTypes(committeeId: string | null | undefined): PolicyDecisionType[] {
  const m = useMatrices(committeeId);
  return useMemo(() => {
    const approved = m.data?.items.find((x) => x.status === 'approved');
    return ((approved?.policy as unknown as PolicyShape | undefined)?.decisionTypes ?? []) as PolicyDecisionType[];
  }, [m.data]);
}

export function useDecisionList(query: RouteQuery<typeof governanceRoutes.listDecisions>, enabled = true) {
  const { projectId, can } = useProjectContext();
  return useQuery({
    queryKey: gk.decisions(projectId, query),
    queryFn: ({ signal }) => api(governanceRoutes.listDecisions, { params: { projectId }, query, signal }),
    enabled: enabled && can('governance.decision.read'),
    placeholderData: (prev) => prev,
  });
}

export function useMeetingList(query: RouteQuery<typeof governanceRoutes.listMeetings>, enabled = true) {
  const { projectId, can } = useProjectContext();
  return useQuery({
    queryKey: gk.meetings(projectId, query),
    queryFn: ({ signal }) => api(governanceRoutes.listMeetings, { params: { projectId }, query, signal }),
    enabled: enabled && can('governance.meeting.read'),
    placeholderData: (prev) => prev,
  });
}

/** i18n key of an escalation source type ('other' is stored as `unspecified`: an `other` key marks plural groups). */
export function sourceKey(type: string): MessageKey {
  const known = ['decision', 'issue', 'risk', 'action_item', 'meeting', 'gate_definition'];
  return `governance.escalations.sources.${known.includes(type) ? type : 'unspecified'}` as MessageKey;
}

export function typeName(types: PolicyDecisionType[], key: string | null | undefined, locale: 'en' | 'ar'): string {
  if (!key) return EM_DASH;
  const t = types.find((x) => x.key === key);
  return t?.name?.[locale] ?? key;
}

// ---------------------------------------------------------------------------------------------------------------
// URL-backed list state (filters, search, page) so counts can link to pre-filtered lists and back/forward works.

export function useUrlState<K extends string>(keys: readonly K[]) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const values = useMemo(() => Object.fromEntries(keys.map((k) => [k, params.get(k) ?? ''])) as Record<K, string>, [params, keys]);
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);
  const set = useCallback(
    (patch: Partial<Record<K | 'page', string | number | null>>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined || v === '') next.delete(k);
        else next.set(k, String(v));
      }
      if (!('page' in patch)) next.delete('page');
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, router, pathname],
  );
  const clear = useCallback(() => router.replace(pathname, { scroll: false }), [router, pathname]);
  return { values, page, set, clear, active: keys.some((k) => values[k] !== '') };
}

export function FilterSelect({
  label,
  value,
  onChange,
  options,
  testId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  testId?: string;
}) {
  const { t } = useI18n();
  return (
    <label className="flex min-w-40 flex-col gap-1 text-sm font-medium text-ink">
      {label}
      <select className={cx(input, 'pe-8')} value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId}>
        <option value="">{t('governance.common.all')}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function FilterBar({ children, onClear, active }: { children: ReactNode; onClear: () => void; active: boolean }) {
  const { t } = useI18n();
  return (
    <div className="mb-4 flex flex-wrap items-end gap-3" role="group" aria-label={t('governance.common.filters')}>
      {children}
      {active ? (
        <button type="button" className="min-h-10 text-sm font-medium text-primary underline-offset-2 hover:underline" onClick={onClear}>
          {t('governance.common.clearFilters')}
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Command dialog: the shared ConfirmCommandDialog + the server's reason for a 403 on a visible record
// (e.g. separation of duties). The shared notice keeps the neutral headline; the reason is added here.

export function GovCommandDialog(props: ComponentProps<typeof ConfirmCommandDialog>) {
  const { t } = useI18n();
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => {
    if (props.open) setErr(null);
  }, [props.open]);
  const reason = isApiError(err) && err.status === 403 && err.detail ? err.detail : null;
  return (
    <ConfirmCommandDialog
      {...props}
      onConfirm={async (i) => {
        setErr(null);
        try {
          return await props.onConfirm(i);
        } catch (e) {
          setErr(e);
          throw e;
        }
      }}
    >
      {props.children}
      {reason ? (
        <p className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-ink" data-testid="policy-reason">
          <span className="font-semibold">{t('governance.common.policyReason')}: </span>
          <span dir="auto">{reason}</span>
        </p>
      ) : null}
    </ConfirmCommandDialog>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Sub-navigation

const TABS = [
  { key: 'overview', segment: '' },
  { key: 'meetings', segment: '/meetings' },
  { key: 'decisions', segment: '/decisions' },
  { key: 'actions', segment: '/actions' },
  { key: 'escalations', segment: '/escalations' },
] as const;

export function hubHref(projectId: string, segment = '') {
  return `/projects/${projectId}/committee${segment}`;
}

export function CommitteeTabs() {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const pathname = usePathname() ?? '';
  const base = hubHref(projectId);
  const active = (segment: string) =>
    segment === '' ? pathname === base || pathname.startsWith(`${base}/committees`) : pathname === `${base}${segment}` || pathname.startsWith(`${base}${segment}/`);
  return (
    <nav aria-label={t('governance.hub.tabs.label')} className="mb-5 overflow-x-auto border-b border-line" data-testid="committee-tabs">
      <ul className="flex min-w-max gap-1">
        {TABS.map((tab) => {
          const on = active(tab.segment);
          return (
            <li key={tab.key}>
              <Link
                href={`${base}${tab.segment}`}
                aria-current={on ? 'page' : undefined}
                className={cx(
                  'inline-flex min-h-10 items-center border-b-2 px-3 text-sm font-medium',
                  on ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-ink',
                )}
              >
                {t(`governance.hub.tabs.${tab.key}`)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Governance history (activity feed with translated governance actions)

const HISTORY_PAGE = 10;

export function auditLabelKey(action: string): MessageKey | null {
  if (!action.startsWith('governance.')) return null;
  return `governance.audit.${action.slice('governance.'.length).replace(/\./g, '_')}` as MessageKey;
}

export function GovHistory({ entityType, entityId, title, defaultOpen = false, className }: { entityType: string; entityId: string; title?: string; defaultOpen?: boolean; className?: string }) {
  const { t, formatDateTime, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const [open, setOpen] = useState(defaultOpen);
  const [page, setPage] = useState(1);
  const query = { page, pageSize: HISTORY_PAGE, entityType, entityId };
  const q = useQuery({
    queryKey: gk.history(projectId, query),
    queryFn: ({ signal }) => api(portfolioRoutes.auditTrail, { params: { projectId }, query, signal }),
    enabled: open,
    placeholderData: (prev) => prev,
  });
  const label = (action: string) => {
    const key = auditLabelKey(action);
    const text = key ? t(key) : null;
    return text && text !== key ? text : <code dir="ltr">{action}</code>;
  };
  return (
    <details className={cx(card, 'group', className)} open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)} data-testid="gov-history">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 font-semibold text-ink">
        <History aria-hidden="true" className="size-4 text-muted" />
        {title ?? t('governance.history.title')}
        <span className="ms-auto text-xs font-normal text-muted group-open:hidden">{t('common.activity.show')}</span>
        <span className="ms-auto hidden text-xs font-normal text-muted group-open:inline">{t('common.activity.hide')}</span>
      </summary>
      <div className="border-t border-line">
        {q.isLoading ? (
          <LoadingState compact />
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data || q.data.items.length === 0 ? (
          <EmptyState title={t('common.activity.empty')} />
        ) : (
          <>
            <ol className="divide-y divide-line">
              {q.data.items.map((e) => (
                <li key={e.id} className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-start sm:gap-4" data-action={e.action}>
                  <time dateTime={e.at} className="tabular shrink-0 text-muted sm:w-44">
                    {formatDateTime(e.at)}
                  </time>
                  <div className="min-w-0 flex-1">
                    <p className="text-ink">
                      <span className="font-medium" dir="auto">
                        {e.actor ?? tStatus('actorKinds', e.actorKind)}
                      </span>{' '}
                      — {label(e.action)}
                    </p>
                    {e.reason ? (
                      <p className="mt-0.5 text-muted">
                        {t('common.activity.reason')}: <span dir="auto">{e.reason}</span>
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
            <div className="border-t border-line px-4 py-2">
              <Pagination page={page} pageSize={HISTORY_PAGE} total={q.data.total} onPageChange={setPage} />
            </div>
          </>
        )}
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Small presentational helpers

export function Section({ id, title, actions, children, className, description }: { id: string; title: string; actions?: ReactNode; children: ReactNode; className?: string; description?: ReactNode }) {
  return (
    <section aria-labelledby={id} className={cx('space-y-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="text-lg font-semibold text-ink">
          {title}
        </h2>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {description ? <div className="text-sm text-muted">{description}</div> : null}
      {children}
    </section>
  );
}

export function Facts({ items }: { items: { label: string; value: ReactNode; wide?: boolean; testId?: string }[] }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {items.map((i) => (
        <div key={i.label} className={i.wide ? 'sm:col-span-2' : undefined} data-testid={i.testId}>
          <dt className="text-sm text-muted">{i.label}</dt>
          <dd className="text-sm break-words text-ink">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** User-entered text: direction follows the content; empty renders an em dash. */
export function UText({ value, multiline = false }: { value: string | null | undefined; multiline?: boolean }) {
  if (!value) return <span className="text-muted">{EM_DASH}</span>;
  return (
    <span dir="auto" className={multiline ? 'whitespace-pre-wrap' : undefined}>
      {value}
    </span>
  );
}

export function Money({ value }: { value: { amount: string; currency: string; unitScale: number } | null | undefined }) {
  const { t } = useI18n();
  if (!value) return <span className="text-muted">{EM_DASH}</span>;
  const unit = value.unitScale === 1 ? '' : ` × ${t(`governance.paper.units.${value.unitScale as 1000 | 1000000}`)}`;
  return (
    <span dir="ltr" className="tabular">
      {value.amount} {value.currency}
      {unit}
    </span>
  );
}

export function ButtonRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

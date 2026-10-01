'use client';

import Link from 'next/link';
import { ChevronRight, Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { DataTable } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { StatusBadge } from '@/components/StatusBadge';
import { btn, card, cx } from '@/components/ui';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { isApiError } from '@/lib/api';
import { baselineHref, useBaselines } from '@/lib/planning';
import { useProjectContext } from '@/lib/project-context';
import { useCommitteeList, type Committee } from '../../committee/_components/gov';

/** A part the caller's roles do not cover: never requested, no count, no title (REQ-UX-022). */
function Restricted({ testId }: { testId: string }) {
  const { t } = useI18n();
  return (
    <p className="flex items-start gap-2 text-sm text-muted" data-testid={testId}>
      <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      {t('project.overview.restricted')}
    </p>
  );
}

function Panel({ id, title, hint, children, testId, state }: { id: string; title: string; hint: string; children: ReactNode; testId: string; state: string }) {
  return (
    <section aria-labelledby={id} className={cx(card, 'flex min-w-0 flex-col gap-3 p-4')} data-testid={testId} data-state={state}>
      <div>
        <h3 id={id} className="font-semibold">
          {title}
        </h3>
        <p className="mt-1 text-xs text-muted">{hint}</p>
      </div>
      {children}
    </section>
  );
}

type CharterState = 'approved' | 'amendment_pending' | 'not_approved';
const charterState = (c: Committee): CharterState =>
  c.charterApprovedVersionNo === null ? 'not_approved' : c.charterApprovedVersionNo < c.charterVersionNo ? 'amendment_pending' : 'approved';

/**
 * Committee charters of the project (REQ-UX-006): each committee's current charter version and its approval state, from
 * the committee register (classification applied by the API). Shows an explicit "none yet" state and a restricted state
 * for callers without governance read access (the list is then not requested).
 */
export function CommitteeCharters() {
  const { t, tStatus, formatDateTime } = useI18n();
  const { projectId, can } = useProjectContext();
  const allowed = can('governance.committee.read');
  const list = useCommitteeList(allowed);
  const hidden = isApiError(list.error) && (list.error.isHidden || list.error.isForbidden);
  const items = list.data?.items ?? [];
  const state = !allowed || hidden ? 'restricted' : list.isLoading ? 'loading' : list.error ? 'error' : items.length === 0 ? 'none' : 'ready';
  const hub = `/projects/${projectId}/committee`;
  let body: ReactNode;
  if (state === 'restricted') body = <Restricted testId="overview-committees-restricted" />;
  else if (state === 'loading') body = <LoadingState compact />;
  else if (state === 'error') body = <ErrorState error={list.error} onRetry={() => list.refetch()} />;
  else if (state === 'none')
    body = (
      <div data-testid="overview-committees-none">
        <EmptyState title={t('project.overview.committees.none')} hint={t('project.overview.committees.noneHint')} />
        {can('governance.committee.manage') ? (
          <Link href={`/projects/${projectId}/setup?step=committee`} className={cx(btn.link, 'text-sm')} data-testid="overview-setup-committee">
            {t('project.overview.committees.setUp')}
          </Link>
        ) : null}
      </div>
    );
  else
    body = (
      <DataTable
        caption={t('project.overview.committees.title')}
        rows={items}
        rowKey={(c) => c.id}
        emptyTitle={t('project.overview.committees.none')}
        testId="overview-committees-table"
        columns={[
          {
            key: 'name',
            header: t('project.overview.committees.name'),
            isRowHeader: true,
            cell: (c) => (
              <span className="flex flex-wrap items-center gap-1.5">
                <Link href={`${hub}/committees/${c.id}`} className="font-medium text-primary hover:underline" dir="auto">
                  {c.name}
                </Link>
                {c.isDemo ? <DemoBadge /> : null}
                <span className="block w-full text-xs text-muted">{tStatus('committeeKinds', c.kind)}</span>
              </span>
            ),
          },
          { key: 'status', header: t('project.overview.committees.status'), cell: (c) => <StatusBadge enumName="committeeStatuses" value={c.status} /> },
          {
            key: 'charter',
            header: t('project.overview.committees.charter'),
            cell: (c) => {
              const s = charterState(c);
              return (
                <span
                  className="flex flex-col items-start gap-1"
                  data-testid="overview-committee-charter"
                  data-committee-kind={c.kind}
                  data-charter-version={c.charterVersionNo}
                  data-charter-approved-version={c.charterApprovedVersionNo ?? undefined}
                  data-charter-state={s}
                >
                  <span className="tabular font-medium">{t('project.overview.committees.version', { version: c.charterVersionNo })}</span>
                  <StatusBadge
                    enumName="committeeStatuses"
                    value={s}
                    tone={s === 'approved' ? 'success' : 'warning'}
                    label={
                      s === 'approved'
                        ? t('project.overview.committees.approved')
                        : s === 'amendment_pending'
                          ? t('project.overview.committees.amendmentPending', { approved: c.charterApprovedVersionNo ?? 0 })
                          : t('project.overview.committees.notApproved')
                    }
                  />
                  {c.charterApprovedAt ? <span className="text-xs text-muted">{t('project.overview.committees.approvedAt', { date: formatDateTime(c.charterApprovedAt) })}</span> : null}
                </span>
              );
            },
          },
        ]}
      />
    );
  return (
    <Panel id="overview-committees-title" title={t('project.overview.committees.title')} hint={t('project.overview.committees.hint')} testId="overview-committees" state={state}>
      {body}
      {allowed ? (
        <Link href={hub} className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
          {t('project.overview.committees.open')}
          <ChevronRight aria-hidden="true" className="size-4 rtl:rotate-180" />
        </Link>
      ) : null}
    </Panel>
  );
}

function Fact({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-5 sm:gap-3">
      <dt className="text-sm text-muted sm:col-span-2">{label}</dt>
      <dd className="text-sm text-ink sm:col-span-3" data-testid={testId}>
        {children}
      </dd>
    </div>
  );
}

/**
 * The approved baseline (REQ-UX-006): version, approval date, approver and the project role(s) the approver held at the
 * approval time, the basis of the approval, and a pending proposal if any — or an explicit "no approved baseline yet".
 */
export function ApprovedBaseline() {
  const { t, tStatus, formatDateTime, formatNumber, formatList } = useI18n();
  const { projectId, can } = useProjectContext();
  const allowed = can('planning.plan.read');
  const q = useBaselines(projectId, allowed);
  const hidden = isApiError(q.error) && (q.error.isHidden || q.error.isForbidden);
  const items = q.data?.items ?? [];
  const approved = items.find((b) => b.status === 'approved') ?? null;
  const pending = items.find((b) => b.status === 'proposed') ?? null;
  const state = !allowed || hidden ? 'restricted' : q.isLoading ? 'loading' : q.error ? 'error' : approved ? 'approved' : 'none';
  let body: ReactNode;
  if (state === 'restricted') body = <Restricted testId="overview-baseline-restricted" />;
  else if (state === 'loading') body = <LoadingState compact />;
  else if (state === 'error') body = <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  else if (!approved)
    body = (
      <div data-testid="overview-baseline-none">
        <EmptyState title={t('project.overview.baseline.none')} hint={t('project.overview.baseline.noneHint')} />
        {!pending && can('planning.baseline.propose') ? (
          <Link href={`/projects/${projectId}/setup?step=baseline`} className={cx(btn.link, 'text-sm')} data-testid="overview-setup-baseline">
            {t('project.overview.baseline.setUp')}
          </Link>
        ) : null}
      </div>
    );
  else
    body = (
      <dl className="space-y-2">
        <Fact label={t('project.overview.baseline.version')} testId="overview-baseline-version">
          <Link href={baselineHref(projectId, approved.id)} className="tabular font-medium text-primary hover:underline" data-version={approved.versionNo}>
            {t('project.overview.baseline.versionValue', { version: approved.versionNo })}
          </Link>{' '}
          <StatusBadge enumName="baselineStatuses" value={approved.status} />
        </Fact>
        <Fact label={t('project.overview.baseline.approvedAt')} testId="overview-baseline-approved-at">
          <span className="tabular">{formatDateTime(approved.approvedAt)}</span>
        </Fact>
        <Fact label={t('project.overview.baseline.approver')} testId="overview-baseline-approver">
          <span dir="auto">{approved.approvedByName ?? EM_DASH}</span>
        </Fact>
        <Fact label={t('project.overview.baseline.approverRole')} testId="overview-baseline-approver-roles">
          <span data-roles={approved.approverRoles.join(',')}>
            {approved.approverRoles.length > 0 ? formatList(approved.approverRoles.map((r) => tStatus('roleKeys', r))) : t('project.overview.baseline.noRole')}
          </span>
        </Fact>
        <Fact label={t('project.overview.baseline.basis')}>
          {approved.decisionId ? (
            <Link href={`/projects/${projectId}/committee/decisions/${approved.decisionId}`} className={btn.link}>
              {t('project.overview.baseline.basisDecision')}
            </Link>
          ) : (
            t('project.overview.baseline.basisDelegated')
          )}
        </Fact>
        <Fact label={t('project.overview.baseline.scope')}>
          {t('project.overview.baseline.scopeValue', { tasks: formatNumber(approved.counts.tasks), milestones: formatNumber(approved.counts.milestones), deliverables: formatNumber(approved.counts.deliverables) })}
        </Fact>
      </dl>
    );
  return (
    <Panel id="overview-baseline-title" title={t('project.overview.baseline.title')} hint={t('project.overview.baseline.hint')} testId="overview-baseline" state={state}>
      {body}
      {pending && allowed ? (
        <p className="rounded-md border border-info/40 bg-info-soft p-2 text-sm text-ink" data-testid="overview-baseline-pending" data-version={pending.versionNo}>
          {t('project.overview.baseline.pending', { version: pending.versionNo, date: formatDateTime(pending.createdAt), name: pending.proposedByName ?? EM_DASH })}{' '}
          <Link href={baselineHref(projectId, pending.id)} className={btn.link}>
            {t('project.overview.baseline.openPending')}
          </Link>
        </p>
      ) : null}
      {allowed && !hidden ? (
        <Link href={`/projects/${projectId}/plan?tab=baselines`} className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
          {t('project.overview.baseline.open')}
          <ChevronRight aria-hidden="true" className="size-4 rtl:rotate-180" />
        </Link>
      ) : null}
    </Panel>
  );
}

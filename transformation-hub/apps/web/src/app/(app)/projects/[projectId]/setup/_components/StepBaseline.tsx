'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { planningRoutes as P } from '@hub/contracts';
import { MILESTONE_STATUSES, TASK_STATUSES } from '@hub/domain';
import { ConfirmCommandDialog } from '@/components/ConfirmCommandDialog';
import { DataTable } from '@/components/DataTable';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { RestrictedState } from '@/components/RestrictedState';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn, card, cx } from '@/components/ui';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api, isApiError } from '@/lib/api';
import { useGates } from '@/lib/gates';
import { useLocalized } from '@/lib/i18n-data';
import { baselineHref, pk, useBaselines, useRefreshPlanning } from '@/lib/planning';
import { useProjectContext } from '@/lib/project-context';
import { GateStatusBadges } from '../../gates/_components/GateBits';

/** Statuses a baseline freezes (change-control buildSnapshot): confirmed tasks — not Draft or cancelled — and every milestone not cancelled. */
const FROZEN_TASK_STATUSES = TASK_STATUSES.filter((s) => s !== 'draft' && s !== 'cancelled').join(',');
const FROZEN_MILESTONE_STATUSES = MILESTONE_STATUSES.filter((s) => s !== 'cancelled').join(',');

function Block({ id, title, hint, children, testId, actions }: { id: string; title: string; hint?: string; children: ReactNode; testId?: string; actions?: ReactNode }) {
  return (
    <section aria-labelledby={id} className={cx(card, 'space-y-3 p-4')} data-testid={testId}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={id} className="font-semibold">
            {title}
          </h3>
          {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function BaselineBlock() {
  const { t, formatDateTime, formatNumber } = useI18n();
  const { projectId, can } = useProjectContext();
  const refresh = useRefreshPlanning(projectId);
  const toast = useToast();
  const allowed = can('planning.plan.read');
  const canPropose = can('planning.baseline.propose');
  const q = useBaselines(projectId, allowed);
  const items = q.data?.items ?? [];
  const approved = items.find((b) => b.status === 'approved') ?? null;
  const pending = items.find((b) => b.status === 'proposed') ?? null;
  const showPreview = allowed && !approved && !pending && !!q.data;
  const tasks = useQuery({
    queryKey: pk.tasks(projectId, { setupPreview: true }),
    queryFn: ({ signal }) => api(P.listTasks, { params: { projectId }, query: { page: 1, pageSize: 1, status: FROZEN_TASK_STATUSES as never }, signal }),
    enabled: showPreview,
  });
  const milestones = useQuery({
    queryKey: pk.milestones(projectId, { setupPreview: true }),
    queryFn: ({ signal }) => api(P.listMilestones, { params: { projectId }, query: { page: 1, pageSize: 1, status: FROZEN_MILESTONE_STATUSES as never }, signal }),
    enabled: showPreview,
  });
  const [open, setOpen] = useState(false);
  const nextVersion = Math.max(0, ...items.map((b) => b.versionNo)) + 1;
  const nTasks = tasks.data?.total;
  const nMilestones = milestones.data?.total;
  const nothing = nTasks === 0 && nMilestones === 0;

  let body: ReactNode;
  if (!allowed || (isApiError(q.error) && (q.error.isHidden || q.error.isForbidden))) body = <RestrictedState showHomeLink={false} />;
  else if (q.isLoading) body = <LoadingState compact />;
  else if (q.error) body = <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  else if (pending)
    body = (
      <div className="space-y-2" data-testid="wizard-baseline-status" data-status={pending.status} data-version={pending.versionNo}>
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{t('project.overview.baseline.versionValue', { version: pending.versionNo })}</span>
          <StatusBadge enumName="baselineStatuses" value={pending.status} label={t('project.setupWizard.baseline.proposedLabel')} />
        </p>
        <p className="text-sm text-ink">{t('project.setupWizard.baseline.pending', { date: formatDateTime(pending.createdAt), name: pending.proposedByName ?? EM_DASH })}</p>
        <p className="text-xs text-muted">
          {t('project.setupWizard.baseline.frozen', { tasks: formatNumber(pending.counts.tasks), milestones: formatNumber(pending.counts.milestones), deliverables: formatNumber(pending.counts.deliverables) })}
        </p>
        <Link href={baselineHref(projectId, pending.id)} className={cx(btn.link, 'text-sm')} data-testid="wizard-baseline-open">
          {t('project.setupWizard.baseline.openProposal')}
        </Link>
      </div>
    );
  else if (approved)
    body = (
      <div className="space-y-2" data-testid="wizard-baseline-status" data-status={approved.status} data-version={approved.versionNo}>
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{t('project.overview.baseline.versionValue', { version: approved.versionNo })}</span>
          <StatusBadge enumName="baselineStatuses" value={approved.status} />
          <span className="text-muted">{t('project.overview.committees.approvedAt', { date: formatDateTime(approved.approvedAt) })}</span>
        </p>
        <p className="text-sm text-muted">{t('project.setupWizard.baseline.rebaseline')}</p>
        <Link href={`/projects/${projectId}/raid?tab=changes`} className={cx(btn.link, 'text-sm')}>
          {t('project.setupWizard.baseline.openChanges')}
        </Link>
      </div>
    );
  else
    body = (
      <div className="space-y-3" data-testid="wizard-baseline-status" data-status="none">
        <p className="text-sm font-medium">{t('project.overview.baseline.none')}</p>
        {tasks.isLoading || milestones.isLoading ? (
          <LoadingState compact />
        ) : tasks.error || milestones.error ? (
          <ErrorState error={tasks.error ?? milestones.error} onRetry={() => void Promise.all([tasks.refetch(), milestones.refetch()])} />
        ) : (
          <p className="text-sm text-ink" data-testid="wizard-baseline-preview" data-tasks={nTasks} data-milestones={nMilestones}>
            {t('project.setupWizard.baseline.preview', { tasks: formatNumber(nTasks ?? 0), milestones: formatNumber(nMilestones ?? 0) })}
          </p>
        )}
        {nothing ? (
          <p className="text-sm text-warning">
            {t('project.setupWizard.baseline.nothing')}{' '}
            <Link href={`/projects/${projectId}/plan?tab=wbs`} className={btn.link}>
              {t('project.setupWizard.baseline.openWbs')}
            </Link>
          </p>
        ) : null}
        {canPropose ? (
          <button type="button" className={btn.primary} onClick={() => setOpen(true)} disabled={nothing || nTasks === undefined} data-testid="wizard-baseline-propose">
            {t('project.setupWizard.baseline.propose')}
          </button>
        ) : (
          <p className="text-sm text-muted">{t('project.setupWizard.baseline.cannotPropose')}</p>
        )}
      </div>
    );

  return (
    <Block id="wizard-baseline-title" title={t('project.setupWizard.baseline.baselineTitle')} hint={t('project.setupWizard.baseline.baselineHint')} testId="wizard-baseline">
      {body}
      <ConfirmCommandDialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('project.setupWizard.baseline.propose')}
        confirmLabel={t('project.setupWizard.baseline.propose')}
        noteMode="optional"
        consequences={[
          t('project.setupWizard.baseline.proposeEffect', { version: nextVersion, tasks: formatNumber(nTasks ?? 0), milestones: formatNumber(nMilestones ?? 0) }),
          t('project.setupWizard.baseline.notApproved'),
          t('common.command.audited'),
        ]}
        onConfirm={async ({ note }) => {
          const r = await api(P.proposeBaseline, { params: { projectId }, body: note ? { note } : {} });
          await refresh();
          toast.show('success', t('project.setupWizard.baseline.proposed', { version: r.versionNo }));
          setOpen(false);
        }}
      />
    </Block>
  );
}

function GatesBlock() {
  const { t, tStatus, formatNumber } = useI18n();
  const loc = useLocalized();
  const { projectId, can } = useProjectContext();
  const allowed = can('gates.gate.read');
  const gates = useGates(projectId, allowed);
  const rows = gates.data ? [...gates.data.items].sort((a, b) => a.sortOrder - b.sortOrder) : undefined;
  return (
    <Block
      id="wizard-gates-title"
      title={t('project.setupWizard.baseline.gatesTitle')}
      hint={t('project.setupWizard.baseline.gatesHint')}
      testId="wizard-gates"
      actions={
        allowed ? (
          <Link href={`/projects/${projectId}/gates`} className={cx(btn.link, 'text-sm')}>
            {t('project.setupWizard.baseline.openGates')}
          </Link>
        ) : null
      }
    >
      {!allowed ? (
        <RestrictedState showHomeLink={false} />
      ) : (
        <DataTable
          caption={t('project.setupWizard.baseline.gatesTitle')}
          rows={rows}
          rowKey={(g) => g.id}
          isLoading={gates.isLoading}
          error={gates.error}
          onRetry={() => gates.refetch()}
          emptyTitle={t('project.cockpit.gate.noGates')}
          testId="wizard-gates-table"
          columns={[
            {
              key: 'gate',
              header: t('project.setupWizard.baseline.gate'),
              isRowHeader: true,
              cell: (g) => (
                <Link href={`/projects/${projectId}/gates/${g.id}`} className="font-medium text-primary hover:underline" data-testid="wizard-gate" data-gate-key={g.key}>
                  <span dir="ltr">{g.key}</span> — <span dir="auto">{loc(g.name, g.nameAr)}</span>
                </Link>
              ),
            },
            { key: 'status', header: t('project.setupWizard.baseline.gateStatus'), cell: (g) => <GateStatusBadges gate={g} /> },
            { key: 'approver', header: t('project.setupWizard.baseline.gateApprover'), cell: (g) => tStatus('roleKeys', g.approverRole) },
            {
              key: 'blockers',
              header: t('project.setupWizard.baseline.gateBlockers'),
              cell: (g) => <span className={cx('tabular', g.blockers.length > 0 && 'font-medium text-danger')}>{formatNumber(g.blockers.length)}</span>,
            },
          ]}
        />
      )}
    </Block>
  );
}

/**
 * Setup wizard step 6 — baseline and gates (REQ-SET-014): propose the plan's first baseline (a frozen snapshot that is
 * NOT approved — the authorized approver approves it on the Integrated Plan) and review the gate list with each gate's
 * status, approver role and open blockers. Nothing is approved here.
 */
export function StepBaseline() {
  const { t } = useI18n();
  return (
    <div className="space-y-4" data-testid="wizard-step-baseline">
      <div>
        <h2 className="text-lg font-semibold">{t('project.setupWizard.baseline.title')}</h2>
        <p className="mt-1 text-sm text-muted">{t('project.setupWizard.baseline.hint')}</p>
      </div>
      <BaselineBlock />
      <GatesBlock />
    </div>
  );
}

'use client';

import Link from 'next/link';
import { ChevronLeft, Pencil, TrendingUp, UserCog } from 'lucide-react';
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
import { VerificationBadge } from '@/components/VerificationBadge';
import { btn, cx } from '@/components/ui';
import { CommandBar } from '@/components/planning/CommandBar';
import { useTaskCommands } from '@/components/planning/commands';
import { DateText, Fact, ProgressBar, Section } from '@/components/planning/bits';
import { OwnerDialog, ProgressDialog, TaskFormDialog } from '@/components/planning/dialogs';
import { NodeDependencies, RaciPanel } from '@/components/planning/RaciPanel';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { useRefreshPlanning, useTask, workstreamHref } from '@/lib/planning';
import { useProjectContext } from '@/lib/project-context';
import { LocalizedText } from '@/components/LocalizedText';

export default function TaskPage() {
  const { t, tStatus, formatNumber, formatDateTime, locale } = useI18n();
  const { taskId } = useParams<{ taskId: string }>();
  const { projectId, can } = useProjectContext();
  const q = useTask(projectId, taskId);
  const refresh = useRefreshPlanning(projectId);
  const commands = useTaskCommands(q.data);
  const [edit, setEdit] = useState(false);
  const [progress, setProgress] = useState(false);
  const [owner, setOwner] = useState(false);

  if (q.isLoading) return <LoadingState />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const x = q.data;
  const closed = ['accepted', 'done', 'cancelled'].includes(x.status);
  const canProgress = can('planning.task.update_progress') && ['not_started', 'in_progress', 'blocked', 'submitted_for_acceptance'].includes(x.status);
  const canOwner = can(x.accountableUserId ? 'planning.ownership.reassign' : 'planning.task.manage');
  const title = locale === 'ar' && x.titleAr ? x.titleAr : x.title;

  return (
    <SectionGuard section="plan">
      <Link href={`/projects/${projectId}/plan?tab=wbs`} className={cx(btn.link, 'mb-3 inline-flex items-center gap-1 text-sm')}>
        <ChevronLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
        {t('planning.plan.back')}
      </Link>
      <PageHeader
        eyebrow={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span dir="ltr">{x.wbsCode}</span>
            {x.workstreamId ? (
              <Link href={workstreamHref(projectId, x.workstreamId, 'tasks')} className={btn.link} dir="ltr">
                {x.workstreamCode}
              </Link>
            ) : null}
          </span>
        }
        title={<LocalizedText text={x.title} textAr={x.titleAr} />}
        documentTitle={`${x.wbsCode} — ${title}`}
        badges={
          <>
            <StatusBadge enumName="taskStatuses" value={x.status} size="md" />
            <VerificationBadge value={x.verificationStatus} />
            {x.overdue ? <StatusBadge enumName="ragStatuses" value="red" tone="danger" label={t('planning.common.overdue')} /> : null}
            {x.isDemo ? <DemoBadge /> : null}
          </>
        }
        actions={
          <>
            {canProgress ? (
              <button type="button" className={btn.secondary} onClick={() => setProgress(true)} data-testid="task-progress">
                <TrendingUp aria-hidden="true" className="size-4" />
                {t('planning.task.progressAction')}
              </button>
            ) : null}
            {can('planning.task.manage') && !closed ? (
              <button type="button" className={btn.secondary} onClick={() => setEdit(true)} data-testid="task-edit">
                <Pencil aria-hidden="true" className="size-4" />
                {t('planning.common.edit')}
              </button>
            ) : null}
            {canOwner ? (
              <button type="button" className={btn.secondary} onClick={() => setOwner(true)} data-testid="task-owner">
                <UserCog aria-hidden="true" className="size-4" />
                {t('planning.owner.assign')}
              </button>
            ) : null}
          </>
        }
      />
      <CommandBar className="mb-6" commands={commands} allowed={x.allowedCommands} expectedVersion={x.version} onDone={refresh} onReload={() => void q.refetch()} />
      {x.status === 'draft' ? <p className="mb-4 rounded-md border border-info/30 bg-info-soft p-3 text-sm text-info">{t('planning.task.draftNotice')}</p> : null}
      {x.status === 'blocked' && x.blockedReason ? (
        <p className="mb-4 rounded-md border border-danger/30 bg-danger-soft p-3 text-sm text-danger" role="note">
          <strong>{t('planning.task.blockedReason')}:</strong> <span dir="auto">{x.blockedReason}</span>
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section id="t-progress" title={t('planning.task.progressSection')} hint={t('planning.task.progressHint')}>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-muted">{t('planning.task.reported')}</p>
              <ProgressBar percent={x.reportedProgress} label={t('planning.task.reported')} />
            </div>
            <div>
              <p className="text-xs text-muted">{t('planning.task.verified')}</p>
              <ProgressBar percent={x.verifiedProgress} label={t('planning.task.verified')} />
            </div>
            <dl className="grid gap-3 sm:grid-cols-2">
              <Fact label={t('planning.task.requiresAcceptance')}>{x.requiresAcceptance ? t('planning.common.yes') : t('planning.common.no')}</Fact>
              <Fact label={t('planning.common.evidence')}>{t('planning.task.evidenceCount', { count: formatNumber(x.evidenceCount) })}</Fact>
              <Fact label={t('planning.task.acceptedAt')}>{x.acceptedAt ? formatDateTime(x.acceptedAt) : EM_DASH}</Fact>
            </dl>
          </div>
        </Section>
        <Section id="t-plan" title={t('planning.task.planSection')}>
          <dl className="grid gap-3 sm:grid-cols-3">
            <Fact label={t('planning.task.duration')}>{x.durationDays === null ? t('planning.task.tbd') : formatNumber(x.durationDays)}</Fact>
            <Fact label={t('planning.task.durationBasis')}>{x.durationBasis ?? EM_DASH}</Fact>
            <Fact label={t('planning.common.gate')}>
              <span dir="ltr">{x.gateKey ?? EM_DASH}</span>
            </Fact>
            <Fact label={t('planning.task.plannedStart')}>
              <DateText value={x.plannedStart} />
            </Fact>
            <Fact label={t('planning.task.plannedFinish')}>
              <DateText value={x.plannedFinish} overdue={x.overdue} />
            </Fact>
            <Fact label={t('planning.common.weight')}>{formatNumber(x.weight)}</Fact>
            <Fact label={t('planning.task.forecastStart')}>
              <DateText value={x.forecastStart} />
            </Fact>
            <Fact label={t('planning.task.forecastFinish')}>
              <DateText value={x.forecastFinish} />
            </Fact>
            <Fact label={t('planning.task.whatIf')}>
              <Link className={btn.link} href={`/projects/${projectId}/plan?tab=whatif&node=${x.id}`}>
                {t('planning.task.whatIfLink')}
              </Link>
            </Fact>
            <Fact label={t('planning.task.actualStart')}>
              <DateText value={x.actualStart} />
            </Fact>
            <Fact label={t('planning.task.actualFinish')}>
              <DateText value={x.actualFinish} />
            </Fact>
          </dl>
        </Section>
        <Section id="t-owner" title={t('planning.task.ownerSection')}>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Fact label={t('planning.common.accountable')}>{x.accountableName ? <span dir="auto">{x.accountableName}</span> : <span className="text-muted">{t('planning.common.unassigned')}</span>}</Fact>
            <Fact label={t('planning.task.proposedFunction')}>
              <span dir="auto">{x.proposedOwnerFunction ?? EM_DASH}</span>
            </Fact>
            <Fact label={t('planning.task.approverRole')}>{x.approverRole ? tStatus('roleKeys', x.approverRole) : EM_DASH}</Fact>
            <Fact label={t('planning.task.evidenceType')}>{x.evidenceType ?? EM_DASH}</Fact>
          </dl>
        </Section>
        <Section id="t-def" title={t('planning.task.definitionSection')}>
          <dl className="grid gap-3">
            <Fact label={t('planning.task.description')} wide>
              <span dir="auto">{x.description ?? EM_DASH}</span>
            </Fact>
            <Fact label={t('planning.task.output')} wide>
              <span dir="auto">{x.output ?? EM_DASH}</span>
            </Fact>
            <Fact label={t('planning.task.acceptanceCriteria')} wide>
              <span dir="auto">{x.acceptanceCriteria ?? EM_DASH}</span>
            </Fact>
            <Fact label={t('planning.task.effort')}>{x.effort ?? EM_DASH}</Fact>
          </dl>
        </Section>
        <RaciPanel entityType="task" entityId={x.id} />
        <NodeDependencies nodeId={x.id} />
      </div>
      <ActivityHistory className="mt-6" projectId={projectId} entityType="task" entityId={x.id} />

      <TaskFormDialog open={edit} onClose={() => setEdit(false)} task={x} />
      <ProgressDialog open={progress} onClose={() => setProgress(false)} task={x} />
      <OwnerDialog
        open={owner}
        onClose={() => setOwner(false)}
        title={t('planning.owner.title', { code: x.wbsCode })}
        current={x.accountableName}
        version={x.version}
        run={(userId, reason) => api(P.assignTaskOwner, { params: { projectId, taskId: x.id }, body: { expectedVersion: x.version, userId, reason } })}
      />
    </SectionGuard>
  );
}

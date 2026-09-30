'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Gavel } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { planningRoutes as P } from '@hub/contracts';
import { ActivityHistory } from '@/components/ActivityHistory';
import { DataTable } from '@/components/DataTable';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { SectionGuard } from '@/components/SectionGuard';
import { StatusBadge } from '@/components/StatusBadge';
import { btn } from '@/components/ui';
import { CommandBar, type CommandSpec } from '@/components/planning/CommandBar';
import { approvalDecisionExtra } from '@/components/planning/commands';
import { BackLink, Notice } from '@/components/planning/DetailShell';
import { DateText, Fact, Section } from '@/components/planning/bits';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { changeRequestHref, pk, taskHref, useRefreshPlanning } from '@/lib/planning';
import { useProjectContext } from '@/lib/project-context';
import { DecisionPaperDialog } from '../../../committee/_components/dialogs';

type Snap = { id: string; wbsCode: string; status: string; durationDays: number | null; plannedStart: string | null; plannedFinish: string | null };

export default function BaselinePage() {
  const { t, formatDateTime, formatNumber } = useI18n();
  const { baselineId } = useParams<{ baselineId: string }>();
  const { projectId, me, can } = useProjectContext();
  const refresh = useRefreshPlanning(projectId);
  const router = useRouter();
  const [paper, setPaper] = useState(false);
  const paperSubject = useMemo(() => ({ type: 'baseline_version' as const, id: baselineId }), [baselineId]);
  const q = useQuery({ queryKey: pk.baseline(projectId, baselineId), queryFn: ({ signal }) => api(P.getBaseline, { params: { projectId, baselineId }, signal }) });
  if (q.isLoading) return <LoadingState />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const b = q.data;
  const mine = b.proposedBy === me.user.id;
  const commands: CommandSpec[] = [
    {
      key: 'approve',
      label: t('planning.baseline.approve'),
      effects: [t('planning.baseline.approveEffect', { version: b.versionNo }), t('planning.baseline.approveWeights'), t('planning.baseline.approveAmount'), t('planning.commands.approvalAuthority'), t('planning.commands.notSelf')],
      permission: 'planning.baseline.approve',
      noteMode: 'optional',
      primary: true,
      hidden: mine,
      extra: approvalDecisionExtra('baseline_approval', { subjectType: 'baseline_version', subjectId: b.id }),
      run: ({ note, expectedVersion, extra }) => api(P.approveBaseline, { params: { projectId, baselineId }, body: { expectedVersion, note: note || undefined, decisionId: extra || undefined } }),
    },
    { key: 'reject', label: t('planning.baseline.reject'), effects: [t('planning.baseline.rejectEffect')], permission: 'planning.baseline.approve', noteMode: 'required', noteLabel: t('planning.common.reason'), danger: true, hidden: mine, run: ({ note, expectedVersion }) => api(P.rejectBaseline, { params: { projectId, baselineId }, body: { expectedVersion, reason: note } }) },
  ];
  const s = b.snapshot;
  return (
    <SectionGuard section="plan">
      <BackLink href={`/projects/${projectId}/plan?tab=baselines`} label={t('planning.baseline.back')} />
      <PageHeader
        title={t('planning.baseline.titleV', { version: b.versionNo })}
        badges={<StatusBadge enumName="baselineStatuses" value={b.status} size="md" />}
        description={b.note ? <span dir="auto">{b.note}</span> : null}
        actions={
          b.status === 'proposed' && can('governance.decision.draft') ? (
            // DOM-P2R-03: a committee paper raised FOR this baseline version (subject pre-selected).
            <button type="button" className={btn.secondary} onClick={() => setPaper(true)} data-testid="baseline-raise-paper">
              <Gavel aria-hidden="true" className="size-4" />
              {t('planning.baseline.raisePaper')}
            </button>
          ) : null
        }
      />
      <DecisionPaperDialog open={paper} onClose={() => setPaper(false)} decision={null} defaultSubject={paperSubject} onCreated={(id) => router.push(`/projects/${projectId}/committee/decisions/${id}`)} />
      {b.status === 'proposed' && mine ? <Notice tone="info">{t('planning.baseline.selfNotice')}</Notice> : null}
      <CommandBar className="mb-6" commands={commands} allowed={b.status === 'proposed' ? ['approve', 'reject'] : []} expectedVersion={b.version} onDone={refresh} onReload={() => void q.refetch()} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Section id="b-facts" title={t('planning.baseline.facts')} hint={t('planning.baseline.frozenHint')}>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Fact label={t('planning.baseline.proposedBy')}>
              <span dir="auto">{b.proposedByName ?? EM_DASH}</span>
            </Fact>
            <Fact label={t('planning.baseline.createdAt')}>{formatDateTime(b.createdAt)}</Fact>
            <Fact label={t('planning.baseline.approvedAt')}>{formatDateTime(b.approvedAt)}</Fact>
            <Fact label={t('planning.baseline.rejectedAt')}>{formatDateTime(b.rejectedAt)}</Fact>
            <Fact label={t('planning.baseline.hash')} wide>
              <code dir="ltr" className="text-xs break-all">
                {b.snapshotHash}
              </code>
            </Fact>
            <Fact label={t('planning.baseline.projectStart')}>
              <DateText value={s.projectStart} />
            </Fact>
            <Fact label={t('planning.baseline.scheduleAtProposal')}>
              {t(`planning.schedule.status_${s.schedule.status as 'complete'}`)} {s.schedule.projectFinish ? `· ${s.schedule.projectFinish}` : ''}
            </Fact>
            <Fact label={t('planning.baseline.changeRequest')}>
              {b.changeRequestId ? (
                <Link className={btn.link} href={changeRequestHref(projectId, b.changeRequestId)}>
                  {t('planning.baseline.viewCr')}
                </Link>
              ) : (
                EM_DASH
              )}
            </Fact>
            <Fact label={t('planning.baseline.decisionNote')}>
              <span dir="auto">{b.decisionNote ?? EM_DASH}</span>
            </Fact>
            <Fact label={t('planning.approvalDecision.backedBy')}>
              {b.decisionId ? (
                <Link className={btn.link} href={`/projects/${projectId}/committee/decisions/${b.decisionId}`} data-testid="baseline-decision-link">
                  {t('planning.approvalDecision.open')}
                </Link>
              ) : b.approvedAt ? (
                <span className="text-muted">{t('planning.approvalDecision.delegated')}</span>
              ) : (
                EM_DASH
              )}
            </Fact>
          </dl>
        </Section>
        <Section id="b-contents" title={t('planning.baseline.contents')}>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Fact label={t('planning.baseline.tasks')}>{formatNumber(b.counts.tasks)}</Fact>
            <Fact label={t('planning.baseline.milestones')}>{formatNumber(b.counts.milestones)}</Fact>
            <Fact label={t('planning.baseline.deliverables')}>{formatNumber(b.counts.deliverables)}</Fact>
            <Fact label={t('planning.baseline.perimeter')}>{formatNumber(b.counts.perimeterItems)}</Fact>
            <Fact label={t('planning.baseline.budget')} wide>
              {s.budget.restricted ? t('planning.baseline.budgetRestricted', { count: formatNumber(s.budget.lineCount) }) : t('planning.baseline.budgetLines', { count: formatNumber(s.budget.lines.length) })}
            </Fact>
            <Fact label={t('planning.baseline.calendar')} wide>
              <span dir="ltr">
                {s.calendar.timezone} · {s.calendar.workingDays.join(',')} · {t('planning.baseline.holidays', { count: s.calendar.holidays.length })}
              </span>
            </Fact>
          </dl>
        </Section>
      </div>
      <h2 className="mt-6 mb-2 text-lg font-semibold">{t('planning.baseline.frozenTasks')}</h2>
      <DataTable<Snap>
        caption={t('planning.baseline.frozenTasks')}
        rows={s.tasks}
        rowKey={(r) => r.id}
        emptyTitle={t('planning.baseline.noTasks')}
        clientPageSize={25}
        columns={[
          { key: 'code', header: t('planning.common.code'), isRowHeader: true, sortValue: (r) => r.wbsCode, cell: (r) => <Link className={btn.link} href={taskHref(projectId, r.id)} dir="ltr">{r.wbsCode}</Link> },
          { key: 'dur', header: t('planning.task.duration'), sortValue: (r) => r.durationDays, cell: (r) => (r.durationDays === null ? t('planning.task.tbd') : formatNumber(r.durationDays)) },
          { key: 'ps', header: t('planning.task.plannedStart'), sortValue: (r) => r.plannedStart, cell: (r) => <DateText value={r.plannedStart} /> },
          { key: 'pf', header: t('planning.task.plannedFinish'), sortValue: (r) => r.plannedFinish, cell: (r) => <DateText value={r.plannedFinish} /> },
        ]}
      />
      <ActivityHistory className="mt-6" projectId={projectId} entityType="baseline_version" entityId={b.id} />
    </SectionGuard>
  );
}

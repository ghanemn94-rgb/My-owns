'use client';

import Link from 'next/link';
import { ChevronLeft, History, RotateCcw, TriangleAlert } from 'lucide-react';
import { useParams } from 'next/navigation';
import { ActivityHistory } from '@/components/ActivityHistory';
import { DemoBadge } from '@/components/DemoBadge';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { RestrictedState } from '@/components/RestrictedState';
import { SectionGuard } from '@/components/SectionGuard';
import { StatusBadge } from '@/components/StatusBadge';
import { card, cx } from '@/components/ui';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { isApiError } from '@/lib/api';
import { useGate, type GateDetail } from '@/lib/gates';
import { useProjectContext } from '@/lib/project-context';
import { sectionHref } from '@/lib/sections';
import { BlockerList, CriteriaCounts, GateStatusBadges, PrerequisiteList } from '../_components/GateBits';
import { GateActions } from '../_components/GateActions';
import { CriterionList } from '../_components/CriterionList';

function Panel({ title, id, children, className }: { title: string; id: string; children: React.ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={cx(card, 'p-4', className)}>
      <h2 id={id} className="mb-2 text-base font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function DecisionPanel({ gate }: { gate: GateDetail }) {
  const { t, tStatus } = useI18n();
  const d = gate.decision;
  return (
    <Panel title={t('gates.decision.title')} id="decision-title">
      {gate.assessment.decisionId && !d ? (
        <p className="text-sm text-muted">{t('gates.decision.notVisible')}</p>
      ) : d ? (
        <div className="space-y-1 text-sm" data-testid="linked-decision">
          <p className="font-medium" dir="auto">
            <span dir="ltr">{d.code}</span> — {d.title} {d.isDemo ? <DemoBadge className="ms-1" /> : null}
          </p>
          <p className="flex flex-wrap gap-2">
            <StatusBadge enumName="decisionStatuses" value={d.status} />
            <StatusBadge enumName="decisionAuthorityOutcomes" value={d.authorityOutcome} />
          </p>
          <p className={d.blocker ? 'text-danger' : 'text-success'}>{d.blocker ? t('gates.decision.notFinal') : t('gates.decision.final')}</p>
        </div>
      ) : (
        <p className="text-sm text-muted">{t('gates.decision.none')}</p>
      )}
      {gate.decisions.length > 0 ? (
        <div className="mt-3">
          <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">{t('gates.decision.raisedForGate')}</h3>
          <ul className="space-y-1 text-sm">
            {gate.decisions.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-2">
                <span dir="ltr">{x.code}</span>
                <span className="min-w-0 flex-1" dir="auto">
                  {x.title}
                </span>
                <StatusBadge enumName="decisionStatuses" value={x.status} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="mt-3 text-xs text-muted">{t('gates.decision.rule', { role: tStatus('roleKeys', gate.approverRole) })}</p>
    </Panel>
  );
}

function CyclesPanel({ gate }: { gate: GateDetail }) {
  const { t, tStatus, formatDateTime, formatNumber } = useI18n();
  const cycles = [...gate.cycles].sort((a, b) => b.cycle - a.cycle);
  return (
    <Panel title={t('gates.cycles.title')} id="cycles-title">
      <p className="mb-2 text-sm text-muted">{t('gates.cycles.hint')}</p>
      <ol className="space-y-2" data-testid="gate-cycles">
        {cycles.map((c) => {
          const met = c.criteria.filter((x) => x.status === 'met').length;
          return (
            <li key={c.id} className={cx('rounded-md border p-2.5 text-sm', c.isCurrent ? 'border-primary bg-primary-soft' : 'border-line')} data-cycle={c.cycle} data-cycle-status={c.status}>
              <div className="flex flex-wrap items-center gap-2">
                <History aria-hidden="true" className="size-4 text-muted" />
                <span className="font-semibold">{t('gates.cycle', { cycle: formatNumber(c.cycle) })}</span>
                <StatusBadge enumName="gateAssessmentStatuses" value={c.status} />
                {c.isCurrent ? <span className="text-xs font-semibold text-primary">{t('gates.cycles.current')}</span> : null}
                {c.reassessment.needsReassessment ? <span className="text-xs font-medium text-danger">{t('gates.reassessment.badge')}</span> : null}
              </div>
              <p className="mt-1 text-xs text-muted">
                {t('gates.cycles.summary', { met: formatNumber(met), total: formatNumber(c.criteria.length) })}
                {c.decidedAt ? ` · ${t('gates.cycles.decidedAt', { at: formatDateTime(c.decidedAt) })}` : ''}
              </p>
              {c.reopenedReason ? (
                <p className="mt-1 text-xs" dir="auto">
                  <RotateCcw aria-hidden="true" className="me-1 inline size-3.5" />
                  {t('gates.cycles.reopenedReason')}: {c.reopenedReason}
                </p>
              ) : null}
              {c.decisionNote ? (
                <p className="mt-1 text-xs" dir="auto">
                  {t('gates.cycles.decisionNote')}: {c.decisionNote}
                </p>
              ) : null}
              {!c.isCurrent ? (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs font-medium text-primary">{t('gates.cycles.showCriteria')}</summary>
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {c.criteria.map((x) => (
                      <li key={x.criterionId} className="inline-flex items-center gap-1 text-xs">
                        <span dir="ltr">{x.key}</span>
                        <span className="text-muted">{tStatus('criterionStatuses', x.status)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

export default function GateDetailPage() {
  const { gateId } = useParams<{ gateId: string }>();
  const { t, tStatus, formatList } = useI18n();
  const { projectId, project } = useProjectContext();
  const q = useGate(projectId, gateId);

  return (
    <SectionGuard section="gates">
      <Link href={sectionHref(projectId, 'gates')} className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
        <ChevronLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
        {t('gates.backToList')}
      </Link>
      {q.isLoading ? (
        <LoadingState />
      ) : q.error || !q.data ? (
        isApiError(q.error) && (q.error.isHidden || q.error.isForbidden) ? <RestrictedState /> : <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        (() => {
          const gate = q.data;
          const flags = gate.assessment.reassessment;
          return (
            <>
              <PageHeader
                eyebrow={<span dir="ltr">{project.code}</span>}
                title={
                  <span data-testid="gate-title">
                    <span dir="ltr">{gate.key}</span> — <span dir="auto">{gate.name}</span>
                  </span>
                }
                documentTitle={`${gate.key} — ${t('gates.title')}`}
                badges={<GateStatusBadges gate={gate} size="md" />}
                description={
                  <div className="space-y-1">
                    {gate.purpose ? <p dir="auto">{gate.purpose}</p> : null}
                    <p>
                      {t('gates.roles.line', {
                        owner: tStatus('roleKeys', gate.ownerRole),
                        reviewer: tStatus('roleKeys', gate.reviewerRole),
                        approver: tStatus('roleKeys', gate.approverRole),
                      })}
                    </p>
                  </div>
                }
              />
              <div className="mb-4">
                <GateActions gate={gate} />
              </div>

              {flags.needsReassessment ? (
                <div role="alert" className="mb-4 flex items-start gap-2 rounded-md border border-danger/40 bg-danger-soft p-3 text-sm text-ink" data-testid="reassessment-banner">
                  <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
                  <div>
                    <p className="font-semibold">{t('gates.reassessment.title')}</p>
                    <p>{t('gates.reassessment.body', { criteria: formatList(flags.criteria.map((c) => c.key)) || EM_DASH })}</p>
                  </div>
                </div>
              ) : null}
              {flags.upstreamGateKeys.length > 0 ? (
                <p className="mb-4 rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-ink">{t('gates.reassessment.upstream', { gates: formatList(flags.upstreamGateKeys) })}</p>
              ) : null}

              <div className="mb-4 grid gap-4 lg:grid-cols-3">
                <Panel title={t('gates.blockers.title')} id="blockers-title" className="lg:col-span-2">
                  <CriteriaCounts counts={gate.evaluation.counts} />
                  <BlockerList blockers={gate.blockers} className="mt-2" />
                  <p className="mt-3 text-xs text-muted">{t('gates.taskHint')}</p>
                </Panel>
                <Panel title={t('gates.prerequisites.title')} id="prereq-title">
                  <PrerequisiteList prerequisites={gate.prerequisites} />
                </Panel>
              </div>

              <div className="mb-4 grid gap-4 lg:grid-cols-3">
                <section aria-labelledby="criteria-title" className="lg:col-span-2">
                  <h2 id="criteria-title" className="mb-2 text-lg font-semibold">
                    {t('gates.criteria.title')}
                  </h2>
                  <p className="mb-3 text-sm text-muted">{t('gates.criteria.hint')}</p>
                  <CriterionList gate={gate} />
                </section>
                <div className="space-y-4">
                  <DecisionPanel gate={gate} />
                  <CyclesPanel gate={gate} />
                </div>
              </div>
              <ActivityHistory projectId={projectId} entityType="gate_assessment" entityId={gate.assessment.id} />
            </>
          );
        })()
      )}
    </SectionGuard>
  );
}

'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ClipboardCheck, ListChecks, Pencil } from 'lucide-react';
import { useState } from 'react';
import { newcoRoutes as N, REQUIREMENT_OUTCOME_COMMANDS, REQUIREMENT_PROGRESS_COMMANDS } from '@hub/contracts';
import { ActivityHistory } from '@/components/ActivityHistory';
import { DemoBadge } from '@/components/DemoBadge';
import { ErrorState } from '@/components/ErrorState';
import { EvidencePanel } from '@/components/EvidencePanel';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { SectionGuard } from '@/components/SectionGuard';
import { StatusBadge } from '@/components/StatusBadge';
import { VerificationBadge } from '@/components/VerificationBadge';
import { btn } from '@/components/ui';
import { PersonText } from '@/components/carveout/bits';
import {
  ApplicabilityBadge,
  AssessApplicabilityDialog,
  ConditionsBadge,
  ConditionsSatisfiedDialog,
  OutcomeDialog,
  ProgressDialog,
  RequirementFormDialog,
  ValidityBadge,
  type OutcomeCmd,
  type ProgressCmd,
} from '@/components/newco/requirements';
import { BackLink, Notice } from '@/components/planning/DetailShell';
import { DateText, Fact, Section } from '@/components/planning/bits';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { ck, entityHref, useFollowEvidence } from '@/lib/carveout';
import { useProjectContext } from '@/lib/project-context';

const PROGRESS = REQUIREMENT_PROGRESS_COMMANDS as readonly string[];
const OUTCOME = REQUIREMENT_OUTCOME_COMMANDS as readonly string[];

/** Regulatory / external-party / internal approval: applicability, progress, outcome with validity and conditions. */
export default function RequirementPage() {
  const { t, tStatus, formatDateTime } = useI18n();
  const { requirementId } = useParams<{ requirementId: string }>();
  const { projectId, can } = useProjectContext();
  useFollowEvidence(projectId);
  const q = useQuery({ queryKey: ck.requirement(projectId, requirementId), queryFn: ({ signal }) => api(N.getRequirement, { params: { projectId, requirementId }, signal }) });
  const [edit, setEdit] = useState(false);
  const [assess, setAssess] = useState(false);
  const [progress, setProgress] = useState<ProgressCmd | null>(null);
  const [outcome, setOutcome] = useState<OutcomeCmd | null>(null);
  const [conditions, setConditions] = useState(false);
  if (q.isLoading) return <LoadingState />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const r = q.data;
  const manage = can('newco.regulatory.manage');
  const verify = can('newco.regulatory.verify');
  const progressCmds = manage ? r.allowedCommands.filter((c) => PROGRESS.includes(c)) : [];
  // Outcomes need a specialist "applicable" assessment first; the API refuses otherwise.
  const outcomeCmds = verify && r.applicability === 'applicable' ? r.allowedCommands.filter((c) => OUTCOME.includes(c)) : [];
  const assessable = verify;
  return (
    <SectionGuard section="newco">
      <BackLink href={`/projects/${projectId}/newco?tab=requirements`} label={t('newco.req.back')} />
      <PageHeader
        eyebrow={<span dir="ltr">{r.code}</span>}
        title={<span dir="auto">{r.title}</span>}
        documentTitle={`${r.code} — ${r.title}`}
        badges={
          <>
            <ApplicabilityBadge value={r.applicability} size="md" />
            <StatusBadge enumName="requirementStatuses" value={r.status} size="md" />
            <ValidityBadge value={r.validityState} />
            <ConditionsBadge value={r.conditionsState} />
            {r.isDemo ? <DemoBadge /> : null}
          </>
        }
        actions={
          <>
            {manage ? (
              <button type="button" className={btn.secondary} onClick={() => setEdit(true)}>
                <Pencil aria-hidden="true" className="size-4" />
                {t('newco.common.edit')}
              </button>
            ) : null}
            {assessable ? (
              <button type="button" className={btn.secondary} onClick={() => setAssess(true)} data-testid="requirement-assess">
                <ClipboardCheck aria-hidden="true" className="size-4" />
                {t('newco.req.assess')}
              </button>
            ) : null}
            {verify && r.conditionsState === 'open' ? (
              <button type="button" className={btn.secondary} onClick={() => setConditions(true)} data-testid="conditions-satisfied">
                <ListChecks aria-hidden="true" className="size-4" />
                {t('newco.req.conditionsConfirm')}
              </button>
            ) : null}
          </>
        }
      />
      {r.applicability === 'assessment_pending' ? <Notice tone="warning">{t('newco.req.pendingNotice')}</Notice> : null}
      {r.validityState === 'expired' || r.validityState === 'expiring' ? <Notice tone={r.validityState === 'expired' ? 'danger' : 'warning'}>{t(`newco.req.validityNotice.${r.validityState}`)}</Notice> : null}
      {progressCmds.length || outcomeCmds.length ? (
        <div className="mb-6 flex flex-wrap gap-2" data-testid="command-bar">
          {progressCmds.map((c) => (
            <button key={c} type="button" className={c === 'withdraw' ? btn.secondary : btn.primary} data-command={c} onClick={() => setProgress(c as ProgressCmd)}>
              {t(`newco.req.cmd.${c as ProgressCmd}`)}
            </button>
          ))}
          {outcomeCmds.map((c) => (
            <button key={c} type="button" className={c === 'record_refusal' ? btn.secondary : btn.primary} data-command={c} onClick={() => setOutcome(c as OutcomeCmd)}>
              {t(`newco.req.cmd.${c as OutcomeCmd}`)}
            </button>
          ))}
        </div>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-2">
        <Section id="requirement-facts" title={t('newco.req.facts')}>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Fact label={t('newco.req.category')}>{tStatus('approvalRegisterCategories', r.category)}</Fact>
            <Fact label={t('newco.req.authority')}>
              <span dir="auto">{r.authority}</span>
            </Fact>
            <Fact label={t('newco.common.owner')}>
              <PersonText person={r.owner} />
            </Fact>
            <Fact label={t('newco.req.gate')}>
              <span dir="ltr">{r.gateKey ?? EM_DASH}</span>
            </Fact>
            <Fact label={t('newco.req.legalEntity')}>
              {r.legalEntity ? (
                <Link className={btn.link} href={entityHref(projectId, r.legalEntity.id)}>
                  {r.legalEntity.name}
                </Link>
              ) : (
                EM_DASH
              )}
            </Fact>
            <Fact label={t('newco.req.origin')}>{t(`newco.req.origins.${r.origin}`)}</Fact>
            <Fact label={t('newco.req.sourceReference')} wide>
              <span dir="auto">{r.sourceReference ?? EM_DASH}</span>
            </Fact>
            <Fact label={t('newco.req.description')} wide>
              <span dir="auto">{r.description ?? EM_DASH}</span>
            </Fact>
            <Fact label={t('newco.common.classification')}>{tStatus('classifications', r.classification)}</Fact>
            <Fact label={t('newco.req.verification')}>
              <VerificationBadge value={r.verificationStatus} />
            </Fact>
            <Fact label={t('newco.common.evidence')}>
              <span className="tabular">{t('newco.common.evidenceCount', { active: r.evidence.active, conflicting: r.evidence.conflicting })}</span>
            </Fact>
          </dl>
        </Section>
        <div className="space-y-4">
          <Section id="requirement-applicability" title={t('newco.req.applicability')} hint={t('newco.req.notDetermination')}>
            <dl className="grid gap-3 sm:grid-cols-2" data-testid="applicability" data-value={r.applicability}>
              <Fact label={t('newco.req.applicability')}>
                <ApplicabilityBadge value={r.applicability} />
              </Fact>
              <Fact label={t('newco.req.assessedBy')}>
                {r.applicabilityAssessment.assessedAt ? (
                  <span>
                    <PersonText person={r.applicabilityAssessment.assessedBy} /> · {formatDateTime(r.applicabilityAssessment.assessedAt)}
                  </span>
                ) : (
                  <span className="text-muted">{t('newco.req.pendingSpecialist')}</span>
                )}
              </Fact>
              <Fact label={t('newco.req.basis')} wide>
                <span dir="auto">{r.applicabilityAssessment.basis ?? EM_DASH}</span>
              </Fact>
            </dl>
          </Section>
          <Section id="requirement-outcome" title={t('newco.req.outcome')}>
            <dl className="grid gap-3 sm:grid-cols-2">
              <Fact label={t('newco.req.submittedOn')}>
                <DateText value={r.submittedOn} />
              </Fact>
              <Fact label={t('newco.req.decisionOn')}>
                <DateText value={r.decisionOn} />
              </Fact>
              <Fact label={t('newco.req.validFrom')}>
                <DateText value={r.validFrom} />
              </Fact>
              <Fact label={t('newco.req.validTo')}>
                <DateText value={r.validTo} overdue={r.validityState === 'expired'} />
              </Fact>
              <Fact label={t('newco.req.validityCol')}>
                <ValidityBadge value={r.validityState} />
              </Fact>
              <Fact label={t('newco.req.outcomeRecordedBy')}>
                <PersonText person={r.outcomeRecordedBy} emptyKey="carveout.common.notRecorded" />
              </Fact>
              <Fact label={t('newco.req.conditionsText')} wide>
                <span className="flex flex-col gap-1">
                  <ConditionsBadge value={r.conditionsState} />
                  <span dir="auto">{r.conditions ?? EM_DASH}</span>
                </span>
              </Fact>
            </dl>
          </Section>
        </div>
      </div>
      <EvidencePanel className="mt-4" targetType="regulatory_requirement" targetId={r.id} title={t('newco.req.evidence')} />
      <ActivityHistory className="mt-6" projectId={projectId} entityType="regulatory_requirement" entityId={r.id} />

      <RequirementFormDialog open={edit} onClose={() => setEdit(false)} requirement={r} />
      <AssessApplicabilityDialog r={r} open={assess} onClose={() => setAssess(false)} />
      <ProgressDialog r={r} command={progress} onClose={() => setProgress(null)} />
      <OutcomeDialog r={r} command={outcome} onClose={() => setOutcome(null)} />
      <ConditionsSatisfiedDialog r={r} open={conditions} onClose={() => setConditions(false)} />
    </SectionGuard>
  );
}

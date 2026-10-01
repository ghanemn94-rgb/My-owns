'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ClipboardList, GitPullRequestArrow, Pencil, Scale, Shuffle, UserCog } from 'lucide-react';
import { useState } from 'react';
import { carveoutRoutes as C } from '@hub/contracts';
import type { PerimeterItemType } from '@hub/domain';
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
import { Day1Checklist, ImpactEntries, PersonText } from '@/components/carveout/bits';
import { ConsentsRegister } from '@/components/carveout/consents';
import {
  ApplyChangeDialog,
  EditItemDialog,
  ImpactAssessmentDialog,
  InterimArrangementDialog,
  ScopeChangeDialog,
  TransferHistory,
  TransferSection,
  TransferabilityDialog,
} from '@/components/carveout/item-sections';
import { BackLink } from '@/components/planning/DetailShell';
import { DateText, Fact, Section } from '@/components/planning/bits';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { useServerMessages } from '@/lib/i18n-data';
import { agreementHref, changeRequestHref, ck, useFollowEvidence } from '@/lib/carveout';
import { useProjectContext } from '@/lib/project-context';

const CONTRACT_LIKE: readonly PerimeterItemType[] = ['contract', 'license'];

/** Screen 7 — one perimeter item: scope, legal vs economic transfer, Day-1 contract position, impacts, evidence. */
export default function PerimeterItemPage() {
  const { t, tStatus, formatDateTime } = useI18n();
  const serverText = useServerMessages();
  const { itemId } = useParams<{ itemId: string }>();
  const { projectId, can } = useProjectContext();
  useFollowEvidence(projectId);
  const q = useQuery({ queryKey: ck.item(projectId, itemId), queryFn: ({ signal }) => api(C.getPerimeterItem, { params: { projectId, itemId }, signal }) });
  const impacts = useQuery({ queryKey: ck.impacts(projectId, itemId), queryFn: ({ signal }) => api(C.listPerimeterImpacts, { params: { projectId, itemId }, signal }) });
  const [dialog, setDialog] = useState<'edit' | 'scope' | 'apply' | 'class' | 'interim' | 'impact' | null>(null);
  if (q.isLoading) return <LoadingState />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const it = q.data;
  const contractLike = CONTRACT_LIKE.includes(it.type);
  const manage = can('carveout.perimeter.manage');
  const latestImpact = impacts.data?.items[0];
  return (
    <SectionGuard section="perimeter">
      <BackLink href={`/projects/${projectId}/perimeter?tab=register`} label={t('carveout.item.back')} />
      <PageHeader
        eyebrow={<span dir="ltr">{it.code}</span>}
        title={<span dir="auto">{it.name}</span>}
        documentTitle={`${it.code} — ${it.name}`}
        badges={
          <>
            <StatusBadge enumName="perimeterDispositions" value={it.disposition} size="md" />
            <span className="text-sm text-muted">{tStatus('perimeterItemTypes', it.type)}</span>
            <VerificationBadge value={it.verificationStatus} />
            {it.inApprovedBaseline ? <StatusBadge enumName="baselineStatuses" value="approved" tone="info" label={t('carveout.item.inBaseline')} /> : null}
            {it.isDemo ? <DemoBadge /> : null}
          </>
        }
        actions={
          <>
            {manage ? (
              <button type="button" className={btn.secondary} onClick={() => setDialog('edit')}>
                <Pencil aria-hidden="true" className="size-4" />
                {t('carveout.common.edit')}
              </button>
            ) : null}
            {manage && !it.pendingChange ? (
              <button type="button" className={btn.secondary} onClick={() => setDialog('scope')} data-testid="scope-change">
                <Shuffle aria-hidden="true" className="size-4" />
                {t('carveout.scope.open')}
              </button>
            ) : null}
            {manage ? (
              <button type="button" className={btn.secondary} onClick={() => setDialog('impact')} data-testid="impact-record">
                <ClipboardList aria-hidden="true" className="size-4" />
                {t('carveout.impact.record')}
              </button>
            ) : null}
          </>
        }
      />

      {it.pendingChange ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning-soft p-3 text-sm" role="note" data-testid="pending-change">
          <p className="min-w-0 text-ink">
            <GitPullRequestArrow aria-hidden="true" className="me-1 inline size-4 text-warning" />
            {t('carveout.scope.pendingBanner', { code: it.pendingChange.code, status: tStatus('changeRequestStatuses', it.pendingChange.status) })}
            {['submitted', 'under_review'].includes(it.pendingChange.status) ? (
              <span className="mt-1 block text-xs" data-testid="pending-change-cost-hint">
                {t('planning.cr.costBeforeApproval')}
              </span>
            ) : null}
          </p>
          <span className="flex flex-wrap gap-2">
            <Link href={changeRequestHref(projectId, it.pendingChange.id)} className={btn.secondary} data-testid="open-change-request">
              {t('carveout.scope.openChange')}
            </Link>
            {manage && ['approved', 'implemented', 'rejected', 'withdrawn'].includes(it.pendingChange.status) ? (
              <button type="button" className={btn.primary} onClick={() => setDialog('apply')} data-testid="apply-change">
                {t('carveout.scope.apply')}
              </button>
            ) : null}
          </span>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <TransferSection item={it} />
        <Section id="item-facts" title={t('carveout.item.facts')}>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Fact label={t('carveout.item.site')}>
              <span dir="ltr">{it.siteCode ?? EM_DASH}</span>
            </Fact>
            <Fact label={t('carveout.common.workstream')}>
              <span dir="ltr">{it.workstreamCode ?? EM_DASH}</span>
            </Fact>
            <Fact label={t('carveout.item.accountableOwner')}>
              <PersonText person={it.owner} />
            </Fact>
            <Fact label={t('carveout.item.mechanism')}>
              <span dir="auto">{it.transferMechanism ?? EM_DASH}</span>
            </Fact>
            <Fact label={t('carveout.item.currentEntity')}>
              <span dir="auto">{it.currentEntity?.name ?? EM_DASH}</span>
            </Fact>
            <Fact label={t('carveout.item.targetEntity')}>
              <span dir="auto">{it.targetEntity?.name ?? EM_DASH}</span>
            </Fact>
            <Fact label={t('carveout.item.legalOwner')}>
              <span dir="auto">{it.legalOwner ?? EM_DASH}</span>
            </Fact>
            <Fact label={t('carveout.item.operator')}>
              <span dir="auto">{it.operator ?? EM_DASH}</span>
            </Fact>
            <Fact label={t('carveout.item.economicBeneficiary')}>
              <span dir="auto">{it.economicBeneficiary ?? EM_DASH}</span>
            </Fact>
            <Fact label={t('carveout.item.agreement')}>
              {it.agreement ? (
                <Link href={agreementHref(projectId, it.agreement.id)} className={btn.link} dir="ltr">
                  {it.agreement.code}
                </Link>
              ) : (
                EM_DASH
              )}
            </Fact>
            <Fact label={t('carveout.item.referenceValue')}>
              {it.referenceValue ? (
                <span className="tabular" dir="ltr">
                  {it.referenceValue.amount} {it.referenceValue.currency} ×{it.referenceValue.unitScale}
                </span>
              ) : it.referenceValueRestricted ? (
                <span className="text-muted">{t('carveout.item.referenceRestricted')}</span>
              ) : (
                EM_DASH
              )}
            </Fact>
            <Fact label={t('carveout.item.consentRequired')}>{it.consentRequired ? t('carveout.common.yes') : t('carveout.common.no')}</Fact>
            {it.disposition === 'pending' ? (
              <>
                <Fact label={t('carveout.item.resolutionPath')}>
                  <span dir="auto">{it.resolutionPath ?? EM_DASH}</span>
                </Fact>
                <Fact label={t('carveout.item.targetGate')}>
                  <span dir="ltr">{it.targetGateKey ?? EM_DASH}</span>
                </Fact>
              </>
            ) : null}
            <Fact label={t('carveout.item.dependencies')} wide>
              <span dir="auto">{it.dependencies ?? EM_DASH}</span>
            </Fact>
            <Fact label={t('carveout.item.risks')} wide>
              <span dir="auto">{it.risks ?? EM_DASH}</span>
            </Fact>
          </dl>
        </Section>
      </div>

      {contractLike ? (
        // QA-P34-03: grid-cols-1 = minmax(0, 1fr): the consents table scrolls inside its own region instead of widening the
        // page at 390 px (an implicit `auto` track grows to the table's min-content width).
        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Section
            id="contract-position"
            title={t('carveout.contract.title')}
            hint={t('carveout.contract.hint')}
            actions={
              <>
                {can('carveout.contract.classify') ? (
                  <button type="button" className={btn.secondary} onClick={() => setDialog('class')} data-testid="set-transferability">
                    <Scale aria-hidden="true" className="size-4" />
                    {t('carveout.contract.classify')}
                  </button>
                ) : null}
                {can('carveout.consent.manage') ? (
                  <button type="button" className={btn.secondary} onClick={() => setDialog('interim')} data-testid="set-interim">
                    <UserCog aria-hidden="true" className="size-4" />
                    {t('carveout.contract.interim')}
                  </button>
                ) : null}
              </>
            }
          >
            <dl className="mb-4 grid gap-3 sm:grid-cols-3">
              <Fact label={t('carveout.contract.class')}>
                <StatusBadge enumName="contractTransferClasses" value={it.transferClass} />
              </Fact>
              <Fact label={t('carveout.contract.assessedBy')}>
                {it.transferClassAssessment.assessedBy ? <PersonText person={it.transferClassAssessment.assessedBy} /> : <span className="text-warning">{t('carveout.day1.assessmentPending')}</span>}
              </Fact>
              <Fact label={t('carveout.contract.assessedAt')}>{it.transferClassAssessment.assessedAt ? formatDateTime(it.transferClassAssessment.assessedAt) : EM_DASH}</Fact>
              {it.transferClassAssessment.basis ? (
                <Fact label={t('carveout.contract.basis')} wide>
                  <span dir="auto">{it.transferClassAssessment.basis}</span>
                </Fact>
              ) : null}
            </dl>
            <h3 className="mb-2 text-sm font-semibold">{t('carveout.day1.title')}</h3>
            <Day1Checklist position={it.day1} />
          </Section>
          <Section id="item-consents" title={t('carveout.tabs.consents')} hint={t('carveout.consents.hint')}>
            <ConsentsRegister perimeterItemId={it.id} />
          </Section>
        </div>
      ) : null}

      <Section className="mt-4" id="impacts" title={t('carveout.impact.title')} hint={t('carveout.impact.hint')}>
        {impacts.isLoading ? <LoadingState compact /> : null}
        {impacts.error ? <ErrorState error={impacts.error} onRetry={() => impacts.refetch()} /> : null}
        {impacts.data && !latestImpact ? <p className="text-sm text-muted">{t('carveout.impact.none')}</p> : null}
        {latestImpact ? (
          <>
            <p className="mb-2 text-xs text-muted">
              {t('carveout.impact.latest', { date: formatDateTime(latestImpact.createdAt), by: latestImpact.assessedByName ?? EM_DASH })}
              {latestImpact.trigger === 'change_request' ? ` · ${t('carveout.impact.fromChange')}` : ''}
            </p>
            <ImpactEntries entries={latestImpact.entries} narrative={latestImpact.narrative} />
            {impacts.data!.items.length > 1 ? <p className="mt-2 text-xs text-muted">{t('carveout.impact.olderCount', { count: impacts.data!.items.length - 1 })}</p> : null}
          </>
        ) : null}
      </Section>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <EvidencePanel targetType="transfer" targetId={it.id} title={t('carveout.evidence.transfer')} />
        <EvidencePanel targetType="perimeter_item" targetId={it.id} title={t('carveout.evidence.item')} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <TransferHistory item={it} />
        <Section id="versions" title={t('carveout.item.history')} hint={t('carveout.item.historyHint')}>
          <ol className="space-y-1.5 text-sm" data-testid="item-history">
            {it.history.map((h) => (
              <li key={h.versionNo} className="flex flex-wrap gap-x-2">
                <span className="tabular font-medium">{t('documents.versions.label', { version: h.versionNo })}</span>
                {/* QA-P34-01f: the recorded reason in the user's language (the user's own text inside it is shown as entered). */}
                <span dir={h.reasonI18n.length ? undefined : 'auto'}>{serverText(h.reasonI18n, h.reason) ?? EM_DASH}</span>
                <span className="text-muted">
                  · <span dir="auto">{h.changedByName ?? EM_DASH}</span> · {formatDateTime(h.changedAt)}
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-muted">
            {t('carveout.item.created')} <DateText value={it.createdAt.slice(0, 10)} />
          </p>
        </Section>
      </div>
      <ActivityHistory className="mt-6" projectId={projectId} entityType="perimeter_item" entityId={it.id} />

      <EditItemDialog item={it} open={dialog === 'edit'} onClose={() => setDialog(null)} />
      <ScopeChangeDialog item={it} open={dialog === 'scope'} onClose={() => setDialog(null)} />
      <ApplyChangeDialog item={it} open={dialog === 'apply'} onClose={() => setDialog(null)} />
      <TransferabilityDialog item={it} open={dialog === 'class'} onClose={() => setDialog(null)} />
      <InterimArrangementDialog item={it} open={dialog === 'interim'} onClose={() => setDialog(null)} />
      <ImpactAssessmentDialog item={it} open={dialog === 'impact'} onClose={() => setDialog(null)} />
    </SectionGuard>
  );
}

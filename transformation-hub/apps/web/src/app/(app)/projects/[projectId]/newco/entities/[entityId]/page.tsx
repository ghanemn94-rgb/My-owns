'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { BadgeCheck, ClipboardPen, Pencil, XCircle } from 'lucide-react';
import { useState } from 'react';
import { newcoRoutes as N } from '@hub/contracts';
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
import { DimensionsSummary, EditEntityDialog, IncorporationBadges, RecordIncorporationDialog, VerifyIncorporationDialog } from '@/components/newco/entities';
import { ApplicabilityBadge } from '@/components/newco/requirements';
import { BackLink, Notice } from '@/components/planning/DetailShell';
import { CodeLink, Fact, Section } from '@/components/planning/bits';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { useServerMessages } from '@/lib/i18n-data';
import { ck, requirementHref, useFollowEvidence } from '@/lib/carveout';
import { useProjectContext } from '@/lib/project-context';

/** Legal entity: incorporation recorded vs verified (AT-06), evidence, linked approvals and history. */
export default function LegalEntityPage() {
  const { t, tStatus, formatDateTime } = useI18n();
  const serverText = useServerMessages();
  const { entityId } = useParams<{ entityId: string }>();
  const { projectId, can, me } = useProjectContext();
  useFollowEvidence(projectId);
  const q = useQuery({ queryKey: ck.entity(projectId, entityId), queryFn: ({ signal }) => api(N.getLegalEntity, { params: { projectId, entityId }, signal }) });
  const [edit, setEdit] = useState(false);
  const [record, setRecord] = useState(false);
  const [verify, setVerify] = useState<'confirm' | 'reject' | null>(null);
  if (q.isLoading) return <LoadingState />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const e = q.data;
  const inc = e.incorporation;
  const pendingVerification = inc.verification === 'proposed';
  const iRecorded = inc.recordedBy?.userId === me.user.id;
  // SEC-P1R-03: a shared legal entity is changed only in its owning project; linked projects read it (the server answers 403).
  const owned = e.ownedByThisProject;
  const mayVerify = owned && can('newco.incorporation.verify') && pendingVerification && !iRecorded;
  return (
    <SectionGuard section="newco">
      <BackLink href={`/projects/${projectId}/newco?tab=entities`} label={t('newco.entities.back')} />
      <PageHeader
        eyebrow={tStatus('entityKinds', e.role)}
        title={<span dir="auto">{e.name}</span>}
        documentTitle={e.name}
        badges={
          <>
            <IncorporationBadges inc={inc} size="md" />
            {e.isDemo ? <DemoBadge /> : null}
          </>
        }
        actions={
          <>
            {owned && can('newco.legal_entity.manage') ? (
              <button type="button" className={btn.secondary} onClick={() => setEdit(true)} data-testid="entity-edit">
                <Pencil aria-hidden="true" className="size-4" />
                {t('newco.common.edit')}
              </button>
            ) : null}
            {owned && can('newco.incorporation.manage') ? (
              <button type="button" className={btn.primary} onClick={() => setRecord(true)} data-testid="incorporation-record">
                <ClipboardPen aria-hidden="true" className="size-4" />
                {t('newco.incorporation.record')}
              </button>
            ) : null}
            {mayVerify ? (
              <>
                <button type="button" className={btn.primary} onClick={() => setVerify('confirm')} data-testid="incorporation-verify">
                  <BadgeCheck aria-hidden="true" className="size-4" />
                  {t('newco.incorporation.verify')}
                </button>
                <button type="button" className={btn.secondary} onClick={() => setVerify('reject')} data-testid="incorporation-reject">
                  <XCircle aria-hidden="true" className="size-4" />
                  {t('newco.incorporation.reject')}
                </button>
              </>
            ) : null}
          </>
        }
      />
      {!owned ? (
        <p className="mb-4 rounded-md border border-info/30 bg-info-soft p-3 text-sm text-ink" role="note" data-testid="entity-not-owned">
          {t('newco.entities.managedByOwner')}
        </p>
      ) : null}
      {owned && pendingVerification && can('newco.incorporation.verify') && iRecorded ? <Notice tone="info">{t('newco.incorporation.youRecorded')}</Notice> : null}
      <div className="grid gap-4 xl:grid-cols-2">
        <Section id="incorporation" title={t('newco.incorporation.title')} hint={t('newco.incorporation.hint')}>
          <dl className="grid gap-3 sm:grid-cols-2" data-testid="incorporation">
            <Fact label={t('newco.incorporation.recordedStatus')}>
              <span data-testid="incorporation-status" data-status={inc.status}>
                <StatusBadge enumName="incorporationStatuses" value={inc.status} tone={inc.verification === 'confirmed' || inc.status === 'not_applicable' ? undefined : inc.status === 'unconfirmed' ? 'neutral' : 'warning'} />
              </span>
            </Fact>
            <Fact label={t('newco.incorporation.verification')}>
              <span data-testid="incorporation-verification" data-verification={inc.verification}>
                <VerificationBadge value={inc.verification} />
              </span>
            </Fact>
            <Fact label={t('newco.incorporation.recorded')}>
              {inc.recordedAt ? (
                <span>
                  <PersonText person={inc.recordedBy} /> · {formatDateTime(inc.recordedAt)}
                </span>
              ) : (
                <span className="text-muted">{t('newco.incorporation.notRecorded')}</span>
              )}
            </Fact>
            <Fact label={t('newco.incorporation.verified')}>
              {inc.verifiedAt ? (
                <span data-testid="incorporation-verified-by">
                  <PersonText person={inc.verifiedBy} /> · {formatDateTime(inc.verifiedAt)}
                </span>
              ) : (
                <span className="text-muted">{t('newco.incorporation.notVerified')}</span>
              )}
            </Fact>
            <Fact label={t('newco.incorporation.evidenceNote')} wide>
              <span dir="auto">{inc.evidenceNote ?? EM_DASH}</span>
            </Fact>
            {inc.verificationNote ? (
              <Fact label={t('newco.incorporation.verificationNote')} wide>
                <span dir="auto">{inc.verificationNote}</span>
              </Fact>
            ) : null}
            <Fact label={t('newco.common.evidence')}>
              <span className="tabular" data-testid="entity-evidence-count">
                {t('newco.common.evidenceCount', { active: e.evidence.active, conflicting: e.evidence.conflicting })}
              </span>
            </Fact>
            <Fact label={t('newco.entities.registrationRef')}>
              <span dir="auto">{e.registrationRef ?? EM_DASH}</span>
            </Fact>
            <Fact label={t('newco.entities.jurisdiction')}>
              <span dir="auto">{e.jurisdiction ?? EM_DASH}</span>
            </Fact>
            <Fact label={t('newco.entities.kind')}>{tStatus('entityKinds', e.kind)}</Fact>
          </dl>
          <p className="mt-3 text-xs text-muted">{t('newco.incorporation.separateNote')}</p>
        </Section>
        <div className="space-y-4">
          <Section id="entity-requirements" title={t('newco.entities.requirements')}>
            {e.requirements.length === 0 ? (
              <p className="text-sm text-muted">{t('newco.entities.noRequirements')}</p>
            ) : (
              <ul className="space-y-2">
                {e.requirements.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <CodeLink href={requirementHref(projectId, r.id)} code={r.code} title={r.title} />
                    <ApplicabilityBadge value={r.applicability} />
                    <StatusBadge enumName="requirementStatuses" value={r.status} />
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section id="entity-history" title={t('newco.entities.history')}>
            {e.history.length === 0 ? (
              <p className="text-sm text-muted">{EM_DASH}</p>
            ) : (
              <ol className="space-y-1.5 text-sm" data-testid="entity-history">
                {[...e.history].reverse().map((h) => (
                  <li key={h.versionNo}>
                    <span className="font-medium tabular">{t('documents.versions.label', { version: h.versionNo })}</span> <span dir={h.reasonI18n.length ? undefined : 'auto'}>{serverText(h.reasonI18n, h.reason) ?? EM_DASH}</span>{' '}
                    <span className="text-muted">
                      · <span dir="auto">{h.changedByName ?? EM_DASH}</span> · {formatDateTime(h.changedAt)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </div>
      </div>
      <EvidencePanel className="mt-4" targetType="legal_entity" targetId={e.id} title={t('newco.entities.evidence')} />
      <DimensionsSummary className="mt-4" />
      <ActivityHistory className="mt-6" projectId={projectId} entityType="legal_entity" entityId={e.id} />

      {owned ? (
        <>
          <EditEntityDialog entity={e} open={edit} onClose={() => setEdit(false)} />
          <RecordIncorporationDialog entity={e} open={record} onClose={() => setRecord(false)} />
          <VerifyIncorporationDialog entity={e} outcome={verify} onClose={() => setVerify(null)} />
        </>
      ) : null}
    </SectionGuard>
  );
}

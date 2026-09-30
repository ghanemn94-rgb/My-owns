'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { BadgeCheck, FilePlus2, Pencil } from 'lucide-react';
import { useEffect, useState } from 'react';
import { carveoutRoutes as C, AGREEMENT_COMMANDS } from '@hub/contracts';
import { ActivityHistory } from '@/components/ActivityHistory';
import { ConfirmCommandDialog } from '@/components/ConfirmCommandDialog';
import { DemoBadge } from '@/components/DemoBadge';
import { ErrorState } from '@/components/ErrorState';
import { EvidencePanel } from '@/components/EvidencePanel';
import { TextAreaField, TextField } from '@/components/Field';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { SectionGuard } from '@/components/SectionGuard';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { UserPicker, type PickedUser } from '@/components/UserPicker';
import { btn, hint } from '@/components/ui';
import { PersonText } from '@/components/carveout/bits';
import { BackLink } from '@/components/planning/DetailShell';
import { CodeLink, DateText, Fact, Section } from '@/components/planning/bits';
import { FormDialog } from '@/components/planning/dialogs';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { ck, itemHref, localToday, useFollowEvidence, useRefreshCarveout, type AgreementDetail } from '@/lib/carveout';
import { useProjectContext } from '@/lib/project-context';

type Cmd = (typeof AGREEMENT_COMMANDS)[number];

function StageDialog({ a, command, onClose }: { a: AgreementDetail; command: Cmd; onClose: () => void }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useRefreshCarveout(projectId);
  const toast = useToast();
  const [date, setDate] = useState(localToday());
  const dateField = command === 'record_signing' ? 'signingDate' : command === 'record_effective' ? 'effectiveDate' : command === 'record_expiry' ? 'expiryDate' : null;
  const reasonRequired = command === 'terminate';
  return (
    <ConfirmCommandDialog
      open
      onClose={onClose}
      title={t(`carveout.agreements.cmd.${command}`)}
      confirmLabel={t(`carveout.agreements.cmd.${command}`)}
      expectedVersion={a.version}
      noteMode={reasonRequired ? 'required' : 'optional'}
      noteLabel={t('carveout.common.reason')}
      danger={command === 'terminate'}
      confirmDisabled={!!dateField && !date}
      consequences={[
        t(`carveout.agreements.effect.${command}`),
        ...(command === 'record_signing' ? [t('carveout.agreements.signingRule'), t('carveout.agreements.notEsignature')] : []),
        t('common.command.audited'),
      ]}
      onReload={() => void refresh()}
      onConfirm={async ({ note }) => {
        await api(C.agreementStage, {
          params: { projectId, agreementId: a.id },
          body: { expectedVersion: a.version, command, ...(dateField ? { [dateField]: date } : {}), ...(note ? { reason: note } : {}) },
        });
        await refresh();
        toast.show('success', t('carveout.agreements.stageDone'));
        onClose();
      }}
    >
      {dateField ? <TextField label={t(`carveout.agreements.${dateField}`)} type="date" dir="ltr" required max={localToday()} value={date} onChange={(e) => setDate(e.target.value)} /> : null}
    </ConfirmCommandDialog>
  );
}

function EditAgreementDialog({ a, open, onClose }: { a: AgreementDetail; open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useRefreshCarveout(projectId);
  const toast = useToast();
  const init = () => ({ title: a.title, scope: a.scope ?? '', outstandingIssues: a.outstandingIssues ?? '', obligations: a.obligations ?? '', renewalDate: a.renewalDate ?? '', expiryDate: a.expiryDate ?? '', kindExpansionProposed: a.kindExpansionProposed ?? '' });
  const [f, setF] = useState(init);
  const [owner, setOwner] = useState<PickedUser | null>(null);
  const [reviewer, setReviewer] = useState<PickedUser | null>(null);
  useEffect(() => {
    if (!open) return;
    setF(init());
    setOwner(a.owner ? { id: a.owner.userId, displayName: a.owner.name ?? '', email: '' } : null);
    setReviewer(a.legalReviewer ? { id: a.legalReviewer.userId, displayName: a.legalReviewer.name ?? '', email: '' } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, a]);
  const nn = (v: string) => (v.trim() ? v.trim() : null);
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={t('carveout.agreements.editTitle', { code: a.code })}
      submitLabel={t('common.actions.save')}
      size="lg"
      disabled={!f.title.trim()}
      testId="agreement-edit"
      onReload={() => void refresh()}
      onSubmit={async () => {
        // Only changed fields are sent (no version bump or audit entry for an unchanged record).
        const body: Record<string, unknown> = {};
        if (f.title.trim() !== a.title) body.title = f.title.trim();
        if (nn(f.scope) !== a.scope) body.scope = nn(f.scope);
        if (nn(f.outstandingIssues) !== a.outstandingIssues) body.outstandingIssues = nn(f.outstandingIssues);
        if (nn(f.obligations) !== a.obligations) body.obligations = nn(f.obligations);
        if ((f.renewalDate || null) !== a.renewalDate) body.renewalDate = f.renewalDate || null;
        if ((f.expiryDate || null) !== a.expiryDate) body.expiryDate = f.expiryDate || null;
        if (!a.kindExpansionConfirmed && nn(f.kindExpansionProposed) !== a.kindExpansionProposed) body.kindExpansionProposed = nn(f.kindExpansionProposed);
        if ((owner?.id ?? null) !== (a.owner?.userId ?? null)) body.ownerUserId = owner?.id ?? null;
        if ((reviewer?.id ?? null) !== (a.legalReviewer?.userId ?? null)) body.legalReviewerUserId = reviewer?.id ?? null;
        if (Object.keys(body).length === 0) return onClose();
        await api(C.updateAgreement, { params: { projectId, agreementId: a.id }, body: { expectedVersion: a.version, ...body } });
        await refresh();
        toast.show('success', t('carveout.common.saved'));
        onClose();
      }}
    >
      <TextField label={t('carveout.agreements.title')} required value={f.title} maxLength={300} onChange={(e) => setF({ ...f, title: e.target.value })} />
      {!a.kindExpansionConfirmed ? <TextField label={t('carveout.agreements.expansionProposed')} hint={t('carveout.agreements.expansionHint')} value={f.kindExpansionProposed} maxLength={300} onChange={(e) => setF({ ...f, kindExpansionProposed: e.target.value })} /> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <UserPicker label={t('carveout.common.owner')} value={owner} onChange={setOwner} />
        <UserPicker label={t('carveout.agreements.legalReviewer')} value={reviewer} onChange={setReviewer} />
      </div>
      <TextAreaField label={t('carveout.agreements.scope')} rows={2} value={f.scope} maxLength={4000} onChange={(e) => setF({ ...f, scope: e.target.value })} />
      <TextAreaField label={t('carveout.agreements.outstandingIssues')} rows={2} value={f.outstandingIssues} maxLength={4000} onChange={(e) => setF({ ...f, outstandingIssues: e.target.value })} />
      <TextAreaField label={t('carveout.agreements.obligations')} rows={2} value={f.obligations} maxLength={4000} onChange={(e) => setF({ ...f, obligations: e.target.value })} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={t('carveout.agreements.renewalDate')} type="date" dir="ltr" value={f.renewalDate} onChange={(e) => setF({ ...f, renewalDate: e.target.value })} />
        <TextField label={t('carveout.agreements.expiryDate')} type="date" dir="ltr" value={f.expiryDate} onChange={(e) => setF({ ...f, expiryDate: e.target.value })} />
      </div>
    </FormDialog>
  );
}

/** Agreement register entry (REQ-AGR-001/002/003): stage commands, draft versions, confirmation of the label's expansion. */
export default function AgreementPage() {
  const { t, tStatus, formatDateTime } = useI18n();
  const { agreementId } = useParams<{ agreementId: string }>();
  const { projectId, can, me } = useProjectContext();
  useFollowEvidence(projectId);
  const refresh = useRefreshCarveout(projectId);
  const toast = useToast();
  const q = useQuery({ queryKey: ck.agreement(projectId, agreementId), queryFn: ({ signal }) => api(C.getAgreement, { params: { projectId, agreementId }, signal }) });
  const [cmd, setCmd] = useState<Cmd | null>(null);
  const [edit, setEdit] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [versionOpen, setVersionOpen] = useState(false);
  const [expansion, setExpansion] = useState({ expansion: '', basis: '' });
  const [version, setVersion] = useState({ label: '', note: '' });
  if (q.isLoading) return <LoadingState />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const a = q.data;
  const manage = can('carveout.agreement.manage');
  const mayConfirm = manage && !a.kindExpansionConfirmed && (a.owner?.userId === me.user.id || a.legalReviewer?.userId === me.user.id);
  const negotiating = !['signed', 'effective', 'terminated', 'expired'].includes(a.stage);
  return (
    <SectionGuard section="perimeter">
      <BackLink href={`/projects/${projectId}/perimeter?tab=agreements`} label={t('carveout.agreements.back')} />
      <PageHeader
        eyebrow={<span dir="ltr">{a.code}</span>}
        title={<span dir="auto">{a.title}</span>}
        documentTitle={`${a.code} — ${a.title}`}
        badges={
          <>
            <StatusBadge enumName="agreementStages" value={a.stage} size="md" />
            <span className="rounded-md border border-line px-2 py-0.5 text-sm font-medium" dir="ltr">
              {a.kindLabel}
            </span>
            <span className={a.kindExpansionConfirmed ? 'text-sm' : 'text-sm text-warning'} data-testid="agreement-expansion">
              {a.kindExpansionConfirmed ? a.kindExpansionDisplay : t('carveout.agreements.unconfirmed')}
            </span>
            <span className="text-sm text-muted">{tStatus('classifications', a.classification)}</span>
            {a.isDemo ? <DemoBadge /> : null}
          </>
        }
        actions={
          <>
            {manage ? (
              <button type="button" className={btn.secondary} onClick={() => setEdit(true)}>
                <Pencil aria-hidden="true" className="size-4" />
                {t('carveout.common.edit')}
              </button>
            ) : null}
            {mayConfirm ? (
              <button type="button" className={btn.secondary} onClick={() => setConfirmOpen(true)} data-testid="confirm-expansion">
                <BadgeCheck aria-hidden="true" className="size-4" />
                {t('carveout.agreements.confirmExpansion')}
              </button>
            ) : null}
            {manage && negotiating ? (
              <button type="button" className={btn.secondary} onClick={() => setVersionOpen(true)} data-testid="add-version">
                <FilePlus2 aria-hidden="true" className="size-4" />
                {t('carveout.agreements.addVersion')}
              </button>
            ) : null}
          </>
        }
      />
      {manage && a.allowedCommands.length ? (
        <div className="mb-6 flex flex-wrap gap-2" data-testid="command-bar">
          {a.allowedCommands.map((c) => (
            <button key={c} type="button" className={c === 'terminate' ? btn.secondary : btn.primary} data-command={c} onClick={() => setCmd(c as Cmd)}>
              {t(`carveout.agreements.cmd.${c as Cmd}`)}
            </button>
          ))}
        </div>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-2">
        <Section id="agreement-facts" title={t('carveout.agreements.facts')}>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Fact label={t('carveout.common.owner')}>
              <PersonText person={a.owner} />
            </Fact>
            <Fact label={t('carveout.agreements.legalReviewer')}>
              <PersonText person={a.legalReviewer} />
            </Fact>
            <Fact label={t('carveout.agreements.expansionProposed')}>
              <span dir="auto">{a.kindExpansionProposed ?? EM_DASH}</span>
            </Fact>
            <Fact label={t('carveout.agreements.expansionConfirmed')}>
              {a.kindExpansionConfirmation.confirmedBy ? (
                <span>
                  <PersonText person={a.kindExpansionConfirmation.confirmedBy} /> · {a.kindExpansionConfirmation.confirmedAt ? formatDateTime(a.kindExpansionConfirmation.confirmedAt) : EM_DASH}
                </span>
              ) : (
                <span className="text-warning">{t('carveout.agreements.unconfirmed')}</span>
              )}
            </Fact>
            <Fact label={t('carveout.agreements.draft')}>
              <span dir="ltr">{a.currentDraftVersion ?? EM_DASH}</span>
            </Fact>
            <Fact label={t('carveout.agreements.signingDate')}>
              <DateText value={a.signingDate} />
            </Fact>
            <Fact label={t('carveout.agreements.effectiveDate')}>
              <DateText value={a.effectiveDate} />
            </Fact>
            <Fact label={t('carveout.agreements.renewalDate')}>
              <DateText value={a.renewalDate} />
            </Fact>
            <Fact label={t('carveout.agreements.expiryDate')}>
              <DateText value={a.expiryDate} />
            </Fact>
            <Fact label={t('carveout.agreements.parties')} wide>
              {a.parties.length ? (
                <ul className="list-disc ps-5">
                  {a.parties.map((p, i) => (
                    <li key={i} dir="auto">
                      {p.name}
                      {p.role ? ` — ${p.role}` : ''}
                    </li>
                  ))}
                </ul>
              ) : (
                EM_DASH
              )}
            </Fact>
            <Fact label={t('carveout.agreements.scope')} wide>
              <span dir="auto">{a.scope ?? EM_DASH}</span>
            </Fact>
            <Fact label={t('carveout.agreements.outstandingIssues')} wide>
              <span dir="auto">{a.outstandingIssues ?? EM_DASH}</span>
            </Fact>
            <Fact label={t('carveout.agreements.obligations')} wide>
              <span dir="auto">{a.obligations ?? EM_DASH}</span>
            </Fact>
          </dl>
        </Section>
        <div className="space-y-4">
          <Section id="agreement-versions" title={t('carveout.agreements.versions')}>
            {a.versions.length === 0 ? (
              <p className="text-sm text-muted">{t('carveout.agreements.noVersions')}</p>
            ) : (
              <ol className="space-y-1.5 text-sm">
                {a.versions.map((v) => (
                  <li key={v.id}>
                    <span className="font-medium" dir="ltr">
                      {v.versionLabel}
                    </span>{' '}
                    <span className="text-muted">
                      · <span dir="auto">{v.recordedByName ?? EM_DASH}</span> · {formatDateTime(v.createdAt)}
                    </span>
                    {v.note ? (
                      <span className="block" dir="auto">
                        {v.note}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </Section>
          <Section id="agreement-links" title={t('carveout.agreements.linked')}>
            <p className="mb-1 text-xs text-muted">{t('carveout.agreements.linkedItems')}</p>
            {a.perimeterItems.length ? (
              <ul className="flex flex-wrap gap-3">
                {a.perimeterItems.map((i) => (
                  <li key={i.id}>
                    <CodeLink href={itemHref(projectId, i.id)} code={i.code} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">{EM_DASH}</p>
            )}
            <p className="mb-1 mt-3 text-xs text-muted">{t('carveout.tabs.consents')}</p>
            {a.consents.length ? (
              <ul className="space-y-1">
                {a.consents.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span dir="ltr">{c.code}</span>
                    <span dir="auto">{c.counterparty}</span>
                    <StatusBadge enumName="consentStatuses" value={c.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">{EM_DASH}</p>
            )}
          </Section>
        </div>
      </div>
      <EvidencePanel className="mt-4" targetType="agreement" targetId={a.id} title={t('carveout.evidence.agreement')} />
      <ActivityHistory className="mt-6" projectId={projectId} entityType="agreement" entityId={a.id} />

      {cmd ? <StageDialog a={a} command={cmd} onClose={() => setCmd(null)} /> : null}
      <EditAgreementDialog a={a} open={edit} onClose={() => setEdit(false)} />
      <FormDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t('carveout.agreements.confirmExpansionTitle', { label: a.kindLabel })}
        submitLabel={t('carveout.agreements.confirmExpansion')}
        disabled={!expansion.expansion.trim() || !expansion.basis.trim()}
        onReload={() => void refresh()}
        onSubmit={async () => {
          await api(C.confirmAgreementExpansion, { params: { projectId, agreementId: a.id }, body: { expectedVersion: a.version, expansion: expansion.expansion.trim(), basis: expansion.basis.trim() } });
          await refresh();
          toast.show('success', t('carveout.agreements.expansionConfirmedToast'));
          setExpansion({ expansion: '', basis: '' });
          setConfirmOpen(false);
        }}
      >
        <p className={hint}>{t('carveout.agreements.confirmExpansionHint')}</p>
        <TextField label={t('carveout.agreements.expansion')} required value={expansion.expansion} maxLength={300} onChange={(e) => setExpansion({ ...expansion, expansion: e.target.value })} />
        <TextAreaField label={t('carveout.agreements.basis')} required rows={2} value={expansion.basis} maxLength={2000} onChange={(e) => setExpansion({ ...expansion, basis: e.target.value })} />
      </FormDialog>
      <FormDialog
        open={versionOpen}
        onClose={() => setVersionOpen(false)}
        title={t('carveout.agreements.addVersion')}
        submitLabel={t('carveout.agreements.addVersion')}
        disabled={!version.label.trim()}
        onReload={() => void refresh()}
        onSubmit={async () => {
          await api(C.addAgreementVersion, { params: { projectId, agreementId: a.id }, body: { expectedVersion: a.version, versionLabel: version.label.trim(), note: version.note.trim() || undefined } });
          await refresh();
          toast.show('success', t('carveout.common.saved'));
          setVersion({ label: '', note: '' });
          setVersionOpen(false);
        }}
      >
        <TextField label={t('carveout.agreements.versionLabel')} required dir="ltr" value={version.label} maxLength={32} onChange={(e) => setVersion({ ...version, label: e.target.value })} />
        <TextAreaField label={t('carveout.common.note')} rows={2} value={version.note} maxLength={2000} onChange={(e) => setVersion({ ...version, note: e.target.value })} />
        <p className={hint}>{t('carveout.agreements.versionHint')}</p>
      </FormDialog>
    </SectionGuard>
  );
}

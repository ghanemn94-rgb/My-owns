'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { useState } from 'react';
import { jvRoutes } from '@hub/contracts';
import { PARTNER_GUARDED_STAGES, PARTNER_STAGES, type PartnerStage } from '@hub/domain';
import { ActivityHistory } from '@/components/ActivityHistory';
import { DataTable } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { ErrorState } from '@/components/ErrorState';
import { SelectField, TextAreaField, TextField } from '@/components/Field';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { RestrictedState } from '@/components/RestrictedState';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn, cx } from '@/components/ui';
import { UserPicker, type PickedUser } from '@/components/UserPicker';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api, isApiError } from '@/lib/api';
import { jvHref, usePartner, useJvRefresh, type PartnerDetail } from '@/lib/jv';
import { useProjectContext } from '@/lib/project-context';
import { ButtonRow, Callout, CmdButton, DocumentLink, DocumentPicker, Facts, JvCommandDialog, NdaNoAccessNotice, Panel, Person, UText } from '../../_components/jv';

type Cmd = 'shortlist' | 'outreach' | 'decideOutreach' | 'submitNda' | 'recordNda' | 'advance' | 'withdraw' | 'conflict' | 'contact' | 'edit' | null;

/** Engagement path (withdrawal is a separate exit). */
const PATH = PARTNER_STAGES.filter((s) => s !== 'withdrawn');

function StagePath({ p }: { p: PartnerDetail }) {
  const { t, tStatus } = useI18n();
  const idx = PATH.indexOf(p.stage as (typeof PATH)[number]);
  return (
    <div data-testid="stage-path" data-stage={p.stage}>
      <ol className="flex flex-wrap gap-1.5" aria-label={t('jv.partner.pathLabel')}>
        {PATH.map((s, i) => {
          const state = p.stage === 'withdrawn' ? 'future' : i < idx ? 'done' : i === idx ? 'current' : 'future';
          return (
            <li
              key={s}
              aria-current={state === 'current' ? 'step' : undefined}
              data-step={s}
              data-state={state}
              className={cx(
                'rounded-full border px-2.5 py-1 text-xs font-medium',
                state === 'current' ? 'border-primary bg-primary text-primary-contrast' : state === 'done' ? 'border-success/40 bg-success-soft text-success' : 'border-line text-muted',
              )}
            >
              <span className="sr-only">{t(`jv.partner.stepState.${state}`)}: </span>
              {tStatus('partnerStages', s)}
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-xs text-muted">{t('jv.partner.pathHint')}</p>
    </div>
  );
}

function PartnerDialogs({ p, cmd, onClose }: { p: PartnerDetail; cmd: Cmd; onClose: () => void }) {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useJvRefresh();
  const toast = useToast();
  const params = { projectId, partnerId: p.id };
  const advanceable = p.nextStages.filter((s) => !PARTNER_GUARDED_STAGES.includes(s));
  const [toStage, setToStage] = useState<PartnerStage | ''>(advanceable[0] ?? '');
  const [outcome, setOutcome] = useState<'approve' | 'reject'>('approve');
  const [ndaOutcome, setNdaOutcome] = useState<'record' | 'reject'>('record');
  const [docId, setDocId] = useState('');
  const [executedOn, setExecutedOn] = useState('');
  const [description, setDescription] = useState('');
  const [mitigation, setMitigation] = useState('');
  const [declarant, setDeclarant] = useState<PickedUser | null>(null);
  const [contact, setContact] = useState<PickedUser | null>(null);
  const [name, setName] = useState(p.name);
  const [desc, setDesc] = useState(p.description ?? '');
  const done = async (msg: string) => {
    await refresh();
    toast.show('success', msg);
    onClose();
  };
  const common = { open: true, onClose, expectedVersion: p.version };
  switch (cmd) {
    case 'shortlist':
      return (
        <JvCommandDialog
          {...common}
          title={p.shortlisted ? t('jv.partner.cmd.unshortlist.title') : t('jv.partner.cmd.shortlist.title')}
          confirmLabel={p.shortlisted ? t('jv.partner.cmd.unshortlist.confirm') : t('jv.partner.cmd.shortlist.confirm')}
          noteMode="required"
          noteLabel={t('jv.common.reason')}
          consequences={[p.shortlisted ? t('jv.partner.cmd.unshortlist.effect') : t('jv.partner.cmd.shortlist.effect'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            await api(jvRoutes.shortlistPartner, { params, body: { expectedVersion: p.version, shortlisted: !p.shortlisted, reason: note } });
            await done(t('jv.common.saved'));
          }}
        />
      );
    case 'outreach':
      return (
        <JvCommandDialog
          {...common}
          title={t('jv.partner.cmd.outreach.title')}
          confirmLabel={t('jv.partner.cmd.outreach.confirm')}
          noteMode="required"
          noteLabel={t('jv.partner.cmd.outreach.note')}
          consequences={[t('jv.partner.cmd.outreach.effect'), t('jv.partner.cmd.outreach.separate'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            await api(jvRoutes.requestOutreach, { params, body: { expectedVersion: p.version, note } });
            await done(t('jv.partner.cmd.outreach.done'));
          }}
        />
      );
    case 'decideOutreach':
      return (
        <JvCommandDialog
          {...common}
          title={t('jv.partner.cmd.decideOutreach.title')}
          confirmLabel={outcome === 'approve' ? t('jv.partner.cmd.decideOutreach.approve') : t('jv.partner.cmd.decideOutreach.reject')}
          danger={outcome === 'reject'}
          consequences={[outcome === 'approve' ? t('jv.partner.cmd.decideOutreach.effectApprove') : t('jv.partner.cmd.decideOutreach.effectReject'), t('jv.partner.cmd.decideOutreach.sod'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            await api(jvRoutes.decideOutreach, { params, body: { expectedVersion: p.version, outcome, ...(note ? { note } : {}) } });
            await done(t('jv.common.saved'));
          }}
        >
          <SelectField label={t('jv.common.outcome')} required value={outcome} onChange={(e) => setOutcome(e.target.value as 'approve' | 'reject')} data-testid="outreach-outcome">
            <option value="approve">{t('jv.partner.cmd.decideOutreach.approve')}</option>
            <option value="reject">{t('jv.partner.cmd.decideOutreach.reject')}</option>
          </SelectField>
        </JvCommandDialog>
      );
    case 'submitNda':
      return (
        <JvCommandDialog
          {...common}
          title={t('jv.partner.cmd.submitNda.title')}
          confirmLabel={t('jv.partner.cmd.submitNda.confirm')}
          confirmDisabled={!docId || !executedOn}
          consequences={[t('jv.partner.cmd.submitNda.effect'), t('jv.partners.ndaNoAccess'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            await api(jvRoutes.submitNda, { params, body: { expectedVersion: p.version, documentId: docId, executedOn, ...(note ? { note } : {}) } });
            await done(t('jv.partner.cmd.submitNda.done'));
          }}
        >
          <DocumentPicker label={t('jv.partner.cmd.submitNda.document')} required value={docId} onChange={setDocId} testId="nda-document" />
          <TextField label={t('jv.partner.cmd.submitNda.executedOn')} required type="date" value={executedOn} onChange={(e) => setExecutedOn(e.target.value)} data-testid="nda-executed-on" />
        </JvCommandDialog>
      );
    case 'recordNda':
      return (
        <JvCommandDialog
          {...common}
          title={t('jv.partner.cmd.recordNda.title')}
          confirmLabel={ndaOutcome === 'record' ? t('jv.partner.cmd.recordNda.record') : t('jv.partner.cmd.recordNda.reject')}
          danger={ndaOutcome === 'reject'}
          consequences={[ndaOutcome === 'record' ? t('jv.partner.cmd.recordNda.effect') : t('jv.partner.cmd.recordNda.effectReject'), t('jv.partners.ndaNoAccess'), t('jv.partner.cmd.recordNda.sod'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            await api(jvRoutes.recordNda, { params, body: { expectedVersion: p.version, outcome: ndaOutcome, ...(note ? { note } : {}) } });
            await done(t('jv.common.saved'));
          }}
        >
          <SelectField label={t('jv.common.outcome')} required value={ndaOutcome} onChange={(e) => setNdaOutcome(e.target.value as 'record' | 'reject')} data-testid="nda-outcome">
            <option value="record">{t('jv.partner.cmd.recordNda.record')}</option>
            <option value="reject">{t('jv.partner.cmd.recordNda.reject')}</option>
          </SelectField>
        </JvCommandDialog>
      );
    case 'advance':
      return (
        <JvCommandDialog
          {...common}
          title={t('jv.partner.cmd.advance.title')}
          confirmLabel={t('jv.partner.cmd.advance.confirm')}
          confirmDisabled={!toStage}
          consequences={[
            toStage ? t('jv.partner.cmd.advance.effect', { from: tStatus('partnerStages', p.stage), to: tStatus('partnerStages', toStage) }) : t('jv.partner.cmd.advance.none'),
            ...(toStage === 'materials_access' ? [t('jv.partner.cmd.advance.materialsNoGrant')] : []),
            t('jv.partner.pathHint'),
            t('common.command.audited'),
          ]}
          onConfirm={async ({ note }) => {
            if (!toStage) return;
            await api(jvRoutes.advancePartner, { params, body: { expectedVersion: p.version, toStage, ...(note ? { note } : {}) } });
            await done(t('jv.partner.cmd.advance.done', { stage: tStatus('partnerStages', toStage) }));
          }}
        >
          <SelectField label={t('jv.partner.cmd.advance.to')} required value={toStage} onChange={(e) => setToStage(e.target.value as PartnerStage)} hint={t('jv.partner.cmd.advance.hint')} data-testid="advance-to">
            {PATH.filter((s) => PATH.indexOf(s) > PATH.indexOf(p.stage as (typeof PATH)[number])).map((s) => (
              <option key={s} value={s} disabled={!advanceable.includes(s)}>
                {tStatus('partnerStages', s)}
                {advanceable.includes(s) ? '' : ` — ${PARTNER_GUARDED_STAGES.includes(s) ? t('jv.partner.cmd.advance.ownCommand') : t('jv.partner.cmd.advance.skipped')}`}
              </option>
            ))}
          </SelectField>
        </JvCommandDialog>
      );
    case 'withdraw':
      return (
        <JvCommandDialog
          {...common}
          title={t('jv.partner.cmd.withdraw.title')}
          confirmLabel={t('jv.partner.cmd.withdraw.confirm')}
          danger
          noteMode="required"
          noteLabel={t('jv.common.reason')}
          consequences={[t('jv.partner.cmd.withdraw.effect'), t('jv.partner.cmd.withdraw.grants'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            const r = await api(jvRoutes.withdrawPartner, { params, body: { expectedVersion: p.version, reason: note } });
            await done(t('jv.partner.cmd.withdraw.done', { count: r.grantsRevoked }));
          }}
        />
      );
    case 'conflict':
      return (
        <JvCommandDialog
          open
          onClose={onClose}
          title={t('jv.partner.conflicts.add')}
          confirmLabel={t('jv.partner.conflicts.confirm')}
          noteMode="none"
          confirmDisabled={!description.trim()}
          consequences={[t('jv.partner.conflicts.effect'), t('common.command.audited')]}
          onConfirm={async () => {
            await api(jvRoutes.addPartnerConflict, { params, body: { description: description.trim(), ...(mitigation.trim() ? { mitigation: mitigation.trim() } : {}), ...(declarant ? { declarantUserId: declarant.id } : {}) } });
            await done(t('jv.common.saved'));
          }}
        >
          <UserPicker label={t('jv.partner.conflicts.declarant')} value={declarant} onChange={setDeclarant} />
          <TextAreaField label={t('jv.partner.conflicts.description')} required value={description} maxLength={4000} onChange={(e) => setDescription(e.target.value)} />
          <TextAreaField label={t('jv.partner.conflicts.mitigation')} value={mitigation} maxLength={4000} onChange={(e) => setMitigation(e.target.value)} />
        </JvCommandDialog>
      );
    case 'contact':
      return (
        <JvCommandDialog
          open
          onClose={onClose}
          title={t('jv.partner.contacts.add')}
          confirmLabel={t('jv.partner.contacts.confirm')}
          confirmDisabled={!contact}
          consequences={[t('jv.partner.contacts.effect'), t('jv.partner.contacts.noAccess'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            if (!contact) return;
            await api(jvRoutes.addPartnerContact, { params, body: { userId: contact.id, ...(note ? { note } : {}) } });
            await done(t('jv.common.saved'));
          }}
        >
          <UserPicker label={t('jv.partner.contacts.user')} required value={contact} onChange={setContact} />
        </JvCommandDialog>
      );
    case 'edit':
      return (
        <JvCommandDialog
          {...common}
          title={t('jv.partner.cmd.edit.title')}
          confirmLabel={t('jv.common.save')}
          noteMode="none"
          confirmDisabled={!name.trim()}
          consequences={[t('jv.partner.cmd.edit.effect'), t('common.command.audited')]}
          onConfirm={async () => {
            await api(jvRoutes.updatePartner, { params, body: { expectedVersion: p.version, name: name.trim(), description: desc.trim() || null } });
            await done(t('jv.common.saved'));
          }}
        >
          <TextField label={t('jv.partners.create.name')} required value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
          <TextAreaField label={t('jv.partners.create.description')} value={desc} maxLength={4000} onChange={(e) => setDesc(e.target.value)} />
        </JvCommandDialog>
      );
    default:
      return null;
  }
}

function RevokeContactDialog({ p, contactId, onClose }: { p: PartnerDetail; contactId: string; onClose: () => void }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useJvRefresh();
  const toast = useToast();
  return (
    <JvCommandDialog
      open
      onClose={onClose}
      title={t('jv.partner.contacts.revoke')}
      confirmLabel={t('jv.partner.contacts.revokeConfirm')}
      danger
      noteMode="required"
      noteLabel={t('jv.common.reason')}
      consequences={[t('jv.partner.contacts.revokeEffect'), t('common.command.audited')]}
      onConfirm={async ({ note }) => {
        const r = await api(jvRoutes.revokePartnerContact, { params: { projectId, partnerId: p.id, contactId }, body: { reason: note } });
        await refresh();
        toast.show('success', t('jv.partner.cmd.withdraw.done', { count: r.grantsRevoked }));
        onClose();
      }}
    />
  );
}

/** Partner detail: engagement stage, outreach approval, NDA (no access by itself), conflicts and external contacts. */
export default function PartnerPage() {
  const { partnerId } = useParams<{ partnerId: string }>();
  const { t, tStatus, formatDate, formatDateTime } = useI18n();
  const { projectId, can, me } = useProjectContext();
  const [cmd, setCmd] = useState<Cmd>(null);
  const [revoke, setRevoke] = useState<string | null>(null);
  const q = usePartner(partnerId);
  const base = jvHref(projectId);
  if (q.isLoading) return <LoadingState />;
  if (q.error) return isApiError(q.error) && (q.error.status === 404 || q.error.status === 403) ? <RestrictedState /> : <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const p = q.data!;
  const people = p.people;
  const withdrawn = p.stage === 'withdrawn';
  const outreachPending = p.outreach.request?.status === 'pending';
  const ndaPending = p.nda.request?.status === 'pending';
  const advanceable = p.nextStages.filter((s) => !PARTNER_GUARDED_STAGES.includes(s));
  const openConflictMine = p.conflicts.some((c) => c.status === 'open' && c.declarantUserId === me.user.id);
  const commands = [
    { key: 'outreach' as const, show: can('jv.partner.manage') && p.stage === 'identified' && !outreachPending, primary: true },
    { key: 'decideOutreach' as const, show: can('jv.partner.approve_contact') && outreachPending && p.outreach.request?.requestedBy !== me.user.id && !openConflictMine, primary: true },
    { key: 'submitNda' as const, show: can('jv.partner.advance_stage') && p.stage === 'approved_for_contact' && !ndaPending, primary: true },
    { key: 'recordNda' as const, show: can('jv.nda.record') && ndaPending && p.nda.request?.requestedBy !== me.user.id && !openConflictMine, primary: true },
    { key: 'advance' as const, show: can('jv.partner.advance_stage') && advanceable.length > 0, primary: true },
    { key: 'shortlist' as const, show: can('jv.partner.manage') && !withdrawn, primary: false },
    { key: 'withdraw' as const, show: can('jv.partner.advance_stage') && !withdrawn && p.stage !== 'closing', primary: false },
    { key: 'edit' as const, show: can('jv.partner.manage'), primary: false },
  ].filter((c) => c.show);
  const pendingNotMine = (outreachPending && p.outreach.request?.requestedBy === me.user.id) || (ndaPending && p.nda.request?.requestedBy === me.user.id);

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`${base}/partners`} className="inline-flex items-center gap-1 hover:underline">
            <ChevronLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
            {t('jv.partners.title')}
          </Link>
        }
        title={
          <span>
            <span dir="ltr">{p.code}</span> — <span dir="auto">{p.name}</span>
          </span>
        }
        documentTitle={`${p.code} — ${p.name}`}
        badges={
          <>
            <StatusBadge enumName="partnerStages" value={p.stage} size="md" />
            <StatusBadge enumName="partnerStages" value={p.shortlisted ? 'shortlisted' : 'longlist'} tone={p.shortlisted ? 'info' : 'neutral'} label={p.shortlisted ? t('jv.partners.shortlisted') : t('jv.partners.longlist')} />
            <StatusBadge enumName="ndaStatuses" value={p.ndaStatus} tone={p.ndaStatus === 'executed' ? 'success' : 'neutral'} label={t('jv.partner.ndaBadge', { status: tStatus('ndaStatuses', p.ndaStatus) })} />
            <span className="text-xs text-muted">{tStatus('classifications', p.classification)}</span>
            {p.isDemo ? <DemoBadge /> : null}
          </>
        }
        description={p.description ? <UText value={p.description} multiline /> : undefined}
      />
      <div className="space-y-6" data-testid="partner-detail" data-stage={p.stage} data-version={p.version}>
        <Panel title={t('jv.partner.pathTitle')} testId="partner-path">
          <StagePath p={p} />
          {withdrawn ? (
            <Callout tone="warning" className="mt-3">
              {t('jv.partner.withdrawn', { reason: p.withdrawnReason ?? EM_DASH })}
            </Callout>
          ) : null}
        </Panel>

        <Panel
          title={t('jv.common.commands')}
          testId="partner-commands"
          actions={
            <ButtonRow>
              {commands.map((c) => (
                <CmdButton key={c.key} label={t(`jv.partner.cmd.${c.key === 'shortlist' && p.shortlisted ? 'unshortlist' : c.key}.action`)} onClick={() => setCmd(c.key)} testId={`cmd-${c.key}`} variant={c.primary ? 'primary' : 'secondary'} />
              ))}
            </ButtonRow>
          }
        >
          {commands.length === 0 ? <p className="text-sm text-muted">{t('jv.common.noCommands')}</p> : null}
          {pendingNotMine ? <p className="text-sm text-muted" data-testid="own-request-note">{t('jv.partner.ownRequest')}</p> : null}
          {openConflictMine ? <p className="text-sm text-danger">{t('jv.partner.conflictedYou')}</p> : null}
        </Panel>

        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title={t('jv.partner.outreach.title')} description={t('jv.partner.outreach.hint')} testId="outreach-panel">
            <Facts
              items={[
                { label: t('jv.partner.outreach.request'), value: p.outreach.request ? <StatusBadge enumName="approvalRequestStatuses" value={p.outreach.request.status} /> : t('jv.partner.notRequested'), testId: 'outreach-request' },
                { label: t('jv.common.requestedBy'), value: p.outreach.request ? <Person id={p.outreach.request.requestedBy} people={people} /> : EM_DASH },
                { label: t('jv.partner.outreach.approvedBy'), value: p.outreach.approvedBy ? <span><Person id={p.outreach.approvedBy} people={people} /> · <span className="tabular">{formatDateTime(p.outreach.approvedAt)}</span></span> : EM_DASH },
              ]}
            />
          </Panel>
          <Panel title={t('jv.partner.nda.title')} testId="nda-panel">
            <Facts
              items={[
                { label: t('jv.partner.nda.status'), value: <StatusBadge enumName="ndaStatuses" value={p.nda.status} />, testId: 'nda-status' },
                { label: t('jv.partner.nda.executedOn'), value: <span className="tabular">{formatDate(p.nda.executedOn)}</span> },
                { label: t('jv.partner.nda.document'), value: <DocumentLink id={p.nda.documentId} /> },
                { label: t('jv.partner.nda.request'), value: p.nda.request ? <StatusBadge enumName="approvalRequestStatuses" value={p.nda.request.status} /> : t('jv.partner.notRequested') },
                { label: t('jv.partner.nda.recordedBy'), value: p.nda.recordedBy ? <span><Person id={p.nda.recordedBy} people={people} /> · <span className="tabular">{formatDateTime(p.nda.recordedAt)}</span></span> : EM_DASH },
              ]}
            />
            <NdaNoAccessNotice testId="nda-panel-no-access" />
          </Panel>
          <Panel title={t('jv.partner.materials.title')} description={t('jv.partner.materials.hint')} testId="materials-panel">
            <Facts
              items={[
                { label: t('jv.partner.materials.approvedBy'), value: p.materialsAccessApprovedBy ? <span><Person id={p.materialsAccessApprovedBy} people={people} /> · <span className="tabular">{formatDateTime(p.materialsAccessApprovedAt)}</span></span> : EM_DASH },
              ]}
            />
            <p className="mt-2 text-sm">
              <Link className={btn.link} href={`${base}/rooms`}>
                {t('jv.partner.materials.rooms')}
              </Link>
            </p>
          </Panel>
        </div>

        <section className="space-y-2" data-testid="partner-conflicts">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-ink">{t('jv.partner.conflicts.title')}</h2>
            {can('jv.partner.manage') ? <CmdButton label={t('jv.partner.conflicts.add')} onClick={() => setCmd('conflict')} testId="cmd-conflict" /> : null}
          </div>
          <p className="text-sm text-muted">{t('jv.partner.conflicts.hint')}</p>
          <DataTable
            caption={t('jv.partner.conflicts.title')}
            columns={[
              { key: 'description', header: t('jv.partner.conflicts.description'), isRowHeader: true, cell: (c) => <UText value={c.description} multiline /> },
              { key: 'declarant', header: t('jv.partner.conflicts.declarant'), cell: (c) => <Person id={c.declarantUserId} people={people} /> },
              { key: 'mitigation', header: t('jv.partner.conflicts.mitigation'), cell: (c) => <UText value={c.mitigation} /> },
              { key: 'status', header: t('jv.common.status'), cell: (c) => <StatusBadge enumName="partnerConflictStatuses" value={c.status} tone={c.status === 'open' ? 'warning' : 'neutral'} /> },
              { key: 'at', header: t('jv.common.recordedAt'), cell: (c) => <span className="tabular">{formatDateTime(c.createdAt)}</span> },
            ]}
            rows={p.conflicts}
            rowKey={(c) => c.id}
            emptyTitle={t('jv.partner.conflicts.empty')}
          />
        </section>

        <section className="space-y-2" data-testid="partner-contacts">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-ink">{t('jv.partner.contacts.title')}</h2>
            {can('jv.room.grant_access') && !withdrawn ? <CmdButton label={t('jv.partner.contacts.add')} onClick={() => setCmd('contact')} testId="cmd-contact" /> : null}
          </div>
          <p className="text-sm text-muted">{t('jv.partner.contacts.hint')}</p>
          <DataTable
            caption={t('jv.partner.contacts.title')}
            columns={[
              { key: 'user', header: t('jv.partner.contacts.user'), isRowHeader: true, cell: (c) => <Person id={c.userId} people={people} /> },
              { key: 'note', header: t('jv.common.note'), cell: (c) => <UText value={c.note} /> },
              { key: 'bound', header: t('jv.partner.contacts.boundAt'), cell: (c) => <span className="tabular">{formatDateTime(c.createdAt)}</span> },
              {
                key: 'state',
                header: t('jv.common.status'),
                cell: (c) =>
                  c.revokedAt ? (
                    <StatusBadge enumName="roomAccessEventKinds" value="grant_revoked" tone="neutral" label={t('jv.partner.contacts.revokedAt', { at: formatDateTime(c.revokedAt) })} />
                  ) : (
                    <StatusBadge enumName="roomAccessEventKinds" value="grant" tone="success" label={t('jv.partner.contacts.active')} />
                  ),
              },
              {
                key: 'cmd',
                header: t('jv.common.commands'),
                cell: (c) => (!c.revokedAt && can('jv.room.grant_access') ? <CmdButton label={t('jv.partner.contacts.revoke')} onClick={() => setRevoke(c.id)} testId="cmd-revoke-contact" /> : <span className="text-muted">{EM_DASH}</span>),
              },
            ]}
            rows={p.contacts}
            rowKey={(c) => c.id}
            emptyTitle={t('jv.partner.contacts.empty')}
          />
        </section>

        <Panel title={t('jv.partner.proposalsTitle')} testId="partner-proposals-link">
          <p className="text-sm text-muted">{t('jv.partner.proposalsHint')}</p>
          <p className="mt-2">
            <Link className={btn.link} href={`${base}/proposals?partnerId=${p.id}`}>
              {t('jv.partner.openProposals')}
            </Link>
          </p>
        </Panel>

        <Panel title={t('jv.common.details')}>
          <Facts
            items={[
              { label: t('jv.partner.stageChangedAt'), value: <span className="tabular">{formatDateTime(p.stageChangedAt)}</span> },
              { label: t('jv.common.createdBy'), value: <Person id={p.createdBy} people={people} /> },
              { label: t('jv.common.createdAt'), value: <span className="tabular">{formatDateTime(p.createdAt)}</span> },
              { label: t('jv.partner.weightedScore'), value: p.weightedScore ?? t('jv.partners.notScored') },
            ]}
          />
        </Panel>
        <ActivityHistory projectId={projectId} entityType="partner" entityId={p.id} />
      </div>
      {cmd ? <PartnerDialogs key={`${cmd}-${p.version}`} p={p} cmd={cmd} onClose={() => setCmd(null)} /> : null}
      {revoke ? <RevokeContactDialog p={p} contactId={revoke} onClose={() => setRevoke(null)} /> : null}
    </>
  );
}

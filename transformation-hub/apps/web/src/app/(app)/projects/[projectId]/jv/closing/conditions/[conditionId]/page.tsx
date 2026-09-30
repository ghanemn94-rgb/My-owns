'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import { useState } from 'react';
import { jvRoutes } from '@hub/contracts';
import { CP_LONG_STOP_EXTENSION_DECISION_TYPE_KEYS, ROLE_KEYS, type RoleKey } from '@hub/domain';
import { ActivityHistory } from '@/components/ActivityHistory';
import { DataTable } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { ErrorState } from '@/components/ErrorState';
import { EvidencePanel } from '@/components/EvidencePanel';
import { SelectField, TextAreaField, TextField } from '@/components/Field';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { RestrictedState } from '@/components/RestrictedState';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn } from '@/components/ui';
import { UserPicker, type PickedUser } from '@/components/UserPicker';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api, isApiError } from '@/lib/api';
import { jk, jvHref, useJvRefresh, type ConditionDetail } from '@/lib/jv';
import { useProjectContext } from '@/lib/project-context';
import { ButtonRow, Callout, CmdButton, DecisionSelect, Facts, Flag, JvCommandDialog, Panel, Person, UText, WaivabilityBadge } from '../../../_components/jv';

type Cmd = 'submit' | 'verify' | 'reopen' | 'determine' | 'waiver' | 'edit' | 'extend' | null;
/** DOM-P4-04: a long-stop date moves later only through an approved extension, while the condition is unsatisfied. */
const EXTENDABLE: readonly string[] = ['open', 'evidence_submitted', 'lapsed'];
type Waiver = ConditionDetail['waivers'][number];

function ConditionDialogs({ c, cmd, onClose }: { c: ConditionDetail; cmd: Cmd; onClose: () => void }) {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useJvRefresh();
  const toast = useToast();
  const params = { projectId, conditionId: c.id };
  const [outcome, setOutcome] = useState<'verify' | 'reject_evidence'>('verify');
  const [blocking, setBlocking] = useState(c.blocking);
  const [waivable, setWaivable] = useState(c.waivable);
  const [authority, setAuthority] = useState<RoleKey | ''>(c.waiverAuthorityRole ?? '');
  const [basis, setBasis] = useState('');
  const [impact, setImpact] = useState('');
  const [conditions, setConditions] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [title, setTitle] = useState(c.title);
  const [description, setDescription] = useState(c.description ?? '');
  const [owner, setOwner] = useState<PickedUser | null>(null);
  const [parties, setParties] = useState(c.parties ?? '');
  const [validTo, setValidTo] = useState(c.validTo ?? '');
  const [longStop, setLongStop] = useState(c.longStopDate ?? '');
  const [extDate, setExtDate] = useState('');
  const [extDecision, setExtDecision] = useState('');
  const validityLocked = c.status === 'verified' || c.status === 'waived';
  const done = async (msg: string) => {
    await refresh();
    toast.show('success', msg);
    onClose();
  };
  switch (cmd) {
    case 'submit':
      return (
        <JvCommandDialog
          open
          onClose={onClose}
          title={t('jv.cp.cmd.submit.title')}
          confirmLabel={t('jv.cp.cmd.submit.confirm')}
          expectedVersion={c.version}
          consequences={[t('jv.cp.cmd.submit.effect'), t('jv.cp.cmd.verify.sod'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            const r = await api(jvRoutes.submitConditionEvidence, { params, body: { expectedVersion: c.version, ...(note ? { note } : {}) } });
            await done(t('jv.common.statusNow', { status: tStatus('conditionStatuses', r.status) }));
          }}
        />
      );
    case 'verify':
      return (
        <JvCommandDialog
          open
          onClose={onClose}
          title={t('jv.cp.cmd.verify.title')}
          confirmLabel={outcome === 'verify' ? t('jv.cp.cmd.verify.verify') : t('jv.cp.cmd.verify.reject')}
          danger={outcome === 'reject_evidence'}
          expectedVersion={c.version}
          consequences={[outcome === 'verify' ? t('jv.cp.cmd.verify.effect') : t('jv.cp.cmd.verify.effectReject'), t('jv.cp.cmd.verify.sod'), t('jv.cp.cmd.verify.human'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            const r = await api(jvRoutes.verifyCondition, { params, body: { expectedVersion: c.version, outcome, ...(note ? { note } : {}) } });
            await done(t('jv.common.statusNow', { status: tStatus('conditionStatuses', r.status) }));
          }}
        >
          <SelectField label={t('jv.common.outcome')} required value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)} data-testid="verify-outcome">
            <option value="verify">{t('jv.cp.cmd.verify.verify')}</option>
            <option value="reject_evidence">{t('jv.cp.cmd.verify.reject')}</option>
          </SelectField>
        </JvCommandDialog>
      );
    case 'reopen':
      return (
        <JvCommandDialog
          open
          onClose={onClose}
          title={t('jv.cp.cmd.reopen.title')}
          confirmLabel={t('jv.cp.cmd.reopen.confirm')}
          noteMode="required"
          noteLabel={t('jv.common.reason')}
          expectedVersion={c.version}
          consequences={[t('jv.cp.cmd.reopen.effect'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            const r = await api(jvRoutes.reopenCondition, { params, body: { expectedVersion: c.version, reason: note } });
            await done(t('jv.common.statusNow', { status: tStatus('conditionStatuses', r.status) }));
          }}
        />
      );
    case 'determine':
      return (
        <JvCommandDialog
          open
          onClose={onClose}
          title={t('jv.cp.cmd.determine.title')}
          confirmLabel={t('jv.cp.cmd.determine.confirm')}
          noteMode="none"
          expectedVersion={c.version}
          confirmDisabled={!basis.trim() || (waivable && !authority)}
          consequences={[t('jv.cp.cmd.determine.effect'), t('jv.cp.cmd.determine.legalOnly'), ...(c.blocking ? [t('jv.cp.cmd.determine.blockingLocked')] : []), t('common.command.audited')]}
          onConfirm={async () => {
            await api(jvRoutes.determineConditionWaivability, { params, body: { expectedVersion: c.version, blocking, waivable, waiverAuthorityRole: waivable && authority ? authority : null, basis: basis.trim() } });
            await done(t('jv.common.saved'));
          }}
        >
          <div className="flex flex-wrap gap-4">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={blocking} disabled={c.blocking} onChange={(e) => setBlocking(e.target.checked)} data-testid="determine-blocking" />
              {t('jv.cp.fields.blockingCheckbox')}
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={waivable} onChange={(e) => setWaivable(e.target.checked)} data-testid="determine-waivable" />
              {t('jv.cp.cmd.determine.waivable')}
            </label>
          </div>
          {waivable ? (
            <SelectField label={t('jv.cp.fields.waiverAuthority')} required value={authority} onChange={(e) => setAuthority(e.target.value as RoleKey | '')}>
              <option value="">{t('jv.common.select')}</option>
              {ROLE_KEYS.map((r) => (
                <option key={r} value={r}>
                  {tStatus('roleKeys', r)}
                </option>
              ))}
            </SelectField>
          ) : null}
          <TextAreaField label={t('jv.cp.fields.waivabilityBasis')} required value={basis} maxLength={4000} onChange={(e) => setBasis(e.target.value)} />
        </JvCommandDialog>
      );
    case 'waiver':
      return (
        <JvCommandDialog
          open
          onClose={onClose}
          title={t('jv.cp.waivers.requestTitle')}
          confirmLabel={t('jv.cp.waivers.requestConfirm')}
          noteMode="none"
          confirmDisabled={!basis.trim() || !impact.trim()}
          consequences={[t('jv.cp.waivers.requestEffect', { role: c.waiverAuthorityRole ? tStatus('roleKeys', c.waiverAuthorityRole) : EM_DASH }), t('jv.cp.waivers.aiCannot'), t('common.command.audited')]}
          onConfirm={async () => {
            await api(jvRoutes.requestConditionWaiver, { params, body: { basis: basis.trim(), impact: impact.trim(), ...(conditions.trim() ? { conditions: conditions.trim() } : {}), ...(expiresOn ? { expiresOn } : {}) } });
            await done(t('jv.cp.waivers.requested'));
          }}
        >
          <TextAreaField label={t('jv.cp.waivers.basis')} required value={basis} maxLength={4000} onChange={(e) => setBasis(e.target.value)} data-testid="waiver-basis" />
          <TextAreaField label={t('jv.cp.waivers.impact')} required value={impact} maxLength={4000} onChange={(e) => setImpact(e.target.value)} data-testid="waiver-impact" />
          <TextField label={t('jv.cp.waivers.conditions')} value={conditions} maxLength={4000} onChange={(e) => setConditions(e.target.value)} />
          <TextField label={t('jv.cp.waivers.expiresOn')} type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
        </JvCommandDialog>
      );
    case 'extend':
      return (
        <JvCommandDialog
          open
          onClose={onClose}
          title={t('jv.cp.cmd.extend.title')}
          confirmLabel={t('jv.cp.cmd.extend.confirm')}
          noteMode="required"
          noteLabel={t('jv.common.reason')}
          expectedVersion={c.version}
          confirmDisabled={!extDate || !extDecision}
          consequences={[t('jv.cp.cmd.extend.effect'), t('jv.cp.cmd.extend.decisionRule'), ...(c.status === 'lapsed' ? [t('jv.cp.cmd.extend.reopens')] : []), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            const r = await api(jvRoutes.extendConditionLongStop, { params, body: { expectedVersion: c.version, longStopDate: extDate, decisionId: extDecision, reason: note } });
            await done(t('jv.common.statusNow', { status: tStatus('conditionStatuses', r.status) }));
          }}
        >
          <TextField label={t('jv.cp.cmd.extend.newDate')} type="date" required value={extDate} min={c.longStopDate ?? undefined} onChange={(e) => setExtDate(e.target.value)} data-testid="extend-date" />
          <DecisionSelect typeKeys={CP_LONG_STOP_EXTENSION_DECISION_TYPE_KEYS} value={extDecision} onChange={setExtDecision} testId="extend-decision" />
        </JvCommandDialog>
      );
    case 'edit':
      return (
        <JvCommandDialog
          open
          onClose={onClose}
          title={t('jv.cp.cmd.edit.title')}
          confirmLabel={t('jv.common.save')}
          noteMode="none"
          expectedVersion={c.version}
          confirmDisabled={!title.trim()}
          consequences={[t('jv.cp.cmd.edit.effect'), t('common.command.audited')]}
          onConfirm={async () => {
            await api(jvRoutes.updateCondition, {
              params,
              body: {
                expectedVersion: c.version,
                title: title.trim(),
                description: description.trim() || null,
                parties: parties.trim() || null,
                // Unchanged dates are not sent, so a locked validity / long-stop date never blocks an edit of other fields.
                ...((validTo || null) !== c.validTo ? { validTo: validTo || null } : {}),
                ...((longStop || null) !== c.longStopDate ? { longStopDate: longStop || null } : {}),
                ...(owner ? { ownerUserId: owner.id } : {}),
              },
            });
            await done(t('jv.common.saved'));
          }}
        >
          <TextField label={t('jv.cp.fields.title')} required value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} />
          <TextAreaField label={t('jv.cp.fields.description')} value={description} maxLength={4000} onChange={(e) => setDescription(e.target.value)} />
          <UserPicker label={t('jv.cp.fields.ownerChange')} value={owner} onChange={setOwner} />
          <TextField label={t('jv.cp.fields.parties')} value={parties} maxLength={1000} onChange={(e) => setParties(e.target.value)} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label={t('jv.cp.fields.validTo')} type="date" value={validTo} disabled={validityLocked} hint={validityLocked ? t('jv.cp.cmd.edit.validityLocked') : undefined} onChange={(e) => setValidTo(e.target.value)} />
            <TextField label={t('jv.cp.fields.longStop')} type="date" value={longStop} disabled={c.status === 'lapsed'} hint={t('jv.cp.cmd.edit.longStopRule')} onChange={(e) => setLongStop(e.target.value)} />
          </div>
        </JvCommandDialog>
      );
    default:
      return null;
  }
}

function WaiverCommands({ w, c }: { w: Waiver; c: ConditionDetail }) {
  const { t } = useI18n();
  const { projectId, can, me } = useProjectContext();
  const refresh = useJvRefresh();
  const toast = useToast();
  const [open, setOpen] = useState<'approve' | 'reject' | null>(null);
  if (w.status !== 'requested' || !can('jv.cp.waive') || !c.waivable) return <span className="text-muted">{EM_DASH}</span>;
  if (w.requestedBy === me.user.id) return <span className="text-xs text-muted">{t('jv.cp.waivers.ownRequest')}</span>;
  return (
    <>
      <ButtonRow>
        <CmdButton label={t('jv.cp.waivers.approve')} onClick={() => setOpen('approve')} testId="cmd-approve-waiver" />
        <CmdButton label={t('jv.cp.waivers.reject')} onClick={() => setOpen('reject')} testId="cmd-reject-waiver" />
      </ButtonRow>
      {open ? (
        <JvCommandDialog
          open
          onClose={() => setOpen(null)}
          title={open === 'approve' ? t('jv.cp.waivers.approveTitle') : t('jv.cp.waivers.rejectTitle')}
          confirmLabel={open === 'approve' ? t('jv.cp.waivers.approve') : t('jv.cp.waivers.reject')}
          danger={open === 'reject'}
          noteMode={open === 'reject' ? 'required' : 'optional'}
          expectedVersion={w.version}
          consequences={[open === 'approve' ? t('jv.cp.waivers.approveEffect') : t('jv.cp.waivers.rejectEffect'), t('jv.cp.waivers.sod'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            if (open === 'approve') await api(jvRoutes.approveConditionWaiver, { params: { projectId, waiverId: w.id }, body: { expectedVersion: w.version, ...(note ? { note } : {}) } });
            else await api(jvRoutes.rejectConditionWaiver, { params: { projectId, waiverId: w.id }, body: { expectedVersion: w.version, note } });
            await refresh();
            toast.show('success', t('jv.common.saved'));
            setOpen(null);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * One condition precedent (REQ-JV-013): evidence, waivability (a non-waivable CP offers no waiver at all — AT-13),
 * verification by someone other than the owner or the evidence submitter, and its waivers.
 */
export default function ConditionPage() {
  const { conditionId } = useParams<{ conditionId: string }>();
  const { t, tStatus, formatDate, formatDateTime } = useI18n();
  const { projectId, can, me } = useProjectContext();
  const [cmd, setCmd] = useState<Cmd>(null);
  const q = useQuery({ queryKey: jk.condition(projectId, conditionId), queryFn: ({ signal }) => api(jvRoutes.getCondition, { params: { projectId, conditionId }, signal }) });
  const base = jvHref(projectId);
  if (q.isLoading) return <LoadingState />;
  if (q.error) return isApiError(q.error) && (q.error.status === 404 || q.error.status === 403) ? <RestrictedState /> : <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const c = q.data!;
  const people = c.people;
  const open = c.status === 'open' || c.status === 'evidence_submitted';
  const iAmOwner = c.ownerUserId === me.user.id;
  const iSubmitted = c.evidenceSubmittedBy === me.user.id;
  const canVerifyRole = can('jv.cp.verify');
  const verifyBlockedBySod = canVerifyRole && c.status === 'evidence_submitted' && (iAmOwner || iSubmitted);
  const pendingWaiver = c.waivers.some((w) => w.status === 'requested');
  const commands = [
    { key: 'submit' as const, show: can('jv.cp.manage') && c.allowedCommands.includes('submit_evidence') },
    { key: 'verify' as const, show: canVerifyRole && c.allowedCommands.includes('verify') && !iAmOwner && !iSubmitted },
    { key: 'reopen' as const, show: can('jv.cp.manage') && c.allowedCommands.includes('reopen') },
    // AT-13: a waiver is requestable only for a CP a specialist determined waivable — never for a non-waivable one.
    { key: 'waiver' as const, show: can('jv.cp.manage') && c.waivable && open && !pendingWaiver },
    // business-gates.md §7 (DOM-P4-03): blocking status and waivability are determined by Legal specialists only.
    { key: 'determine' as const, show: can('jv.cp.set_waivability') && open },
    { key: 'extend' as const, show: can('jv.cp.manage') && !!c.longStopDate && EXTENDABLE.includes(c.status) },
    { key: 'edit' as const, show: can('jv.cp.manage') },
  ].filter((x) => x.show);

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={c.closingId ? `${base}/closing/closings/${c.closingId}` : `${base}/closing?tab=conditions`} className="inline-flex items-center gap-1 hover:underline">
            <ChevronLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
            {c.closingId ? t('jv.cp.backToClosing') : t('jv.closing.tabs.conditions')}
          </Link>
        }
        title={
          <span>
            <span dir="ltr">{c.reference}</span> — <span dir="auto">{c.title}</span>
          </span>
        }
        documentTitle={`${c.reference} — ${c.title}`}
        badges={
          <>
            <StatusBadge enumName="conditionStatuses" value={c.status} size="md" />
            <Flag on={c.blocking} danger onLabel={t('jv.cp.blocking')} offLabel={t('jv.cp.nonBlocking')} />
            <WaivabilityBadge c={c} />
            <StatusBadge enumName="conditionKinds" value={c.kind} tone="neutral" />
            {c.isDemo ? <DemoBadge /> : null}
          </>
        }
        description={c.description ? <UText value={c.description} multiline /> : undefined}
      />
      <div className="space-y-6" data-testid="cp-detail" data-status={c.status} data-waivable={c.waivable ? 'true' : 'false'}>
        {!c.waivable ? (
          <Callout tone="danger" testId="cp-not-waivable">
            {c.waivabilityDeterminedBy ? t('jv.cp.nonWaivableNotice') : t('jv.cp.notDeterminedNotice')}
          </Callout>
        ) : (
          <Callout testId="cp-waivable-notice">{t('jv.cp.waivableNotice', { role: c.waiverAuthorityRole ? tStatus('roleKeys', c.waiverAuthorityRole) : EM_DASH })}</Callout>
        )}
        {c.status === 'waived' && !c.waiverEffective ? <Callout tone="danger">{t('jv.cp.waiverNotEffective')}</Callout> : null}
        {c.status === 'lapsed' ? (
          <Callout tone="danger" testId="cp-lapsed">
            {t('jv.cp.lapsedNotice', { date: formatDate(c.longStopDate) })}
          </Callout>
        ) : null}

        <Panel
          title={t('jv.common.commands')}
          testId="cp-commands"
          actions={
            <ButtonRow>
              {commands.map((x) => (
                <CmdButton key={x.key} label={t(`jv.cp.cmd.${x.key}.action`)} onClick={() => setCmd(x.key)} testId={`cmd-${x.key}`} variant={x.key === 'verify' || x.key === 'submit' ? 'primary' : 'secondary'} />
              ))}
            </ButtonRow>
          }
        >
          {commands.length === 0 ? <p className="text-sm text-muted">{t('jv.common.noCommands')}</p> : null}
          {verifyBlockedBySod ? (
            <p className="text-sm text-muted" data-testid="verify-sod-note">
              {iAmOwner ? t('jv.cp.sodOwner') : t('jv.cp.sodSubmitter')}
            </p>
          ) : null}
          {c.status === 'open' && c.evidence.active === 0 ? <p className="text-sm text-muted">{t('jv.cp.evidenceFirst')}</p> : null}
        </Panel>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title={t('jv.cp.waivabilityTitle')} testId="cp-waivability">
            <Facts
              items={[
                { label: t('jv.cp.fields.waivable'), value: <WaivabilityBadge c={c} /> },
                { label: t('jv.cp.fields.waiverAuthority'), value: c.waiverAuthorityRole ? tStatus('roleKeys', c.waiverAuthorityRole) : EM_DASH },
                { label: t('jv.cp.fields.waivabilityBasis'), value: <UText value={c.waivabilityBasis} multiline />, wide: true },
                { label: t('jv.cp.fields.determinedBy'), value: <Person id={c.waivabilityDeterminedBy} people={people} /> },
              ]}
            />
          </Panel>
          <Panel title={t('jv.cp.verificationTitle')} testId="cp-verification">
            <Facts
              items={[
                { label: t('jv.cp.fields.owner'), value: <Person id={c.ownerUserId} people={people} /> },
                { label: t('jv.cp.fields.evidenceSubmittedBy'), value: <Person id={c.evidenceSubmittedBy} people={people} /> },
                { label: t('jv.cp.fields.verifiedBy'), value: c.verifiedBy ? <span><Person id={c.verifiedBy} people={people} /> · <span className="tabular">{formatDateTime(c.verifiedAt)}</span></span> : EM_DASH, testId: 'cp-verified-by' },
                { label: t('jv.common.note'), value: <UText value={c.statusNote} /> },
              ]}
            />
          </Panel>
        </div>

        <Panel title={t('jv.common.details')}>
          <Facts
            items={[
              { label: t('jv.cp.fields.parties'), value: <UText value={c.parties} /> },
              { label: t('jv.cp.fields.validTo'), value: <span className="tabular">{formatDate(c.validTo)}</span> },
              { label: t('jv.cp.fields.longStop'), value: <span className="tabular">{formatDate(c.longStopDate)}</span> },
              {
                label: t('jv.cp.fields.longStopExtension'),
                value: c.longStopExtendedBy ? (
                  <span>
                    <Person id={c.longStopExtendedBy} people={people} /> · <span className="tabular">{formatDateTime(c.longStopExtendedAt)}</span>
                  </span>
                ) : (
                  EM_DASH
                ),
                testId: 'cp-long-stop-extension',
              },
              { label: t('jv.cp.fields.gate'), value: c.gateKey ? <span dir="ltr">{c.gateKey}</span> : EM_DASH },
              { label: t('jv.common.updated'), value: <span className="tabular">{formatDateTime(c.updatedAt)}</span> },
            ]}
          />
        </Panel>

        <section className="space-y-2" data-testid="cp-waivers">
          <h2 className="text-lg font-semibold text-ink">{t('jv.cp.waivers.title')}</h2>
          <DataTable
            caption={t('jv.cp.waivers.title')}
            columns={[
              {
                key: 'basis',
                header: t('jv.cp.waivers.basis'),
                isRowHeader: true,
                cell: (w) => (
                  <span className="flex flex-col gap-0.5">
                    <UText value={w.basis} multiline />
                    <span className="text-xs text-muted">
                      {t('jv.cp.waivers.impact')}: <UText value={w.impact} />
                    </span>
                  </span>
                ),
              },
              { key: 'authority', header: t('jv.cp.fields.waiverAuthority'), cell: (w) => (w.authorityRole ? tStatus('roleKeys', w.authorityRole) : EM_DASH) },
              { key: 'requested', header: t('jv.common.requestedBy'), cell: (w) => <Person id={w.requestedBy} people={people} /> },
              { key: 'status', header: t('jv.common.status'), cell: (w) => <StatusBadge enumName="waiverStatuses" value={w.status} /> },
              { key: 'decided', header: t('jv.cp.waivers.decided'), cell: (w) => (w.decidedBy ? <span><Person id={w.decidedBy} people={people} /> · <span className="tabular">{formatDateTime(w.decidedAt)}</span></span> : EM_DASH) },
              { key: 'cmd', header: t('jv.common.commands'), cell: (w) => <WaiverCommands w={w} c={c} /> },
            ]}
            rows={c.waivers}
            rowKey={(w) => w.id}
            emptyTitle={c.waivable ? t('jv.cp.waivers.empty') : t('jv.cp.waivers.noneNonWaivable')}
            testId="waivers-table"
          />
        </section>

        <EvidencePanel targetType="closing_condition" targetId={c.id} title={t('jv.cp.evidenceTitle')} />
        <ActivityHistory projectId={projectId} entityType="closing_condition" entityId={c.id} />
        <p className="text-sm">
          <Link className={btn.link} href={`${base}/closing?tab=conditions`}>
            {t('jv.cp.register')}
          </Link>
        </p>
      </div>
      {cmd ? <ConditionDialogs key={`${cmd}-${c.version}`} c={c} cmd={cmd} onClose={() => setCmd(null)} /> : null}
    </>
  );
}

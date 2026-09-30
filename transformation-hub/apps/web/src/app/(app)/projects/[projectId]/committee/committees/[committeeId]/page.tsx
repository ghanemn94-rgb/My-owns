'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { governanceRoutes } from '@hub/contracts';
import { CADENCE_FREQUENCIES, COMMITTEE_MEMBER_ROLES, MAX_PROPOSED_MEETINGS, VOTING_SEAT_ROLES } from '@hub/domain';
import { DataTable } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { ErrorState } from '@/components/ErrorState';
import { SelectField, TextAreaField, TextField } from '@/components/Field';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { RestrictedState } from '@/components/RestrictedState';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { UserPicker, type PickedUser } from '@/components/UserPicker';
import { btn, card, cx } from '@/components/ui';
import { EM_DASH, useI18n, type MessageKey } from '@/i18n/provider';
import { api } from '@/lib/api';
import { useProjectContext } from '@/lib/project-context';
import { ScheduleMeetingDialog } from '../../_components/dialogs';
import { ApprovalDocumentPicker } from '../../_components/evidence';
import { Facts, GovCommandDialog, GovHistory, Section, UText, gk, hubHref, useCommittee, useGovRefresh, useMatrices, useMeetingList, type CommitteeDetail, type MatrixVersion, type PolicyShape } from '../../_components/gov';

type Seat = CommitteeDetail['memberships'][number];
type MemberRole = (typeof COMMITTEE_MEMBER_ROLES)[number];
const CHARTER_KEYS = ['purpose', 'scope', 'delegatedAuthority', 'exclusions', 'reservedMatters', 'cadence', 'classification', 'minutesRetention', 'escalation', 'conflictsOfInterest', 'circulation'] as const;
type CharterKey = (typeof CHARTER_KEYS)[number];
type Cmd = 'amend' | 'approveCharter' | 'activate' | 'addSeat' | 'endSeat' | 'approveMatrix' | 'verifyMatrix' | 'draftMatrix' | 'proposeMeetings';
type CadenceFrequency = (typeof CADENCE_FREQUENCIES)[number];

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export default function CommitteeDetailPage() {
  const { committeeId } = useParams<{ committeeId: string }>();
  const { t, tStatus, formatDate, formatDateTime, locale } = useI18n();
  const { projectId, can, me } = useProjectContext();
  const refresh = useGovRefresh();
  const toast = useToast();
  const c = useCommittee(committeeId);
  const matrices = useMatrices(committeeId);
  const versions = useQuery({
    queryKey: gk.charterVersions(projectId, committeeId),
    queryFn: ({ signal }) => api(governanceRoutes.listCharterVersions, { params: { projectId, committeeId }, signal }),
    enabled: Boolean(c.data),
  });
  const meetings = useMeetingList({ committeeId, pageSize: 5 }, Boolean(c.data));
  const [cmd, setCmd] = useState<Cmd | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [charter, setCharter] = useState<Record<CharterKey, string>>(() => Object.fromEntries(CHARTER_KEYS.map((k) => [k, ''])) as Record<CharterKey, string>);
  const [cadenceIsProposal, setCadenceIsProposal] = useState(true);
  const [cadenceFrequency, setCadenceFrequency] = useState<CadenceFrequency | ''>('');
  // REQ-GOV-009: proposed meeting series (first meeting given by the secretariat; the cadence determines the rest).
  const [firstAt, setFirstAt] = useState('');
  const [seriesCount, setSeriesCount] = useState('4');
  const [seriesTitle, setSeriesTitle] = useState('');
  const [seriesLocation, setSeriesLocation] = useState('');
  const [reference, setReference] = useState('');
  const [seatUser, setSeatUser] = useState<PickedUser | null>(null);
  const [seatLabel, setSeatLabel] = useState('');
  const [seatRole, setSeatRole] = useState<MemberRole>('voting_member');
  const [seatVoting, setSeatVoting] = useState(true);
  const [dateA, setDateA] = useState('');
  const [dateB, setDateB] = useState('');
  const [policyText, setPolicyText] = useState('');
  const [endSeat, setEndSeat] = useState<Seat | null>(null);
  const [matrix, setMatrix] = useState<MatrixVersion | null>(null);
  const [approvalDoc, setApprovalDoc] = useState<{ id: string; title: string } | null>(null);
  const [verifyDecision, setVerifyDecision] = useState<'accept' | 'reject'>('accept');

  if (c.isLoading) return <LoadingState />;
  if (c.error || !c.data) return c.error ? <ErrorState error={c.error} onRetry={() => c.refetch()} /> : <RestrictedState />;
  const d = c.data;
  const base = hubHref(projectId);
  const manage = can('governance.committee.manage');
  const inForce = matrices.data?.items.find((m) => m.status === 'approved') ?? null;
  const pendingMatrices = (matrices.data?.items ?? []).filter((m) => m.pendingVerification);
  const canVerifyMatrix = can('documents.evidence.verify');
  /** Separation of duties known on the client (the API also refuses the uploader of the approval document). */
  const verifyBlockedFor = (m: MatrixVersion): MessageKey | null =>
    m.createdBy === me.user.id ? 'governance.committee.matrix.verify.youDrafted' : m.approvedBy === me.user.id ? 'governance.committee.matrix.verify.youApproved' : null;
  const policy = (inForce?.policy ?? null) as PolicyShape | null;
  const pendingAmendment = d.charterApprovedVersionNo !== null && d.charterApprovedVersionNo < d.charterVersionNo;
  const todayStr = today();

  const open = (k: Cmd) => {
    setReference('');
    setDateA(k === 'addSeat' ? todayStr : '');
    setDateB('');
    if (k === 'amend') {
      setCharter(Object.fromEntries(CHARTER_KEYS.map((key) => [key, (d.charter[key] as string | undefined) ?? ''])) as Record<CharterKey, string>);
      setCadenceIsProposal(d.charter.cadenceIsProposal !== false);
      setCadenceFrequency(d.charter.cadenceRule?.frequency ?? '');
    }
    if (k === 'proposeMeetings') {
      setFirstAt('');
      setSeriesCount('4');
      setSeriesTitle('');
      setSeriesLocation('');
    }
    if (k === 'addSeat') {
      setSeatUser(null);
      setSeatLabel('');
      setSeatRole('voting_member');
      setSeatVoting(true);
    }
    if (k === 'draftMatrix') setPolicyText('');
    setApprovalDoc(null);
    setVerifyDecision('accept');
    setCmd(k);
  };
  const done = async (key: MessageKey) => {
    await refresh();
    toast.show('success', t(key));
    setCmd(null);
    setEndSeat(null);
    setMatrix(null);
  };
  let policyError: string | null = null;
  let parsedPolicy: unknown = null;
  if (cmd === 'draftMatrix' && policyText.trim()) {
    try {
      parsedPolicy = JSON.parse(policyText);
    } catch {
      policyError = t('governance.committee.matrix.draft.invalidJson');
    }
  }

  const dialogs: Record<Cmd, { title: string; confirm: string; consequences: ReactNode[]; noteMode: 'none' | 'optional' | 'required'; noteLabel?: string; disabled?: boolean; run: (note: string) => Promise<void>; children?: ReactNode; version?: number }> = {
    amend: {
      title: t('governance.committee.charter.update.title'),
      confirm: t('governance.committee.charter.update.confirm'),
      consequences: [t('governance.committee.charter.update.effect')],
      noteMode: 'optional',
      noteLabel: t('governance.common.reason'),
      version: d.version,
      run: async (note) => {
        const body: Record<string, string | boolean | { frequency: CadenceFrequency } | null> = { cadenceIsProposal, cadenceRule: cadenceFrequency ? { frequency: cadenceFrequency } : null };
        for (const k of CHARTER_KEYS) if (charter[k].trim()) body[k] = charter[k].trim();
        await api(governanceRoutes.updateCharter, { params: { projectId, committeeId }, body: { expectedVersion: d.version, charter: body, ...(note ? { reason: note } : {}) } });
        await done('governance.committee.charter.update.done');
      },
      children: (
        <div className="space-y-3">
          {CHARTER_KEYS.map((k) => (
            <TextAreaField key={k} label={t(`governance.committee.charter.fields.${k}`)} rows={2} value={charter[k]} maxLength={8000} onChange={(e) => setCharter({ ...charter, [k]: e.target.value })} />
          ))}
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={cadenceIsProposal} onChange={(e) => setCadenceIsProposal(e.target.checked)} />
            {t('governance.committee.charter.update.cadenceIsProposal')}
          </label>
          <SelectField
            label={t('governance.committee.charter.cadenceRule.label')}
            value={cadenceFrequency}
            onChange={(e) => setCadenceFrequency(e.target.value as CadenceFrequency | '')}
            hint={t('governance.committee.charter.cadenceRule.hint')}
            data-testid="charter-cadence-rule"
          >
            <option value="">{t('governance.committee.charter.cadenceRule.none')}</option>
            {CADENCE_FREQUENCIES.map((f) => (
              <option key={f} value={f}>
                {t(`governance.committee.charter.cadenceRule.${f}`)}
              </option>
            ))}
          </SelectField>
        </div>
      ),
    },
    proposeMeetings: {
      title: t('governance.committee.meetings.propose.title'),
      confirm: t('governance.committee.meetings.propose.confirm'),
      consequences: [t('governance.committee.meetings.propose.effect'), t('governance.committee.meetings.propose.effectIdempotent'), t('governance.committee.meetings.propose.effectNoInvention')],
      noteMode: 'none',
      version: d.version,
      disabled: !firstAt || !seriesTitle.trim() || !(Number(seriesCount) >= 1 && Number(seriesCount) <= MAX_PROPOSED_MEETINGS),
      run: async () => {
        // datetime-local is interpreted as Asia/Riyadh (UTC+3, no daylight saving), as for a meeting scheduled by hand.
        const r = await api(governanceRoutes.proposeMeetingSeries, {
          params: { projectId, committeeId },
          body: { expectedVersion: d.version, firstMeetingAt: new Date(`${firstAt}:00+03:00`).toISOString(), count: Number(seriesCount), title: seriesTitle.trim(), ...(seriesLocation.trim() ? { location: seriesLocation.trim() } : {}) },
        });
        await refresh();
        toast.show('success', t('governance.committee.meetings.propose.done', { created: r.created.length, skipped: r.skipped.length }));
        setCmd(null);
      },
      children: (
        <div className="space-y-4">
          <p className="text-sm text-ink">
            {d.charter.cadenceRule ? t('governance.committee.meetings.propose.rule', { rule: t(`governance.committee.charter.cadenceRule.${d.charter.cadenceRule.frequency}`), version: d.charterVersionNo }) : null}
          </p>
          <TextField label={t('governance.committee.meetings.propose.first')} required type="datetime-local" dir="ltr" value={firstAt} onChange={(e) => setFirstAt(e.target.value)} hint={t('governance.committee.meetings.propose.firstHint')} data-testid="propose-first" />
          <TextField
            label={t('governance.committee.meetings.propose.count')}
            required
            type="number"
            dir="ltr"
            min={1}
            max={MAX_PROPOSED_MEETINGS}
            value={seriesCount}
            onChange={(e) => setSeriesCount(e.target.value)}
            hint={t('governance.committee.meetings.propose.countHint', { max: MAX_PROPOSED_MEETINGS })}
            data-testid="propose-count"
          />
          <TextField label={t('governance.meetings.create.titleField')} required value={seriesTitle} maxLength={300} onChange={(e) => setSeriesTitle(e.target.value)} data-testid="propose-title" />
          <TextField label={t('governance.meetings.create.location')} value={seriesLocation} maxLength={300} onChange={(e) => setSeriesLocation(e.target.value)} />
        </div>
      ),
    },
    approveCharter: {
      title: t('governance.committee.charter.approve.title', { version: d.charterVersionNo }),
      confirm: t('governance.committee.charter.approve.confirm'),
      consequences: [t('governance.committee.charter.approve.effect', { version: d.charterVersionNo }), t('governance.hub.internalApprovals')],
      noteMode: 'optional',
      version: d.version,
      run: async (note) => {
        await api(governanceRoutes.approveCharter, { params: { projectId, committeeId }, body: { expectedVersion: d.version, ...(reference.trim() ? { approvalReference: reference.trim() } : {}), ...(note ? { note } : {}) } });
        await done('governance.committee.charter.approve.done');
      },
      children: <TextField label={t('governance.committee.charter.approve.reference')} value={reference} maxLength={300} onChange={(e) => setReference(e.target.value)} />,
    },
    activate: {
      title: t('governance.committee.charter.activate.title'),
      confirm: t('governance.committee.charter.activate.confirm'),
      consequences: [t('governance.committee.charter.activate.effect')],
      noteMode: 'optional',
      version: d.version,
      run: async (note) => {
        await api(governanceRoutes.activateCommittee, { params: { projectId, committeeId }, body: { expectedVersion: d.version, ...(note ? { note } : {}) } });
        await done('governance.committee.charter.activate.done');
      },
    },
    addSeat: {
      title: t('governance.committee.seats.add.title'),
      confirm: t('governance.committee.seats.add.confirm'),
      consequences: [t('governance.committee.seats.add.effect')],
      noteMode: 'none',
      disabled: !seatLabel.trim() || !dateA,
      run: async () => {
        await api(governanceRoutes.addMembership, {
          params: { projectId, committeeId },
          body: { userId: seatUser?.id ?? null, roleLabel: seatLabel.trim(), memberRole: seatRole, voting: seatVoting && VOTING_SEAT_ROLES.includes(seatRole), validFrom: dateA, ...(dateB ? { validTo: dateB } : {}) },
        });
        await done('governance.committee.seats.add.done');
      },
      children: (
        <div className="space-y-4">
          <UserPicker label={t('governance.committee.seats.add.person')} value={seatUser} onChange={setSeatUser} />
          <p className="text-xs text-muted">{t('governance.committee.seats.add.personHint')}</p>
          <TextField label={t('governance.committee.seats.add.roleLabel')} required value={seatLabel} maxLength={200} onChange={(e) => setSeatLabel(e.target.value)} />
          <SelectField label={t('governance.committee.seats.add.capacity')} required value={seatRole} onChange={(e) => setSeatRole(e.target.value as MemberRole)}>
            {COMMITTEE_MEMBER_ROLES.map((r) => (
              <option key={r} value={r}>
                {tStatus('committeeMemberRoles', r)}
              </option>
            ))}
          </SelectField>
          <label className="flex items-start gap-2 text-sm text-ink">
            <input type="checkbox" className="mt-1" checked={seatVoting && VOTING_SEAT_ROLES.includes(seatRole)} disabled={!VOTING_SEAT_ROLES.includes(seatRole)} onChange={(e) => setSeatVoting(e.target.checked)} />
            <span>
              {t('governance.committee.seats.add.voting')}
              <span className="block text-xs text-muted">{t('governance.committee.seats.add.votingHint')}</span>
            </span>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label={t('governance.committee.seats.add.validFrom')} required type="date" dir="ltr" value={dateA} onChange={(e) => setDateA(e.target.value)} />
            <TextField label={t('governance.committee.seats.add.validTo')} type="date" dir="ltr" value={dateB} onChange={(e) => setDateB(e.target.value)} />
          </div>
        </div>
      ),
    },
    endSeat: {
      title: t('governance.committee.seats.end.title'),
      confirm: t('governance.committee.seats.end.confirm'),
      consequences: [endSeat ? `${endSeat.displayName ?? t('governance.common.tbc')} — ${endSeat.roleLabel}` : '', t('governance.committee.seats.end.effect')],
      noteMode: 'required',
      noteLabel: t('governance.common.reason'),
      disabled: !dateA,
      version: endSeat?.version,
      run: async (note) => {
        if (!endSeat) return;
        await api(governanceRoutes.endMembership, { params: { projectId, committeeId, membershipId: endSeat.id }, body: { expectedVersion: endSeat.version, validTo: dateA, reason: note } });
        await done('governance.committee.seats.end.done');
      },
      children: <TextField label={t('governance.committee.seats.end.validTo')} required type="date" dir="ltr" value={dateA} onChange={(e) => setDateA(e.target.value)} />,
    },
    approveMatrix: {
      title: t('governance.committee.matrix.approve.title', { version: matrix?.versionNo ?? 0 }),
      confirm: matrix?.isDemoPolicy ? t('governance.committee.matrix.approve.confirm') : t('governance.committee.matrix.approve.confirmPending'),
      consequences: matrix?.isDemoPolicy
        ? [t('governance.committee.matrix.approve.effect'), t('governance.hub.internalApprovals')]
        : [t('governance.committee.matrix.approve.effectPending'), t('governance.committee.matrix.approve.effectVerifier'), t('governance.hub.internalApprovals')],
      noteMode: 'optional',
      disabled: !reference.trim() || (!matrix?.isDemoPolicy && !approvalDoc),
      run: async (note) => {
        if (!matrix) return;
        const r = await api(governanceRoutes.approveAuthorityMatrixVersion, {
          params: { projectId, committeeId, versionId: matrix.id },
          body: { approvalReference: reference.trim(), ...(approvalDoc && !matrix.isDemoPolicy ? { approvalDocumentId: approvalDoc.id } : {}), ...(dateA ? { effectiveFrom: dateA } : {}), ...(note ? { note } : {}) },
        });
        await done(r.pendingVerification ? 'governance.committee.matrix.approve.donePending' : 'governance.committee.matrix.approve.done');
      },
      children: (
        <div className="space-y-4">
          {matrix?.isDemoPolicy ? (
            <p className="flex flex-wrap items-center gap-2 text-sm text-ink">
              <DemoBadge />
              {t('governance.committee.matrix.approve.demoNoDocument')}
            </p>
          ) : null}
          <TextField label={t('governance.committee.matrix.approve.reference')} required value={reference} maxLength={300} onChange={(e) => setReference(e.target.value)} />
          {matrix && !matrix.isDemoPolicy ? (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-ink">
                {t('governance.committee.matrix.approve.document')}
                <span className="text-danger" aria-hidden="true">
                  {' '}
                  *
                </span>
              </legend>
              <p className="text-xs text-muted">{t('governance.committee.matrix.approve.documentHint')}</p>
              <ApprovalDocumentPicker value={approvalDoc} onChange={setApprovalDoc} />
            </fieldset>
          ) : null}
          <TextField label={t('governance.committee.matrix.approve.effectiveFrom')} type="date" dir="ltr" value={dateA} onChange={(e) => setDateA(e.target.value)} />
        </div>
      ),
    },
    verifyMatrix: {
      title: t('governance.committee.matrix.verify.title', { version: matrix?.versionNo ?? 0 }),
      confirm: verifyDecision === 'accept' ? t('governance.committee.matrix.verify.confirmAccept') : t('governance.committee.matrix.verify.confirmReject'),
      consequences:
        verifyDecision === 'accept'
          ? [t('governance.committee.matrix.verify.effectAccept', { version: matrix?.versionNo ?? 0 }), t('governance.committee.matrix.verify.sod')]
          : [t('governance.committee.matrix.verify.effectReject'), t('governance.committee.matrix.verify.sod')],
      noteMode: verifyDecision === 'reject' ? 'required' : 'optional',
      noteLabel: verifyDecision === 'reject' ? t('governance.common.reason') : undefined,
      run: async (note) => {
        if (!matrix) return;
        await api(governanceRoutes.verifyAuthorityMatrixApproval, {
          params: { projectId, committeeId, versionId: matrix.id },
          body: { decision: verifyDecision, ...(note ? { note } : {}) },
        });
        await done(verifyDecision === 'accept' ? 'governance.committee.matrix.verify.doneAccept' : 'governance.committee.matrix.verify.doneReject');
      },
      children: matrix ? (
        <div className="space-y-4" data-testid="matrix-verify-form">
          <Facts
            items={[
              { label: t('governance.committee.matrix.approve.reference'), value: <UText value={matrix.approvalReference} /> },
              { label: t('governance.committee.matrix.columns.approvedAt'), value: <span className="tabular">{formatDateTime(matrix.approvedAt)}</span> },
              {
                label: t('governance.committee.matrix.approve.document'),
                wide: true,
                value: matrix.approvalDocumentId ? (
                  <Link href={`/projects/${projectId}/documents/${matrix.approvalDocumentId}`} className={btn.link} data-testid="matrix-approval-document">
                    {t('governance.committee.matrix.verify.openDocument')}
                  </Link>
                ) : (
                  <span className="text-muted">{EM_DASH}</span>
                ),
              },
            ]}
          />
          <fieldset>
            <legend className="text-sm font-medium text-ink">{t('governance.committee.matrix.verify.decision')}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {(['accept', 'reject'] as const).map((v) => (
                <label key={v} className={cx('inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm', verifyDecision === v ? 'border-primary bg-primary-soft' : 'border-line-strong')}>
                  <input type="radio" name="matrix-verify-decision" value={v} checked={verifyDecision === v} onChange={() => setVerifyDecision(v)} />
                  {t(`governance.committee.matrix.verify.${v}`)}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      ) : null,
    },
    draftMatrix: {
      title: t('governance.committee.matrix.draft.title'),
      confirm: t('governance.committee.matrix.draft.confirm'),
      consequences: [t('governance.committee.matrix.draft.effect')],
      noteMode: 'none',
      disabled: !parsedPolicy || Boolean(policyError),
      run: async () => {
        await api(governanceRoutes.createAuthorityMatrixVersion, {
          params: { projectId, committeeId },
          body: { policy: parsedPolicy as never, ...(dateA ? { effectiveFrom: dateA } : {}), ...(dateB ? { effectiveTo: dateB } : {}) },
        });
        await done('governance.committee.matrix.draft.done');
      },
      children: (
        <div className="space-y-4">
          <TextAreaField label={t('governance.committee.matrix.draft.policy')} required rows={10} dir="ltr" value={policyText} onChange={(e) => setPolicyText(e.target.value)} hint={t('governance.committee.matrix.draft.policyHint')} error={policyError} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label={t('governance.committee.matrix.draft.effectiveFrom')} type="date" dir="ltr" value={dateA} onChange={(e) => setDateA(e.target.value)} />
            <TextField label={t('governance.committee.matrix.draft.effectiveTo')} type="date" dir="ltr" value={dateB} onChange={(e) => setDateB(e.target.value)} />
          </div>
        </div>
      ),
    },
  };
  const active = cmd ? dialogs[cmd] : null;

  const seatState = (s: Seat) => (s.activeToday ? 'active' : s.validFrom > todayStr ? 'notStarted' : 'ended');

  return (
    <>
      <Link href={base} className={cx(btn.link, 'mb-3 inline-flex items-center gap-1 text-sm')}>
        <ChevronLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
        {t('governance.committee.back')}
      </Link>
      <PageHeader
        eyebrow={tStatus('committeeKinds', d.kind)}
        title={<span dir="auto">{d.name}</span>}
        documentTitle={d.name}
        badges={
          <>
            <StatusBadge enumName="committeeStatuses" value={d.status} size="md" />
            <StatusBadge enumName="classifications" value={d.classification} tone="neutral" />
            {d.isDemo ? <DemoBadge /> : null}
          </>
        }
        actions={
          <>
            {can('governance.charter.approve') && d.charterApprovedVersionNo !== d.charterVersionNo && d.status !== 'dissolved' ? (
              <button type="button" className={btn.primary} onClick={() => open('approveCharter')} data-testid="approve-charter">
                {t('governance.committee.charter.approve.label')}
              </button>
            ) : null}
            {manage && d.status === 'charter_approved' ? (
              <button type="button" className={btn.primary} onClick={() => open('activate')}>
                {t('governance.committee.charter.activate.label')}
              </button>
            ) : null}
            {manage && d.status !== 'dissolved' ? (
              <button type="button" className={btn.secondary} onClick={() => open('amend')}>
                {t('governance.committee.charter.update.label')}
              </button>
            ) : null}
          </>
        }
      />

      <div className="space-y-6">
        <Section id="charter" title={t('governance.committee.charter.title')}>
          <div className={cx(card, 'space-y-3 p-4')}>
            <p className="flex flex-wrap items-center gap-2 text-sm text-ink">
              <span className="font-semibold">{t('governance.committee.charter.version', { version: d.charterVersionNo })}</span>
              <span className="text-muted">·</span>
              {d.charterApprovedVersionNo ? <span>{t('governance.committee.charter.approvedVersion', { version: d.charterApprovedVersionNo })}</span> : <span className="text-warning">{t('governance.committee.charter.notApproved')}</span>}
              {d.charterApprovedAt ? <span className="text-muted">({formatDateTime(d.charterApprovedAt)})</span> : null}
            </p>
            {pendingAmendment ? <p className="rounded-md border border-warning/40 bg-warning-soft p-2 text-sm text-ink">{t('governance.committee.charter.amendmentPending', { version: d.charterVersionNo })}</p> : null}
            {CHARTER_KEYS.some((k) => d.charter[k]) ? (
              <Facts
                items={CHARTER_KEYS.filter((k) => d.charter[k]).map((k) => ({
                  label: t(`governance.committee.charter.fields.${k}`),
                  wide: true,
                  value: (
                    <span className="flex flex-wrap items-center gap-2">
                      <UText value={d.charter[k] as string} multiline />
                      {k === 'cadence' && d.charter.cadenceIsProposal !== false ? <StatusBadge enumName="verificationStatuses" value="proposed" label={t('governance.committee.charter.cadenceProposal')} /> : null}
                    </span>
                  ),
                }))}
              />
            ) : (
              <p className="text-sm text-muted">{t('governance.committee.charter.empty')}</p>
            )}
            {d.charter.cadenceRule ? (
              <p className="text-sm text-ink" data-testid="charter-cadence-rule-value">
                {t('governance.committee.charter.cadenceRule.value', { rule: t(`governance.committee.charter.cadenceRule.${d.charter.cadenceRule.frequency}`) })}
              </p>
            ) : null}
          </div>
          <details className={cx(card, 'p-4')}>
            <summary className="cursor-pointer font-semibold text-ink">{t('governance.committee.charter.versions')}</summary>
            <DataTable
              className="relative mt-3"
              caption={t('governance.committee.charter.versions')}
              rows={versions.data?.items}
              rowKey={(v) => String(v.versionNo)}
              isLoading={versions.isLoading}
              error={versions.error}
              onRetry={() => versions.refetch()}
              emptyTitle={t('governance.committee.charter.versionsEmpty')}
              columns={[
                { key: 'v', header: t('governance.committee.charter.columns.version'), isRowHeader: true, cell: (v) => <span className="tabular">{t('documents.versions.label', { version: v.versionNo })}</span> },
                { key: 'at', header: t('governance.committee.charter.columns.changedAt'), cell: (v) => <span className="tabular">{formatDateTime(v.changedAt)}</span> },
                { key: 'reason', header: t('governance.committee.charter.columns.reason'), cell: (v) => <UText value={v.reason} /> },
                { key: 'approved', header: t('governance.committee.charter.columns.approved'), cell: (v) => (v.approved ? t('governance.common.yes') : t('governance.common.no')) },
              ]}
            />
          </details>
        </Section>

        <Section
          id="seats"
          title={t('governance.committee.seats.title')}
          actions={
            manage && d.status !== 'dissolved' ? (
              <button type="button" className={btn.secondary} onClick={() => open('addSeat')} data-testid="add-seat">
                {t('governance.committee.seats.add.label')}
              </button>
            ) : null
          }
        >
          <DataTable
            className="relative"
            caption={t('governance.committee.seats.title')}
            rows={d.memberships}
            rowKey={(s) => s.id}
            emptyTitle={t('governance.committee.seats.empty')}
            testId="seats-table"
            columns={[
              { key: 'seat', header: t('governance.committee.seats.columns.seat'), isRowHeader: true, sortValue: (s) => s.roleLabel, cell: (s) => <UText value={s.roleLabel} /> },
              {
                key: 'person',
                header: t('governance.committee.seats.columns.person'),
                sortValue: (s) => s.displayName ?? '',
                cell: (s) => (s.isPlaceholder ? <span className="italic text-muted">{t('governance.common.tbc')}</span> : <UText value={s.displayName} />),
              },
              { key: 'capacity', header: t('governance.committee.seats.columns.capacity'), sortValue: (s) => s.memberRole, cell: (s) => tStatus('committeeMemberRoles', s.memberRole) },
              { key: 'voting', header: t('governance.committee.seats.columns.voting'), cell: (s) => (s.voting ? t('governance.common.yes') : t('governance.common.no')) },
              {
                key: 'term',
                header: t('governance.committee.seats.columns.term'),
                cell: (s) => (
                  <span className="tabular">
                    {s.validTo ? t('governance.committee.seats.termRange', { from: formatDate(s.validFrom), to: formatDate(s.validTo) }) : t('governance.committee.seats.termFrom', { from: formatDate(s.validFrom) })}
                  </span>
                ),
              },
              {
                key: 'state',
                header: t('governance.committee.seats.columns.state'),
                cell: (s) => (
                  <span className="flex flex-wrap items-center gap-2">
                    <StatusBadge enumName="committeeStatuses" value={seatState(s)} tone={s.activeToday ? 'success' : 'neutral'} label={t(`governance.committee.seats.${seatState(s)}`)} />
                    {manage && (!s.validTo || s.validTo >= todayStr) ? (
                      <button
                        type="button"
                        className={btn.link}
                        onClick={() => {
                          setEndSeat(s);
                          open('endSeat');
                          setDateA(todayStr);
                        }}
                        aria-label={t('governance.committee.seats.end.labelFor', { seat: s.roleLabel })}
                      >
                        {t('governance.committee.seats.end.label')}
                      </button>
                    ) : null}
                  </span>
                ),
              },
            ]}
          />
        </Section>

        <Section
          id="matrix"
          title={t('governance.committee.matrix.title')}
          actions={
            can('governance.authority_matrix.manage') && d.status !== 'dissolved' ? (
              <button type="button" className={btn.secondary} onClick={() => open('draftMatrix')}>
                {t('governance.committee.matrix.draft.label')}
              </button>
            ) : null
          }
        >
          <div className={cx(card, 'space-y-3 p-4 text-sm')} data-testid="matrix-panel">
            {d.activeMatrix ? (
              <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                {d.activeMatrix.usable
                  ? t('governance.committee.matrix.inForce', { version: d.activeMatrix.versionNo, date: formatDate(d.activeMatrix.effectiveFrom) })
                  : t('governance.committee.matrix.notUsable', { version: d.activeMatrix.versionNo, reason: d.activeMatrix.usableReason })}
                {d.activeMatrix.isDemoPolicy ? (
                  <>
                    <DemoBadge />
                    <span className="text-xs text-muted">{t('governance.committee.matrix.demoPolicy')}</span>
                  </>
                ) : null}
              </p>
            ) : (
              <p className="rounded-md border border-warning/40 bg-warning-soft p-2 text-ink">{t('governance.committee.matrix.none')}</p>
            )}
            {pendingMatrices.map((m) => (
              <p key={m.id} role="note" className="rounded-md border border-info/40 bg-info-soft p-2 text-ink" data-testid="matrix-pending-verification">
                {inForce
                  ? t('governance.committee.matrix.pendingCallout', { version: m.versionNo, current: inForce.versionNo })
                  : t('governance.committee.matrix.pendingCalloutNone', { version: m.versionNo })}
              </p>
            ))}
            {policy ? (
              <ul className="list-disc space-y-1 ps-5 text-ink">
                <li>{t('governance.committee.matrix.quorumRule', { min: policy.quorum.minVotingMembersPresent, percent: Math.round(policy.quorum.minFractionPresent * 100) })}</li>
                <li>{t('governance.committee.matrix.threshold', { value: t(`governance.committee.matrix.thresholds.${policy.approvalThreshold.type}`) })}</li>
                <li>{t('governance.committee.matrix.tieRule', { value: t(`governance.committee.matrix.ties.${policy.tieRule}`) })}</li>
              </ul>
            ) : null}
          </div>
          {policy ? (
            <DataTable
              className="relative"
              caption={t('governance.committee.matrix.types.title')}
              rows={policy.decisionTypes}
              rowKey={(x) => x.key}
              emptyTitle={EM_DASH}
              clientPageSize={20}
              columns={[
                { key: 'name', header: t('governance.committee.matrix.types.name'), isRowHeader: true, cell: (x) => <span dir="auto">{x.name?.[locale] ?? x.key}</span> },
                {
                  key: 'limit',
                  header: t('governance.committee.matrix.types.limit'),
                  cell: (x) =>
                    x.maxAmount ? (
                      <span dir="ltr" className="tabular">
                        {x.maxAmount} {x.currency}
                      </span>
                    ) : (
                      <span className="text-muted">{t('governance.committee.matrix.types.noLimit')}</span>
                    ),
                },
                {
                  key: 'within',
                  header: t('governance.committee.matrix.types.within'),
                  cell: (x) => <StatusBadge enumName="decisionAuthorityOutcomes" value={x.withinCommitteeAuthority ? 'within_mandate' : 'pending_external_authority'} />,
                },
                { key: 'escalate', header: t('governance.committee.matrix.types.escalateTo'), cell: (x) => <span dir="auto">{x.escalateTo}</span> },
              ]}
            />
          ) : null}
          <DataTable
            className="relative"
            caption={t('governance.committee.matrix.versions')}
            rows={matrices.data?.items}
            rowKey={(m) => m.id}
            isLoading={matrices.isLoading}
            error={matrices.error}
            onRetry={() => matrices.refetch()}
            emptyTitle={t('governance.committee.matrix.versionsEmpty')}
            columns={[
              { key: 'v', header: t('governance.committee.matrix.columns.version'), isRowHeader: true, cell: (m) => <span className="tabular">{t('documents.versions.label', { version: m.versionNo })}</span> },
              {
                key: 'status',
                header: t('governance.committee.matrix.columns.status'),
                cell: (m) => (
                  <span className="flex flex-col items-start gap-1" data-testid="matrix-status" data-version={m.versionNo}>
                    {m.pendingVerification ? (
                      <StatusBadge enumName="authorityMatrixStatuses" value="pending" tone="warning" label={t('governance.committee.matrix.pendingVerification')} />
                    ) : (
                      <StatusBadge enumName="authorityMatrixStatuses" value={m.status} />
                    )}
                    {m.approvalVerifiedAt ? <span className="text-xs text-muted">{t('governance.committee.matrix.verifiedAt', { date: formatDateTime(m.approvalVerifiedAt) })}</span> : null}
                  </span>
                ),
              },
              { key: 'demo', header: t('governance.committee.matrix.columns.demo'), cell: (m) => (m.isDemoPolicy ? <DemoBadge /> : t('governance.committee.matrix.real')) },
              {
                key: 'effective',
                header: t('governance.committee.matrix.columns.effective'),
                cell: (m) => (
                  <span className="tabular">
                    {formatDate(m.effectiveFrom)}
                    {m.effectiveTo ? ` – ${formatDate(m.effectiveTo)}` : ''}
                  </span>
                ),
              },
              { key: 'approvedAt', header: t('governance.committee.matrix.columns.approvedAt'), cell: (m) => <span className="tabular">{formatDateTime(m.approvedAt)}</span> },
              {
                key: 'reference',
                header: t('governance.committee.matrix.columns.reference'),
                cell: (m) =>
                  m.status === 'draft' && !m.pendingVerification && can('governance.authority_matrix.approve') ? (
                    <button
                      type="button"
                      className={btn.secondary}
                      onClick={() => {
                        setMatrix(m);
                        open('approveMatrix');
                      }}
                      aria-label={t('governance.committee.matrix.approve.labelFor', { version: m.versionNo })}
                      data-testid="matrix-approve"
                    >
                      {t('governance.committee.matrix.approve.label')}
                    </button>
                  ) : (
                    <span className="flex flex-col items-start gap-1">
                      <UText value={m.approvalReference} />
                      {m.approvalDocumentId ? (
                        <Link href={`/projects/${projectId}/documents/${m.approvalDocumentId}`} className={cx(btn.link, 'text-xs')}>
                          {t('governance.committee.matrix.approvalDocument')}
                        </Link>
                      ) : null}
                      {m.pendingVerification && canVerifyMatrix ? (
                        verifyBlockedFor(m) ? (
                          <span className="text-xs text-muted" data-testid="matrix-verify-blocked">
                            {t(verifyBlockedFor(m)!)}
                          </span>
                        ) : (
                          <button
                            type="button"
                            className={btn.secondary}
                            onClick={() => {
                              setMatrix(m);
                              open('verifyMatrix');
                            }}
                            aria-label={t('governance.committee.matrix.verify.labelFor', { version: m.versionNo })}
                            data-testid="matrix-verify"
                          >
                            {t('governance.committee.matrix.verify.label')}
                          </button>
                        )
                      ) : null}
                    </span>
                  ),
              },
            ]}
          />
        </Section>

        <Section
          id="committee-meetings"
          title={t('governance.committee.meetings.title')}
          actions={
            <>
              <Link href={`${base}/meetings?committeeId=${d.id}`} className={cx(btn.link, 'text-sm')}>
                {t('governance.committee.meetings.viewAll')}
              </Link>
              {can('governance.meeting.manage') && d.status === 'active' && d.charter.cadenceRule ? (
                <button type="button" className={btn.secondary} onClick={() => open('proposeMeetings')} data-testid="propose-meetings">
                  {t('governance.committee.meetings.propose.action')}
                </button>
              ) : null}
              {can('governance.meeting.manage') && d.status === 'active' ? (
                <button type="button" className={btn.secondary} onClick={() => setScheduleOpen(true)}>
                  {t('governance.meetings.create.action')}
                </button>
              ) : null}
            </>
          }
        >
          <DataTable
            className="relative"
            caption={t('governance.committee.meetings.title')}
            rows={meetings.data?.items}
            rowKey={(m) => m.id}
            isLoading={meetings.isLoading}
            error={meetings.error}
            onRetry={() => meetings.refetch()}
            emptyTitle={t('governance.meetings.empty')}
            columns={[
              {
                key: 'n',
                header: t('governance.meetings.columns.number'),
                isRowHeader: true,
                cell: (m) => (
                  <Link href={`${base}/meetings/${m.id}`} className="font-medium text-primary hover:underline">
                    {m.isCirculation ? t('governance.common.circulationNumber', { number: m.number }) : t('governance.common.meetingNumber', { number: m.number })}
                  </Link>
                ),
              },
              { key: 'title', header: t('governance.meetings.columns.title'), cell: (m) => <UText value={m.title} /> },
              { key: 'at', header: t('governance.meetings.columns.scheduledAt'), cell: (m) => <span className="tabular">{formatDateTime(m.scheduledAt)}</span> },
              { key: 'status', header: t('governance.meetings.columns.status'), cell: (m) => <StatusBadge enumName="meetingStatuses" value={m.status} /> },
            ]}
          />
        </Section>

        <GovHistory entityType="committee" entityId={d.id} />
      </div>

      {cmd && active ? (
        <GovCommandDialog
          open
          onClose={() => {
            setCmd(null);
            setEndSeat(null);
            setMatrix(null);
          }}
          title={active.title}
          confirmLabel={active.confirm}
          consequences={[...active.consequences, t('common.command.audited')]}
          noteMode={active.noteMode}
          noteLabel={active.noteLabel}
          expectedVersion={active.version}
          confirmDisabled={active.disabled}
          onReload={() => {
            void refresh();
            setCmd(null);
          }}
          onConfirm={({ note }) => active.run(note)}
        >
          {active.children}
        </GovCommandDialog>
      ) : null}
      <ScheduleMeetingDialog open={scheduleOpen} onClose={() => setScheduleOpen(false)} committeeId={d.id} />
    </>
  );
}

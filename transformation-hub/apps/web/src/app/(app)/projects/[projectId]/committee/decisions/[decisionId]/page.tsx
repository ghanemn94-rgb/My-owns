'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CircleAlert, CircleCheck, ChevronLeft, Scale } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useId, useState, type ReactNode } from 'react';
import { governanceRoutes } from '@hub/contracts';
import { VOTE_CHOICES } from '@hub/domain';
import { DataTable } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { ErrorState } from '@/components/ErrorState';
import { EvidencePanel } from '@/components/EvidencePanel';
import { SelectField, TextField } from '@/components/Field';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { RestrictedState } from '@/components/RestrictedState';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn, card, cx } from '@/components/ui';
import { EM_DASH, useI18n, type MessageKey } from '@/i18n/provider';
import { api } from '@/lib/api';
import { useServerMessages } from '@/lib/i18n-data';
import { useProjectContext } from '@/lib/project-context';
import { AgendaRequestDialog, CreateActionDialog, DecisionPaperDialog } from '../../_components/dialogs';
import { ExternalEvidenceFact, ExternalEvidencePicker } from '../../_components/evidence';
import {
  Facts,
  GovCommandDialog,
  GovHistory,
  Money,
  Section,
  UText,
  gk,
  hubHref,
  typeName,
  useCommittee,
  useDecisionList,
  useDecisionTypes,
  useGovRefresh,
  useMeetingList,
  type DecisionDetail,
  type Vote,
} from '../../_components/gov';

type VoteChoice = (typeof VOTE_CHOICES)[number];
type CmdKey =
  | 'submit'
  | 'startReview'
  | 'return'
  | 'vote'
  | 'closeVoting'
  | 'recordOutcome'
  | 'circulate'
  | 'recuse'
  | 'recuseOnBehalf'
  | 'external'
  | 'defer'
  | 'resume'
  | 'supersede'
  | 'startImplementation'
  | 'verifyImplementation';

const EVIDENCE_ANCHOR = 'decision-evidence';

const MAIN_PATH = ['draft', 'submitted', 'under_review', 'recommended', 'approved', 'implementation_pending', 'implemented_verified'] as const;

function Lifecycle({ d }: { d: DecisionDetail }) {
  const { t, tStatus } = useI18n();
  const steps = MAIN_PATH.filter((s) => s !== 'recommended' || d.status === 'recommended' || d.authorityOutcome === 'pending_external_authority');
  const idx = steps.indexOf(d.status as (typeof steps)[number]);
  return (
    <div className={cx(card, 'p-4')}>
      <h2 className="mb-3 text-lg font-semibold text-ink">{t('governance.decision.lifecycle.title')}</h2>
      <ol className="flex flex-wrap gap-2" data-testid="decision-lifecycle">
        {steps.map((s, i) => {
          const state = idx === -1 ? 'upcoming' : i < idx ? 'done' : i === idx ? 'current' : 'upcoming';
          return (
            <li
              key={s}
              aria-current={state === 'current' ? 'step' : undefined}
              className={cx(
                'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium',
                state === 'current' && 'border-primary bg-primary-soft text-primary',
                state === 'done' && 'border-success/30 bg-success-soft text-success',
                state === 'upcoming' && 'border-line text-muted',
              )}
            >
              {state === 'done' ? <CircleCheck aria-hidden="true" className="size-3.5" /> : null}
              {tStatus('decisionStatuses', s)}
            </li>
          );
        })}
      </ol>
      {idx === -1 ? (
        <p className="mt-3 text-sm text-ink">
          <StatusBadge enumName="decisionStatuses" value={d.status} size="md" />
        </p>
      ) : null}
      <p className="mt-3 text-xs text-muted">{t('governance.decision.lifecycle.approvalNotImplementation')}</p>
    </div>
  );
}

function ChoiceGroup({ value, onChange, legend, options }: { value: string; onChange: (v: string) => void; legend: string; options: { value: string; label: string }[] }) {
  const name = useId();
  return (
    <fieldset>
      <legend className="text-sm font-medium text-ink">{legend}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((o) => (
          <label key={o.value} className={cx('inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm', value === o.value ? 'border-primary bg-primary-soft' : 'border-line-strong')}>
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function num(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}

export default function DecisionDetailPage() {
  const { decisionId } = useParams<{ decisionId: string }>();
  const { t, tStatus, formatDate, formatDateTime, locale } = useI18n();
  const serverText = useServerMessages();
  const { projectId, can, me } = useProjectContext();
  const refresh = useGovRefresh();
  const toast = useToast();
  const [cmd, setCmd] = useState<CmdKey | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [actionOpen, setActionOpen] = useState(false);
  const [agendaOpen, setAgendaOpen] = useState(false);
  // Command inputs
  const [choice, setChoice] = useState<VoteChoice>('approve');
  const [meetingId, setMeetingId] = useState('');
  const [reference, setReference] = useState('');
  const [extOutcome, setExtOutcome] = useState<'approved' | 'rejected'>('approved');
  const [dateInput, setDateInput] = useState('');
  const [successor, setSuccessor] = useState('');
  const [evidenceLinkId, setEvidenceLinkId] = useState('');
  const [recuseUserId, setRecuseUserId] = useState('');
  // REQ-GOV-015: the member's conflict-of-interest declaration for the item, made in the vote dialog.
  const [conflictChoice, setConflictChoice] = useState<'' | 'no_conflict' | 'conflict'>('');

  const q = useQuery({
    queryKey: gk.decision(projectId, decisionId),
    queryFn: ({ signal }) => api(governanceRoutes.getDecision, { params: { projectId, decisionId }, signal }),
  });
  const d = q.data;
  const votes = useQuery({
    queryKey: gk.votes(projectId, decisionId),
    queryFn: ({ signal }) => api(governanceRoutes.listVotes, { params: { projectId, decisionId }, signal }),
    enabled: Boolean(d),
  });
  const actions = useQuery({
    queryKey: gk.actions(projectId, { decisionId }),
    queryFn: ({ signal }) => api(governanceRoutes.listActions, { params: { projectId }, query: { decisionId, pageSize: 100 }, signal }),
    enabled: Boolean(d),
  });
  const types = useDecisionTypes(d?.committeeId);
  const meetings = useMeetingList({ committeeId: d?.committeeId, pageSize: 100, isCirculation: 'false' }, Boolean(d) && (cmd === 'startReview' || cmd === 'resume'));
  const tableable = (meetings.data?.items ?? []).filter((m) => ['planned', 'agenda_published', 'in_session'].includes(m.status));
  const tabledMeeting = useMeetingList({ committeeId: d?.committeeId, pageSize: 100 }, Boolean(d?.meetingId));
  const currentMeeting = tabledMeeting.data?.items.find((m) => m.id === d?.meetingId);
  const allDecisions = useDecisionList({ pageSize: 100 }, cmd === 'supersede');
  const successors = (allDecisions.data?.items ?? []).filter((x) => x.id !== decisionId && ['approved', 'implementation_pending', 'implemented_verified'].includes(x.status));
  // Seats of the decision's committee: names of recusal recorders and the members a secretariat may recuse on behalf of.
  const committee = useCommittee(d?.committeeId);

  if (q.isLoading) return <LoadingState />;
  if (q.error || !d) return q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <RestrictedState />;

  const allowed = new Set(d.allowedCommands);
  const me_ = me.user.id;
  const isRequester = d.requesterUserId === me_;
  const recused = d.recusals.some((r) => r.userId === me_);
  const seats = committee.data?.memberships ?? [];
  const seatHolders = new Map(seats.filter((s) => s.userId).map((s) => [s.userId!, s.displayName ?? s.roleLabel]));
  const recusedIds = new Set(d.recusals.map((r) => r.userId));
  // Members who hold a seat today and are not recused yet (the API re-checks the seat and the current round's votes).
  const onBehalfCandidates = [...new Map(seats.filter((s) => s.userId && s.activeToday && s.userId !== me_ && !recusedIds.has(s.userId)).map((s) => [s.userId!, s.displayName ?? s.roleLabel])).entries()];
  const recorderName = (uid: string | null) =>
    uid === null
      ? null
      : uid === me_
        ? t('governance.decision.recusals.recordedByYou')
        : (seatHolders.get(uid) ?? (committee.data ? t('governance.decision.recusals.recordedByOther') : t('governance.decision.recusals.recordedByUnknown')));
  const myVote = votes.data?.items.find((v) => v.userId === me_ && v.round === d.voteRound);
  const base = hubHref(projectId);
  const voting = d.voting;
  const declared = voting?.declaredUserIds.includes(me_) ?? false;
  // A recused member has already declared the conflict: no declaration step (the server refuses the vote as recused).
  const needsDeclaration = !declared && !recused;
  const isChair = !!voting?.chairUserId && voting.chairUserId === me_;

  const openCmd = (k: CmdKey) => {
    setChoice('approve');
    setMeetingId('');
    setReference('');
    setExtOutcome('approved');
    setDateInput('');
    setSuccessor('');
    setEvidenceLinkId('');
    setRecuseUserId('');
    setConflictChoice('');
    setCmd(k);
  };

  const commands: { key: CmdKey; label: string; show: boolean; primary?: boolean }[] = [
    { key: 'submit', label: t('governance.decision.cmd.submit.label'), show: allowed.has('submit') && can('governance.decision.submit'), primary: true },
    { key: 'startReview', label: t('governance.decision.cmd.startReview.label'), show: allowed.has('start_review') && can('governance.decision.review'), primary: true },
    { key: 'vote', label: t('governance.decision.cmd.vote.label'), show: d.status === 'under_review' && can('governance.decision.vote') && !voting?.closed, primary: true },
    // DOM-P2R-01: only the committee's chair closes voting on the round.
    { key: 'closeVoting', label: t('governance.decision.cmd.closeVoting.label'), show: d.status === 'under_review' && !!voting && !voting.closed && isChair && can('governance.decision.record_outcome') },
    { key: 'recordOutcome', label: t('governance.decision.cmd.recordOutcome.label'), show: d.status === 'under_review' && can('governance.decision.record_outcome'), primary: true },
    { key: 'external', label: t('governance.decision.cmd.external.label'), show: d.status === 'recommended' && can('governance.decision.record_external_approval'), primary: true },
    { key: 'startImplementation', label: t('governance.decision.cmd.startImplementation.label'), show: allowed.has('start_implementation') && can('governance.action.manage'), primary: true },
    { key: 'verifyImplementation', label: t('governance.decision.cmd.verifyImplementation.label'), show: allowed.has('verify_implementation') && can('governance.decision.verify_implementation'), primary: true },
    { key: 'resume', label: t('governance.decision.cmd.resume.label'), show: allowed.has('resume') && can('governance.decision.review') },
    { key: 'circulate', label: t('governance.decision.cmd.circulate.label'), show: d.status === 'under_review' && can('governance.circulation.initiate') },
    { key: 'recuse', label: t('governance.decision.cmd.recuse.label'), show: ['draft', 'submitted', 'under_review', 'deferred'].includes(d.status) && can('governance.conflict.declare') && !recused },
    { key: 'recuseOnBehalf', label: t('governance.decision.cmd.recuseOnBehalf.label'), show: ['draft', 'submitted', 'under_review', 'deferred'].includes(d.status) && can('governance.meeting.manage') },
    { key: 'return', label: t('governance.decision.cmd.return.label'), show: allowed.has('return_to_draft') && can('governance.decision.review') },
    { key: 'defer', label: t('governance.decision.cmd.defer.label'), show: allowed.has('defer') && can('governance.decision.record_outcome') },
    { key: 'supersede', label: t('governance.decision.cmd.supersede.label'), show: allowed.has('supersede') && can('governance.decision.record_outcome') },
  ];
  const visible = commands.filter((c) => c.show);
  const title = (k: CmdKey) => t(`governance.decision.cmd.${k}.title` as MessageKey, { code: d.code });
  const escalatedBody = d.escalatedTo ?? EM_DASH;

  const run = async (body: () => Promise<unknown>, doneKey: MessageKey, values?: Record<string, string>) => {
    await body();
    await refresh();
    toast.show('success', t(doneKey, values));
    setCmd(null);
  };

  const dialogs: Record<CmdKey, { consequences: ReactNode[]; confirm: () => Promise<void>; noteMode?: 'none' | 'optional' | 'required'; noteLabel?: string; children?: ReactNode; disabled?: boolean; danger?: boolean; noteRun?: (note: string) => Promise<void> }> = {
    submit: {
      consequences: [t('governance.decision.cmd.submit.effect')],
      noteMode: 'none',
      confirm: () => run(() => api(governanceRoutes.submitDecision, { params: { projectId, decisionId }, body: { expectedVersion: d.version } }), 'governance.decision.cmd.submit.done'),
    },
    startReview: {
      consequences: [t('governance.decision.cmd.startReview.effect')],
      confirm: async () => undefined,
      noteRun: (note) =>
        run(
          () => api(governanceRoutes.startReview, { params: { projectId, decisionId }, body: { expectedVersion: d.version, ...(meetingId ? { meetingId } : {}), ...(note ? { note } : {}) } }),
          'governance.decision.cmd.startReview.done',
        ),
      children: (
        <SelectField label={t('governance.decision.cmd.startReview.meeting')} value={meetingId} onChange={(e) => setMeetingId(e.target.value)} data-testid="review-meeting">
          <option value="">{d.meetingId ? t('governance.decision.cmd.startReview.meetingKeep') : t('governance.common.notTabled')}</option>
          {tableable.map((m) => (
            <option key={m.id} value={m.id}>
              {t('governance.common.meetingNumber', { number: m.number })} — {m.title}
            </option>
          ))}
        </SelectField>
      ),
    },
    return: {
      consequences: [t('governance.decision.cmd.return.effect')],
      noteMode: 'required',
      noteLabel: t('governance.common.reason'),
      danger: true,
      confirm: async () => undefined,
      noteRun: (note) => run(() => api(governanceRoutes.returnToDraft, { params: { projectId, decisionId }, body: { expectedVersion: d.version, note } }), 'governance.decision.cmd.return.done'),
    },
    vote: {
      consequences: [t('governance.decision.cmd.vote.effect')],
      // REQ-GOV-015: a member with a conflict records a recusal (reason required) instead of voting.
      noteMode: conflictChoice === 'conflict' ? 'required' : 'optional',
      noteLabel: conflictChoice === 'conflict' ? t('governance.decision.cmd.vote.recuseReason') : t('governance.decision.cmd.vote.comment'),
      disabled: needsDeclaration && !conflictChoice,
      confirm: async () => undefined,
      noteRun: (note) =>
        conflictChoice === 'conflict'
          ? run(() => api(governanceRoutes.declareRecusal, { params: { projectId, decisionId }, body: { reason: note } }), 'governance.decision.cmd.vote.recusedDone')
          : run(
              () =>
                api(governanceRoutes.castVote, {
                  params: { projectId, decisionId },
                  body: { expectedVersion: d.version, choice, ...(note ? { comment: note } : {}), ...(needsDeclaration ? { conflictDeclaration: 'no_conflict' as const } : {}) },
                }),
              'governance.decision.cmd.vote.done',
            ),
      children: (
        <div className="space-y-3">
          {isRequester ? <Hint tone="warning">{t('governance.decision.cmd.vote.requesterHint')}</Hint> : null}
          {recused ? <Hint tone="warning">{t('governance.decision.cmd.vote.recusedHint')}</Hint> : null}
          {myVote ? <Hint tone="info">{t('governance.decision.cmd.vote.alreadyVoted', { choice: tStatus('voteChoices', myVote.choice) })}</Hint> : null}
          {declared ? (
            <Hint tone="info">{t('governance.decision.cmd.vote.declared')}</Hint>
          ) : !needsDeclaration ? null : (
            <div data-testid="vote-conflict">
              <ChoiceGroup
                legend={t('governance.decision.cmd.vote.conflictLegend')}
                value={conflictChoice}
                onChange={(v) => setConflictChoice(v as 'no_conflict' | 'conflict')}
                options={[
                  { value: 'no_conflict', label: t('governance.decision.cmd.vote.noConflict') },
                  { value: 'conflict', label: t('governance.decision.cmd.vote.hasConflict') },
                ]}
              />
            </div>
          )}
          {conflictChoice !== 'conflict' ? (
            <>
              <Hint tone="info">{t('governance.decision.cmd.vote.conflictFirst')}</Hint>
              <ChoiceGroup legend={t('governance.decision.cmd.vote.choice')} value={choice} onChange={(v) => setChoice(v as VoteChoice)} options={VOTE_CHOICES.map((c) => ({ value: c, label: tStatus('voteChoices', c) }))} />
            </>
          ) : null}
        </div>
      ),
    },
    closeVoting: {
      consequences: [t('governance.decision.cmd.closeVoting.effect1'), t('governance.decision.cmd.closeVoting.effect2')],
      noteMode: 'required',
      noteLabel: t('governance.common.reason'),
      confirm: async () => undefined,
      noteRun: (note) => run(() => api(governanceRoutes.closeVoting, { params: { projectId, decisionId }, body: { expectedVersion: d.version, reason: note } }), 'governance.decision.cmd.closeVoting.done'),
      children: voting ? <Hint tone="info">{t('governance.decision.cmd.closeVoting.outstanding', { count: voting.outstanding })}</Hint> : null,
    },
    recordOutcome: {
      consequences: [t('governance.decision.cmd.recordOutcome.effect1'), t('governance.decision.cmd.recordOutcome.effect2'), t('governance.decision.cmd.recordOutcome.complete'), t('governance.decision.cmd.recordOutcome.integrity'), t('governance.hub.internalApprovals')],
      // DOM-P2R-01: not before every eligible member voted, or the chair closed voting (the server re-checks).
      disabled: !!voting && !voting.complete,
      children: voting && !voting.complete ? <Hint tone="warning">{t('governance.decision.cmd.recordOutcome.outstanding', { count: voting.outstanding })}</Hint> : null,
      confirm: async () => undefined,
      noteRun: async (note) => {
        const r = await api(governanceRoutes.recordOutcome, { params: { projectId, decisionId }, body: { expectedVersion: d.version, ...(note ? { note } : {}) } });
        await refresh();
        toast.show('success', t('governance.decision.cmd.recordOutcome.done', { status: tStatus('decisionStatuses', r.status) }));
        setCmd(null);
      },
    },
    circulate: {
      consequences: [t('governance.decision.cmd.circulate.effect')],
      disabled: !dateInput,
      confirm: async () => undefined,
      noteRun: (note) =>
        run(
          () => api(governanceRoutes.initiateCirculation, { params: { projectId, decisionId }, body: { expectedVersion: d.version, responseDeadline: dateInput, ...(note ? { note } : {}) } }),
          'governance.decision.cmd.circulate.done',
        ),
      children: <TextField label={t('governance.decision.cmd.circulate.deadline')} required type="date" dir="ltr" value={dateInput} onChange={(e) => setDateInput(e.target.value)} />,
    },
    recuse: {
      consequences: [t('governance.decision.cmd.recuse.effect'), t('governance.decision.cmd.recuse.afterVote')],
      noteMode: 'required',
      noteLabel: t('governance.common.reason'),
      confirm: async () => undefined,
      noteRun: (note) => run(() => api(governanceRoutes.declareRecusal, { params: { projectId, decisionId }, body: { reason: note } }), 'governance.decision.cmd.recuse.done'),
    },
    recuseOnBehalf: {
      consequences: [t('governance.decision.cmd.recuseOnBehalf.effect'), t('governance.decision.cmd.recuse.afterVote')],
      noteMode: 'required',
      noteLabel: t('governance.common.reason'),
      disabled: !recuseUserId,
      confirm: async () => undefined,
      noteRun: (note) =>
        run(() => api(governanceRoutes.declareRecusal, { params: { projectId, decisionId }, body: { userId: recuseUserId, reason: note } }), 'governance.decision.cmd.recuseOnBehalf.done'),
      children: (
        <SelectField
          label={t('governance.decision.cmd.recuseOnBehalf.member')}
          required
          value={recuseUserId}
          onChange={(e) => setRecuseUserId(e.target.value)}
          hint={t('governance.decision.cmd.recuseOnBehalf.memberHint')}
          data-testid="recuse-member"
        >
          <option value="">{committee.isLoading ? t('governance.common.loadingList') : t('governance.common.select')}</option>
          {onBehalfCandidates.map(([uid, name]) => (
            <option key={uid} value={uid}>
              {name}
            </option>
          ))}
        </SelectField>
      ),
    },
    external: {
      consequences: [t('governance.decision.cmd.external.effect', { body: escalatedBody }), t('governance.decision.cmd.external.evidenceEffect'), t('governance.hub.internalApprovals')],
      disabled: !reference.trim() || !evidenceLinkId,
      confirm: async () => undefined,
      noteRun: (note) =>
        run(
          () =>
            api(governanceRoutes.recordExternalApproval, {
              params: { projectId, decisionId },
              body: { expectedVersion: d.version, externalReference: reference.trim(), evidenceLinkId, outcome: extOutcome, ...(note ? { note } : {}) },
            }),
          'governance.decision.cmd.external.done',
        ),
      children: (
        <div className="space-y-3">
          <ChoiceGroup
            legend={t('governance.decision.cmd.external.outcome')}
            value={extOutcome}
            onChange={(v) => setExtOutcome(v as 'approved' | 'rejected')}
            options={[
              { value: 'approved', label: tStatus('decisionStatuses', 'approved') },
              { value: 'rejected', label: tStatus('decisionStatuses', 'rejected') },
            ]}
          />
          <TextField label={t('governance.decision.cmd.external.reference')} required value={reference} maxLength={500} onChange={(e) => setReference(e.target.value)} hint={t('governance.decision.cmd.external.referenceHint')} />
          <ExternalEvidencePicker decisionId={d.id} value={evidenceLinkId} onChange={setEvidenceLinkId} evidenceAnchor={EVIDENCE_ANCHOR} />
        </div>
      ),
    },
    defer: {
      consequences: [t('governance.decision.cmd.defer.effect'), t('governance.decision.cmd.defer.newRound')],
      noteMode: 'required',
      noteLabel: t('governance.common.reason'),
      confirm: async () => undefined,
      noteRun: (note) =>
        run(() => api(governanceRoutes.deferDecision, { params: { projectId, decisionId }, body: { expectedVersion: d.version, note, ...(dateInput ? { revisitDate: dateInput } : {}) } }), 'governance.decision.cmd.defer.done'),
      children: <TextField label={t('governance.decision.cmd.defer.revisitDate')} type="date" dir="ltr" value={dateInput} onChange={(e) => setDateInput(e.target.value)} />,
    },
    resume: {
      consequences: [t('governance.decision.cmd.resume.effect')],
      confirm: async () => undefined,
      noteRun: (note) =>
        run(
          () => api(governanceRoutes.resumeDecision, { params: { projectId, decisionId }, body: { expectedVersion: d.version, ...(meetingId ? { meetingId } : {}), ...(note ? { note } : {}) } }),
          'governance.decision.cmd.resume.done',
        ),
      children: (
        <SelectField label={t('governance.decision.cmd.startReview.meeting')} value={meetingId} onChange={(e) => setMeetingId(e.target.value)}>
          <option value="">{t('governance.common.notTabled')}</option>
          {tableable.map((m) => (
            <option key={m.id} value={m.id}>
              {t('governance.common.meetingNumber', { number: m.number })} — {m.title}
            </option>
          ))}
        </SelectField>
      ),
    },
    supersede: {
      consequences: [t('governance.decision.cmd.supersede.effect')],
      noteMode: 'required',
      noteLabel: t('governance.common.reason'),
      disabled: !successor,
      danger: true,
      confirm: async () => undefined,
      noteRun: (note) =>
        run(() => api(governanceRoutes.supersedeDecision, { params: { projectId, decisionId }, body: { expectedVersion: d.version, supersededByDecisionId: successor, note } }), 'governance.decision.cmd.supersede.done'),
      children: (
        <SelectField label={t('governance.decision.cmd.supersede.by')} required value={successor} onChange={(e) => setSuccessor(e.target.value)} hint={t('governance.decision.cmd.supersede.byHint')}>
          <option value="">{t('governance.common.select')}</option>
          {successors.map((x) => (
            <option key={x.id} value={x.id}>
              {x.code} — {x.title}
            </option>
          ))}
        </SelectField>
      ),
    },
    startImplementation: {
      consequences: [t('governance.decision.cmd.startImplementation.effect')],
      confirm: async () => undefined,
      noteRun: (note) =>
        run(() => api(governanceRoutes.startImplementation, { params: { projectId, decisionId }, body: { expectedVersion: d.version, ...(note ? { note } : {}) } }), 'governance.decision.cmd.startImplementation.done'),
    },
    verifyImplementation: {
      consequences: [t('governance.decision.cmd.verifyImplementation.effect')],
      noteMode: 'required',
      noteLabel: t('governance.decision.cmd.verifyImplementation.evidence'),
      confirm: async () => undefined,
      noteRun: (note) =>
        run(() => api(governanceRoutes.verifyImplementation, { params: { projectId, decisionId }, body: { expectedVersion: d.version, evidenceNote: note } }), 'governance.decision.cmd.verifyImplementation.done'),
    },
  };
  const active = cmd ? dialogs[cmd] : null;

  const tally = d.tallySnapshot as Record<string, unknown> | null;
  const tallyCounts = (tally?.tally ?? null) as Record<string, unknown> | null;
  const tallyQuorum = (tally?.quorum ?? null) as Record<string, unknown> | null;
  const tallyAuthority = (tally?.authority ?? null) as Record<string, unknown> | null;
  // QA-P2-04: the authority reason in the active language (codes from the outcome snapshot); the decision type is named as
  // the matrix names it. Outcomes recorded before the codes existed keep the server's English sentence.
  const authorityReasonCodes = d.authorityReasonI18n?.map((m) => (typeof m.params['decisionType'] === 'string' ? { ...m, params: { ...m.params, decisionType: typeName(types, m.params['decisionType'], locale) } } : m));
  const authorityReasonText = d.authorityReason ?? (typeof tallyAuthority?.reason === 'string' ? tallyAuthority.reason : '');

  return (
    <>
      <Link href={`${base}/decisions`} className={cx(btn.link, 'mb-3 inline-flex items-center gap-1 text-sm')}>
        <ChevronLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
        {t('governance.decision.back')}
      </Link>
      <PageHeader
        eyebrow={<span dir="ltr">{d.code}</span>}
        // Free text typed by the requester in the decision paper: shown as entered (data-user-text).
        title={
          <span dir="auto" data-user-text>
            {d.title}
          </span>
        }
        documentTitle={`${d.code} — ${d.title}`}
        badges={
          <>
            <span data-testid="decision-status">
              <StatusBadge enumName="decisionStatuses" value={d.status} size="md" />
            </span>
            {d.authorityOutcome !== 'not_assessed' ? <StatusBadge enumName="decisionAuthorityOutcomes" value={d.authorityOutcome} /> : null}
            <StatusBadge enumName="classifications" value={d.classification} tone="neutral" />
            {d.isDemo ? <DemoBadge /> : null}
          </>
        }
        actions={
          <>
            {d.status === 'draft' && can('governance.decision.draft') ? (
              <button type="button" className={btn.secondary} onClick={() => setEditOpen(true)} data-testid="edit-paper">
                {t('governance.paper.edit')}
              </button>
            ) : null}
            {['draft', 'submitted', 'under_review', 'deferred'].includes(d.status) && can('governance.agenda_request.create') ? (
              <button type="button" className={btn.secondary} onClick={() => setAgendaOpen(true)} data-testid="request-agenda">
                {t('governance.agenda.request.action')}
              </button>
            ) : null}
          </>
        }
      />

      {visible.length ? (
        <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label={t('governance.actions.columns.commands')} data-testid="decision-commands">
          {visible.map((c) => (
            <button key={c.key} type="button" className={c.primary ? btn.primary : btn.secondary} onClick={() => openCmd(c.key)} data-command={c.key}>
              {c.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="space-y-6">
        {d.status === 'recommended' ? (
          <div role="status" className="rounded-lg border border-warning/40 bg-warning-soft p-4" data-testid="recommended-callout">
            <p className="flex items-center gap-2 font-semibold text-ink">
              <Scale aria-hidden="true" className="size-5 text-warning" />
              {t('governance.decision.recommended.title')}
            </p>
            <p className="mt-1 text-sm text-ink">{t('governance.decision.recommended.body', { body: escalatedBody })}</p>
            <p className="mt-1 text-sm text-ink">{t('governance.decision.recommended.evidence')}</p>
            <Link href={`${base}/escalations?sourceType=decision&sourceId=${d.id}`} className={cx(btn.link, 'mt-2 inline-block text-sm')}>
              {t('governance.hub.tabs.escalations')}
            </Link>
          </div>
        ) : null}

        <Lifecycle d={d} />

        {d.status === 'under_review' && voting ? (
          <div className={cx(card, 'p-4')} data-testid="voting-state" data-complete={voting.complete ? 'true' : 'false'}>
            <h2 className="mb-2 text-lg font-semibold text-ink">{t('governance.decision.votingState.title', { round: voting.round })}</h2>
            {voting.closed ? (
              <p className="text-sm text-ink" data-testid="voting-closed">
                {t('governance.decision.votingState.closed', { at: formatDateTime(voting.closedAt) })}{' '}
                <span className="text-muted">{t('governance.common.reason')}: </span>
                <UText value={voting.closeReason} />
              </p>
            ) : voting.outstanding > 0 ? (
              <p className="text-sm text-ink" data-testid="voting-outstanding">
                {t('governance.decision.votingState.outstanding', { count: voting.outstanding })}{' '}
                <span dir="auto">{voting.outstandingUserIds.map((u) => seatHolders.get(u) ?? t('governance.decision.recusals.recordedByUnknown')).join(', ')}</span>
              </p>
            ) : (
              <p className="text-sm text-ink">{t('governance.decision.votingState.allVoted')}</p>
            )}
            <p className="mt-2 text-xs text-muted">{t('governance.decision.votingState.rule')}</p>
          </div>
        ) : null}

        {d.status === 'draft' ? (
          d.missingFields.length ? (
            <div role="note" className="rounded-lg border border-warning/40 bg-warning-soft p-4 text-sm" data-testid="missing-fields">
              <p className="flex items-center gap-2 font-semibold text-ink">
                <CircleAlert aria-hidden="true" className="size-4 text-warning" />
                {t('governance.paper.missingTitle')}
              </p>
              <p className="mt-1 text-ink">{t('governance.paper.missingHint')}</p>
              <ul className="mt-1 list-disc ps-5 text-ink">
                {d.missingFields.map((f) => (
                  <li key={f}>{t(`governance.paper.missing.${f.replace('.', '_')}` as MessageKey)}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="rounded-lg border border-success/30 bg-success-soft p-3 text-sm text-ink">{t('governance.paper.complete')}</p>
          )
        ) : null}

        <Section id="paper" title={t('governance.paper.title')}>
          <div className={cx(card, 'p-4')}>
            <Facts
              items={[
                { label: t('governance.common.committee'), value: <CommitteeLink committeeId={d.committeeId} /> },
                { label: t('governance.paper.decisionType'), value: typeName(types, d.decisionTypeKey, locale) },
                { label: t('governance.paper.requester'), value: <UText value={d.requesterName} /> },
                { label: t('governance.paper.latestSafeDate'), value: formatDate(d.latestSafeDate) },
                {
                  label: t('governance.decision.tabledAt'),
                  value: d.meetingId ? (
                    <Link href={`${base}/meetings/${d.meetingId}`} className={btn.link}>
                      {currentMeeting?.isCirculation
                        ? t('governance.common.circulationNumber', { number: currentMeeting.number })
                        : currentMeeting
                          ? t('governance.common.meetingNumber', { number: currentMeeting.number })
                          : t('governance.common.meeting')}
                    </Link>
                  ) : (
                    <span className="text-muted">{t('governance.common.notTabled')}</span>
                  ),
                },
                { label: t('governance.paper.amount'), value: <Money value={d.amount} /> },
                {
                  label: t('governance.paper.subject.fact'),
                  testId: 'decision-subject',
                  value: d.subject ? (
                    <span>
                      {t(`governance.paper.subject.types.${d.subject.type}`)}
                      {d.subject.label ? (
                        <>
                          {' — '}
                          <span dir="auto">{d.subject.label}</span>
                        </>
                      ) : null}
                    </span>
                  ) : (
                    <span className="text-muted">{t('governance.paper.subject.factNone')}</span>
                  ),
                },
                {
                  label: t('governance.paper.supportingEvidence'),
                  value: (
                    <span className="flex flex-col gap-1">
                      <span>{t('governance.paper.supportingEvidenceCount', { count: d.supportingEvidenceLinks })}</span>
                      {d.evidenceNoneReason ? (
                        <span>
                          <span className="text-muted">{t('governance.paper.evidenceNoneReason')}: </span>
                          <UText value={d.evidenceNoneReason} />
                        </span>
                      ) : null}
                    </span>
                  ),
                },
                { label: t('governance.paper.issue'), value: <UText value={d.issue} multiline />, wide: true },
                { label: t('governance.paper.whyNow'), value: <UText value={d.whyNow} multiline />, wide: true },
                {
                  label: t('governance.paper.alternatives'),
                  wide: true,
                  value: d.alternatives.length ? (
                    <ol className="list-decimal space-y-1 ps-5">
                      {d.alternatives.map((a, i) => (
                        <li key={i}>
                          <span dir="auto" className="font-medium">
                            {a.title}
                          </span>
                          {a.summary ? (
                            <>
                              {' — '}
                              <span dir="auto">{a.summary}</span>
                            </>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <span className="text-muted">{EM_DASH}</span>
                  ),
                },
                { label: t('governance.paper.recommendation'), value: <UText value={d.recommendation} multiline />, wide: true },
                { label: t('governance.paper.impactFinancial'), value: <UText value={d.impacts.financial} /> },
                { label: t('governance.paper.impactOperational'), value: <UText value={d.impacts.operational} /> },
                { label: t('governance.paper.impactSchedule'), value: <UText value={d.impacts.schedule} /> },
                { label: t('governance.paper.requiredAuthority'), value: <UText value={d.requiredAuthority} /> },
                { label: t('governance.paper.risks'), value: <UText value={d.risks} multiline />, wide: true },
                { label: t('governance.paper.dependencies'), value: <UText value={d.dependencies} multiline />, wide: true },
              ]}
            />
          </div>
        </Section>

        {d.outcomeRecordedAt || d.externalAuthorityReference || d.supersededByDecisionId || d.implementationStartedAt ? (
          <Section id="outcome" title={t('governance.decision.tally.title')}>
            <div className={cx(card, 'space-y-3 p-4')} data-testid="decision-outcome">
              {tallyCounts ? (
                <p className="text-sm text-ink">
                  <span className="font-semibold">{t('governance.decision.round', { round: num(tally?.round) })}: </span>
                  {t('governance.decision.tally.counts', { approve: num(tallyCounts.approve), reject: num(tallyCounts.reject), abstain: num(tallyCounts.abstain) })}
                </p>
              ) : null}
              {num(tally?.disregardedVotes) > 0 ? <p className="text-sm text-muted">{t('governance.decision.tally.disregarded', { count: num(tally?.disregardedVotes) })}</p> : null}
              <Facts
                items={[
                  ...(tallyQuorum
                    ? [
                        {
                          label: t('governance.decision.tally.quorum'),
                          value:
                            typeof tallyQuorum.presentVoting === 'number' && typeof tallyQuorum.eligibleVoting === 'number' && typeof tallyQuorum.required === 'number' ? (
                              t('governance.decision.tally.quorumDetail', {
                                status: tallyQuorum.met ? t('governance.meeting.quorum.met') : t('governance.meeting.quorum.notMet'),
                                present: tallyQuorum.presentVoting,
                                eligible: tallyQuorum.eligibleVoting,
                                required: tallyQuorum.required,
                              })
                            ) : (
                              // Older snapshots without structured counts: the server's (English) explanation.
                              <span dir="ltr" lang="en">
                                {String(tallyQuorum.explanation ?? EM_DASH)}
                              </span>
                            ),
                          wide: true,
                        },
                      ]
                    : []),
                  ...(tallyAuthority || d.authorityReason
                    ? [
                        {
                          label: t('governance.decision.facts.authorityReason'),
                          // Server rule explanation, translated from its codes; older outcomes: the English sentence.
                          value: authorityReasonCodes?.length ? (
                            <span data-testid="authority-reason">{serverText(authorityReasonCodes, authorityReasonText)}</span>
                          ) : (
                            <span dir="ltr" lang="en" data-testid="authority-reason">
                              {authorityReasonText}
                            </span>
                          ),
                          wide: true,
                        },
                      ]
                    : []),
                  ...(d.escalatedTo ? [{ label: t('governance.decision.facts.escalatedTo'), value: <UText value={d.escalatedTo} /> }] : []),
                  ...(d.outcomeRecordedAt ? [{ label: t('governance.decision.facts.outcomeRecordedAt'), value: formatDateTime(d.outcomeRecordedAt) }] : []),
                  ...(d.decidedViaCirculation ? [{ label: t('governance.decision.facts.viaCirculation'), value: t('governance.common.yes') }] : []),
                  ...(d.externalAuthorityReference ? [{ label: t('governance.decision.facts.externalReference'), value: <UText value={d.externalAuthorityReference} />, testId: 'external-reference' }] : []),
                  ...(d.externalEvidenceLinkId
                    ? [{ label: t('governance.decision.facts.externalEvidence'), value: <ExternalEvidenceFact decisionId={d.id} linkId={d.externalEvidenceLinkId} evidenceAnchor={EVIDENCE_ANCHOR} /> }]
                    : []),
                  ...(d.supersededByDecisionId
                    ? [
                        {
                          label: t('governance.decision.facts.supersededBy'),
                          value: (
                            <Link href={`${base}/decisions/${d.supersededByDecisionId}`} className={btn.link}>
                              {t('governance.common.view')}
                            </Link>
                          ),
                        },
                      ]
                    : []),
                  ...(d.implementationStartedAt ? [{ label: t('governance.decision.facts.implementationStartedAt'), value: formatDateTime(d.implementationStartedAt) }] : []),
                  ...(d.implementationVerifiedAt ? [{ label: t('governance.decision.facts.implementationVerifiedAt'), value: formatDateTime(d.implementationVerifiedAt) }] : []),
                  ...(d.implementationEvidenceNote ? [{ label: t('governance.decision.facts.implementationEvidence'), value: <UText value={d.implementationEvidenceNote} multiline />, wide: true }] : []),
                ]}
              />
            </div>
          </Section>
        ) : null}

        <Section id="votes" title={t('governance.decision.votes.title')} description={t('governance.decision.votes.immutable')}>
          <DataTable<Vote>
            className="relative"
            caption={t('governance.decision.votes.title')}
            rows={votes.data?.items}
            rowKey={(v) => v.id}
            isLoading={votes.isLoading}
            error={votes.error}
            onRetry={() => votes.refetch()}
            emptyTitle={t('governance.decision.votes.empty')}
            testId="votes-table"
            columns={[
              { key: 'member', header: t('governance.decision.votes.columns.member'), isRowHeader: true, sortValue: (v) => v.displayName ?? '', cell: (v) => <UText value={v.displayName} /> },
              { key: 'capacity', header: t('governance.decision.votes.columns.capacity'), cell: (v) => tStatus('committeeMemberRoles', v.memberRoleAtVote) },
              { key: 'choice', header: t('governance.decision.votes.columns.choice'), sortValue: (v) => v.choice, cell: (v) => <StatusBadge enumName="voteChoices" value={v.choice} tone={v.choice === 'approve' ? 'success' : v.choice === 'reject' ? 'danger' : 'neutral'} /> },
              { key: 'round', header: t('governance.decision.votes.columns.round'), sortValue: (v) => v.round, cell: (v) => <span className="tabular">{v.round}</span> },
              { key: 'via', header: t('governance.decision.votes.columns.via'), cell: (v) => (v.viaCirculation ? t('governance.decision.votes.viaCirculation') : t('governance.decision.votes.inMeeting')) },
              { key: 'castAt', header: t('governance.decision.votes.columns.castAt'), sortValue: (v) => v.castAt, cell: (v) => <span className="tabular">{formatDateTime(v.castAt)}</span> },
              { key: 'comment', header: t('governance.decision.votes.columns.comment'), cell: (v) => <UText value={v.comment} /> },
            ]}
          />
        </Section>

        <Section id="recusals" title={t('governance.decision.recusals.title')} description={t('governance.decision.recusals.rule')}>
          {d.recusals.length ? (
            <ul className={cx(card, 'divide-y divide-line')} data-testid="recusals">
              {d.recusals.map((r) => (
                <li key={r.userId} className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:gap-4" data-testid="recusal" data-on-behalf={r.onBehalf ? 'true' : 'false'}>
                  <span className="flex flex-col gap-1 font-medium sm:w-56">
                    <UText value={r.displayName} />
                    {r.onBehalf ? (
                      <StatusBadge enumName="attendanceStatuses" value="recused" tone="info" label={t('governance.decision.recusals.onBehalf')} />
                    ) : (
                      <span className="text-xs font-normal text-muted">{t('governance.decision.recusals.ownDeclaration')}</span>
                    )}
                  </span>
                  <span className="flex-1 space-y-1">
                    <span className="block">
                      <span className="text-muted">{t('governance.common.reason')}: </span>
                      <UText value={r.reason} />
                    </span>
                    {r.onBehalf ? (
                      <span className="block text-xs text-muted" data-testid="recusal-recorder">
                        {t('governance.decision.recusals.recordedBy', { name: recorderName(r.recordedBy) ?? EM_DASH })}
                      </span>
                    ) : null}
                  </span>
                  <time className="tabular text-muted" dateTime={r.declaredAt}>
                    {formatDateTime(r.declaredAt)}
                  </time>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">{t('governance.decision.recusals.empty')}</p>
          )}
        </Section>

        {can('documents.document.read') ? (
          <div id={EVIDENCE_ANCHOR} className="scroll-mt-20">
            <EvidencePanel targetType="decision" targetId={d.id} title={t('governance.decision.evidence.title')} />
            <p className="mt-2 text-xs text-muted">{t('governance.decision.evidence.hint')}</p>
          </div>
        ) : null}

        <Section
          id="actions"
          title={t('governance.decision.actions.title')}
          actions={
            <>
              <Link href={`${base}/actions?decisionId=${d.id}`} className={cx(btn.link, 'text-sm')}>
                {t('governance.decision.actions.viewAll')}
              </Link>
              {can('governance.action.manage') && ['approved', 'implementation_pending', 'under_review', 'recommended'].includes(d.status) ? (
                <button type="button" className={btn.secondary} onClick={() => setActionOpen(true)} data-testid="add-action">
                  {t('governance.decision.cmd.addAction')}
                </button>
              ) : null}
            </>
          }
        >
          <DataTable
            className="relative"
            caption={t('governance.decision.actions.title')}
            rows={actions.data?.items}
            rowKey={(a) => a.id}
            isLoading={actions.isLoading}
            error={actions.error}
            onRetry={() => actions.refetch()}
            emptyTitle={t('governance.decision.actions.empty')}
            columns={[
              { key: 'code', header: t('governance.actions.columns.code'), isRowHeader: true, cell: (a) => <span dir="ltr">{a.code}</span> },
              { key: 'title', header: t('governance.actions.columns.title'), cell: (a) => <UText value={a.title} /> },
              { key: 'owner', header: t('governance.actions.columns.owner'), cell: (a) => <UText value={a.ownerName} /> },
              {
                key: 'due',
                header: t('governance.actions.columns.dueDate'),
                cell: (a) => (
                  <span className="flex flex-wrap items-center gap-1">
                    <span className="tabular">{formatDate(a.dueDate)}</span>
                    {a.overdue ? <StatusBadge enumName="actionItemStatuses" value="overdue" tone="danger" label={t('governance.actions.overdue')} /> : null}
                  </span>
                ),
              },
              { key: 'status', header: t('governance.actions.columns.status'), cell: (a) => <StatusBadge enumName="actionItemStatuses" value={a.status} /> },
            ]}
          />
        </Section>

        <GovHistory entityType="decision" entityId={d.id} title={t('governance.decision.history')} defaultOpen />
        <p className="text-xs text-muted">{t('governance.hub.internalApprovals')}</p>
      </div>

      {cmd && active ? (
        <GovCommandDialog
          open
          onClose={() => setCmd(null)}
          title={title(cmd)}
          confirmLabel={commands.find((c) => c.key === cmd)?.label ?? ''}
          consequences={[...active.consequences, t('common.command.audited')]}
          noteMode={active.noteMode ?? 'optional'}
          noteLabel={active.noteLabel}
          expectedVersion={d.version}
          danger={active.danger}
          confirmDisabled={active.disabled}
          onReload={() => {
            void refresh();
            setCmd(null);
          }}
          onConfirm={async ({ note }) => {
            if (active.noteRun) await active.noteRun(note);
            else await active.confirm();
          }}
        >
          {active.children}
        </GovCommandDialog>
      ) : null}

      {d.status === 'draft' ? <DecisionPaperDialog open={editOpen} onClose={() => setEditOpen(false)} decision={d} /> : null}
      <CreateActionDialog open={actionOpen} onClose={() => setActionOpen(false)} decisionId={d.id} />
      <AgendaRequestDialog open={agendaOpen} onClose={() => setAgendaOpen(false)} committeeId={d.committeeId} decisionId={d.id} />
    </>
  );
}

function Hint({ tone, children }: { tone: 'warning' | 'info'; children: ReactNode }) {
  return (
    <p className={cx('rounded-md border p-2 text-sm text-ink', tone === 'warning' ? 'border-warning/40 bg-warning-soft' : 'border-info/40 bg-info-soft')} role="note">
      {children}
    </p>
  );
}

function CommitteeLink({ committeeId }: { committeeId: string }) {
  const { t } = useI18n();
  const { projectId, can } = useProjectContext();
  const c = useQuery({
    queryKey: gk.committee(projectId, committeeId),
    queryFn: ({ signal }) => api(governanceRoutes.getCommittee, { params: { projectId, committeeId }, signal }),
    enabled: can('governance.committee.read'),
  });
  if (c.isLoading) return <span className="text-muted">{t('states.loading')}</span>;
  if (!c.data) return <span className="text-muted">{EM_DASH}</span>;
  return (
    <Link href={`${hubHref(projectId)}/committees/${committeeId}`} className={btn.link} dir="auto">
      {c.data.name}
    </Link>
  );
}


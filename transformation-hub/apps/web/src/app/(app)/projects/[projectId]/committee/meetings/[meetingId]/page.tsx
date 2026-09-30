'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useMemo, useState, type ReactNode } from 'react';
import { governanceRoutes } from '@hub/contracts';
import { ATTENDANCE_STATUSES } from '@hub/domain';
import { DataTable } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { Dialog } from '@/components/Dialog';
import { ErrorState } from '@/components/ErrorState';
import { SelectField, TextAreaField } from '@/components/Field';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { RestrictedState } from '@/components/RestrictedState';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn, card, cx, input } from '@/components/ui';
import { EM_DASH, useI18n, type MessageKey } from '@/i18n/provider';
import { api } from '@/lib/api';
import { useProjectContext } from '@/lib/project-context';
import { AgendaRequestDialog, CreateActionDialog } from '../../_components/dialogs';
import { Facts, GovCommandDialog, GovHistory, Section, UText, gk, hubHref, useCommittee, useDecisionList, useGovRefresh, type AgendaItem } from '../../_components/gov';
import { ScreenAgendaDialog } from '../../_components/screen';

type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
type Declaration = 'no_conflict' | 'interest_declared' | 'recused';
type MeetingCmd = 'confirm' | 'publish' | 'freeze' | 'start' | 'close' | 'cancel' | 'quorum' | 'draftMinutes' | 'approveMinutes';

const riyadhDate = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

function PackDialog({ meetingId, packId, onClose }: { meetingId: string; packId: string | null; onClose: () => void }) {
  const { t, tStatus, formatDateTime, formatDate } = useI18n();
  const { projectId } = useProjectContext();
  const q = useQuery({
    queryKey: gk.pack(projectId, meetingId, packId ?? ''),
    queryFn: ({ signal }) => api(governanceRoutes.getPack, { params: { projectId, meetingId, packId: packId! }, signal }),
    enabled: Boolean(packId),
  });
  const p = q.data?.payload as
    | {
        agenda?: { number: number | null; title: string; kind: string }[];
        decisionPapers?: { id: string; code: string; title: string; status: string; version: number }[];
        openActions?: { id: string; code: string; title: string; dueDate: string | null; status: string }[];
        quorum?: { explanation?: string } | null;
      }
    | undefined;
  return (
    <Dialog open={Boolean(packId)} onClose={onClose} size="lg" title={q.data ? t('governance.meeting.packs.viewFor', { title: q.data.title }) : t('governance.meeting.packs.view')}>
      {q.isLoading ? (
        <LoadingState compact />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : q.data && p ? (
        <div className="space-y-4 text-sm" data-testid="pack-view">
          <p className="text-muted">
            {formatDateTime(q.data.generatedAt)} · <StatusBadge enumName="classifications" value={q.data.classification} tone="neutral" />{' '}
            {q.data.includesDemoData ? <DemoBadge /> : null}
          </p>
          <p className="break-all text-xs text-muted">
            {t('governance.meeting.packs.columns.hash')}: <code dir="ltr">{q.data.contentHash}</code>
          </p>
          {q.data.previousSnapshotId ? <p className="text-xs text-muted">{t('governance.meeting.packs.previous')}</p> : null}
          <div>
            <h3 className="font-semibold text-ink">{t('governance.meeting.packs.agenda')}</h3>
            <ol className="mt-1 list-none space-y-1">
              {(p.agenda ?? []).map((a, i) => (
                <li key={i}>
                  <span className="tabular me-2 text-muted">{a.number ?? EM_DASH}.</span>
                  <span dir="auto">{a.title}</span> <span className="text-muted">({tStatus('agendaItemKinds', a.kind)})</span>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h3 className="font-semibold text-ink">{t('governance.meeting.packs.papers')}</h3>
            <ul className="mt-1 space-y-1">
              {(p.decisionPapers ?? []).map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2">
                  <span dir="ltr" className="font-medium">
                    {d.code}
                  </span>
                  <span dir="auto">{d.title}</span>
                  <StatusBadge enumName="decisionStatuses" value={d.status} />
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="font-semibold text-ink">{t('governance.meeting.packs.openActions')}</h3>
            <ul className="mt-1 space-y-1">
              {(p.openActions ?? []).length === 0 ? <li className="text-muted">{EM_DASH}</li> : null}
              {(p.openActions ?? []).map((a) => (
                <li key={a.id}>
                  <span dir="ltr" className="me-2 font-medium">
                    {a.code}
                  </span>
                  <span dir="auto">{a.title}</span> <span className="tabular text-muted">{formatDate(a.dueDate)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="font-semibold text-ink">{t('governance.meeting.packs.quorum')}</h3>
            <p className="mt-1" dir="ltr">
              {p.quorum?.explanation ?? t('governance.meeting.packs.noQuorum')}
            </p>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}

export default function MeetingDetailPage() {
  const { meetingId } = useParams<{ meetingId: string }>();
  const { t, tStatus, formatDateTime } = useI18n();
  const { projectId, can, me } = useProjectContext();
  const refresh = useGovRefresh();
  const toast = useToast();
  const [cmd, setCmd] = useState<MeetingCmd | null>(null);
  const [attOpen, setAttOpen] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [agendaOpen, setAgendaOpen] = useState(false);
  const [actionOpen, setActionOpen] = useState(false);
  const [screening, setScreening] = useState<AgendaItem | null>(null);
  const [packId, setPackId] = useState<string | null>(null);
  const [minutesText, setMinutesText] = useState('');
  const [minutesReason, setMinutesReason] = useState('');
  const [att, setAtt] = useState<Record<string, AttendanceStatus | ''>>({});
  const [decl, setDecl] = useState<{ userId: string; declaration: Declaration; decisionId: string; description: string }>({ userId: '', declaration: 'no_conflict', decisionId: '', description: '' });

  const q = useQuery({
    queryKey: gk.meeting(projectId, meetingId),
    queryFn: ({ signal }) => api(governanceRoutes.getMeeting, { params: { projectId, meetingId }, signal }),
  });
  const m = q.data;
  const committee = useCommittee(m?.committeeId);
  const packs = useQuery({
    queryKey: gk.packs(projectId, meetingId),
    queryFn: ({ signal }) => api(governanceRoutes.listPacks, { params: { projectId, meetingId }, signal }),
    enabled: Boolean(m),
  });
  const pendingQuery = { meetingId, screeningStatus: 'requested' as const, pageSize: 100 };
  const pending = useQuery({
    queryKey: gk.agenda(projectId, pendingQuery),
    queryFn: ({ signal }) => api(governanceRoutes.listAgendaRequests, { params: { projectId }, query: pendingQuery, signal }),
    enabled: Boolean(m) && !m?.isCirculation,
  });
  const decisions = useDecisionList({ meetingId, pageSize: 100 }, Boolean(m));
  const committeeDecisions = useDecisionList({ committeeId: m?.committeeId, pageSize: 100 }, conflictOpen && Boolean(m));

  const onDate = m ? riyadhDate(m.scheduledAt) : '';
  const seats = useMemo(
    () => (committee.data?.memberships ?? []).filter((s) => s.userId && s.validFrom <= onDate && (!s.validTo || s.validTo >= onDate)),
    [committee.data, onDate],
  );

  if (q.isLoading) return <LoadingState />;
  if (q.error || !m) return q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <RestrictedState />;

  const base = hubHref(projectId);
  const manage = can('governance.meeting.manage');
  const heading = m.isCirculation ? t('governance.common.circulationNumber', { number: m.number }) : t('governance.common.meetingNumber', { number: m.number });
  const st = m.status;
  const commands: { key: MeetingCmd; label: string; show: boolean; primary?: boolean; danger?: boolean }[] = [
    // REQ-GOV-009: a proposed (cadence-generated) meeting joins the schedule only by this explicit confirmation.
    { key: 'confirm', label: t('governance.meeting.cmd.confirm.label'), show: manage && !m.isCirculation && st === 'proposed', primary: true },
    { key: 'publish', label: t('governance.meeting.cmd.publish.label'), show: manage && !m.isCirculation && st === 'planned', primary: true },
    { key: 'freeze', label: t('governance.meeting.cmd.freeze.label'), show: manage && st !== 'cancelled' },
    { key: 'start', label: t('governance.meeting.cmd.start.label'), show: manage && !m.isCirculation && st === 'agenda_published', primary: true },
    { key: 'quorum', label: t('governance.meeting.cmd.quorum.label'), show: manage && !m.isCirculation && ['agenda_published', 'in_session', 'held'].includes(st) },
    { key: 'close', label: t('governance.meeting.cmd.close.label'), show: manage && !m.isCirculation && st === 'in_session', primary: true },
    {
      key: 'draftMinutes',
      label: st === 'minutes_approved' ? t('governance.meeting.cmd.draftMinutes.correct') : t('governance.meeting.cmd.draftMinutes.label'),
      show: can('governance.minutes.draft') && !m.isCirculation && ['held', 'minutes_draft', 'minutes_approved'].includes(st),
    },
    { key: 'approveMinutes', label: t('governance.meeting.cmd.approveMinutes.label'), show: can('governance.minutes.approve') && st === 'minutes_draft', primary: true },
    { key: 'cancel', label: t('governance.meeting.cmd.cancel.label'), show: manage && !m.isCirculation && (st === 'proposed' || st === 'planned' || st === 'agenda_published'), danger: true },
  ];
  const visible = commands.filter((c) => c.show);
  const params = { projectId, meetingId };
  const done = async (key: MessageKey) => {
    await refresh();
    toast.show('success', t(key));
    setCmd(null);
  };

  const meetingDialogs: Record<MeetingCmd, { consequences: ReactNode[]; noteMode: 'none' | 'optional' | 'required'; run: (note: string) => Promise<void>; children?: ReactNode; disabled?: boolean }> = {
    confirm: {
      consequences: [t('governance.meeting.cmd.confirm.effect'), t('common.command.audited')],
      noteMode: 'optional',
      run: async (note) => {
        await api(governanceRoutes.confirmMeeting, { params, body: { expectedVersion: m.version, ...(note ? { note } : {}) } });
        await done('governance.meeting.cmd.confirm.done');
      },
    },
    publish: {
      consequences: [t('governance.meeting.cmd.publish.effect')],
      noteMode: 'optional',
      run: async (note) => {
        await api(governanceRoutes.publishAgenda, { params, body: { expectedVersion: m.version, ...(note ? { note } : {}) } });
        await done('governance.meeting.cmd.publish.done');
      },
    },
    freeze: {
      consequences: [t('governance.meeting.cmd.freeze.effect')],
      noteMode: 'optional',
      run: async (note) => {
        await api(governanceRoutes.freezePack, { params, body: { expectedVersion: m.version, ...(note ? { note } : {}) } });
        await done('governance.meeting.cmd.freeze.done');
      },
    },
    start: {
      consequences: [t('governance.meeting.cmd.start.effect')],
      noteMode: 'optional',
      run: async (note) => {
        await api(governanceRoutes.startSession, { params, body: { expectedVersion: m.version, ...(note ? { note } : {}) } });
        await done('governance.meeting.cmd.start.done');
      },
    },
    close: {
      consequences: [t('governance.meeting.cmd.close.effect')],
      noteMode: 'optional',
      run: async (note) => {
        await api(governanceRoutes.closeSession, { params, body: { expectedVersion: m.version, ...(note ? { note } : {}) } });
        await done('governance.meeting.cmd.close.done');
      },
    },
    cancel: {
      consequences: [t('governance.meeting.cmd.cancel.effect')],
      noteMode: 'required',
      run: async (note) => {
        await api(governanceRoutes.cancelMeeting, { params, body: { expectedVersion: m.version, note } });
        await done('governance.meeting.cmd.cancel.done');
      },
    },
    quorum: {
      consequences: [t('governance.meeting.cmd.quorum.effect')],
      noteMode: 'none',
      run: async () => {
        await api(governanceRoutes.quorumCheck, { params, body: { expectedVersion: m.version } });
        await done('governance.meeting.cmd.quorum.done');
      },
    },
    draftMinutes: {
      consequences: [t('governance.meeting.cmd.draftMinutes.effect')],
      noteMode: 'none',
      disabled: !minutesText.trim() || (st === 'minutes_approved' && !minutesReason.trim()),
      run: async () => {
        await api(governanceRoutes.draftMinutes, { params, body: { expectedVersion: m.version, text: minutesText.trim(), ...(minutesReason.trim() ? { reason: minutesReason.trim() } : {}) } });
        await done('governance.meeting.cmd.draftMinutes.done');
      },
      children: (
        <div className="space-y-3">
          <TextAreaField label={t('governance.meeting.cmd.draftMinutes.text')} required rows={8} value={minutesText} maxLength={50000} onChange={(e) => setMinutesText(e.target.value)} />
          {st === 'minutes_approved' ? (
            <TextAreaField label={t('governance.meeting.cmd.draftMinutes.reason')} required rows={2} value={minutesReason} maxLength={1000} onChange={(e) => setMinutesReason(e.target.value)} hint={t('governance.meeting.cmd.draftMinutes.reasonHint')} />
          ) : null}
        </div>
      ),
    },
    approveMinutes: {
      consequences: [t('governance.meeting.cmd.approveMinutes.effect'), t('governance.hub.internalApprovals')],
      noteMode: 'optional',
      run: async (note) => {
        await api(governanceRoutes.approveMinutes, { params, body: { expectedVersion: m.version, ...(note ? { note } : {}) } });
        await done('governance.meeting.cmd.approveMinutes.done');
      },
    },
  };
  const active = cmd ? meetingDialogs[cmd] : null;
  const cmdTitle = (k: MeetingCmd) => t(`governance.meeting.cmd.${k}.title` as MessageKey, { number: m.number });
  const q_ = m.quorumSnapshot as { met?: boolean; presentVoting?: number; eligibleVoting?: number; required?: number; onDate?: string; computedAt?: string } | null;
  const attendanceByMembership = new Map(m.attendance.map((a) => [a.membershipId, a]));
  const canAttend = manage && (st === 'agenda_published' || st === 'in_session');
  const canDeclare = (can('governance.conflict.declare') || manage) && st !== 'cancelled' && st !== 'minutes_approved' && !m.isCirculation;
  const memberUserIds = new Set((committee.data?.memberships ?? []).map((s) => s.userId).filter(Boolean));

  return (
    <>
      <Link href={`${base}/meetings`} className={cx(btn.link, 'mb-3 inline-flex items-center gap-1 text-sm')}>
        <ChevronLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
        {t('governance.meeting.back')}
      </Link>
      <PageHeader
        eyebrow={
          <Link href={`${base}/committees/${m.committeeId}`} className={btn.link} dir="auto">
            {m.committeeName}
          </Link>
        }
        title={
          <span>
            {heading} — <span dir="auto">{m.title}</span>
          </span>
        }
        documentTitle={`${heading} — ${m.title}`}
        badges={
          <>
            <span data-testid="meeting-status">
              <StatusBadge enumName="meetingStatuses" value={m.status} size="md" />
            </span>
            {m.isCirculation ? <StatusBadge enumName="agendaItemKinds" value="circulation" tone="info" label={t('governance.meetings.circulation')} /> : null}
            <StatusBadge enumName="classifications" value={m.classification} tone="neutral" />
            {m.isDemo ? <DemoBadge /> : null}
          </>
        }
      />

      {visible.length ? (
        <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label={t('governance.actions.columns.commands')} data-testid="meeting-commands">
          {visible.map((c) => (
            <button
              key={c.key}
              type="button"
              className={c.danger ? btn.secondary : c.primary ? btn.primary : btn.secondary}
              onClick={() => {
                setMinutesText(m.minutesText ?? '');
                setMinutesReason('');
                setCmd(c.key);
              }}
              data-command={c.key}
            >
              {c.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="space-y-6">
        {st === 'proposed' ? (
          <p className="rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm text-ink" data-testid="meeting-proposed-note">
            {m.cadenceCharterVersionNo !== null ? t('governance.meeting.proposedFromCadence', { version: m.cadenceCharterVersionNo }) : t('governance.meeting.proposedNote')}
          </p>
        ) : null}
        <div className={cx(card, 'p-4')}>
          <Facts
            items={[
              { label: t('governance.meeting.scheduledAt'), value: <span className="tabular">{formatDateTime(m.scheduledAt)}</span> },
              ...(m.isCirculation ? [{ label: t('governance.meeting.responseDeadline'), value: <span className="tabular">{m.responseDeadline ?? EM_DASH}</span> }] : [{ label: t('governance.meeting.location'), value: <UText value={m.location} /> }]),
            ]}
          />
        </div>

        {!m.isCirculation ? (
          <Section
            id="agenda"
            title={t('governance.agenda.agendaTitle')}
            actions={
              can('governance.agenda_request.create') && (st === 'planned' || st === 'agenda_published') ? (
                <button type="button" className={btn.secondary} onClick={() => setAgendaOpen(true)} data-testid="request-agenda">
                  {t('governance.agenda.request.action')}
                </button>
              ) : null
            }
          >
            {m.agenda.length ? (
              <ol className={cx(card, 'divide-y divide-line')} data-testid="agenda-list">
                {m.agenda.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                    <span className="tabular w-8 font-semibold text-ink">{a.number}.</span>
                    <span className="min-w-0 flex-1" dir="auto">
                      {a.title}
                    </span>
                    <span className="text-muted">{tStatus('agendaItemKinds', a.kind)}</span>
                    {a.decisionId && a.decisionCode ? (
                      <Link href={`${base}/decisions/${a.decisionId}`} className={btn.link} dir="ltr">
                        {a.decisionCode}
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted">{t('governance.agenda.agendaEmpty')}</p>
            )}
            {pending.data && pending.data.items.length ? (
              <div className="rounded-lg border border-info/40 bg-info-soft p-3">
                <h3 className="text-sm font-semibold text-ink">{t('governance.agenda.pending')}</h3>
                <ul className="mt-2 space-y-2">
                  {pending.data.items.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="min-w-0 flex-1" dir="auto">
                        {a.title}
                      </span>
                      {a.decisionCode ? <span dir="ltr">{a.decisionCode}</span> : null}
                      {can('governance.agenda_request.screen') ? (
                        <button type="button" className={btn.secondary} onClick={() => setScreening(a)} aria-label={t('governance.agenda.screen.labelFor', { title: a.title })} data-testid="screen-request">
                          {t('governance.agenda.screen.action')}
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Section>
        ) : null}

        <Section id="tabled" title={t('governance.meeting.decisions.title')}>
          <DataTable
            className="relative"
            caption={t('governance.meeting.decisions.title')}
            rows={decisions.data?.items}
            rowKey={(d) => d.id}
            isLoading={decisions.isLoading}
            error={decisions.error}
            onRetry={() => decisions.refetch()}
            emptyTitle={t('governance.meeting.decisions.empty')}
            columns={[
              {
                key: 'code',
                header: t('governance.decisions.columns.code'),
                isRowHeader: true,
                cell: (d) => (
                  <Link href={`${base}/decisions/${d.id}`} className="font-medium text-primary hover:underline" dir="ltr">
                    {d.code}
                  </Link>
                ),
              },
              { key: 'title', header: t('governance.decisions.columns.title'), cell: (d) => <UText value={d.title} /> },
              { key: 'status', header: t('governance.decisions.columns.status'), cell: (d) => <StatusBadge enumName="decisionStatuses" value={d.status} /> },
            ]}
          />
        </Section>

        {!m.isCirculation ? (
          <Section
            id="attendance"
            title={t('governance.meeting.attendance.title')}
            actions={
              canAttend ? (
                <button
                  type="button"
                  className={btn.secondary}
                  onClick={() => {
                    setAtt(Object.fromEntries(seats.map((s) => [s.id, attendanceByMembership.get(s.id)?.status ?? ''])));
                    setAttOpen(true);
                  }}
                  data-testid="record-attendance"
                >
                  {t('governance.meeting.attendance.record')}
                </button>
              ) : null
            }
          >
            <DataTable
              className="relative"
              caption={t('governance.meeting.attendance.title')}
              rows={m.attendance}
              rowKey={(a) => a.membershipId}
              emptyTitle={t('governance.meeting.attendance.notRecorded')}
              testId="attendance-table"
              columns={[
                { key: 'person', header: t('governance.meeting.attendance.columns.person'), isRowHeader: true, cell: (a) => <UText value={a.displayName} /> },
                { key: 'seat', header: t('governance.meeting.attendance.columns.seat'), cell: (a) => <UText value={a.roleLabel} /> },
                { key: 'capacity', header: t('governance.meeting.attendance.columns.capacity'), cell: (a) => tStatus('committeeMemberRoles', a.memberRole) },
                { key: 'voting', header: t('governance.meeting.attendance.columns.voting'), cell: (a) => (a.voting ? t('governance.common.yes') : t('governance.common.no')) },
                { key: 'status', header: t('governance.meeting.attendance.columns.status'), cell: (a) => <StatusBadge enumName="attendanceStatuses" value={a.status} tone={a.status === 'present' || a.status === 'remote' ? 'success' : 'neutral'} /> },
              ]}
            />
          </Section>
        ) : null}

        {!m.isCirculation ? (
          <Section
            id="quorum"
            title={t('governance.meeting.quorum.title')}
          >
            <div className={cx(card, 'p-4 text-sm')} data-testid="quorum-panel">
              {q_ ? (
                <>
                  <p className="font-semibold text-ink">{q_.met ? t('governance.meeting.quorum.met') : t('governance.meeting.quorum.notMet')}</p>
                  <p className="mt-1 text-ink">
                    {t('governance.meeting.quorum.detail', { present: q_.presentVoting ?? 0, eligible: q_.eligibleVoting ?? 0, required: q_.required ?? 0, date: q_.onDate ?? EM_DASH })}
                  </p>
                  {q_.computedAt ? <p className="mt-1 text-xs text-muted">{t('governance.meeting.quorum.checkedAt', { at: formatDateTime(q_.computedAt) })}</p> : null}
                </>
              ) : (
                <p className="text-muted">{t('governance.meeting.quorum.notChecked')}</p>
              )}
            </div>
          </Section>
        ) : null}

        {!m.isCirculation ? (
          <Section
            id="conflicts"
            title={t('governance.meeting.conflicts.title')}
            actions={
              canDeclare ? (
                <button
                  type="button"
                  className={btn.secondary}
                  onClick={() => {
                    setDecl({ userId: '', declaration: 'no_conflict', decisionId: '', description: '' });
                    setConflictOpen(true);
                  }}
                  data-testid="declare-conflict"
                >
                  {t('governance.meeting.conflicts.declare')}
                </button>
              ) : null
            }
          >
            <DataTable
              className="relative"
              caption={t('governance.meeting.conflicts.title')}
              rows={m.conflicts}
              rowKey={(c) => c.id}
              emptyTitle={t('governance.meeting.conflicts.empty')}
              columns={[
                { key: 'member', header: t('governance.meeting.conflicts.columns.member'), isRowHeader: true, cell: (c) => <UText value={c.displayName} /> },
                {
                  key: 'declaration',
                  header: t('governance.meeting.conflicts.columns.declaration'),
                  cell: (c) => (
                    <StatusBadge enumName="attendanceStatuses" value={c.declaration} tone={c.declaration === 'no_conflict' ? 'success' : 'warning'} label={t(`governance.meeting.conflicts.types.${c.declaration}`)} />
                  ),
                },
                {
                  key: 'decision',
                  header: t('governance.meeting.conflicts.columns.decision'),
                  cell: (c) =>
                    c.decisionId ? (
                      <Link href={`${base}/decisions/${c.decisionId}`} className={btn.link}>
                        {t('governance.common.view')}
                      </Link>
                    ) : (
                      <span className="text-muted">{EM_DASH}</span>
                    ),
                },
                { key: 'details', header: t('governance.meeting.conflicts.columns.details'), cell: (c) => <UText value={c.description} /> },
                { key: 'at', header: t('governance.meeting.conflicts.columns.at'), cell: (c) => <span className="tabular">{formatDateTime(c.declaredAt)}</span> },
              ]}
            />
          </Section>
        ) : null}

        {!m.isCirculation ? (
          <Section id="minutes" title={t('governance.meeting.minutes.title')}>
            <div className={cx(card, 'p-4 text-sm')} data-testid="minutes-panel">
              {m.minutesText ? (
                <>
                  <p className="whitespace-pre-wrap text-ink" dir="auto">
                    {m.minutesText}
                  </p>
                  {m.minutesApprovedAt ? <p className="mt-2 text-xs text-muted">{t('governance.meeting.minutes.approvedAt', { at: formatDateTime(m.minutesApprovedAt) })}</p> : null}
                </>
              ) : (
                <p className="text-muted">{t('governance.meeting.minutes.empty')}</p>
              )}
            </div>
          </Section>
        ) : null}

        <Section id="packs" title={t('governance.meeting.packs.title')}>
          <DataTable
            className="relative"
            caption={t('governance.meeting.packs.title')}
            rows={packs.data?.items}
            rowKey={(p) => p.id}
            isLoading={packs.isLoading}
            error={packs.error}
            onRetry={() => packs.refetch()}
            emptyTitle={t('governance.meeting.packs.empty')}
            testId="packs-table"
            columns={[
              {
                key: 'title',
                header: t('governance.meeting.packs.columns.title'),
                isRowHeader: true,
                cell: (p) => (
                  <span className="flex flex-wrap items-center gap-2">
                    <span dir="auto">{p.title}</span>
                    {p.id === m.packSnapshotId ? <StatusBadge enumName="meetingStatuses" value="current" tone="info" label={t('governance.meeting.packs.current')} /> : null}
                  </span>
                ),
              },
              { key: 'frozenAt', header: t('governance.meeting.packs.columns.frozenAt'), cell: (p) => <span className="tabular">{formatDateTime(p.generatedAt)}</span> },
              { key: 'classification', header: t('governance.meeting.packs.columns.classification'), cell: (p) => tStatus('classifications', p.classification) },
              { key: 'hash', header: t('governance.meeting.packs.columns.hash'), cell: (p) => <code dir="ltr" className="text-xs">{p.contentHash.slice(0, 12)}…</code> },
              {
                key: 'view',
                header: t('governance.meeting.packs.view'),
                cell: (p) => (
                  <button type="button" className={btn.link} onClick={() => setPackId(p.id)} aria-label={t('governance.meeting.packs.viewFor', { title: p.title })}>
                    {t('governance.meeting.packs.view')}
                  </button>
                ),
              },
            ]}
          />
        </Section>

        {can('governance.action.manage') ? (
          <div>
            <button type="button" className={btn.secondary} onClick={() => setActionOpen(true)}>
              {t('governance.actions.create.action')}
            </button>
          </div>
        ) : null}

        <GovHistory entityType="meeting" entityId={m.id} />
      </div>

      {cmd && active ? (
        <GovCommandDialog
          open
          onClose={() => setCmd(null)}
          title={cmdTitle(cmd)}
          confirmLabel={commands.find((c) => c.key === cmd)?.label ?? ''}
          consequences={[...active.consequences, t('common.command.audited')]}
          noteMode={active.noteMode}
          noteLabel={cmd === 'cancel' ? t('governance.common.reason') : undefined}
          expectedVersion={m.version}
          danger={cmd === 'cancel'}
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

      {attOpen ? (
        <GovCommandDialog
          open
          onClose={() => setAttOpen(false)}
          title={t('governance.meeting.attendance.recordTitle')}
          confirmLabel={t('governance.meeting.attendance.confirm')}
          noteMode="none"
          consequences={[t('governance.meeting.attendance.effect'), t('governance.meeting.attendance.frozen'), t('common.command.audited')]}
          confirmDisabled={!Object.values(att).some(Boolean)}
          onConfirm={async () => {
            const entries = Object.entries(att)
              .filter(([, v]) => v)
              .map(([membershipId, status]) => ({ membershipId, status: status as AttendanceStatus }));
            await api(governanceRoutes.recordAttendance, { params, body: { entries } });
            await refresh();
            toast.show('success', t('governance.meeting.attendance.done'));
            setAttOpen(false);
          }}
        >
          <div className="space-y-2" data-testid="attendance-form">
            {seats.length === 0 ? <p className="text-sm text-muted">{t('governance.meeting.attendance.empty')}</p> : null}
            {seats.map((s) => (
              <label key={s.id} className="grid items-center gap-2 text-sm sm:grid-cols-[1fr_12rem]">
                <span>
                  <span className="font-medium" dir="auto">
                    {s.displayName ?? t('governance.common.tbc')}
                  </span>
                  <span className="block text-xs text-muted" dir="auto">
                    {s.roleLabel} · {tStatus('committeeMemberRoles', s.memberRole)}
                  </span>
                </span>
                <select className={cx(input, 'pe-8')} value={att[s.id] ?? ''} onChange={(e) => setAtt({ ...att, [s.id]: e.target.value as AttendanceStatus | '' })} data-membership={s.id} data-person={s.displayName ?? ''}>
                  <option value="">{t('governance.meeting.attendance.notRecorded')}</option>
                  {ATTENDANCE_STATUSES.map((a) => (
                    <option key={a} value={a}>
                      {tStatus('attendanceStatuses', a)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </GovCommandDialog>
      ) : null}

      {conflictOpen ? (
        <GovCommandDialog
          open
          onClose={() => setConflictOpen(false)}
          title={t('governance.meeting.conflicts.declareTitle')}
          confirmLabel={t('governance.meeting.conflicts.confirm')}
          noteMode="none"
          consequences={[
            t('governance.meeting.conflicts.effect'),
            ...(decl.declaration === 'recused' ? [t('governance.decision.cmd.recuse.afterVote')] : []),
            t('common.command.audited'),
          ]}
          confirmDisabled={decl.declaration === 'recused' && (!decl.decisionId || (!!decl.userId && !decl.description.trim()))}
          onConfirm={async () => {
            await api(governanceRoutes.declareConflict, {
              params,
              body: {
                declaration: decl.declaration,
                ...(decl.userId ? { userId: decl.userId } : {}),
                ...(decl.decisionId ? { decisionId: decl.decisionId } : {}),
                ...(decl.description.trim() ? { description: decl.description.trim() } : {}),
              },
            });
            await refresh();
            toast.show('success', t('governance.meeting.conflicts.done'));
            setConflictOpen(false);
          }}
        >
          <div className="space-y-4">
            {manage ? (
              <SelectField label={t('governance.meeting.conflicts.member')} value={decl.userId} onChange={(e) => setDecl({ ...decl, userId: e.target.value })}>
                {can('governance.conflict.declare') && memberUserIds.has(me.user.id) ? <option value="">{t('governance.meeting.conflicts.self')}</option> : <option value="">{t('governance.common.select')}</option>}
                {(committee.data?.memberships ?? [])
                  .filter((s) => s.userId && s.userId !== me.user.id)
                  .map((s) => (
                    <option key={s.id} value={s.userId!}>
                      {s.displayName ?? s.roleLabel}
                    </option>
                  ))}
              </SelectField>
            ) : null}
            <SelectField label={t('governance.meeting.conflicts.declaration')} required value={decl.declaration} onChange={(e) => setDecl({ ...decl, declaration: e.target.value as Declaration })}>
              {(['no_conflict', 'interest_declared', 'recused'] as const).map((k) => (
                <option key={k} value={k}>
                  {t(`governance.meeting.conflicts.types.${k}`)}
                </option>
              ))}
            </SelectField>
            <SelectField label={t('governance.meeting.conflicts.decision')} required={decl.declaration === 'recused'} value={decl.decisionId} onChange={(e) => setDecl({ ...decl, decisionId: e.target.value })} hint={t('governance.meeting.conflicts.decisionHint')}>
              <option value="">{t('governance.common.none')}</option>
              {(committeeDecisions.data?.items ?? [])
                .filter((d) => ['draft', 'submitted', 'under_review', 'deferred'].includes(d.status))
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.code} — {d.title}
                  </option>
                ))}
            </SelectField>
            <TextAreaField
              label={t('governance.meeting.conflicts.description')}
              rows={2}
              value={decl.description}
              maxLength={2000}
              required={decl.declaration === 'recused' && !!decl.userId}
              hint={decl.declaration === 'recused' && decl.userId ? t('governance.meeting.conflicts.onBehalfReason') : undefined}
              onChange={(e) => setDecl({ ...decl, description: e.target.value })}
            />
          </div>
        </GovCommandDialog>
      ) : null}

      <PackDialog meetingId={meetingId} packId={packId} onClose={() => setPackId(null)} />
      <ScreenAgendaDialog item={screening} onClose={() => setScreening(null)} />
      <AgendaRequestDialog open={agendaOpen} onClose={() => setAgendaOpen(false)} committeeId={m.committeeId} meetingId={m.id} />
      <CreateActionDialog open={actionOpen} onClose={() => setActionOpen(false)} meetingId={m.id} />
    </>
  );
}


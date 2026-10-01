'use client';

import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { jvRoutes } from '@hub/contracts';
import { ActivityHistory } from '@/components/ActivityHistory';
import { DataTable } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { ErrorState } from '@/components/ErrorState';
import { TextAreaField, TextField } from '@/components/Field';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { RestrictedState } from '@/components/RestrictedState';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn, cx } from '@/components/ui';
import { UserPicker, type PickedUser } from '@/components/UserPicker';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api, isApiError } from '@/lib/api';
import { CLOSING_DECISION_TYPE_KEYS, SIGNING_DECISION_TYPE_KEYS, jvHref, useEvent, useJvRefresh, usePartnerNames, type ChecklistItem, type EventBlocker, type EventKind, type TxEventDetail } from '@/lib/jv';
import { useProjectContext } from '@/lib/project-context';
import { BlockerList, ButtonRow, Callout, CmdButton, DecisionSelect, DocumentLink, DocumentPicker, Facts, Flag, JvCommandDialog, LinkedDecision, Money, Panel, Person, RecordOnlyNotice, UText, WaivabilityBadge, blockersOf } from './jv';

type EventCommand = 'start_preparation' | 'mark_ready' | 'back_to_preparation' | 'abort';
const EVENT_COMMANDS: readonly EventCommand[] = ['start_preparation', 'mark_ready', 'back_to_preparation', 'abort'];
type Pending = { kind: 'transition'; command: EventCommand } | { kind: 'request' } | { kind: 'confirm' } | { kind: 'item' } | { kind: 'cp' } | { kind: 'deliver' | 'accept' | 'notRequired' | 'notRequiredConfirm' | 'notRequiredReject'; item: ChecklistItem } | null;

/** Unique references of the conditions that block (unmet / unverified / not effectively waived / lapsed). */
function blockingCpRefs(blockers: readonly EventBlocker[]): string[] {
  return [...new Set(blockers.filter((b) => b.kind === 'condition').map((b) => b.ref))];
}

/**
 * Wraps a command that the server may refuse with `details.blockers` (mark ready, request confirmation, confirm): the
 * blockers are shown translated inside the dialog next to the standard error notice.
 */
function useRefusal() {
  const [blockers, setBlockers] = useState<EventBlocker[]>([]);
  const wrap = async <T,>(fn: () => Promise<T>): Promise<T> => {
    setBlockers([]);
    try {
      return await fn();
    } catch (e) {
      setBlockers(blockersOf(e));
      throw e;
    }
  };
  return { blockers, wrap, reset: () => setBlockers([]) };
}

function RefusalBlockers({ blockers }: { blockers: EventBlocker[] }) {
  const { t } = useI18n();
  if (!blockers.length) return null;
  return (
    <div className="rounded-md border border-danger/40 bg-danger-soft p-3" data-testid="refusal-blockers">
      <p className="mb-2 text-sm font-semibold text-danger">{t('jv.event.refusedBlockers')}</p>
      <BlockerList blockers={blockers} testId="refusal-blocker-list" />
    </div>
  );
}

function EventDialogs({ e, pending, onClose }: { e: TxEventDetail; pending: Pending; onClose: () => void }) {
  const { t, tStatus } = useI18n();
  const { projectId, can } = useProjectContext();
  // DOM-P34R-08: only the Legal specialist (jv.cp.set_waivability) may create a non-blocking condition.
  const canSetNonBlocking = can('jv.cp.set_waivability');
  const refresh = useJvRefresh();
  const toast = useToast();
  const refusal = useRefusal();
  const [decisionId, setDecisionId] = useState(e.confirmationDecisionId ?? '');
  const [docId, setDocId] = useState('');
  const [title, setTitle] = useState('');
  const [party, setParty] = useState('');
  const [owner, setOwner] = useState<PickedUser | null>(null);
  const [dueDate, setDueDate] = useState('');
  const [reference, setReference] = useState('');
  const [description, setDescription] = useState('');
  const [parties, setParties] = useState('');
  const [blocking, setBlocking] = useState(true);
  const [validTo, setValidTo] = useState('');
  const [longStop, setLongStop] = useState('');
  const kindLabel = tStatus('closingKinds', e.kind);
  const done = async (msg: string) => {
    await refresh();
    toast.show('success', msg);
    onClose();
  };
  if (!pending) return null;
  switch (pending.kind) {
    case 'transition': {
      const c = pending.command;
      return (
        <JvCommandDialog
          open
          onClose={onClose}
          title={t(`jv.event.cmd.${c}`)}
          confirmLabel={t(`jv.event.cmd.${c}`)}
          danger={c === 'abort'}
          noteMode={c === 'abort' ? 'required' : 'optional'}
          noteLabel={c === 'abort' ? t('jv.common.reason') : undefined}
          expectedVersion={e.version}
          consequences={[t(`jv.event.effect.${c}`, { kind: kindLabel }), ...(c === 'mark_ready' ? [t('jv.event.markReadyRule')] : []), t('common.command.audited')]}
          onConfirm={({ note }) =>
            refusal.wrap(async () => {
              const r = await api(jvRoutes.transitionEvent, { params: { projectId, eventId: e.id }, body: { expectedVersion: e.version, command: c, ...(note ? { note } : {}) } });
              await done(t('jv.common.statusNow', { status: tStatus('closingStatuses', r.status) }));
            })
          }
        >
          <RefusalBlockers blockers={refusal.blockers} />
        </JvCommandDialog>
      );
    }
    case 'request':
      return (
        <JvCommandDialog
          open
          onClose={onClose}
          title={t('jv.event.request.title', { kind: kindLabel })}
          confirmLabel={t('jv.event.request.confirm')}
          expectedVersion={e.version}
          confirmDisabled={!decisionId || (e.kind === 'signing' && !docId && !e.executedDocumentId)}
          consequences={[t('jv.event.request.effect', { kind: kindLabel }), t('jv.event.request.finalDecision'), ...(e.kind === 'signing' ? [t('jv.event.request.g5Rule'), t('jv.event.request.executedCopy')] : []), t('common.command.audited')]}
          onConfirm={({ note }) =>
            refusal.wrap(async () => {
              await api(jvRoutes.requestEventConfirmation, { params: { projectId, eventId: e.id }, body: { expectedVersion: e.version, decisionId, ...(docId ? { executedDocumentId: docId } : {}), ...(note ? { note } : {}) } });
              await done(t('jv.event.request.done'));
            })
          }
        >
          <DecisionSelect typeKeys={e.kind === 'closing' ? CLOSING_DECISION_TYPE_KEYS : SIGNING_DECISION_TYPE_KEYS} value={decisionId} onChange={setDecisionId} testId="confirm-decision" />
          <DocumentPicker label={t('jv.event.request.executedDocument')} required={e.kind === 'signing' && !e.executedDocumentId} value={docId} onChange={setDocId} testId="executed-document" />
          <RefusalBlockers blockers={refusal.blockers} />
        </JvCommandDialog>
      );
    case 'confirm':
      return (
        <JvCommandDialog
          open
          onClose={onClose}
          title={e.kind === 'closing' ? t('jv.event.confirm.closingTitle') : t('jv.event.confirm.signingTitle')}
          confirmLabel={e.kind === 'closing' ? t('jv.event.confirm.closing') : t('jv.event.confirm.signing')}
          expectedVersion={e.version}
          consequences={[
            e.kind === 'closing' ? t('jv.event.confirm.closingEffect') : t('jv.event.confirm.signingEffect'),
            t('jv.event.confirm.reevaluated'),
            t('jv.event.confirm.sod'),
            t('common.command.audited'),
          ]}
          onConfirm={({ note }) =>
            refusal.wrap(async () => {
              const route = e.kind === 'closing' ? jvRoutes.confirmClosing : jvRoutes.recordSigning;
              const r = await api(route, { params: { projectId, eventId: e.id }, body: { expectedVersion: e.version, ...(note ? { note } : {}) } });
              await done(t('jv.common.statusNow', { status: tStatus('closingStatuses', r.status) }));
            })
          }
        >
          <RefusalBlockers blockers={refusal.blockers} />
        </JvCommandDialog>
      );
    case 'item':
      return (
        <JvCommandDialog
          open
          onClose={onClose}
          title={t('jv.checklist.add.title', { kind: kindLabel })}
          confirmLabel={t('jv.checklist.add.confirm')}
          noteMode="none"
          confirmDisabled={!title.trim()}
          consequences={[t('jv.checklist.add.effect', { kind: kindLabel }), t('common.command.audited')]}
          onConfirm={async () => {
            await api(jvRoutes.createChecklistItem, {
              params: { projectId },
              body: { eventId: e.id, title: title.trim(), ...(party.trim() ? { responsibleParty: party.trim() } : {}), ...(owner ? { ownerUserId: owner.id } : {}), ...(dueDate ? { dueDate } : {}) },
            });
            await done(t('jv.common.saved'));
          }}
        >
          <TextField label={t('jv.checklist.fields.title')} required value={title} maxLength={300} onChange={(x) => setTitle(x.target.value)} data-testid="item-title" />
          <TextField label={t('jv.checklist.fields.party')} value={party} maxLength={200} onChange={(x) => setParty(x.target.value)} />
          <UserPicker label={t('jv.checklist.fields.owner')} value={owner} onChange={setOwner} />
          <TextField label={t('jv.checklist.fields.dueDate')} type="date" value={dueDate} onChange={(x) => setDueDate(x.target.value)} />
        </JvCommandDialog>
      );
    case 'cp':
      return (
        <JvCommandDialog
          open
          onClose={onClose}
          title={t('jv.cp.add.title')}
          confirmLabel={t('jv.cp.add.confirm')}
          noteMode="none"
          confirmDisabled={!title.trim() || !owner}
          consequences={[t('jv.cp.add.effect'), t('jv.cp.add.notWaivable'), t('common.command.audited')]}
          onConfirm={async () => {
            if (!owner) return;
            await api(jvRoutes.createCondition, {
              params: { projectId },
              body: {
                closingId: e.id,
                title: title.trim(),
                ownerUserId: owner.id,
                blocking,
                ...(reference.trim() ? { reference: reference.trim().toUpperCase() } : {}),
                ...(description.trim() ? { description: description.trim() } : {}),
                ...(parties.trim() ? { parties: parties.trim() } : {}),
                ...(validTo ? { validTo } : {}),
                ...(longStop ? { longStopDate: longStop } : {}),
              },
            });
            await done(t('jv.common.saved'));
          }}
        >
          <TextField label={t('jv.cp.fields.reference')} hint={t('jv.cp.add.referenceHint')} value={reference} maxLength={32} onChange={(x) => setReference(x.target.value)} dir="ltr" />
          <TextField label={t('jv.cp.fields.title')} required value={title} maxLength={300} onChange={(x) => setTitle(x.target.value)} data-testid="cp-title" />
          <TextAreaField label={t('jv.cp.fields.description')} value={description} maxLength={4000} onChange={(x) => setDescription(x.target.value)} />
          <UserPicker label={t('jv.cp.fields.owner')} required value={owner} onChange={setOwner} />
          <TextField label={t('jv.cp.fields.parties')} value={parties} maxLength={1000} onChange={(x) => setParties(x.target.value)} />
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={blocking} disabled={!canSetNonBlocking} onChange={(x) => setBlocking(x.target.checked)} data-testid="cp-blocking" />
            {t('jv.cp.fields.blockingCheckbox')}
          </label>
          {!canSetNonBlocking ? <p className="text-xs text-muted">{t('jv.cp.fields.blockingLegalOnly')}</p> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label={t('jv.cp.fields.validTo')} type="date" value={validTo} onChange={(x) => setValidTo(x.target.value)} />
            <TextField label={t('jv.cp.fields.longStop')} type="date" value={longStop} onChange={(x) => setLongStop(x.target.value)} />
          </div>
        </JvCommandDialog>
      );
    case 'deliver':
      return (
        <JvCommandDialog
          open
          onClose={onClose}
          title={t('jv.checklist.deliver.title')}
          confirmLabel={t('jv.checklist.deliver.confirm')}
          expectedVersion={pending.item.version}
          confirmDisabled={!docId}
          consequences={[t('jv.checklist.deliver.effect'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            await api(jvRoutes.deliverChecklistItem, { params: { projectId, itemId: pending.item.id }, body: { expectedVersion: pending.item.version, documentId: docId, ...(note ? { note } : {}) } });
            await done(t('jv.common.saved'));
          }}
        >
          <DocumentPicker label={t('jv.checklist.deliver.document')} required value={docId} onChange={setDocId} testId="deliver-document" />
        </JvCommandDialog>
      );
    case 'accept':
      return (
        <JvCommandDialog
          open
          onClose={onClose}
          title={t('jv.checklist.accept.title')}
          confirmLabel={t('jv.checklist.accept.confirm')}
          expectedVersion={pending.item.version}
          consequences={[t('jv.checklist.accept.effect'), t('jv.checklist.accept.sod'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            await api(jvRoutes.acceptChecklistItem, { params: { projectId, itemId: pending.item.id }, body: { expectedVersion: pending.item.version, ...(note ? { note } : {}) } });
            await done(t('jv.common.saved'));
          }}
        />
      );
    case 'notRequired':
      return (
        <JvCommandDialog
          open
          onClose={onClose}
          title={t('jv.checklist.notRequired.title')}
          confirmLabel={t('jv.checklist.notRequired.confirm')}
          noteMode="required"
          noteLabel={t('jv.common.reason')}
          expectedVersion={pending.item.version}
          consequences={[t('jv.checklist.notRequired.effect'), t('jv.checklist.notRequired.sod'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            await api(jvRoutes.setChecklistItemNotRequired, { params: { projectId, itemId: pending.item.id }, body: { expectedVersion: pending.item.version, reason: note } });
            await done(t('jv.common.saved'));
          }}
        />
      );
    // SEC-P34-10: the second person (jv.cp.verify, not the requester) confirms or rejects the pending request.
    case 'notRequiredConfirm':
    case 'notRequiredReject': {
      const confirming = pending.kind === 'notRequiredConfirm';
      return (
        <JvCommandDialog
          open
          onClose={onClose}
          title={confirming ? t('jv.checklist.notRequired.confirmTitle') : t('jv.checklist.notRequired.rejectTitle')}
          confirmLabel={confirming ? t('jv.checklist.notRequired.confirmConfirm') : t('jv.checklist.notRequired.rejectConfirm')}
          danger={!confirming}
          noteMode={confirming ? 'optional' : 'required'}
          noteLabel={confirming ? undefined : t('jv.common.reason')}
          expectedVersion={pending.item.version}
          consequences={[
            ...(pending.item.notRequiredRequest?.reason ? [t('jv.checklist.notRequired.reason', { reason: pending.item.notRequiredRequest.reason })] : []),
            confirming ? t('jv.checklist.notRequired.confirmEffect') : t('jv.checklist.notRequired.rejectEffect'),
            t('jv.checklist.notRequired.sod'),
            t('common.command.audited'),
          ]}
          onConfirm={async ({ note }) => {
            await api(jvRoutes.decideChecklistItemNotRequired, {
              params: { projectId, itemId: pending.item.id },
              body: { expectedVersion: pending.item.version, decision: confirming ? 'confirm' : 'reject', ...(note ? { note } : {}) },
            });
            await done(t('jv.common.saved'));
          }}
        />
      );
    }
    default:
      return null;
  }
}

/**
 * DOM-P4-02: a signing is requested and recorded only while gate G5 (JV Signing Readiness) is approved and not under
 * reassessment, on the decision that approved it — the server evaluates it at the request and inside the recording.
 */
function SigningGateNotice({ g }: { g: NonNullable<TxEventDetail['signingGate']> }) {
  const { t, tStatus } = useI18n();
  const common = { testId: 'signing-gate' } as const;
  if (g.underReassessment) return <Callout tone="danger" {...common}>{t('jv.event.signingGate.reassessment')}</Callout>;
  if (g.passed) return <Callout tone="success" {...common}>{t('jv.event.signingGate.passed')}</Callout>;
  return (
    <Callout tone="warning" {...common}>
      {t('jv.event.signingGate.pending', { status: g.status ? tStatus('gateAssessmentStatuses', g.status) : t('jv.event.signingGate.notAssessed') })}
    </Callout>
  );
}

function ReadinessPanel({ e }: { e: TxEventDetail }) {
  const { t, tStatus } = useI18n();
  const refs = blockingCpRefs(e.blockers);
  const frozen = e.status === 'confirmed' || e.status === 'aborted';
  return (
    <Panel title={t('jv.event.readinessTitle')} description={t('jv.event.readinessHint')} testId="event-readiness">
      {e.signingGate && !frozen ? (
        <div className="mb-3" data-passed={e.signingGate.passed ? 'true' : 'false'} data-testid="signing-gate-state">
          <SigningGateNotice g={e.signingGate} />
        </div>
      ) : null}
      <div data-ready={e.ready ? 'true' : 'false'} data-testid="event-ready-state">
        {frozen ? (
          <Callout tone={e.status === 'confirmed' ? 'success' : 'warning'}>{t('jv.event.frozen', { status: tStatus('closingStatuses', e.status) })}</Callout>
        ) : e.ready ? (
          <Callout tone="success" testId="event-ready">
            {e.kind === 'closing' ? t('jv.event.readyClosing') : t('jv.event.readySigning')}
          </Callout>
        ) : (
          <div role="alert" className="rounded-md border border-danger/40 bg-danger-soft p-3" data-testid={e.kind === 'closing' ? 'closing-blocked' : 'signing-blocked'}>
            <p className="font-semibold text-danger">{e.kind === 'closing' ? t('jv.event.closingBlocked') : t('jv.event.signingBlocked')}</p>
            {refs.length ? (
              <p className="mt-1 text-sm text-ink" data-testid="blocked-cps">
                {t('jv.event.unmetCps', { refs: refs.join(', ') })}
              </p>
            ) : null}
            <div className="mt-2">
              <BlockerList blockers={e.blockers} />
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

/** Signing or closing detail: readiness (live server rule), commands, confirmation, separate checklist, CP set, funds flow. */
export function EventDetailScreen({ kind, eventId }: { kind: EventKind; eventId: string }) {
  const { t, tStatus, formatDate, formatDateTime, formatNumber } = useI18n();
  const { projectId, can, me } = useProjectContext();
  const partners = usePartnerNames();
  const [pending, setPending] = useState<Pending>(null);
  const q = useEvent(kind, eventId);
  const base = jvHref(projectId);
  if (q.isLoading) return <LoadingState />;
  if (q.error) return isApiError(q.error) && (q.error.status === 404 || q.error.status === 403) ? <RestrictedState /> : <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const e = q.data!;
  const people = e.people;
  const canManage = can('jv.closing_checklist.manage');
  const confirmPermission = kind === 'closing' ? 'jv.closing.declare' : 'jv.signing.record';
  const requestPending = e.confirmationRequest?.status === 'pending';
  const iRequested = requestPending && e.confirmationRequest?.requestedBy === me.user.id;
  const frozen = e.status === 'confirmed' || e.status === 'aborted';
  const showConfirm = can(confirmPermission) && e.status === 'ready_for_confirmation' && requestPending;
  const confirmBlockedReason: ReactNode = !e.ready ? t('jv.event.confirm.blockedReason') : iRequested ? t('jv.event.confirm.ownRequest') : null;
  const transitions = canManage ? EVENT_COMMANDS.filter((c) => e.allowedCommands.includes(c)) : [];
  const reasonId = `confirm-reason-${e.id}`;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`${base}/closing?tab=${kind === 'closing' ? 'closings' : 'signings'}`} className="inline-flex items-center gap-1 hover:underline">
            <ChevronLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
            {t('jv.closing.title')}
          </Link>
        }
        title={
          <span>
            <span dir="ltr">{e.code}</span> — <span dir="auto">{e.name}</span>
          </span>
        }
        documentTitle={`${e.code ?? ''} — ${e.name}`}
        badges={
          <>
            <StatusBadge enumName="closingKinds" value={e.kind} tone="neutral" />
            <StatusBadge enumName="closingStatuses" value={e.status} size="md" />
            {e.partnerId ? <span className="text-xs text-muted" dir="auto">{partners.label(e.partnerId)}</span> : null}
            {e.isDemo ? <DemoBadge /> : null}
          </>
        }
        description={e.description ? <UText value={e.description} multiline /> : undefined}
      />
      <div className="space-y-6" data-testid="event-detail" data-kind={e.kind} data-status={e.status} data-ready={e.ready ? 'true' : 'false'}>
        <ReadinessPanel e={e} />

        <Panel
          title={t('jv.common.commands')}
          testId="event-commands"
          actions={
            <ButtonRow>
              {transitions.map((c) => (
                <CmdButton key={c} label={t(`jv.event.cmd.${c}`)} onClick={() => setPending({ kind: 'transition', command: c })} testId={`cmd-${c}`} variant={c === 'abort' ? 'danger' : 'secondary'} />
              ))}
              {canManage && e.status === 'ready_for_confirmation' && !requestPending ? <CmdButton label={t('jv.event.request.action')} onClick={() => setPending({ kind: 'request' })} testId="cmd-request-confirmation" variant="primary" /> : null}
              {showConfirm ? (
                <CmdButton
                  label={kind === 'closing' ? t('jv.event.confirm.closing') : t('jv.event.confirm.signing')}
                  onClick={() => setPending({ kind: 'confirm' })}
                  testId="cmd-confirm"
                  variant="primary"
                  disabled={!!confirmBlockedReason}
                  describedBy={confirmBlockedReason ? reasonId : undefined}
                />
              ) : null}
            </ButtonRow>
          }
        >
          {confirmBlockedReason && showConfirm ? (
            <p id={reasonId} className="text-sm text-danger" data-testid="confirm-disabled-reason">
              {confirmBlockedReason}
            </p>
          ) : null}
          {!showConfirm && can(confirmPermission) && !frozen ? <p className="text-sm text-muted" data-testid="confirm-not-available">{t('jv.event.confirm.notYet')}</p> : null}
          {transitions.length === 0 && !showConfirm && !can(confirmPermission) ? <p className="text-sm text-muted">{t('jv.common.noCommands')}</p> : null}
        </Panel>

        <Panel title={t('jv.event.confirmationTitle')} testId="event-confirmation">
          <Facts
            items={[
              { label: t('jv.event.fields.request'), value: e.confirmationRequest ? <StatusBadge enumName="approvalRequestStatuses" value={e.confirmationRequest.status} /> : t('jv.event.fields.noRequest'), testId: 'confirmation-request' },
              { label: t('jv.common.requestedBy'), value: e.confirmationRequest ? <span><Person id={e.confirmationRequest.requestedBy} people={people} /> · <span className="tabular">{formatDateTime(e.confirmationRequest.requestedAt)}</span></span> : EM_DASH },
              { label: t('jv.common.decision'), value: e.confirmationDecisionId ? <LinkedDecision d={e.decision} testId="confirmation-decision" /> : t('jv.common.noDecision') },
              { label: t('jv.event.fields.executedDocument'), value: <DocumentLink id={e.executedDocumentId} /> },
              { label: t('jv.event.fields.authority'), value: <UText value={e.confirmationAuthority} /> },
              { label: t('jv.event.fields.confirmed'), value: e.confirmedBy ? <span><Person id={e.confirmedBy} people={people} /> · <span className="tabular">{formatDateTime(e.confirmedAt)}</span></span> : EM_DASH },
              { label: t('jv.closing.fields.targetDate'), value: <span className="tabular">{formatDate(e.targetDate)}</span> },
              { label: t('jv.event.fields.statusReason'), value: <UText value={e.statusReason} /> },
            ]}
          />
        </Panel>

        {kind === 'closing' ? (
          <section className="space-y-2" data-testid="event-conditions">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-ink">{t('jv.event.cpsTitle')}</h2>
              {can('jv.cp.manage') && !frozen ? <CmdButton label={t('jv.cp.add.action')} onClick={() => setPending({ kind: 'cp' })} testId="cmd-add-cp" /> : null}
            </div>
            <p className="text-sm text-muted">{t('jv.event.cpsHint')}</p>
            <DataTable
              caption={t('jv.event.cpsTitle')}
              columns={[
                {
                  key: 'ref',
                  header: t('jv.cp.fields.reference'),
                  isRowHeader: true,
                  cell: (c) => (
                    <Link className={cx(btn.link, 'whitespace-nowrap')} href={`${base}/closing/conditions/${c.id}`} dir="ltr" data-testid="event-cp-link">
                      {c.reference}
                    </Link>
                  ),
                },
                { key: 'title', header: t('jv.cp.fields.title'), cell: (c) => <span dir="auto">{c.title}</span> },
                { key: 'owner', header: t('jv.cp.fields.owner'), cell: (c) => <Person id={c.ownerUserId} people={people} /> },
                {
                  key: 'flags',
                  header: t('jv.cp.fields.flags'),
                  cell: (c) => (
                    <span className="flex flex-wrap gap-1">
                      <Flag on={c.blocking} danger onLabel={t('jv.cp.blocking')} offLabel={t('jv.cp.nonBlocking')} />
                      <WaivabilityBadge c={c} />
                    </span>
                  ),
                },
                { key: 'status', header: t('jv.common.status'), cell: (c) => <StatusBadge enumName="conditionStatuses" value={c.status} /> },
                { key: 'evidence', header: t('jv.cp.fields.evidence'), cell: (c) => <span className="tabular text-xs">{t('jv.cp.evidenceCount', { active: formatNumber(c.evidence.active), conflicting: formatNumber(c.evidence.conflicting) })}</span> },
                { key: 'longStop', header: t('jv.cp.fields.longStop'), cell: (c) => <span className="tabular">{formatDate(c.longStopDate)}</span> },
              ]}
              rows={e.conditions}
              rowKey={(c) => c.id}
              emptyTitle={t('jv.cp.empty')}
              testId="event-cps-table"
            />
          </section>
        ) : null}

        <section className="space-y-2" data-testid="event-checklist">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-ink">{kind === 'closing' ? t('jv.checklist.closingTitle') : t('jv.checklist.signingTitle')}</h2>
            {canManage && !frozen ? <CmdButton label={t('jv.checklist.add.action')} onClick={() => setPending({ kind: 'item' })} testId="cmd-add-item" /> : null}
          </div>
          <p className="text-sm text-muted">{t('jv.checklist.hint')}</p>
          <DataTable
            caption={kind === 'closing' ? t('jv.checklist.closingTitle') : t('jv.checklist.signingTitle')}
            columns={[
              { key: 'code', header: t('jv.checklist.fields.code'), isRowHeader: true, cell: (i) => <span dir="ltr">{i.code ?? EM_DASH}</span> },
              {
                key: 'title',
                header: t('jv.checklist.fields.title'),
                cell: (i) => (
                  <span className="flex flex-col">
                    <span dir="auto">{i.title}</span>
                    {i.responsibleParty ? <span className="text-xs text-muted" dir="auto">{i.responsibleParty}</span> : null}
                  </span>
                ),
              },
              { key: 'owner', header: t('jv.checklist.fields.owner'), cell: (i) => <Person id={i.ownerUserId} people={people} /> },
              { key: 'due', header: t('jv.checklist.fields.dueDate'), cell: (i) => <span className="tabular">{formatDate(i.dueDate)}</span> },
              {
                key: 'status',
                header: t('jv.common.status'),
                cell: (i) => (
                  <span className="flex flex-col gap-1">
                    <StatusBadge enumName="closingDeliverableStatuses" value={i.status} />
                    {i.notRequiredRequest ? (
                      <span className="text-xs text-warning" data-testid="not-required-pending">
                        {t('jv.checklist.notRequired.pending')} <Person id={i.notRequiredRequest.requestedBy} people={people} />
                      </span>
                    ) : null}
                  </span>
                ),
              },
              {
                key: 'doc',
                header: t('jv.checklist.fields.executed'),
                cell: (i) => (
                  <span className="flex flex-col text-xs">
                    <DocumentLink id={i.documentId} />
                    {i.deliveredBy ? (
                      <span>
                        {t('jv.checklist.deliveredBy')} <Person id={i.deliveredBy} people={people} />
                      </span>
                    ) : null}
                    {i.verifiedBy ? (
                      <span>
                        {t('jv.checklist.acceptedBy')} <Person id={i.verifiedBy} people={people} />
                      </span>
                    ) : null}
                  </span>
                ),
              },
              {
                key: 'cmd',
                header: t('jv.common.commands'),
                cell: (i) =>
                  frozen ? (
                    <span className="text-muted">{EM_DASH}</span>
                  ) : (
                    <ButtonRow>
                      {canManage && i.status === 'pending' ? <CmdButton label={t('jv.checklist.deliver.action')} onClick={() => setPending({ kind: 'deliver', item: i })} testId="cmd-deliver" /> : null}
                      {can('jv.cp.verify') && i.status === 'delivered' && i.deliveredBy !== me.user.id && i.ownerUserId !== me.user.id ? <CmdButton label={t('jv.checklist.accept.action')} onClick={() => setPending({ kind: 'accept', item: i })} testId="cmd-accept" /> : null}
                      {canManage && (i.status === 'pending' || i.status === 'delivered') && !i.notRequiredRequest ? <CmdButton label={t('jv.checklist.notRequired.action')} onClick={() => setPending({ kind: 'notRequired', item: i })} testId="cmd-not-required" /> : null}
                      {can('jv.cp.verify') && i.notRequiredRequest && i.notRequiredRequest.requestedBy !== me.user.id ? (
                        <>
                          <CmdButton label={t('jv.checklist.notRequired.confirmAction')} onClick={() => setPending({ kind: 'notRequiredConfirm', item: i })} testId="cmd-not-required-confirm" />
                          <CmdButton label={t('jv.checklist.notRequired.rejectAction')} onClick={() => setPending({ kind: 'notRequiredReject', item: i })} testId="cmd-not-required-reject" />
                        </>
                      ) : null}
                    </ButtonRow>
                  ),
              },
            ]}
            rows={e.checklist}
            rowKey={(i) => i.id}
            emptyTitle={t('jv.checklist.empty')}
            testId="checklist-table"
          />
        </section>

        {kind === 'closing' ? (
          <section className="space-y-2" data-testid="event-funds">
            <h2 className="text-lg font-semibold text-ink">{t('jv.funds.title')}</h2>
            <RecordOnlyNotice testId="event-record-only" />
            <DataTable
              caption={t('jv.funds.title')}
              columns={[
                { key: 'code', header: t('jv.funds.fields.code'), isRowHeader: true, cell: (f) => <span dir="ltr">{f.code ?? EM_DASH}</span> },
                { key: 'desc', header: t('jv.funds.fields.description'), cell: (f) => <UText value={f.description} /> },
                { key: 'amount', header: t('jv.common.amount'), cell: (f) => (f.amount ? <Money value={f.amount} /> : <span className="text-warning">{t('jv.scenarios.tbd')}</span>) },
                { key: 'status', header: t('jv.common.status'), cell: (f) => <StatusBadge enumName="fundsFlowStatuses" value={f.status} /> },
              ]}
              rows={e.fundsFlows}
              rowKey={(f) => f.id}
              emptyTitle={t('jv.funds.empty')}
            />
            <p className="text-sm">
              <Link className={btn.link} href={`${base}/funds-flow?closingId=${e.id}`}>
                {t('jv.funds.open')}
              </Link>
            </p>
          </section>
        ) : (
          <Panel title={t('jv.event.closingsTitle')} description={t('jv.event.closingsHint')} testId="signing-closings">
            {e.closings.length === 0 ? (
              <p className="text-sm text-muted">{t('jv.closing.emptyClosings')}</p>
            ) : (
              <ul className="space-y-1">
                {e.closings.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 text-sm">
                    <Link className={btn.link} href={`${base}/closing/closings/${c.id}`} dir="ltr">
                      {c.code ?? `#${c.id.slice(-6)}`}
                    </Link>
                    <StatusBadge enumName="closingStatuses" value={c.status} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        <ActivityHistory projectId={projectId} entityType="closing" entityId={e.id} />
      </div>
      {pending ? <EventDialogs key={`${pending.kind}-${'item' in pending ? pending.item.id : ''}-${e.version}`} e={e} pending={pending} onClose={() => setPending(null)} /> : null}
    </>
  );
}

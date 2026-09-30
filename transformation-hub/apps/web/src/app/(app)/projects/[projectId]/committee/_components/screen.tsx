'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { governanceRoutes, type SCREENING_OUTCOMES } from '@hub/contracts';
import { SelectField } from '@/components/Field';
import { useToast } from '@/components/Toast';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { useProjectContext } from '@/lib/project-context';
import { GovCommandDialog, gk, useGovRefresh, useMeetingList, type AgendaItem } from './gov';

type Outcome = (typeof SCREENING_OUTCOMES)[number];

/**
 * Secretariat screening of an agenda request (REQ-GOV-012): accept onto a numbered agenda, return, defer, merge into another
 * request of the same meeting, or reject — every outcome but accept with a reason.
 */
export function ScreenAgendaDialog({ item, onClose }: { item: AgendaItem | null; onClose: () => void }) {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useGovRefresh();
  const toast = useToast();
  const [outcome, setOutcome] = useState<Outcome>('accept');
  const [meetingId, setMeetingId] = useState('');
  const [targetId, setTargetId] = useState('');
  const meetings = useMeetingList({ committeeId: item?.committeeId, pageSize: 100, isCirculation: 'false' }, Boolean(item));
  const open = (meetings.data?.items ?? []).filter((m) => m.status === 'planned' || m.status === 'agenda_published');
  // Merge targets: the other live requests (requested / accepted) of the chosen meeting.
  const targetQuery = { meetingId, pageSize: 100 };
  const targets = useQuery({
    queryKey: gk.agenda(projectId, targetQuery),
    queryFn: ({ signal }) => api(governanceRoutes.listAgendaRequests, { params: { projectId }, query: targetQuery, signal }),
    enabled: Boolean(item) && outcome === 'merge' && Boolean(meetingId),
  });
  const mergeTargets = (targets.data?.items ?? []).filter((a) => a.id !== item?.id && (a.screeningStatus === 'requested' || a.screeningStatus === 'accepted'));
  useEffect(() => {
    if (item) {
      setOutcome('accept');
      setMeetingId(item.meetingId ?? '');
      setTargetId('');
    }
  }, [item]);
  if (!item) return null;
  const needsMeeting = outcome === 'accept' || outcome === 'merge';
  return (
    <GovCommandDialog
      open
      onClose={onClose}
      title={t('governance.agenda.screen.title')}
      confirmLabel={t('governance.agenda.screen.confirm')}
      noteMode={outcome === 'accept' ? 'optional' : 'required'}
      noteLabel={t('governance.common.reason')}
      expectedVersion={item.version}
      confirmDisabled={(needsMeeting && !meetingId) || (outcome === 'merge' && !targetId)}
      consequences={[
        t('governance.agenda.screen.effect'),
        ...(outcome === 'merge' ? [t('governance.agenda.screen.mergeEffect')] : []),
        ...(outcome === 'reject' ? [t('governance.agenda.screen.rejectEffect')] : []),
        ...(outcome !== 'accept' ? [t('governance.agenda.screen.reasonRequired')] : []),
        t('common.command.audited'),
      ]}
      onConfirm={async ({ note }) => {
        await api(governanceRoutes.screenAgendaRequest, {
          params: { projectId, agendaItemId: item.id },
          body: {
            expectedVersion: item.version,
            outcome,
            ...(needsMeeting && meetingId ? { meetingId } : {}),
            ...(outcome === 'merge' ? { mergeIntoAgendaItemId: targetId } : {}),
            ...(note ? { note } : {}),
          },
        });
        await refresh();
        toast.show('success', t('governance.agenda.screen.done'));
        onClose();
      }}
    >
      <div className="space-y-4">
        <p className="text-sm font-medium text-ink" dir="auto">
          {item.title}
        </p>
        <SelectField
          label={t('governance.agenda.screen.outcome')}
          required
          value={outcome}
          onChange={(e) => {
            setOutcome(e.target.value as Outcome);
            setTargetId('');
          }}
          data-testid="screen-outcome"
        >
          <option value="accept">{t('governance.agenda.screen.accept')}</option>
          <option value="return">{t('governance.agenda.screen.return')}</option>
          {item.screeningStatus === 'requested' ? <option value="defer">{t('governance.agenda.screen.defer')}</option> : null}
          <option value="merge">{t('governance.agenda.screen.merge')}</option>
          <option value="reject">{t('governance.agenda.screen.reject')}</option>
        </SelectField>
        {needsMeeting ? (
          <SelectField
            label={t('governance.agenda.screen.meeting')}
            required
            value={meetingId}
            onChange={(e) => {
              setMeetingId(e.target.value);
              setTargetId('');
            }}
            data-testid="screen-meeting"
          >
            <option value="">{t('governance.common.select')}</option>
            {open.map((m) => (
              <option key={m.id} value={m.id}>
                {t('governance.common.meetingNumber', { number: m.number })} — {m.title}
              </option>
            ))}
          </SelectField>
        ) : null}
        {outcome === 'merge' && meetingId ? (
          <SelectField label={t('governance.agenda.screen.mergeInto')} required value={targetId} onChange={(e) => setTargetId(e.target.value)} data-testid="screen-merge-target">
            <option value="">{t('governance.common.select')}</option>
            {mergeTargets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.number !== null ? `${a.number}. ` : ''}
                {a.title} ({tStatus('agendaScreeningStatuses', a.screeningStatus)})
              </option>
            ))}
          </SelectField>
        ) : null}
        {outcome === 'merge' && meetingId && targets.data && mergeTargets.length === 0 ? <p className="text-sm text-muted">{t('governance.agenda.screen.noMergeTargets')}</p> : null}
      </div>
    </GovCommandDialog>
  );
}

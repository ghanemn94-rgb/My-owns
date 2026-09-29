'use client';

import { useEffect, useState } from 'react';
import { governanceRoutes } from '@hub/contracts';
import { SelectField } from '@/components/Field';
import { useToast } from '@/components/Toast';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { useProjectContext } from '@/lib/project-context';
import { GovCommandDialog, useGovRefresh, useMeetingList, type AgendaItem } from './gov';

type Outcome = 'accept' | 'return' | 'defer';

/** Secretariat screening of an agenda request (accept onto a numbered agenda, return or defer with a reason). */
export function ScreenAgendaDialog({ item, onClose }: { item: AgendaItem | null; onClose: () => void }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useGovRefresh();
  const toast = useToast();
  const [outcome, setOutcome] = useState<Outcome>('accept');
  const [meetingId, setMeetingId] = useState('');
  const meetings = useMeetingList({ committeeId: item?.committeeId, pageSize: 100, isCirculation: 'false' }, Boolean(item));
  const open = (meetings.data?.items ?? []).filter((m) => m.status === 'planned' || m.status === 'agenda_published');
  useEffect(() => {
    if (item) {
      setOutcome('accept');
      setMeetingId(item.meetingId ?? '');
    }
  }, [item]);
  if (!item) return null;
  return (
    <GovCommandDialog
      open
      onClose={onClose}
      title={t('governance.agenda.screen.title')}
      confirmLabel={t('governance.agenda.screen.confirm')}
      noteMode={outcome === 'accept' ? 'optional' : 'required'}
      noteLabel={t('governance.common.reason')}
      expectedVersion={item.version}
      confirmDisabled={outcome === 'accept' && !meetingId}
      consequences={[t('governance.agenda.screen.effect'), ...(outcome !== 'accept' ? [t('governance.agenda.screen.reasonRequired')] : []), t('common.command.audited')]}
      onConfirm={async ({ note }) => {
        await api(governanceRoutes.screenAgendaRequest, {
          params: { projectId, agendaItemId: item.id },
          body: { expectedVersion: item.version, outcome, ...(outcome === 'accept' && meetingId ? { meetingId } : {}), ...(note ? { note } : {}) },
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
        <SelectField label={t('governance.agenda.screen.outcome')} required value={outcome} onChange={(e) => setOutcome(e.target.value as Outcome)} data-testid="screen-outcome">
          <option value="accept">{t('governance.agenda.screen.accept')}</option>
          <option value="return">{t('governance.agenda.screen.return')}</option>
          {item.screeningStatus === 'requested' ? <option value="defer">{t('governance.agenda.screen.defer')}</option> : null}
        </SelectField>
        {outcome === 'accept' ? (
          <SelectField label={t('governance.agenda.screen.meeting')} required value={meetingId} onChange={(e) => setMeetingId(e.target.value)} data-testid="screen-meeting">
            <option value="">{t('governance.common.select')}</option>
            {open.map((m) => (
              <option key={m.id} value={m.id}>
                {t('governance.common.meetingNumber', { number: m.number })} — {m.title}
              </option>
            ))}
          </SelectField>
        ) : null}
      </div>
    </GovCommandDialog>
  );
}

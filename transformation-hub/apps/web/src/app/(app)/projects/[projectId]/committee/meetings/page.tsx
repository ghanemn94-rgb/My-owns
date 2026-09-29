'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CalendarPlus, MessageSquarePlus } from 'lucide-react';
import { useState } from 'react';
import { governanceRoutes } from '@hub/contracts';
import { AGENDA_SCREENING_STATUSES, MEETING_STATUSES } from '@hub/domain';
import { DataTable, type Column } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { PageHeader } from '@/components/PageHeader';
import { SearchInput } from '@/components/SearchInput';
import { StatusBadge } from '@/components/StatusBadge';
import { btn } from '@/components/ui';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { useProjectContext } from '@/lib/project-context';
import { AgendaRequestDialog, ScheduleMeetingDialog } from '../_components/dialogs';
import { FilterBar, FilterSelect, Section, UText, gk, hubHref, useCommitteeList, useMeetingList, useUrlState, type AgendaItem, type Meeting } from '../_components/gov';
import { ScreenAgendaDialog } from '../_components/screen';

const PAGE_SIZE = 20;
const FILTERS = ['q', 'committeeId', 'status', 'type', 'aStatus', 'aq', 'apage'] as const;
type MeetingStatus = (typeof MEETING_STATUSES)[number];
type ScreeningStatus = (typeof AGENDA_SCREENING_STATUSES)[number];

export default function MeetingsPage() {
  const { t, tStatus, formatDateTime } = useI18n();
  const { projectId, can } = useProjectContext();
  const { values, page, set, clear, active } = useUrlState(FILTERS);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [screening, setScreening] = useState<AgendaItem | null>(null);
  const committees = useCommitteeList();
  const base = hubHref(projectId);

  const meetings = useMeetingList({
    page,
    pageSize: PAGE_SIZE,
    q: values.q || undefined,
    committeeId: values.committeeId || undefined,
    status: (values.status || undefined) as MeetingStatus | undefined,
    isCirculation: values.type === 'circulation' ? 'true' : values.type === 'meeting' ? 'false' : undefined,
  });

  const aPage = Math.max(1, Number(values.apage) || 1);
  const agendaQuery = {
    page: aPage,
    pageSize: PAGE_SIZE,
    q: values.aq || undefined,
    committeeId: values.committeeId || undefined,
    screeningStatus: (values.aStatus || undefined) as ScreeningStatus | undefined,
  };
  const agenda = useQuery({
    queryKey: gk.agenda(projectId, agendaQuery),
    queryFn: ({ signal }) => api(governanceRoutes.listAgendaRequests, { params: { projectId }, query: agendaQuery, signal }),
    enabled: can('governance.meeting.read'),
    placeholderData: (prev) => prev,
  });

  const columns: Column<Meeting>[] = [
    {
      key: 'number',
      header: t('governance.meetings.columns.number'),
      isRowHeader: true,
      sortValue: (m) => m.number,
      cell: (m) => (
        <Link href={`${base}/meetings/${m.id}`} className="tabular font-medium text-primary hover:underline" data-testid="meeting-link">
          {m.isCirculation ? t('governance.common.circulationNumber', { number: m.number }) : t('governance.common.meetingNumber', { number: m.number })}
        </Link>
      ),
    },
    {
      key: 'title',
      header: t('governance.meetings.columns.title'),
      sortValue: (m) => m.title,
      cell: (m) => (
        <span className="flex flex-wrap items-center gap-1">
          <UText value={m.title} />
          {m.isDemo ? <DemoBadge /> : null}
        </span>
      ),
    },
    { key: 'committee', header: t('governance.meetings.columns.committee'), sortValue: (m) => m.committeeName, cell: (m) => <UText value={m.committeeName} /> },
    { key: 'scheduledAt', header: t('governance.meetings.columns.scheduledAt'), sortValue: (m) => m.scheduledAt, cell: (m) => <span className="tabular">{formatDateTime(m.scheduledAt)}</span> },
    { key: 'status', header: t('governance.meetings.columns.status'), sortValue: (m) => m.status, cell: (m) => <StatusBadge enumName="meetingStatuses" value={m.status} /> },
    { key: 'pack', header: t('governance.meetings.columns.pack'), cell: (m) => (m.packSnapshotId ? t('governance.meetings.packFrozen') : <span className="text-muted">{t('governance.meetings.packNone')}</span>) },
  ];

  const agendaColumns: Column<AgendaItem>[] = [
    { key: 'title', header: t('governance.agenda.columns.title'), isRowHeader: true, sortValue: (a) => a.title, cell: (a) => <UText value={a.title} /> },
    { key: 'kind', header: t('governance.agenda.columns.kind'), cell: (a) => tStatus('agendaItemKinds', a.kind) },
    {
      key: 'decision',
      header: t('governance.agenda.columns.decision'),
      cell: (a) =>
        a.decisionId && a.decisionCode ? (
          <Link href={`${base}/decisions/${a.decisionId}`} className={btn.link} dir="ltr">
            {a.decisionCode}
          </Link>
        ) : (
          <span className="text-muted">{EM_DASH}</span>
        ),
    },
    {
      key: 'meeting',
      header: t('governance.agenda.columns.meeting'),
      cell: (a) =>
        a.meetingId ? (
          <Link href={`${base}/meetings/${a.meetingId}`} className={btn.link}>
            {t('governance.common.view')}
          </Link>
        ) : (
          <span className="text-muted">{EM_DASH}</span>
        ),
    },
    { key: 'number', header: t('governance.agenda.columns.number'), cell: (a) => (a.number ? <span className="tabular">{a.number}</span> : <span className="text-muted">{EM_DASH}</span>) },
    { key: 'requestedAt', header: t('governance.agenda.columns.requestedAt'), sortValue: (a) => a.createdAt, cell: (a) => <span className="tabular">{formatDateTime(a.createdAt)}</span> },
    {
      key: 'status',
      header: t('governance.agenda.columns.status'),
      cell: (a) => (
        <span className="flex flex-wrap items-center gap-2">
          <StatusBadge enumName="agendaScreeningStatuses" value={a.screeningStatus} />
          {can('governance.agenda_request.screen') && (a.screeningStatus === 'requested' || a.screeningStatus === 'deferred') ? (
            <button type="button" className={btn.secondary} onClick={() => setScreening(a)} aria-label={t('governance.agenda.screen.labelFor', { title: a.title })}>
              {t('governance.agenda.screen.action')}
            </button>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('governance.meetings.title')}
        description={t('governance.meetings.subtitle')}
        actions={
          <>
            {can('governance.agenda_request.create') ? (
              <button type="button" className={btn.secondary} onClick={() => setRequestOpen(true)} data-testid="request-agenda">
                <MessageSquarePlus aria-hidden="true" className="size-4" />
                {t('governance.agenda.request.action')}
              </button>
            ) : null}
            {can('governance.meeting.manage') ? (
              <button type="button" className={btn.primary} onClick={() => setScheduleOpen(true)} data-testid="schedule-meeting">
                <CalendarPlus aria-hidden="true" className="size-4" />
                {t('governance.meetings.create.action')}
              </button>
            ) : null}
          </>
        }
      />
      <FilterBar onClear={clear} active={active}>
        <SearchInput className="w-full sm:w-72" label={t('governance.meetings.search')} value={values.q} onChange={(v) => set({ q: v })} />
        {committees.data ? (
          <FilterSelect label={t('governance.common.committee')} value={values.committeeId} onChange={(v) => set({ committeeId: v })} options={committees.data.items.map((c) => ({ value: c.id, label: c.name }))} />
        ) : null}
        <FilterSelect label={t('governance.common.status')} value={values.status} onChange={(v) => set({ status: v })} options={MEETING_STATUSES.map((s) => ({ value: s, label: tStatus('meetingStatuses', s) }))} />
        <FilterSelect
          label={t('governance.meetings.filterType')}
          value={values.type}
          onChange={(v) => set({ type: v })}
          options={[
            { value: 'meeting', label: t('governance.meetings.typeMeeting') },
            { value: 'circulation', label: t('governance.meetings.typeCirculation') },
          ]}
        />
      </FilterBar>
      <DataTable
        caption={t('governance.meetings.title')}
        columns={columns}
        rows={meetings.data?.items}
        rowKey={(m) => m.id}
        isLoading={meetings.isLoading}
        error={meetings.error}
        onRetry={() => meetings.refetch()}
        emptyTitle={active ? t('governance.meetings.emptySearch') : t('governance.meetings.empty')}
        pagination={meetings.data ? { page, pageSize: PAGE_SIZE, total: meetings.data.total, onPageChange: (p) => set({ page: p }) } : undefined}
        testId="meetings-table"
      />

      <Section id="agenda-requests" title={t('governance.agenda.title')} description={t('governance.agenda.subtitle')} className="mt-8">
        <div className="flex flex-wrap items-end gap-3">
          <SearchInput className="w-full sm:w-72" label={t('governance.agenda.search')} value={values.aq} onChange={(v) => set({ aq: v })} />
          <FilterSelect
            label={t('governance.agenda.columns.status')}
            value={values.aStatus}
            onChange={(v) => set({ aStatus: v })}
            options={AGENDA_SCREENING_STATUSES.map((s) => ({ value: s, label: tStatus('agendaScreeningStatuses', s) }))}
          />
        </div>
        <DataTable
          caption={t('governance.agenda.title')}
          columns={agendaColumns}
          rows={agenda.data?.items}
          rowKey={(a) => a.id}
          isLoading={agenda.isLoading}
          error={agenda.error}
          onRetry={() => agenda.refetch()}
          emptyTitle={values.aq || values.aStatus ? t('governance.agenda.emptySearch') : t('governance.agenda.empty')}
          pagination={agenda.data ? { page: aPage, pageSize: PAGE_SIZE, total: agenda.data.total, onPageChange: (p) => set({ apage: p, page }) } : undefined}
          testId="agenda-table"
        />
      </Section>

      {can('governance.meeting.manage') ? <ScheduleMeetingDialog open={scheduleOpen} onClose={() => setScheduleOpen(false)} committeeId={values.committeeId || undefined} /> : null}
      {can('governance.agenda_request.create') ? <AgendaRequestDialog open={requestOpen} onClose={() => setRequestOpen(false)} committeeId={values.committeeId || undefined} /> : null}
      <ScreenAgendaDialog item={screening} onClose={() => setScreening(null)} />
    </>
  );
}

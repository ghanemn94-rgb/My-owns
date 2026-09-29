'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { planningRoutes as P } from '@hub/contracts';
import { UPDATE_STATUSES } from '@hub/domain';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { localToday, pk, updateHref, useRefreshPlanning, type StatusUpdate } from '@/lib/planning';
import { useProjectContext } from '@/lib/project-context';
import { DataTable, type Column } from '../DataTable';
import { DemoBadge } from '../DemoBadge';
import { SelectField, TextAreaField, TextField } from '../Field';
import { StatusBadge } from '../StatusBadge';
import { useToast } from '../Toast';
import { btn, cx } from '../ui';
import { CodeLink, FilterSelect, RagBadge } from './bits';
import { FormDialog } from './dialogs';

const PAGE = 20;

/** Periodic updates of a workstream (or all): submit → review → return/accept; accepted versions are frozen. */
export function StatusUpdatesPanel({ workstreamId }: { workstreamId?: string }) {
  const { t, tStatus, formatDateTime } = useI18n();
  const { projectId, can } = useProjectContext();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [create, setCreate] = useState(false);
  useEffect(() => setPage(1), [status]);
  const query = { page, pageSize: PAGE, workstreamId, status: status || undefined };
  const list = useQuery({ queryKey: pk.updates(projectId, query), queryFn: ({ signal }) => api(P.listStatusUpdates, { params: { projectId }, query, signal }), placeholderData: keepPreviousData });
  const columns: Column<StatusUpdate>[] = [
    { key: 'period', header: t('planning.update.periodEnd'), isRowHeader: true, cell: (u) => <CodeLink href={updateHref(projectId, u.id)} code={u.periodEnd} title={u.workstreamCode ?? t('planning.update.projectLevel')} /> },
    { key: 'status', header: t('planning.common.status'), cell: (u) => <StatusBadge enumName="updateStatuses" value={u.status} /> },
    { key: 'reported', header: t('planning.health.reported'), cell: (u) => (u.ragReported ? <RagBadge value={u.ragReported} /> : '—') },
    { key: 'calc', header: t('planning.health.calculated'), cell: (u) => (u.ragCalculated ? <RagBadge value={u.ragCalculated} /> : '—') },
    { key: 'summary', header: t('planning.update.summary'), cell: (u) => <span dir="auto" className="line-clamp-2 text-sm">{u.summary}</span> },
    { key: 'by', header: t('planning.update.submittedBy'), cell: (u) => (u.submittedByName ? <span dir="auto">{u.submittedByName} · {formatDateTime(u.submittedAt)}</span> : '—') },
    { key: 'demo', header: '', cell: (u) => (u.isDemo ? <DemoBadge /> : null) },
  ];
  return (
    <div className="space-y-3" data-testid="updates-panel">
      <div className="flex flex-wrap items-end gap-3">
        <FilterSelect label={t('planning.common.status')} value={status} onChange={setStatus} className="w-full sm:w-48">
          <option value="">{t('planning.common.allStatuses')}</option>
          {UPDATE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {tStatus('updateStatuses', s)}
            </option>
          ))}
        </FilterSelect>
        {can('planning.status_update.submit') ? (
          <button type="button" className={cx(btn.primary, 'ms-auto')} onClick={() => setCreate(true)} data-testid="update-create">
            <Plus aria-hidden="true" className="size-4" />
            {t('planning.update.create')}
          </button>
        ) : null}
      </div>
      <p className="text-xs text-muted">{t('planning.update.hint')}</p>
      <DataTable
        caption={t('planning.update.title')}
        columns={columns}
        rows={list.data?.items}
        rowKey={(u) => u.id}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        emptyTitle={t('planning.update.empty')}
        pagination={list.data ? { page, pageSize: PAGE, total: list.data.total, onPageChange: setPage } : undefined}
        testId="updates-table"
      />
      <StatusUpdateFormDialog open={create} onClose={() => setCreate(false)} workstreamId={workstreamId} />
    </div>
  );
}

export function StatusUpdateFormDialog({ open, onClose, workstreamId, update }: { open: boolean; onClose: () => void; workstreamId?: string; update?: StatusUpdate }) {
  const { t, tStatus } = useI18n();
  const { projectId, project } = useProjectContext();
  const refresh = useRefreshPlanning(projectId);
  const toast = useToast();
  const [f, setF] = useState({ periodEnd: '', summary: '', achievements: '', nextSteps: '', blockers: '', ragReported: '' });
  useEffect(() => {
    if (!open) return;
    setF({
      periodEnd: update?.periodEnd ?? localToday(project.timezone),
      summary: update?.summary ?? '',
      achievements: update?.achievements ?? '',
      nextSteps: update?.nextSteps ?? '',
      blockers: update?.blockers ?? '',
      ragReported: update?.ragReported ?? '',
    });
  }, [open, update, project.timezone]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      size="lg"
      testId="update-form"
      title={update ? t('planning.update.editTitle') : t('planning.update.create')}
      submitLabel={update ? t('common.actions.save') : t('planning.update.saveDraft')}
      disabled={!f.summary.trim() || !f.periodEnd}
      onReload={() => void refresh()}
      onSubmit={async () => {
        const rag = (f.ragReported || null) as 'green' | 'amber' | 'red' | null;
        if (update) {
          await api(P.updateStatusUpdate, {
            params: { projectId, statusUpdateId: update.id },
            body: { expectedVersion: update.version, periodEnd: f.periodEnd, summary: f.summary.trim(), achievements: f.achievements.trim() || null, nextSteps: f.nextSteps.trim() || null, blockers: f.blockers.trim() || null, ragReported: rag },
          });
        } else {
          await api(P.createStatusUpdate, {
            params: { projectId },
            body: { workstreamId, periodEnd: f.periodEnd, summary: f.summary.trim(), achievements: f.achievements.trim() || undefined, nextSteps: f.nextSteps.trim() || undefined, blockers: f.blockers.trim() || undefined, ragReported: rag ?? undefined },
          });
        }
        toast.show('success', t('planning.update.saved'));
        await refresh();
        onClose();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={t('planning.update.periodEnd')} type="date" required value={f.periodEnd} onChange={set('periodEnd')} dir="ltr" />
        <SelectField label={t('planning.update.ragReported')} value={f.ragReported} onChange={set('ragReported')} hint={t('planning.update.ragHint')}>
          <option value="">{t('planning.common.none')}</option>
          {(['green', 'amber', 'red'] as const).map((s) => (
            <option key={s} value={s}>
              {tStatus('ragStatuses', s)}
            </option>
          ))}
        </SelectField>
      </div>
      <TextAreaField label={t('planning.update.summary')} required value={f.summary} onChange={set('summary')} rows={3} maxLength={4000} />
      <TextAreaField label={t('planning.update.achievements')} value={f.achievements} onChange={set('achievements')} rows={2} maxLength={4000} />
      <TextAreaField label={t('planning.update.nextSteps')} value={f.nextSteps} onChange={set('nextSteps')} rows={2} maxLength={4000} />
      <TextAreaField label={t('planning.update.blockers')} value={f.blockers} onChange={set('blockers')} rows={2} maxLength={4000} />
    </FormDialog>
  );
}


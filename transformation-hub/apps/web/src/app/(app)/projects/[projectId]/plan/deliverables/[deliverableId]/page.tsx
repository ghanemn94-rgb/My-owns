'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Pencil, UserCog } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { planningRoutes as P } from '@hub/contracts';
import { ActivityHistory } from '@/components/ActivityHistory';
import { DemoBadge } from '@/components/DemoBadge';
import { ErrorState } from '@/components/ErrorState';
import { TextAreaField, TextField } from '@/components/Field';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { SectionGuard } from '@/components/SectionGuard';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn } from '@/components/ui';
import { CommandBar } from '@/components/planning/CommandBar';
import { useDeliverableCommands } from '@/components/planning/commands';
import { BackLink } from '@/components/planning/DetailShell';
import { DateText, Fact, Section } from '@/components/planning/bits';
import { FormDialog, OwnerDialog } from '@/components/planning/dialogs';
import { RaciPanel } from '@/components/planning/RaciPanel';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { pk, taskHref, useRefreshPlanning, type Deliverable } from '@/lib/planning';
import { useProjectContext } from '@/lib/project-context';
import { useLocalized } from '@/lib/i18n-data';
import { LocalizedText } from '@/components/LocalizedText';

function EditDeliverableDialog({ open, onClose, d }: { open: boolean; onClose: () => void; d: Deliverable }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useRefreshPlanning(projectId);
  const toast = useToast();
  const [f, setF] = useState({ title: '', weight: '1', dueDate: '', acceptanceCriteria: '' });
  useEffect(() => {
    if (open) setF({ title: d.title, weight: String(d.weight), dueDate: d.dueDate ?? '', acceptanceCriteria: d.acceptanceCriteria ?? '' });
  }, [open, d]);
  const w = Number(f.weight);
  const weightChanged = w !== d.weight;
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={t('planning.deliverable.editTitle', { code: d.code })}
      submitLabel={t('common.actions.save')}
      disabled={!f.title.trim() || !Number.isInteger(w) || w < 1 || w > 100}
      onReload={() => void refresh()}
      onSubmit={async () => {
        await api(P.updateDeliverable, {
          params: { projectId, deliverableId: d.id },
          body: { expectedVersion: d.version, title: f.title.trim(), weight: w, dueDate: f.dueDate || null, acceptanceCriteria: f.acceptanceCriteria.trim() || null },
        });
        toast.show('success', t('planning.common.saved'));
        await refresh();
        onClose();
      }}
    >
      <TextField label={t('planning.common.title')} required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={300} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={t('planning.common.weight')} type="number" min={1} max={100} required value={f.weight} onChange={(e) => setF({ ...f, weight: e.target.value })} dir="ltr" hint={weightChanged && d.weightApproved ? t('planning.deliverable.weightResets') : undefined} />
        <TextField label={t('planning.common.due')} type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} dir="ltr" />
      </div>
      <TextAreaField label={t('planning.task.acceptanceCriteria')} value={f.acceptanceCriteria} onChange={(e) => setF({ ...f, acceptanceCriteria: e.target.value })} rows={3} maxLength={2000} />
    </FormDialog>
  );
}

export default function DeliverablePage() {
  const { t, formatNumber, formatDateTime } = useI18n();
  const loc = useLocalized();
  const { deliverableId } = useParams<{ deliverableId: string }>();
  const { projectId, can } = useProjectContext();
  const refresh = useRefreshPlanning(projectId);
  const q = useQuery({ queryKey: pk.deliverable(projectId, deliverableId), queryFn: ({ signal }) => api(P.getDeliverable, { params: { projectId, deliverableId }, signal }) });
  const commands = useDeliverableCommands(q.data);
  const [edit, setEdit] = useState(false);
  const [owner, setOwner] = useState(false);
  if (q.isLoading) return <LoadingState />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  return (
    <SectionGuard section="plan">
      <BackLink href={`/projects/${projectId}/plan?tab=deliverables`} label={t('planning.deliverable.back')} />
      <PageHeader
        eyebrow={<span dir="ltr">{d.code}</span>}
        title={<LocalizedText text={d.title} textAr={d.titleAr} />}
        documentTitle={`${d.code} — ${loc(d.title, d.titleAr)}`}
        badges={
          <>
            <StatusBadge enumName="deliverableStatuses" value={d.status} size="md" />
            <StatusBadge enumName="approvalStates" value={d.weightApproved ? 'approved' : 'proposed'} label={d.weightApproved ? t('planning.deliverable.weightApproved') : t('planning.deliverable.weightNotApproved')} />
            {d.isDemo ? <DemoBadge /> : null}
          </>
        }
        actions={
          <>
            {can('planning.wbs.manage') && !['accepted', 'cancelled'].includes(d.status) ? (
              <button type="button" className={btn.secondary} onClick={() => setEdit(true)}>
                <Pencil aria-hidden="true" className="size-4" />
                {t('planning.common.edit')}
              </button>
            ) : null}
            {can(d.ownerUserId ? 'planning.ownership.reassign' : 'planning.wbs.manage') ? (
              <button type="button" className={btn.secondary} onClick={() => setOwner(true)}>
                <UserCog aria-hidden="true" className="size-4" />
                {t('planning.owner.assign')}
              </button>
            ) : null}
          </>
        }
      />
      <CommandBar className="mb-6" commands={commands} allowed={d.allowedCommands} expectedVersion={d.version} onDone={refresh} onReload={() => void q.refetch()} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Section id="d-facts" title={t('planning.deliverable.facts')} hint={t('planning.deliverable.weightHint')}>
          <dl className="grid gap-3 sm:grid-cols-3">
            <Fact label={t('planning.common.weight')}>{formatNumber(d.weight)}</Fact>
            <Fact label={t('planning.common.due')}>
              <DateText value={d.dueDate} overdue={d.overdue} />
            </Fact>
            <Fact label={t('planning.common.gate')}>
              <span dir="ltr">{d.gateKey ?? EM_DASH}</span>
            </Fact>
            <Fact label={t('planning.common.evidence')}>{t('planning.task.evidenceCount', { count: formatNumber(d.evidenceCount) })}</Fact>
            <Fact label={t('planning.task.acceptedAt')}>{d.acceptedAt ? formatDateTime(d.acceptedAt) : EM_DASH}</Fact>
            <Fact label={t('planning.common.owner')}>{d.ownerName ? <span dir="auto">{d.ownerName}</span> : <span className="text-muted">{t('planning.common.unassigned')}</span>}</Fact>
            <Fact label={t('planning.deliverable.task')}>
              {d.taskId ? (
                <Link className={btn.link} href={taskHref(projectId, d.taskId)}>
                  {t('planning.deliverable.openTask')}
                </Link>
              ) : (
                EM_DASH
              )}
            </Fact>
            <Fact label={t('planning.task.acceptanceCriteria')} wide>
              <span dir="auto">{d.acceptanceCriteria ?? EM_DASH}</span>
            </Fact>
          </dl>
        </Section>
        <RaciPanel entityType="deliverable" entityId={d.id} />
      </div>
      <ActivityHistory className="mt-6" projectId={projectId} entityType="deliverable" entityId={d.id} />
      <EditDeliverableDialog open={edit} onClose={() => setEdit(false)} d={d} />
      <OwnerDialog
        open={owner}
        onClose={() => setOwner(false)}
        title={t('planning.owner.title', { code: d.code })}
        current={d.ownerName}
        version={d.version}
        run={(userId, reason) => api(P.assignDeliverableOwner, { params: { projectId, deliverableId: d.id }, body: { expectedVersion: d.version, userId, reason } })}
      />
    </SectionGuard>
  );
}

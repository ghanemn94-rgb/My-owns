'use client';

import { useQuery } from '@tanstack/react-query';
import { Pencil, UserCog } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { planningRoutes as P } from '@hub/contracts';
import { ActivityHistory } from '@/components/ActivityHistory';
import { DemoBadge } from '@/components/DemoBadge';
import { ErrorState } from '@/components/ErrorState';
import { TextField } from '@/components/Field';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { SectionGuard } from '@/components/SectionGuard';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { VerificationBadge } from '@/components/VerificationBadge';
import { btn } from '@/components/ui';
import { CommandBar } from '@/components/planning/CommandBar';
import { useMilestoneCommands } from '@/components/planning/commands';
import { BackLink } from '@/components/planning/DetailShell';
import { DateText, Fact, Section } from '@/components/planning/bits';
import { FormDialog, OwnerDialog } from '@/components/planning/dialogs';
import { NodeDependencies, RaciPanel } from '@/components/planning/RaciPanel';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { pk, useRefreshPlanning, type Milestone } from '@/lib/planning';
import { useProjectContext } from '@/lib/project-context';
import { useLocalized } from '@/lib/i18n-data';
import { LocalizedText } from '@/components/LocalizedText';

function EditMilestoneDialog({ open, onClose, m }: { open: boolean; onClose: () => void; m: Milestone }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useRefreshPlanning(projectId);
  const toast = useToast();
  const [f, setF] = useState({ title: '', plannedDate: '', forecastDate: '', gateKey: '', isCritical: false });
  useEffect(() => {
    if (open) setF({ title: m.title, plannedDate: m.plannedDate ?? '', forecastDate: m.forecastDate ?? '', gateKey: m.gateKey ?? '', isCritical: m.isCritical });
  }, [open, m]);
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={t('planning.milestone.editTitle', { code: m.code })}
      submitLabel={t('common.actions.save')}
      disabled={!f.title.trim()}
      onReload={() => void refresh()}
      onSubmit={async () => {
        await api(P.updateMilestone, {
          params: { projectId, milestoneId: m.id },
          body: { expectedVersion: m.version, title: f.title.trim(), plannedDate: f.plannedDate || null, forecastDate: f.forecastDate || null, gateKey: f.gateKey.trim() || null, isCritical: f.isCritical },
        });
        toast.show('success', t('planning.common.saved'));
        await refresh();
        onClose();
      }}
    >
      <TextField label={t('planning.common.title')} required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={300} />
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField label={t('planning.milestone.plannedDate')} type="date" value={f.plannedDate} onChange={(e) => setF({ ...f, plannedDate: e.target.value })} dir="ltr" />
        <TextField label={t('planning.milestone.forecastDate')} type="date" value={f.forecastDate} onChange={(e) => setF({ ...f, forecastDate: e.target.value })} dir="ltr" />
        <TextField label={t('planning.common.gate')} value={f.gateKey} onChange={(e) => setF({ ...f, gateKey: e.target.value })} dir="ltr" maxLength={16} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4" checked={f.isCritical} onChange={(e) => setF({ ...f, isCritical: e.target.checked })} />
        {t('planning.milestone.critical')}
      </label>
    </FormDialog>
  );
}

export default function MilestonePage() {
  const { t, formatNumber } = useI18n();
  const loc = useLocalized();
  const { milestoneId } = useParams<{ milestoneId: string }>();
  const { projectId, can } = useProjectContext();
  const refresh = useRefreshPlanning(projectId);
  const q = useQuery({ queryKey: pk.milestone(projectId, milestoneId), queryFn: ({ signal }) => api(P.getMilestone, { params: { projectId, milestoneId }, signal }) });
  const commands = useMilestoneCommands(q.data);
  const [edit, setEdit] = useState(false);
  const [owner, setOwner] = useState(false);
  if (q.isLoading) return <LoadingState />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const m = q.data;
  return (
    <SectionGuard section="plan">
      <BackLink href={`/projects/${projectId}/plan?tab=milestones`} label={t('planning.milestone.back')} />
      <PageHeader
        eyebrow={<span dir="ltr">{m.code}</span>}
        title={<LocalizedText text={m.title} textAr={m.titleAr} />}
        documentTitle={`${m.code} — ${loc(m.title, m.titleAr)}`}
        badges={
          <>
            <StatusBadge enumName="milestoneStatuses" value={m.status} size="md" />
            <VerificationBadge value={m.verificationStatus} />
            {m.isCritical ? <StatusBadge enumName="ragStatuses" value="amber" tone="warning" label={t('planning.milestone.critical')} /> : null}
            {m.isDemo ? <DemoBadge /> : null}
          </>
        }
        actions={
          <>
            {can('planning.wbs.manage') && !['achieved_verified', 'cancelled'].includes(m.status) ? (
              <button type="button" className={btn.secondary} onClick={() => setEdit(true)}>
                <Pencil aria-hidden="true" className="size-4" />
                {t('planning.common.edit')}
              </button>
            ) : null}
            {can(m.ownerUserId ? 'planning.ownership.reassign' : 'planning.wbs.manage') ? (
              <button type="button" className={btn.secondary} onClick={() => setOwner(true)}>
                <UserCog aria-hidden="true" className="size-4" />
                {t('planning.owner.assign')}
              </button>
            ) : null}
          </>
        }
      />
      <CommandBar className="mb-6" commands={commands} allowed={m.allowedCommands} expectedVersion={m.version} onDone={refresh} onReload={() => void q.refetch()} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Section id="m-facts" title={t('planning.milestone.facts')} hint={t('planning.milestone.evidenceHint')}>
          <dl className="grid gap-3 sm:grid-cols-3">
            <Fact label={t('planning.milestone.plannedDate')}>
              <DateText value={m.plannedDate} overdue={m.overdue} />
            </Fact>
            <Fact label={t('planning.milestone.forecastDate')}>
              <DateText value={m.forecastDate} />
            </Fact>
            <Fact label={t('planning.milestone.actualDate')}>
              <DateText value={m.actualDate} />
            </Fact>
            <Fact label={t('planning.common.gate')}>
              <span dir="ltr">{m.gateKey ?? EM_DASH}</span>
            </Fact>
            <Fact label={t('planning.common.weight')}>{formatNumber(m.weight)}</Fact>
            <Fact label={t('planning.common.evidence')}>{t('planning.task.evidenceCount', { count: formatNumber(m.evidenceCount) })}</Fact>
            <Fact label={t('planning.common.owner')}>{m.ownerName ? <span dir="auto">{m.ownerName}</span> : <span className="text-muted">{t('planning.common.unassigned')}</span>}</Fact>
            <Fact label={t('planning.common.workstream')}>
              <span dir="ltr">{m.workstreamCode ?? EM_DASH}</span>
            </Fact>
          </dl>
        </Section>
        <RaciPanel entityType="milestone" entityId={m.id} />
        <NodeDependencies nodeId={m.id} />
      </div>
      <ActivityHistory className="mt-6" projectId={projectId} entityType="milestone" entityId={m.id} />
      <EditMilestoneDialog open={edit} onClose={() => setEdit(false)} m={m} />
      <OwnerDialog
        open={owner}
        onClose={() => setOwner(false)}
        title={t('planning.owner.title', { code: m.code })}
        current={m.ownerName}
        version={m.version}
        run={(userId, reason) => api(P.assignMilestoneOwner, { params: { projectId, milestoneId: m.id }, body: { expectedVersion: m.version, userId, reason } })}
      />
    </SectionGuard>
  );
}

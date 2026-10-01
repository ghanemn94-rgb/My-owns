'use client';

import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, UserPlus } from 'lucide-react';
import { useParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { portfolioRoutes } from '@hub/contracts';
import { ActivityHistory } from '@/components/ActivityHistory';
import { ConfirmCommandDialog } from '@/components/ConfirmCommandDialog';
import { DataTable } from '@/components/DataTable';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { MetricCard } from '@/components/MetricCard';
import { PageHeader } from '@/components/PageHeader';
import { RestrictedState } from '@/components/RestrictedState';
import { SectionGuard } from '@/components/SectionGuard';
import { useToast } from '@/components/Toast';
import { UserPicker, type PickedUser } from '@/components/UserPicker';
import { btn, card, cx } from '@/components/ui';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { useProjectContext } from '@/lib/project-context';
import { qk, useWorkstreams } from '@/lib/queries';
import { workstreamName, type Workstream } from '@/lib/workstreams';
import { Tabs, useTabParam } from '@/components/planning/Tabs';
import { WorkstreamProgress, WorkstreamTasks } from '@/components/planning/workstream';
import { DeliverablesTab, MilestonesTab } from '@/components/planning/plan/RegisterTabs';
import { StatusUpdatesPanel } from '@/components/planning/updates';
import { RAID_OPEN_GROUP, RaidRegister } from '@/components/planning/raid';

const WS_TABS = ['overview', 'tasks', 'deliverables', 'milestones', 'updates', 'risks', 'issues', 'progress'] as const;
type WsTab = (typeof WS_TABS)[number];

function AssignLeadDialog({ open, onClose, workstream }: { open: boolean; onClose: () => void; workstream: Workstream }) {
  const { t, locale } = useI18n();
  const { projectId } = useProjectContext();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [user, setUser] = useState<PickedUser | null>(null);
  const name = `${workstream.code} — ${workstreamName(workstream, locale)}`;

  return (
    <ConfirmCommandDialog
      open={open}
      onClose={() => {
        setUser(null);
        onClose();
      }}
      title={t('project.workstreams.assignLeadTitle', { name })}
      confirmLabel={t('project.workstreams.assignLead')}
      noteMode="none"
      expectedVersion={workstream.version}
      confirmDisabled={!user}
      consequences={[
        user ? t('project.workstreams.assignLeadEffect', { user: user.displayName, name }) : t('project.workstreams.assignLeadPick'),
        workstream.leadName ? t('project.workstreams.assignLeadReplaces', { user: workstream.leadName }) : t('project.workstreams.assignLeadFirst'),
        t('common.command.audited'),
      ]}
      onReload={() => queryClient.invalidateQueries({ queryKey: qk.workstreams(projectId) })}
      onConfirm={async () => {
        if (!user) return;
        await api(portfolioRoutes.assignWorkstreamLead, {
          params: { projectId, workstreamId: workstream.id },
          body: { userId: user.id, expectedVersion: workstream.version },
        });
        await queryClient.invalidateQueries({ queryKey: qk.workstreams(projectId) });
        toast.show('success', t('project.workstreams.leadAssigned', { user: user.displayName }));
        setUser(null);
        onClose();
      }}
    >
      <UserPicker label={t('project.workstreams.lead')} value={user} onChange={setUser} required />
    </ConfirmCommandDialog>
  );
}

/** Screen 6 — Workstream Workspace: overview, tasks, deliverables, milestones, periodic updates, risks, issues, progress. */
export default function WorkstreamDetailPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <WorkstreamScreen />
    </Suspense>
  );
}

function WorkstreamScreen() {
  const { t, locale, tStatus } = useI18n();
  const { workstreamId } = useParams<{ workstreamId: string }>();
  const { projectId, can } = useProjectContext();
  const ws = useWorkstreams(projectId);
  const [assignOpen, setAssignOpen] = useState(false);
  const [tab, setTab] = useTabParam<WsTab>(WS_TABS, 'overview');

  if (ws.isLoading) return <LoadingState />;
  if (ws.error) return <ErrorState error={ws.error} onRetry={() => ws.refetch()} />;
  const w = ws.data?.items.find((x) => x.id === workstreamId);
  if (!w) return <RestrictedState />;

  const canAssign = can('planning.ownership.reassign');
  const base = `/projects/${projectId}/workstreams/${w.id}`;

  return (
    <SectionGuard section="workstreams">
      <Link href={`/projects/${projectId}/workstreams`} className={cx(btn.link, 'mb-3 inline-flex items-center gap-1 text-sm')}>
        <ChevronLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
        {t('project.workstreams.backToList')}
      </Link>
      <PageHeader
        eyebrow={<span dir="ltr">{w.code}</span>}
        title={<span dir="auto">{workstreamName(w, locale)}</span>}
        documentTitle={`${w.code} — ${workstreamName(w, locale)}`}
        description={
          locale === 'ar' ? (
            <span dir="ltr" lang="en">
              {w.name}
            </span>
          ) : w.nameAr ? (
            <span dir="rtl" lang="ar">
              {w.nameAr}
            </span>
          ) : null
        }
        actions={
          canAssign ? (
            <button type="button" className={btn.primary} onClick={() => setAssignOpen(true)} data-testid="assign-lead">
              <UserPlus aria-hidden="true" className="size-4" />
              {t('project.workstreams.assignLead')}
            </button>
          ) : null
        }
      />

      <Tabs label={t('planning.ws.workspace')} value={tab} onChange={setTab} tabs={WS_TABS.map((k) => ({ key: k, label: t(`planning.ws.tab_${k}`) }))} testId="ws-tabs">
      {tab === 'overview' ? (
      <div className="space-y-6">
        <section aria-labelledby="ws-details" className={cx(card, 'p-4')}>
          <h2 id="ws-details" className="mb-3 text-lg font-semibold">
            {t('project.workstreams.details')}
          </h2>
          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-muted">{t('project.workstreams.lead')}</dt>
              <dd className="text-sm">
                {w.leadName ? (
                  <span dir="auto">{w.leadName}</span>
                ) : (
                  <span className="text-muted">
                    {t('project.workstreams.unassigned')}
                    {w.proposedLeadFunction ? ` — ${t('project.workstreams.proposedFunction', { fn: w.proposedLeadFunction })}` : ''}
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted">{t('project.workstreams.gates')}</dt>
              <dd className="text-sm" dir="ltr">
                {w.linkedGateKeys.join(', ') || EM_DASH}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-sm text-muted">{t('project.workstreams.objective')}</dt>
              <dd className="text-sm" dir="auto">
                {w.objective ?? EM_DASH}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-sm text-muted">{t('project.workstreams.scope')}</dt>
              <dd className="text-sm" dir="auto">
                {w.scope ?? EM_DASH}
              </dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="ws-metrics">
          <h2 id="ws-metrics" className="mb-3 text-lg font-semibold">
            {t('project.metrics.title')}
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard metric="tasks" label={t('project.metrics.tasks')} value={w.counts.tasks} href={`${base}?tab=tasks`} />
            <MetricCard metric="deliverables" label={t('project.metrics.deliverables')} value={w.counts.deliverables} href={`${base}?tab=deliverables`} />
            <MetricCard metric="openRisks" label={t('portfolio.openRisks')} value={w.counts.openRisks} href={`${base}?tab=risks&status=${RAID_OPEN_GROUP}`} />
          </div>
        </section>

        <section aria-labelledby="ws-raci">
          <h2 id="ws-raci" className="mb-1 text-lg font-semibold">
            {t('project.workstreams.raci')}
          </h2>
          <p className="mb-3 text-sm text-muted">{t('project.workstreams.raciHint')}</p>
          <DataTable
            caption={t('project.workstreams.raci')}
            rows={w.raci}
            rowKey={(r) => r.function}
            emptyTitle={t('project.workstreams.raciEmpty')}
            columns={[
              { key: 'fn', header: t('project.workstreams.function'), isRowHeader: true, sortValue: (r) => r.function, cell: (r) => <span dir="auto">{r.function}</span> },
              {
                key: 'raci',
                header: 'RACI',
                sortValue: (r) => 'RACI'.indexOf(r.raci),
                cell: (r) => (
                  <span className="inline-flex items-center gap-2">
                    <span className="inline-flex size-6 items-center justify-center rounded bg-primary-soft text-xs font-bold text-primary" aria-hidden="true">
                      {r.raci}
                    </span>
                    {tStatus('raciValues', r.raci)}
                  </span>
                ),
              },
            ]}
          />
        </section>

        <ActivityHistory projectId={projectId} entityType="workstream" entityId={w.id} />
      </div>
      ) : null}
      {tab === 'tasks' ? <WorkstreamTasks ws={w} /> : null}
      {tab === 'deliverables' ? <DeliverablesTab workstreamId={w.id} /> : null}
      {tab === 'milestones' ? <MilestonesTab workstreamId={w.id} /> : null}
      {tab === 'updates' ? <StatusUpdatesPanel workstreamId={w.id} /> : null}
      {tab === 'risks' ? <RaidRegister kind="risks" workstreamId={w.id} /> : null}
      {tab === 'issues' ? <RaidRegister kind="issues" workstreamId={w.id} /> : null}
      {tab === 'progress' ? <WorkstreamProgress ws={w} /> : null}
      </Tabs>

      {canAssign ? <AssignLeadDialog open={assignOpen} onClose={() => setAssignOpen(false)} workstream={w} /> : null}
    </SectionGuard>
  );
}

'use client';

import Link from 'next/link';
import { ChevronRight, Info } from 'lucide-react';
import { DataTable, type Column } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { SectionGuard } from '@/components/SectionGuard';
import { StatusBadge } from '@/components/StatusBadge';
import { DemoBadge } from '@/components/DemoBadge';
import { card, cx } from '@/components/ui';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { useProjectContext } from '@/lib/project-context';
import { useGates, useGateWaivers, type GateSummary, type GateWaiver } from '@/lib/gates';
import { BlockerList, CriteriaCounts, GateStatusBadges, PrerequisiteList } from './_components/GateBits';

function GateCard({ gate, projectId }: { gate: GateSummary; projectId: string }) {
  const { t } = useI18n();
  const href = `/projects/${projectId}/gates/${gate.id}`;
  return (
    <li className={cx(card, 'flex flex-col gap-3 p-4')} data-testid="gate-card" data-gate-key={gate.key}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="min-w-0 text-base font-semibold">
          <Link href={href} className="hover:underline">
            <span dir="ltr">{gate.key}</span> — <span dir="auto">{gate.name}</span>
          </Link>
        </h2>
        <GateStatusBadges gate={gate} />
      </div>
      <CriteriaCounts counts={gate.evaluation.counts} />
      <div>
        <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">{t('gates.prerequisites.title')}</h3>
        <PrerequisiteList prerequisites={gate.prerequisites} />
      </div>
      <div>
        <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">{t('gates.blockers.title')}</h3>
        <BlockerList blockers={gate.blockers} limit={3} />
      </div>
      <Link href={href} className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
        {t('gates.openGate', { key: gate.key })}
        <ChevronRight aria-hidden="true" className="size-4 rtl:rotate-180" />
      </Link>
    </li>
  );
}

function WaiverRegister({ projectId }: { projectId: string }) {
  const { t, tStatus, formatDate, formatDateTime } = useI18n();
  const waivers = useGateWaivers(projectId);
  const columns: Column<GateWaiver>[] = [
    {
      key: 'target',
      header: t('gates.waivers.criterion'),
      isRowHeader: true,
      sortValue: (w) => w.targetKey ?? '',
      cell: (w) => (
        <span dir="ltr" className="font-medium">
          {w.targetKey ?? EM_DASH}
        </span>
      ),
    },
    { key: 'status', header: t('gates.waivers.status'), sortValue: (w) => w.status, cell: (w) => <StatusBadge enumName="waiverStatuses" value={w.status} /> },
    { key: 'authority', header: t('gates.waivers.authority'), cell: (w) => tStatus('roleKeys', w.authorityRole) },
    {
      key: 'basis',
      header: t('gates.waivers.basis'),
      cell: (w) => (
        <span dir="auto" className="line-clamp-2">
          {w.basis}
          {w.isDemo ? <DemoBadge className="ms-1" /> : null}
        </span>
      ),
    },
    { key: 'expires', header: t('gates.waivers.expiresOn'), cell: (w) => formatDate(w.expiresOn) },
    { key: 'requested', header: t('gates.waivers.requestedAt'), sortValue: (w) => w.createdAt, cell: (w) => <span className="tabular">{formatDateTime(w.createdAt)}</span> },
    { key: 'effective', header: t('gates.waivers.effective'), cell: (w) => (w.effective ? t('gates.waivers.yes') : t('gates.waivers.no')) },
  ];
  return (
    <DataTable
      caption={t('gates.waivers.title')}
      columns={columns}
      rows={waivers.data?.items}
      rowKey={(w) => w.id}
      isLoading={waivers.isLoading}
      error={waivers.error}
      onRetry={() => waivers.refetch()}
      emptyTitle={t('gates.waivers.empty')}
      testId="waiver-register"
    />
  );
}

export default function GatesPage() {
  const { t } = useI18n();
  const { projectId, project } = useProjectContext();
  const gates = useGates(projectId);
  const items = [...(gates.data?.items ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <SectionGuard section="gates">
      <PageHeader eyebrow={<span dir="ltr">{project.code}</span>} title={t('gates.title')} description={t('gates.subtitle')} />
      <p className="mb-4 flex items-start gap-2 rounded-md border border-info/30 bg-info-soft p-3 text-sm text-ink">
        <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-info" />
        {t('gates.taskHint')}
      </p>
      {gates.isLoading ? (
        <LoadingState />
      ) : gates.error ? (
        <ErrorState error={gates.error} onRetry={() => gates.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState title={t('gates.empty')} />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2" data-testid="gate-list">
          {items.map((g) => (
            <GateCard key={g.id} gate={g} projectId={projectId} />
          ))}
        </ul>
      )}
      <section aria-labelledby="waivers-title" className="mt-8">
        <h2 id="waivers-title" className="mb-1 text-lg font-semibold">
          {t('gates.waivers.title')}
        </h2>
        <p className="mb-3 text-sm text-muted">{t('gates.waivers.hint')}</p>
        <WaiverRegister projectId={projectId} />
      </section>
    </SectionGuard>
  );
}

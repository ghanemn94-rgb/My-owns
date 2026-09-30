'use client';

import Link from 'next/link';
import { ChevronRight, Flag } from 'lucide-react';
import { ActivityHistory } from '@/components/ActivityHistory';
import { MetricCard } from '@/components/MetricCard';
import { NotImplementedYet } from '@/components/NotImplementedYet';
import { DelayImpactTile } from '@/components/planning/DelayImpactTile';
import { PageHeader } from '@/components/PageHeader';
import { ProjectBadges } from '@/components/ProjectBadges';
import { DimensionCards } from '@/components/ProjectDimensions';
import { StatusBadge } from '@/components/StatusBadge';
import { card, cx } from '@/components/ui';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { useProjectContext } from '@/lib/project-context';
import { nextGate, useGates } from '@/lib/gates';
import { useLocalized } from '@/lib/i18n-data';
import { BlockerList, GateStatusBadges } from './gates/_components/GateBits';
import { sectionAppliesTo, sectionByKey, sectionHref, type SectionKey } from '@/lib/sections';

/** The "next gate" tile from the live gate evaluation (status, RAG, blockers) when the caller can read gates. */
function NextGateTile() {
  const { t } = useI18n();
  const loc = useLocalized();
  const { project, projectId, can } = useProjectContext();
  const canGates = can('gates.gate.read');
  const gates = useGates(projectId, canGates);
  const live = gates.data ? nextGate(gates.data.items) : null;
  if (canGates && live) {
    return (
      <div className="mt-3 space-y-2" data-testid="next-gate" data-gate-key={live.key}>
        <p className="text-base font-semibold" dir="auto">
          <Link href={`/projects/${projectId}/gates/${live.id}`} className="hover:underline">
            <span dir="ltr">{live.key}</span> — {loc(live.name, live.nameAr)}
          </Link>
        </p>
        <GateStatusBadges gate={live} />
        <BlockerList blockers={live.blockers} limit={2} />
        <Link href={`/projects/${projectId}/gates/${live.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline" data-testid="next-gate-link">
          {t('gates.openGate', { key: live.key })}
          <ChevronRight aria-hidden="true" className="size-4 rtl:rotate-180" />
        </Link>
        <p className="text-xs text-muted">{t('project.cockpit.gateHint')}</p>
      </div>
    );
  }
  if (project.nextGate) {
    return (
      <div className="mt-3 space-y-2" data-testid="next-gate">
        <p className="text-base font-semibold" dir="auto">
          <span dir="ltr">{project.nextGate.key}</span> — {loc(project.nextGate.name, project.nextGate.nameAr)}
        </p>
        <StatusBadge enumName="gateAssessmentStatuses" value={project.nextGate.status} size="md" />
        <p className="text-xs text-muted">{t('project.cockpit.gateHint')}</p>
      </div>
    );
  }
  return (
    <p className="mt-3 text-sm text-muted">
      {EM_DASH} {t('portfolio.notVisible')}
    </p>
  );
}

export default function ProjectOverviewPage() {
  const { t, tStatus } = useI18n();
  const loc = useLocalized();
  const { project, projectId, can } = useProjectContext();
  const isCockpit = project.templateKind === 'dc_carveout';

  const canOpen = (key: SectionKey) => {
    const def = sectionByKey(key);
    return sectionAppliesTo(def, project.templateKind) && can(def.permissions);
  };

  const metrics: { key: string; label: string; value: number | null | undefined; section: SectionKey }[] = [
    { key: 'workstreams', label: t('project.metrics.workstreams'), value: project.counts.workstreams, section: 'workstreams' },
    { key: 'tasks', label: t('project.metrics.tasks'), value: project.counts.tasks, section: 'plan' },
    { key: 'milestones', label: t('project.metrics.milestones'), value: project.counts.milestones, section: 'plan' },
    { key: 'deliverables', label: t('project.metrics.deliverables'), value: project.counts.deliverables, section: 'plan' },
    { key: 'openRisks', label: t('portfolio.openRisks'), value: project.openRisks, section: 'raid' },
    { key: 'overdueActions', label: t('portfolio.overdueActions'), value: project.overdueActions, section: 'committee' },
  ];
  // Only show a metric the caller can see AND whose contributing records they can open.
  const visibleMetrics = metrics.filter((m) => m.value !== undefined && m.value !== null && canOpen(m.section));

  const nextGatePhase = project.nextGate ? project.phases.find((p) => p.gateKeys.includes(project.nextGate!.key))?.key : undefined;
  const gaps = Array.isArray(project.setupState.gaps) ? (project.setupState.gaps as unknown[]).filter((g): g is string => typeof g === 'string') : [];

  return (
    <>
      <PageHeader
        eyebrow={isCockpit ? t('project.cockpit.eyebrow') : t('project.overview.eyebrow')}
        title={<span dir="auto">{project.name}</span>}
        documentTitle={`${project.code} — ${isCockpit ? t('project.cockpit.eyebrow') : t('project.overview.eyebrow')}`}
        badges={<ProjectBadges project={project} />}
        description={
          project.objective ? (
            <p>
              <span className="font-medium text-ink">{t('project.fields.objective')}: </span>
              <span dir="auto">{project.objective}</span>
            </p>
          ) : null
        }
      />

      <div className="space-y-8">
        <section aria-labelledby="dims-title">
          <h2 id="dims-title" className="mb-1 text-lg font-semibold">
            {t('project.cockpit.dimensionsTitle')}
          </h2>
          <p className="mb-3 text-sm text-muted">{t('project.cockpit.dimensionsHint')}</p>
          <DimensionCards dimensions={project.dimensions} hrefFor={(key) => `/projects/${projectId}/dimensions/${key}`} linkLabel={t('gates.dimensions.openDetail')} />
        </section>

        <div className="grid gap-4 lg:grid-cols-3">
          <section aria-labelledby="gate-title" className={cx(card, 'p-4')}>
            <h2 id="gate-title" className="flex items-center gap-2 text-lg font-semibold">
              <Flag aria-hidden="true" className="size-5 text-primary" />
              {t('portfolio.nextGate')}
            </h2>
            <NextGateTile />
          </section>

          <section aria-labelledby="phases-title" className={cx(card, 'p-4 lg:col-span-2')}>
            <h2 id="phases-title" className="text-lg font-semibold">
              {t('project.phases.title')}
            </h2>
            {project.phases.length === 0 ? (
              <p className="mt-3 text-sm text-muted">{t('project.phases.empty')}</p>
            ) : (
              <ol className="mt-3 grid gap-2 sm:grid-cols-2" data-testid="phase-list">
                {project.phases.map((ph, i) => {
                  const current = ph.key === nextGatePhase;
                  return (
                    <li
                      key={ph.key}
                      className={cx('flex items-start gap-3 rounded-md border p-2.5', current ? 'border-primary bg-primary-soft' : 'border-line')}
                      aria-current={current ? 'step' : undefined}
                    >
                      <span className="tabular flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold text-ink">
                        {i + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium" dir="auto">
                          {loc(ph.name, ph.nameAr)}
                        </span>
                        <span className="block text-xs text-muted">
                          {t('project.phases.gates')}: <span dir="ltr">{ph.gateKeys.join(', ') || EM_DASH}</span>
                          {current ? <span className="ms-2 font-semibold text-primary">{t('project.phases.current')}</span> : null}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>

        {visibleMetrics.length > 0 ? (
          <section aria-labelledby="metrics-title">
            <h2 id="metrics-title" className="mb-3 text-lg font-semibold">
              {t('project.metrics.title')}
            </h2>
            <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
              {visibleMetrics.map((m) => (
                <MetricCard key={m.key} label={m.label} value={m.value} href={sectionHref(projectId, m.section)} />
              ))}
            </div>
          </section>
        ) : null}

        {gaps.length > 0 ? (
          <section aria-labelledby="gaps-title" className={cx(card, 'p-4')}>
            <h2 id="gaps-title" className="text-lg font-semibold">
              {t('project.setup.gapsTitle')}
            </h2>
            <p className="mt-1 text-sm text-muted">{t('project.setup.gapsHint')}</p>
            <ul className="mt-3 flex flex-wrap gap-2" data-testid="setup-gaps">
              {gaps.map((g) => (
                <li key={g}>
                  <StatusBadge enumName="setupGaps" value={g} tone="warning" />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="later-title">
          <h2 id="later-title" className="mb-3 text-lg font-semibold">
            {t('project.cockpit.laterTitle')}
          </h2>
          <div className="grid gap-3 md:grid-cols-3">
            {can('planning.plan.read') ? <DelayImpactTile /> : <NotImplementedYet compact phase="P2" feature={t('project.cockpit.delayImpact')} />}
            <NotImplementedYet compact phase="P2" feature={t('project.cockpit.topDecisions')} />
            <NotImplementedYet compact phase="P2" feature={t('project.cockpit.committeeAsks')} />
          </div>
        </section>

        <p className="text-xs text-muted">
          {t('project.fields.template')}: {tStatus('templateKinds', project.templateKind)} ({project.templateKey}) ·{' '}
          {t('project.fields.timezone')}: <span dir="ltr">{project.timezone}</span>
        </p>

        <ActivityHistory projectId={projectId} />
      </div>
    </>
  );
}

'use client';

import { ActivityHistory } from '@/components/ActivityHistory';
import { MetricCard } from '@/components/MetricCard';
import { DelayImpactTile } from '@/components/planning/DelayImpactTile';
import { PageHeader } from '@/components/PageHeader';
import { ProjectBadges } from '@/components/ProjectBadges';
import { DimensionCards } from '@/components/ProjectDimensions';
import { StatusBadge } from '@/components/StatusBadge';
import { card, cx } from '@/components/ui';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { useProjectContext } from '@/lib/project-context';
import { useLocalized } from '@/lib/i18n-data';
import { sectionAppliesTo, sectionByKey, sectionHref, type SectionKey } from '@/lib/sections';
import { CommitteeAsksTile, DelayImpactRestrictedTile, NextGateTile, OverallHealthTile, TopDecisionsTile } from './_components/CockpitTiles';

/**
 * Project home. For DC carve-out projects this is the DC Executive Cockpit (Screen 2, REQ-UX-005): overall health, the
 * four independent status dimensions, the next gate, delay impact, the top three decisions and gate blockers, and the
 * committee asks — each tile from the live API within the caller's scope, each figure linking to its records.
 */
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

        <section aria-labelledby="signals-title">
          <h2 id="signals-title" className="mb-3 text-lg font-semibold">
            {t('project.cockpit.signalsTitle')}
          </h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <OverallHealthTile />
            <NextGateTile />
            {can('planning.plan.read') ? <DelayImpactTile /> : <DelayImpactRestrictedTile />}
          </div>
        </section>

        <section aria-labelledby="asks-title">
          <h2 id="asks-title" className="mb-3 text-lg font-semibold">
            {t('project.cockpit.asksTitle')}
          </h2>
          <div className="grid gap-4 lg:grid-cols-2">
            <TopDecisionsTile />
            {/* Committee asks: only for callers who can read governance (the decision register or the meetings). */}
            {can(['governance.decision.read', 'governance.meeting.read']) ? <CommitteeAsksTile /> : null}
          </div>
        </section>

        <section aria-labelledby="phases-title" className={cx(card, 'p-4')}>
          <h2 id="phases-title" className="text-lg font-semibold">
            {t('project.phases.title')}
          </h2>
          {project.phases.length === 0 ? (
            <p className="mt-3 text-sm text-muted">{t('project.phases.empty')}</p>
          ) : (
            <ol className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4" data-testid="phase-list">
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

        <p className="text-xs text-muted">
          {t('project.fields.template')}: {tStatus('templateKinds', project.templateKind)} ({project.templateKey}) ·{' '}
          {t('project.fields.timezone')}: <span dir="ltr">{project.timezone}</span>
        </p>

        <ActivityHistory projectId={projectId} />
      </div>
    </>
  );
}

'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { SectionGuard } from '@/components/SectionGuard';
import { useI18n } from '@/i18n/provider';
import { useProjectContext } from '@/lib/project-context';
import { Tabs, useTabParam } from '@/components/planning/Tabs';
import { WbsTab } from '@/components/planning/plan/WbsTab';
import { KanbanTab } from '@/components/planning/plan/KanbanTab';
import { TimelineTab } from '@/components/planning/plan/TimelineTab';
import { DeliverablesTab, MilestonesTab } from '@/components/planning/plan/RegisterTabs';
import { BaselinesTab, DependenciesTab, LookAheadTab, WhatIfTab } from '@/components/planning/plan/ScheduleTabs';
import { HealthTab } from '@/components/planning/plan/HealthTab';
import { CrossProjectTab } from '@/components/planning/plan/CrossProjectTab';

const TABS = ['wbs', 'kanban', 'timeline', 'milestones', 'deliverables', 'dependencies', 'crossproject', 'baselines', 'lookahead', 'whatif', 'health'] as const;
type TabKey = (typeof TABS)[number];

function PlanScreen() {
  const { t } = useI18n();
  const { project } = useProjectContext();
  const [tab, setTab] = useTabParam<TabKey>(TABS, 'wbs');
  const node = useSearchParams().get('node') ?? undefined;
  return (
    <>
      <PageHeader eyebrow={<span dir="auto">{project.code}</span>} title={t('project.screens.plan.title')} description={t('planning.plan.subtitle')} />
      <Tabs label={t('project.screens.plan.title')} value={tab} onChange={setTab} tabs={TABS.map((k) => ({ key: k, label: t(`planning.tabs.${k}`) }))} testId="plan-tabs">
        {tab === 'wbs' ? <WbsTab /> : null}
        {tab === 'kanban' ? <KanbanTab /> : null}
        {tab === 'timeline' ? <TimelineTab /> : null}
        {tab === 'milestones' ? <MilestonesTab /> : null}
        {tab === 'deliverables' ? <DeliverablesTab /> : null}
        {tab === 'dependencies' ? <DependenciesTab /> : null}
        {tab === 'crossproject' ? <CrossProjectTab /> : null}
        {tab === 'baselines' ? <BaselinesTab /> : null}
        {tab === 'lookahead' ? <LookAheadTab /> : null}
        {tab === 'whatif' ? <WhatIfTab initialNodeId={node} /> : null}
        {tab === 'health' ? <HealthTab /> : null}
      </Tabs>
    </>
  );
}

/** Screen 5 — Integrated Plan: WBS, Kanban, timeline, registers, dependencies, baselines, look-ahead, what-if and health. */
export default function PlanPage() {
  return (
    <SectionGuard section="plan">
      <Suspense fallback={<LoadingState />}>
        <PlanScreen />
      </Suspense>
    </SectionGuard>
  );
}

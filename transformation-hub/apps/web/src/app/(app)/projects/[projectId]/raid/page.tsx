'use client';

import { Suspense } from 'react';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { SectionGuard } from '@/components/SectionGuard';
import { Tabs, useTabParam } from '@/components/planning/Tabs';
import { ChangeRequestsPanel, RaidRegister, RiskHeatMap } from '@/components/planning/raid';
import { useI18n } from '@/i18n/provider';
import { useProjectContext } from '@/lib/project-context';

const TABS = ['risks', 'issues', 'assumptions', 'dependencies', 'changes'] as const;
type TabKey = (typeof TABS)[number];

function RaidScreen() {
  const { t } = useI18n();
  const { project } = useProjectContext();
  const [tab, setTab] = useTabParam<TabKey>(TABS, 'risks');
  return (
    <>
      <PageHeader eyebrow={<span dir="auto">{project.code}</span>} title={t('project.screens.raid.title')} description={t('planning.raid.subtitle')} />
      <Tabs label={t('project.screens.raid.title')} value={tab} onChange={setTab} tabs={TABS.map((k) => ({ key: k, label: t(`planning.raid.tab_${k}`) }))} testId="raid-tabs">
        {tab === 'changes' ? (
          <ChangeRequestsPanel />
        ) : (
          <div className="grid gap-4 xl:grid-cols-[1fr_auto]">
            <div className="min-w-0">
              <RaidRegister key={tab} kind={tab} />
            </div>
            {tab === 'risks' ? (
              <div className="xl:w-64">
                <RiskHeatMap />
              </div>
            ) : null}
          </div>
        )}
      </Tabs>
    </>
  );
}

/** Screen 12 — RAID & Change Control. */
export default function RaidPage() {
  return (
    <SectionGuard section="raid">
      <Suspense fallback={<LoadingState />}>
        <RaidScreen />
      </Suspense>
    </SectionGuard>
  );
}

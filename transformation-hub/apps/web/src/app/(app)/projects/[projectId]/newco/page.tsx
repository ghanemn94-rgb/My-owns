'use client';

import { Suspense } from 'react';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { SectionGuard } from '@/components/SectionGuard';
import { EntitiesPanel } from '@/components/newco/entities';
import { RequirementsRegister } from '@/components/newco/requirements';
import { Tabs, useTabParam } from '@/components/planning/Tabs';
import { useI18n } from '@/i18n/provider';
import { useFollowEvidence } from '@/lib/carveout';
import { useProjectContext } from '@/lib/project-context';

const TABS = ['entities', 'requirements'] as const;
type TabKey = (typeof TABS)[number];

function NewcoScreen() {
  const { t } = useI18n();
  const { project, projectId } = useProjectContext();
  const [tab, setTab] = useTabParam<TabKey>(TABS, 'entities');
  useFollowEvidence(projectId);
  return (
    <>
      <PageHeader eyebrow={<span dir="auto">{project.code}</span>} title={t('project.screens.newco.title')} description={t('newco.page.subtitle')} />
      <Tabs label={t('project.screens.newco.title')} value={tab} onChange={setTab} tabs={TABS.map((k) => ({ key: k, label: t(`newco.tabs.${k}`) }))} testId="newco-tabs">
        {tab === 'entities' ? <EntitiesPanel /> : <RequirementsRegister />}
      </Tabs>
    </>
  );
}

/** Screen 8 — NewCo & regulatory: legal entities, incorporation recorded vs verified (AT-06), approval register. */
export default function NewcoPage() {
  return (
    <SectionGuard section="newco">
      <Suspense fallback={<LoadingState />}>
        <NewcoScreen />
      </Suspense>
    </SectionGuard>
  );
}

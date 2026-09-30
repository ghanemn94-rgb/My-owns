'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { SectionGuard } from '@/components/SectionGuard';
import { AgreementsRegister } from '@/components/carveout/agreements';
import { ConsentsRegister } from '@/components/carveout/consents';
import { Day1PositionsPanel, PerimeterVersionsPanel, ReconciliationPanel, SitesPanel, TransfersPanel } from '@/components/carveout/panels';
import { PerimeterRegister } from '@/components/carveout/register';
import { Tabs, useTabParam } from '@/components/planning/Tabs';
import { useI18n } from '@/i18n/provider';
import { useFollowEvidence } from '@/lib/carveout';
import { useProjectContext } from '@/lib/project-context';

const TABS = ['register', 'reconciliation', 'transfers', 'day1', 'versions', 'sites', 'agreements', 'consents'] as const;
type TabKey = (typeof TABS)[number];

function PerimeterScreen() {
  const { t } = useI18n();
  const { project, projectId } = useProjectContext();
  const sp = useSearchParams();
  const [tab, setTab] = useTabParam<TabKey>(TABS, 'register');
  useFollowEvidence(projectId);
  const filters = { type: sp.get('type') ?? undefined, disposition: sp.get('disposition') ?? undefined, siteId: sp.get('siteId') ?? undefined };
  const aspect = sp.get('aspect') ?? undefined;
  return (
    <>
      <PageHeader eyebrow={<span dir="auto">{project.code}</span>} title={t('project.screens.perimeter.title')} description={t('carveout.page.subtitle')} />
      <Tabs label={t('project.screens.perimeter.title')} value={tab} onChange={setTab} tabs={TABS.map((k) => ({ key: k, label: t(`carveout.tabs.${k}`) }))} testId="perimeter-tabs">
        {tab === 'register' ? (
          // Remount when a deep link changes the filters so the register starts from them.
          <PerimeterRegister key={JSON.stringify(filters)} initial={filters} />
        ) : tab === 'reconciliation' ? (
          <ReconciliationPanel />
        ) : tab === 'transfers' ? (
          <TransfersPanel key={aspect ?? ''} initialAspect={aspect} />
        ) : tab === 'day1' ? (
          <Day1PositionsPanel />
        ) : tab === 'versions' ? (
          <PerimeterVersionsPanel />
        ) : tab === 'sites' ? (
          <SitesPanel />
        ) : tab === 'agreements' ? (
          <AgreementsRegister />
        ) : (
          <ConsentsRegister />
        )}
      </Tabs>
    </>
  );
}

/** Screen 7 — Perimeter & transfers (register, reconciliation, legal vs economic transfers, Day-1 contract positions, change-controlled perimeter). */
export default function PerimeterPage() {
  return (
    <SectionGuard section="perimeter">
      <Suspense fallback={<LoadingState />}>
        <PerimeterScreen />
      </Suspense>
    </SectionGuard>
  );
}

'use client';

import { Suspense, type ReactNode } from 'react';
import { LoadingState } from '@/components/LoadingState';
import { SectionGuard } from '@/components/SectionGuard';
import { ReportsTabs } from './_components/rp';

/**
 * Reports (spec §10 screen 16b, reports part; §11): report snapshots, their files, the KPI catalogue and the BI exposure.
 * A UI hint only — the API re-checks the caller's access on every snapshot read and every download.
 */
export default function ReportsLayout({ children }: { children: ReactNode }) {
  return (
    <SectionGuard section="reports">
      <ReportsTabs />
      <Suspense fallback={<LoadingState />}>{children}</Suspense>
    </SectionGuard>
  );
}

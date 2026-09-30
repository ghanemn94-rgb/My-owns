'use client';

import { Suspense, type ReactNode } from 'react';
import { LoadingState } from '@/components/LoadingState';
import { SectionGuard } from '@/components/SectionGuard';
import { ClearanceNote, FinanceTabs } from './_components/fin';

/**
 * Finance & Value (spec §10 screen 10; REQ-UX-013): one guarded section with its own sub-navigation. Users without
 * `finance.record.read` in the project see the restricted-access state (AT-29 E2E); the API enforces the same rule
 * and filters every list, count and total by the caller's finance clearance.
 */
export default function FinanceLayout({ children }: { children: ReactNode }) {
  return (
    <SectionGuard section="finance">
      <FinanceTabs />
      <ClearanceNote />
      <Suspense fallback={<LoadingState />}>{children}</Suspense>
    </SectionGuard>
  );
}

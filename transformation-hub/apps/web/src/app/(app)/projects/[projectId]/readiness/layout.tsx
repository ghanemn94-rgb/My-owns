'use client';

import { Suspense, type ReactNode } from 'react';
import { LoadingState } from '@/components/LoadingState';
import { SectionGuard } from '@/components/SectionGuard';
import { ReadinessTabs } from './_components/rd';

/** Day-1 & TSA Center (spec §10 screen 9): one guarded section with its own sub-navigation. */
export default function ReadinessLayout({ children }: { children: ReactNode }) {
  return (
    <SectionGuard section="readiness">
      <ReadinessTabs />
      <Suspense fallback={<LoadingState />}>{children}</Suspense>
    </SectionGuard>
  );
}

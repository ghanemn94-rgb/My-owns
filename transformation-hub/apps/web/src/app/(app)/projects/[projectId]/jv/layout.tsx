'use client';

import { Suspense, type ReactNode } from 'react';
import { LoadingState } from '@/components/LoadingState';
import { SectionGuard } from '@/components/SectionGuard';
import { JvTabs } from './_components/jv';

/** JV & Diligence (spec §10 screen 11): one guarded section with its own sub-navigation. */
export default function JvLayout({ children }: { children: ReactNode }) {
  return (
    <SectionGuard section="jv">
      <JvTabs />
      <Suspense fallback={<LoadingState />}>{children}</Suspense>
    </SectionGuard>
  );
}

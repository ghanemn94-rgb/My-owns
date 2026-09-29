'use client';

import { Suspense, type ReactNode } from 'react';
import { LoadingState } from '@/components/LoadingState';
import { SectionGuard } from '@/components/SectionGuard';
import { CommitteeTabs } from './_components/gov';

/** Committee Hub (spec §10 screen 4): one guarded section with its own sub-navigation. */
export default function CommitteeLayout({ children }: { children: ReactNode }) {
  return (
    <SectionGuard section="committee">
      <CommitteeTabs />
      <Suspense fallback={<LoadingState />}>{children}</Suspense>
    </SectionGuard>
  );
}

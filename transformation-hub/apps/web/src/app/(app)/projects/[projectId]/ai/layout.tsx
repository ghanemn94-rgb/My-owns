'use client';

import { Suspense, type ReactNode } from 'react';
import { LoadingState } from '@/components/LoadingState';
import { SectionGuard } from '@/components/SectionGuard';
import { AiTabs } from './_components/nav';

/** AI PM Center (spec §10 screen 14; spec §12): one guarded section with its own sub-navigation. */
export default function AiLayout({ children }: { children: ReactNode }) {
  return (
    <SectionGuard section="ai">
      <AiTabs />
      <Suspense fallback={<LoadingState />}>{children}</Suspense>
    </SectionGuard>
  );
}

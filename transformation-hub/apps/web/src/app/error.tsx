'use client';

import { Main } from '@/components/Main';
import { ErrorState } from '@/components/ErrorState';

/** Last-resort boundary for rendering failures; shows no stack trace. */
export default function GlobalRouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <Main>
      <ErrorState error={error} onRetry={retry} />
    </Main>
  );
}

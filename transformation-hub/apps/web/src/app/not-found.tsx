'use client';

import { Main } from '@/components/Main';
import { RestrictedState } from '@/components/RestrictedState';

/** Unknown URLs get the same neutral message as hidden records (nothing about existence is revealed). */
export default function NotFound() {
  return (
    <Main>
      <RestrictedState />
    </Main>
  );
}

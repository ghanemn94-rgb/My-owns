'use client';

import { LoaderCircle } from 'lucide-react';
import { useT } from '@/i18n/provider';
import { cx } from './ui';

export function LoadingState({ label, className, compact = false }: { label?: string; className?: string; compact?: boolean }) {
  const t = useT();
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="loading-state"
      className={cx('flex items-center justify-center gap-2 text-sm text-muted', compact ? 'py-4' : 'py-12', className)}
    >
      <LoaderCircle aria-hidden="true" className="size-5 animate-spin" />
      <span>{label ?? t('states.loading')}</span>
    </div>
  );
}

'use client';

import { FlaskConical } from 'lucide-react';
import { useT } from '@/i18n/provider';
import { cx } from './ui';

/** Visible marker on every synthetic (is_demo) record. */
export function DemoBadge({ className }: { className?: string }) {
  const t = useT();
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-md border border-demo-line bg-demo-soft px-1.5 py-0.5 text-xs font-semibold text-demo',
        className,
      )}
      title={t('common.demo.tooltip')}
      data-testid="demo-badge"
    >
      <FlaskConical aria-hidden="true" className="size-3.5" />
      {t('common.demo.badge')}
    </span>
  );
}

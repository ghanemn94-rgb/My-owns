'use client';

import { Construction } from 'lucide-react';
import { useT } from '@/i18n/provider';
import { card, cx } from './ui';

/**
 * Honest placeholder for functionality delivered in a later implementation phase. Never renders sample data.
 */
export function NotImplementedYet({
  phase,
  feature,
  description,
  compact = false,
  className,
}: {
  phase: string;
  /** Translated name of the screen / capability. */
  feature: string;
  description?: string;
  compact?: boolean;
  className?: string;
}) {
  const t = useT();
  return (
    <section
      className={cx(card, 'border-dashed', compact ? 'p-4' : 'p-8 text-center', className)}
      data-testid="not-implemented"
      data-phase={phase}
    >
      <div className={cx('flex gap-3', compact ? 'items-start' : 'flex-col items-center')}>
        <Construction aria-hidden="true" className={cx('shrink-0 text-muted', compact ? 'mt-0.5 size-5' : 'size-8')} />
        <div className={compact ? '' : 'max-w-prose'}>
          <h2 className={cx('font-semibold text-ink', compact ? 'text-sm' : 'text-lg')}>{feature}</h2>
          <p className="mt-1 text-sm text-muted">{t('states.notImplemented.body', { phase })}</p>
          {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
          {!compact ? <p className="mt-3 text-xs text-muted">{t('states.notImplemented.noFakeData')}</p> : null}
        </div>
      </div>
    </section>
  );
}

'use client';

import Link from 'next/link';
import { Lock } from 'lucide-react';
import { useT } from '@/i18n/provider';
import { btn, cx } from './ui';

/**
 * Shown for 404 and 403 alike: "not found or you don't have access". It never states whether the record
 * exists, matching the API's deny-by-default behaviour.
 */
export function RestrictedState({ className, showHomeLink = true }: { className?: string; showHomeLink?: boolean }) {
  const t = useT();
  return (
    <section
      aria-labelledby="restricted-title"
      className={cx('flex flex-col items-center gap-2 px-4 py-12 text-center', className)}
      data-testid="restricted-state"
    >
      <Lock aria-hidden="true" className="size-8 text-muted" />
      <h2 id="restricted-title" className="text-lg font-semibold text-ink">
        {t('states.restricted.title')}
      </h2>
      <p className="max-w-prose text-sm text-muted">{t('states.restricted.hint')}</p>
      {showHomeLink ? (
        <Link href="/" className={cx(btn.secondary, 'mt-2')}>
          {t('states.restricted.backHome')}
        </Link>
      ) : null}
    </section>
  );
}

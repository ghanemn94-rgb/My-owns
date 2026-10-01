'use client';

import { CircleAlert, RefreshCw } from 'lucide-react';
import { isApiError } from '@/lib/api';
import { useT } from '@/i18n/provider';
import { RestrictedState } from './RestrictedState';
import { btn, cx } from './ui';

/**
 * Generic failure state. 403/404 are delegated to RestrictedState so a caller never learns whether a hidden
 * resource exists. Shows the correlation id so support can trace the request.
 */
export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const t = useT();
  if (isApiError(error) && (error.isHidden || error.isForbidden)) return <RestrictedState className={className} />;
  const correlationId = isApiError(error) ? error.correlationId : undefined;
  const unavailable = isApiError(error) && (error.status === 0 || error.status >= 500);
  return (
    <div role="alert" className={cx('flex flex-col items-center gap-2 px-4 py-10 text-center', className)} data-testid="error-state">
      <CircleAlert aria-hidden="true" className="size-8 text-danger" />
      <p className="font-medium text-ink">{unavailable ? t('states.error.unavailableTitle') : t('states.error.title')}</p>
      <p className="max-w-prose text-sm text-muted">
        {isApiError(error) && error.detail && !unavailable ? error.detail : t('states.error.hint')}
      </p>
      {correlationId ? (
        <p className="text-xs text-muted">
          {t('states.error.correlation')}{' '}
          <code dir="ltr" className="rounded bg-surface-muted px-1 py-0.5 font-mono">
            {correlationId}
          </code>
        </p>
      ) : null}
      {onRetry ? (
        <button type="button" className={cx(btn.secondary, 'mt-2')} onClick={onRetry}>
          <RefreshCw aria-hidden="true" className="size-4" />
          {t('common.actions.retry')}
        </button>
      ) : null}
    </div>
  );
}

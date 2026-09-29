'use client';

import { CircleAlert, RefreshCw } from 'lucide-react';
import { isApiError } from '@/lib/api';
import { useT, type MessageKey } from '@/i18n/provider';
import { btn, cx } from './ui';

/** Map an API failure to a translated headline. Details from the server (422/400) are shown as-is. */
export function errorHeadlineKey(error: unknown): MessageKey {
  if (!isApiError(error)) return 'states.error.title';
  if (error.status === 409) return 'states.conflict.title';
  if (error.status === 422) return 'states.ruleViolation.title';
  if (error.status === 400) return 'states.validation.title';
  if (error.status === 403 || error.status === 404) return 'states.restricted.title';
  if (error.status === 0 || error.status >= 500) return 'states.error.unavailableTitle';
  return 'states.error.title';
}

/**
 * Inline error for forms and command dialogs:
 * 409 → "changed by someone else — reload and review" (+ reload action), 422/400 → the server's detail,
 * 403/404 → the neutral restricted message (existence is never revealed).
 */
export function ApiErrorNotice({ error, onReload, className }: { error: unknown; onReload?: () => void; className?: string }) {
  const t = useT();
  if (!error) return null;
  const e = isApiError(error) ? error : null;
  const showDetail = e && (e.status === 422 || e.status === 400) && e.detail;
  return (
    <div role="alert" className={cx('rounded-md border border-danger/40 bg-danger-soft p-3 text-sm text-danger', className)}>
      <div className="flex items-start gap-2">
        <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 space-y-1">
          <p className="font-semibold">{t(errorHeadlineKey(error))}</p>
          {e?.status === 409 ? <p>{t('states.conflict.hint')}</p> : null}
          {showDetail ? (
            <p dir="auto" className="text-ink">
              {e.detail}
            </p>
          ) : null}
          {e && (e.status === 403 || e.status === 404) ? <p>{t('states.restricted.hint')}</p> : null}
          {e?.correlationId ? (
            <p className="text-xs">
              {t('states.error.correlation')} <code dir="ltr">{e.correlationId}</code>
            </p>
          ) : null}
          {e?.status === 409 && onReload ? (
            <button type="button" className={cx(btn.secondary, 'mt-1')} onClick={onReload}>
              <RefreshCw aria-hidden="true" className="size-4" />
              {t('common.actions.reloadAndReview')}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

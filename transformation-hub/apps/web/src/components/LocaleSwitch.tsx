'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Globe } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { identityRoutes } from '@hub/contracts';
import { api } from '@/lib/api';
import { LOCALE_COOKIE, type Locale } from '@/i18n/config';
import { useI18n } from '@/i18n/provider';
import { useToast } from './Toast';
import { btn, cx } from './ui';

export const EXPLICIT_LOCALE_KEY = 'hub_locale_explicit';

/**
 * Switches between Arabic (RTL) and English (LTR). Signed-in users persist the preference through the API
 * (which also sets the `hub_locale` cookie); on the login page the cookie is set directly. The page is then
 * re-rendered on the server so `<html lang dir>` is correct.
 */
export function LocaleSwitch({ authenticated, className }: { authenticated: boolean; className?: string }) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const target: Locale = locale === 'ar' ? 'en' : 'ar';

  const switchLocale = async () => {
    setBusy(true);
    try {
      if (authenticated) {
        await api(identityRoutes.setLocale, { body: { locale: target } });
      } else {
        document.cookie = `${LOCALE_COOKIE}=${target}; path=/; SameSite=Lax; max-age=31536000`;
        // Remember the explicit pre-login choice so sign-in can keep it (see login page).
        try {
          sessionStorage.setItem(EXPLICIT_LOCALE_KEY, target);
        } catch {
          /* storage unavailable: the choice simply is not carried over */
        }
      }
      startTransition(() => {
        router.refresh();
      });
      // Server-provided localized strings (e.g. phase names) must be fetched again.
      void queryClient.invalidateQueries();
    } catch {
      toast.show('error', t('common.locale.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={switchLocale}
      disabled={busy || pending}
      className={cx(btn.ghost, 'px-2.5', className)}
      data-testid="locale-switch"
      aria-label={t('common.locale.switchTo', { language: target === 'ar' ? 'العربية' : 'English' })}
    >
      <Globe aria-hidden="true" className="size-4" />
      <span lang={target} dir={target === 'ar' ? 'rtl' : 'ltr'}>
        {target === 'ar' ? 'العربية' : 'English'}
      </span>
    </button>
  );
}

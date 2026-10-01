'use client';

import '@/lib/zod-csp';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/Toast';
import { I18nProvider } from '@/i18n/provider';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/messages';
import { QueryProvider } from '@/lib/query';

export function Providers({
  locale,
  messages,
  appName,
  children,
}: {
  locale: Locale;
  messages: Messages;
  appName: string;
  children: ReactNode;
}) {
  return (
    <I18nProvider locale={locale} messages={messages} appName={appName}>
      <QueryProvider>
        <ToastProvider>{children}</ToastProvider>
      </QueryProvider>
    </I18nProvider>
  );
}

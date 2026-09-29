import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import './globals.css';
import { LOCALE_COOKIE, dirOf, normalizeLocale } from '@/i18n/config';
import { MESSAGES } from '@/i18n/messages';
import { Providers } from './providers';

/** Working product name; configurable per deployment without a rebuild (no official logo is used). */
function appName(fallback: string): string {
  const configured = process.env.HUB_APP_NAME?.trim();
  return configured ? configured.slice(0, 80) : fallback;
}

async function currentLocale() {
  const store = await cookies();
  return normalizeLocale(store.get(LOCALE_COOKIE)?.value);
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await currentLocale();
  const name = appName(MESSAGES[locale].common.appName);
  return {
    title: { default: name, template: `%s · ${name}` },
    description: MESSAGES[locale].common.appTagline,
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0b4f8a',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await currentLocale();
  const messages = MESSAGES[locale];
  return (
    <html lang={locale} dir={dirOf(locale)}>
      <body>
        <Providers locale={locale} messages={messages} appName={appName(messages.common.appName)}>
          {children}
        </Providers>
      </body>
    </html>
  );
}

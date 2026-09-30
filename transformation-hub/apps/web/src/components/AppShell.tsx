'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import type { Me } from '@hub/contracts';
import { isApiError } from '@/lib/api';
import { useMe } from '@/lib/queries';
import { useI18n } from '@/i18n/provider';
import { DemoModeBanner } from './DemoModeBanner';
import { ErrorState } from './ErrorState';
import { LoadingState } from './LoadingState';
import { LocaleSwitch } from './LocaleSwitch';
import { UserMenu } from './UserMenu';
import { cx } from './ui';

export function SkipLink() {
  const { t } = useI18n();
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-primary focus:shadow"
    >
      {t('common.skipToContent')}
    </a>
  );
}

export function Wordmark() {
  const { appName, t } = useI18n();
  return (
    <Link href="/" className="flex min-w-0 flex-col leading-tight" aria-label={`${appName} — ${t('nav.portfolio')}`}>
      <span className="truncate text-base font-semibold text-primary">{appName}</span>
      <span className="hidden truncate text-xs text-muted sm:block">{t('common.appTagline')}</span>
    </Link>
  );
}

function showAdmin(me: Me): boolean {
  return me.orgPermissions.some((p) => /^(admin|config|integrations|audit)\./.test(p));
}

function TopNav({ me }: { me: Me }) {
  const { t } = useI18n();
  const pathname = usePathname() ?? '/';
  const items = [
    { href: '/', label: t('nav.portfolio'), active: pathname === '/' || pathname.startsWith('/projects') },
    { href: '/inbox', label: t('nav.inbox'), active: pathname.startsWith('/inbox') },
    // Counterparty (external partner) accounts: their granted partner rooms (JV & Diligence, partner-access projection).
    ...(me.projects.some((p) => p.permissions.includes('jv.disclosure.view')) ? [{ href: '/partner-access', label: t('nav.partnerAccess'), active: pathname.startsWith('/partner-access') }] : []),
    ...(showAdmin(me) ? [{ href: '/admin', label: t('nav.admin'), active: pathname.startsWith('/admin') }] : []),
  ];
  return (
    <nav aria-label={t('nav.primary')} className="order-last w-full sm:order-none sm:w-auto">
      <ul className="flex flex-wrap gap-1">
        {items.map((i) => (
          <li key={i.href}>
            <Link
              href={i.href}
              aria-current={i.active ? 'page' : undefined}
              className={cx(
                'inline-flex min-h-10 items-center rounded-md px-3 py-2 text-sm font-medium',
                i.active ? 'bg-primary-soft text-primary' : 'text-ink hover:bg-surface-muted',
              )}
            >
              {i.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Authenticated application frame. Loads `/me` once; a 401 sends the browser to /login (handled centrally in
 * the query client). Everything inside assumes a signed-in principal.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe();

  if (me.isLoading || (isApiError(me.error) && me.error.isUnauthenticated)) {
    return (
      <>
        <SkipLink />
        <main id="main-content" className="mx-auto max-w-7xl px-4">
          <LoadingState />
        </main>
      </>
    );
  }
  if (me.error || !me.data) {
    return (
      <main id="main-content" className="mx-auto max-w-7xl px-4">
        <ErrorState error={me.error} onRetry={() => me.refetch()} />
      </main>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <SkipLink />
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2">
          <Wordmark />
          <TopNav me={me.data} />
          <div className="ms-auto flex items-center gap-1">
            <LocaleSwitch authenticated />
            <UserMenu me={me.data} />
          </div>
        </div>
        {me.data.mode.demo ? <DemoModeBanner /> : null}
      </header>
      <div className="flex-1">{children}</div>
    </div>
  );
}

'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, KeyRound, LogIn } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { identityRoutes } from '@hub/contracts';
import { ROLE_KEYS } from '@hub/domain';
import { ApiErrorNotice } from '@/components/ApiErrorNotice';
import { SkipLink, Wordmark } from '@/components/AppShell';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { EXPLICIT_LOCALE_KEY, LocaleSwitch } from '@/components/LocaleSwitch';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { btn, card, cx } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import { LOCALE_COOKIE } from '@/i18n/config';
import { api, readCookie } from '@/lib/api';
import { qk } from '@/lib/queries';

/** Only same-site relative paths are accepted as a post-login destination (no open redirect). */
function safeNext(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\') || next.startsWith('/login')) return '/';
  return next;
}

function LoginContent() {
  const { t, tStatus, formatList } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const config = useQuery({ queryKey: qk.authConfig, queryFn: ({ signal }) => api(identityRoutes.authConfig, { signal }) });
  // A 401 here is the normal case (no session); the central 401 redirect is a no-op on /login.
  const me = useQuery({ queryKey: qk.me, queryFn: ({ signal }) => api(identityRoutes.me, { signal }), retry: false });
  const demoEnabled = config.data?.demoLogin === true;
  const users = useQuery({
    queryKey: qk.demoUsers,
    queryFn: ({ signal }) => api(identityRoutes.demoUsers, { signal }),
    enabled: demoEnabled,
  });

  const roleSummary = (summary: string) => {
    const parts = summary
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0 || (parts.length === 1 && parts[0] === 'no roles')) return t('auth.noRoles');
    return formatList(parts.map((p) => ((ROLE_KEYS as readonly string[]).includes(p) ? tStatus('roleKeys', p) : p)));
  };

  const signIn = async (userId: string) => {
    setBusyId(userId);
    setError(null);
    try {
      await api(identityRoutes.demoLogin, { body: { userId } });
      // The API restores the user's saved language on sign-in; keep a language chosen on this page instead.
      let explicit: string | null = null;
      try {
        explicit = sessionStorage.getItem(EXPLICIT_LOCALE_KEY);
        sessionStorage.removeItem(EXPLICIT_LOCALE_KEY);
      } catch {
        explicit = null;
      }
      if ((explicit === 'en' || explicit === 'ar') && readCookie(LOCALE_COOKIE) !== explicit) {
        await api(identityRoutes.setLocale, { body: { locale: explicit } }).catch(() => undefined);
      }
      queryClient.clear();
      // Full navigation so the root layout re-reads the locale cookie set for this user.
      window.location.assign(safeNext(params.get('next')));
    } catch (e) {
      setError(e);
      setBusyId(null);
    }
  };

  if (config.isLoading) return <LoadingState />;
  if (config.error) return <ErrorState error={config.error} onRetry={() => config.refetch()} />;
  const oidc = config.data?.oidc;

  return (
    <div className="space-y-6">
      <PageHeader title={t('auth.title')} description={t('auth.subtitle')} />

      {me.data ? (
        <div role="status" className={cx(card, 'flex flex-wrap items-center justify-between gap-3 p-4')} data-testid="already-signed-in">
          <p className="text-sm text-ink">
            {t('auth.signedInAs')} <strong dir="auto">{me.data.user.displayName}</strong>
          </p>
          <a href={safeNext(params.get('next'))} className={btn.primary}>
            {t('auth.continue')}
          </a>
        </div>
      ) : null}

      <section aria-labelledby="sso-title" className={cx(card, 'p-4')}>
        <h2 id="sso-title" className="flex items-center gap-2 text-lg font-semibold">
          <KeyRound aria-hidden="true" className="size-5 text-primary" />
          {t('auth.sso.title')}
        </h2>
        {oidc?.loginUrl ? (
          <a href={oidc.loginUrl} className={cx(btn.primary, 'mt-3')} data-testid="oidc-login">
            <LogIn aria-hidden="true" className="size-4 rtl:-scale-x-100" />
            {t('auth.sso.signIn')}
          </a>
        ) : (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink" data-testid="oidc-status">
            {t('auth.sso.statusLabel')}
            <StatusBadge enumName="integrationStatuses" value={oidc?.status ?? 'not_configured'} />
          </p>
        )}
        {!oidc?.loginUrl ? <p className="mt-2 text-xs text-muted">{t('auth.sso.notConfiguredHint')}</p> : null}
      </section>

      {demoEnabled ? (
        <section aria-labelledby="demo-title" className={cx(card, 'p-4')}>
          <h2 id="demo-title" className="flex items-center gap-2 text-lg font-semibold">
            <FlaskConical aria-hidden="true" className="size-5 text-demo" />
            {t('auth.demo.title')}
          </h2>
          <div className="mt-2 rounded-md border border-demo-line bg-demo-soft p-3 text-sm text-demo" data-testid="demo-notice">
            <p className="font-semibold">{t('common.demo.bannerTitle')}</p>
            <p>{t('auth.demo.notice')}</p>
            {users.data?.notice ? (
              <p className="mt-1 text-xs" dir="auto" lang="en">
                {users.data.notice}
              </p>
            ) : null}
          </div>
          <ApiErrorNotice error={error} className="mt-3" />
          {users.isLoading ? (
            <LoadingState compact />
          ) : users.error ? (
            <ErrorState error={users.error} onRetry={() => users.refetch()} />
          ) : (
            <ul className="mt-4 grid gap-3 sm:grid-cols-2" aria-label={t('auth.demo.personas')}>
              {(users.data?.items ?? []).map((u) => (
                <li key={u.id} className="flex flex-col gap-2 rounded-md border border-line p-3">
                  <div className="min-w-0">
                    <p className="font-medium text-ink" dir="auto">
                      {u.displayName}
                    </p>
                    {u.title ? (
                      <p className="text-xs text-muted" dir="auto">
                        {u.title}
                      </p>
                    ) : null}
                    <p className="mt-1 text-xs text-ink">
                      <span className="text-muted">{t('auth.demo.roles')}: </span>
                      {roleSummary(u.roleSummary)}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={cx(btn.secondary, 'mt-auto self-start')}
                    onClick={() => signIn(u.id)}
                    disabled={busyId !== null}
                    aria-busy={busyId === u.id}
                    data-testid="demo-login"
                    data-persona={u.displayName}
                  >
                    <LogIn aria-hidden="true" className="size-4 rtl:-scale-x-100" />
                    {busyId === u.id ? t('common.actions.working') : t('auth.demo.signInAs', { name: u.displayName })}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <p className="text-sm text-muted">{t('auth.demo.disabled')}</p>
      )}
    </div>
  );
}

export default function LoginPage() {
  const { t } = useI18n();
  return (
    <div className="min-h-screen">
      <SkipLink />
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl items-center gap-4 px-4 py-2">
          <Wordmark />
          <div className="ms-auto">
            <LocaleSwitch authenticated={false} />
          </div>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-3xl px-4 py-8 focus:outline-none">
        <Suspense fallback={<LoadingState />}>
          <LoginContent />
        </Suspense>
        <p className="mt-8 text-center text-xs text-muted">{t('auth.footer')}</p>
      </main>
    </div>
  );
}

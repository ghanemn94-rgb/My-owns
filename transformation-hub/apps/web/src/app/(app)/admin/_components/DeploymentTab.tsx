'use client';

import type { ReactNode } from 'react';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { RestrictedState } from '@/components/RestrictedState';
import { StatusBadge } from '@/components/StatusBadge';
import { card, cx } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import { isApiError } from '@/lib/api';
import { useDeploymentSettings } from '@/lib/config';

function Group({ title, children, testId }: { title: string; children: ReactNode; testId: string }) {
  return (
    <section className={cx(card, 'p-4')} data-testid={testId} aria-label={title}>
      <h3 className="mb-2 font-semibold">{title}</h3>
      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[minmax(0,16rem)_1fr]">{children}</dl>
    </section>
  );
}

function Row({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd data-testid={testId}>{children}</dd>
    </>
  );
}

/**
 * Administration → Deployment (REQ-UX-020): the configuration the platform is running with, shown honestly and without
 * secrets — whether each part is configured and the host names it talks to, never a credential. Changes are made by the
 * operators in the deployment configuration (environment), not on this screen.
 */
export function DeploymentTab({ allowed }: { allowed: boolean }) {
  const { t, tStatus, formatNumber } = useI18n();
  const q = useDeploymentSettings(allowed);
  if (!allowed) return <RestrictedState showHomeLink={false} />;
  if (q.isLoading) return <LoadingState />;
  if (q.error) return isApiError(q.error) && (q.error.isForbidden || q.error.isHidden) ? <RestrictedState showHomeLink={false} /> : <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const yes = (v: boolean, positive: 'configured' | 'enabled' = 'configured') =>
    v ? (
      <StatusBadge enumName="deploymentFlags" value={positive} tone="success" />
    ) : (
      <StatusBadge enumName="deploymentFlags" value={positive === 'configured' ? 'not_configured' : 'disabled'} tone="neutral" />
    );
  const host = (h: string | null) =>
    h ? (
      <span dir="ltr" className="font-mono text-xs">
        {h}
      </span>
    ) : (
      <StatusBadge enumName="deploymentFlags" value="not_configured" tone="neutral" />
    );
  return (
    <div className="space-y-4" data-testid="admin-deployment">
      <p className="text-sm text-muted">{t('config.admin.deployment.hint')}</p>
      <p className="rounded-md border border-info/40 bg-info-soft p-3 text-sm" data-testid="deployment-no-secrets">
        {t('config.admin.deployment.noSecrets')}
      </p>
      <Group title={t('config.admin.deployment.platform')} testId="deployment-platform">
        <Row label={t('config.admin.deployment.appName')}>
          {/* The configured value (HUB_APP_NAME), shown as configured — not a UI text. */}
          <span dir="auto" data-user-text>
            {d.appName}
          </span>
        </Row>
        <Row label={t('config.admin.deployment.mode')} testId="deployment-mode">
          <StatusBadge enumName="deploymentModes" value={d.mode} tone={d.mode === 'demo' ? 'warning' : 'info'} />
        </Row>
        <Row label={t('config.admin.deployment.environment')}>
          <span dir="ltr">{d.nodeEnv}</span>
        </Row>
        <Row label={t('config.admin.deployment.privateMode')}>{yes(d.privateMode, 'enabled')}</Row>
        <Row label={t('config.admin.deployment.egress')}>
          {d.egressAllowlist.length ? (
            <span dir="ltr" className="font-mono text-xs">
              {d.egressAllowlist.join(', ')}
            </span>
          ) : (
            t('config.admin.deployment.egressNone')
          )}
        </Row>
      </Group>
      <Group title={t('config.admin.deployment.identity')} testId="deployment-identity">
        <Row label={t('config.admin.deployment.oidc')}>{yes(d.identity.oidcConfigured)}</Row>
        <Row label={t('config.admin.deployment.oidcIssuer')}>{host(d.identity.oidcIssuerHost)}</Row>
        <Row label={t('config.admin.deployment.linkByEmail')}>{yes(d.identity.linkByEmail, 'enabled')}</Row>
        <Row label={t('config.admin.deployment.demoLogin')}>{yes(d.identity.demoLogin, 'enabled')}</Row>
        <Row label={t('config.admin.deployment.cookieSecure')}>{yes(d.identity.cookieSecure, 'enabled')}</Row>
        <Row label={t('config.admin.deployment.sessions')}>
          <span className="tabular">{t('config.admin.deployment.sessionsValue', { idle: formatNumber(d.identity.sessionIdleMinutes), absolute: formatNumber(d.identity.sessionAbsoluteHours) })}</span>
        </Row>
      </Group>
      <Group title={t('config.admin.deployment.storage')} testId="deployment-storage">
        <Row label={t('config.admin.deployment.driver')}>{tStatus('storageDrivers', d.storage.driver)}</Row>
        {d.storage.s3 ? (
          <>
            <Row label={t('config.admin.deployment.s3Endpoint')}>{host(d.storage.s3.endpointHost || null)}</Row>
            <Row label={t('config.admin.deployment.s3Bucket')}>
              <span dir="ltr" className="font-mono text-xs">
                {d.storage.s3.bucket}
              </span>
            </Row>
            <Row label={t('config.admin.deployment.s3Encryption')}>
              <span dir="ltr">{d.storage.s3.sse}</span>
              {d.storage.s3.kmsKeyConfigured ? <span className="ms-2 text-xs text-muted">{t('config.admin.deployment.kmsConfigured')}</span> : null}
            </Row>
          </>
        ) : null}
        <Row label={t('config.admin.deployment.maxUpload')}>
          <span className="tabular">{t('config.admin.deployment.megabytes', { value: formatNumber(d.storage.maxUploadMb) })}</span>
        </Row>
        <Row label={t('config.admin.deployment.unscanned')}>{yes(d.storage.allowUnscannedFiles, 'enabled')}</Row>
      </Group>
      <Group title={t('config.admin.deployment.ai')} testId="deployment-ai">
        <Row label={t('config.admin.deployment.mock')}>{yes(d.ai.mockProviderAllowed, 'enabled')}</Row>
        <Row label={t('config.admin.deployment.openAi')}>{host(d.ai.openAiCompatibleEndpointHost)}</Row>
        <Row label={t('config.admin.deployment.anthropic')}>{host(d.ai.anthropicGatewayHost)}</Row>
      </Group>
      <Group title={t('config.admin.deployment.rateLimits')} testId="deployment-rate-limits">
        <Row label={t('config.admin.deployment.perMinute')}>
          <span className="tabular">{formatNumber(d.rateLimits.perMinute)}</span>
        </Row>
        <Row label={t('config.admin.deployment.mutationsPerMinute')}>
          <span className="tabular">{formatNumber(d.rateLimits.mutationsPerMinute)}</span>
        </Row>
        <Row label={t('config.admin.deployment.publicPerMinute')}>
          <span className="tabular">{formatNumber(d.rateLimits.publicPerMinute)}</span>
        </Row>
      </Group>
      <section className={cx(card, 'p-4')} data-testid="deployment-warnings" aria-labelledby="deployment-warnings-title">
        <h3 id="deployment-warnings-title" className="mb-2 font-semibold">
          {t('config.admin.deployment.warnings')}
        </h3>
        {d.warnings.length ? (
          <ul className="list-disc space-y-1 ps-5 text-sm">
            {d.warnings.map((w) => (
              <li key={w} dir="ltr" data-user-text>
                {w}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">{t('config.admin.deployment.noWarnings')}</p>
        )}
        <p className="mt-2 text-xs text-muted">{t('config.admin.deployment.warningsHint')}</p>
      </section>
    </div>
  );
}

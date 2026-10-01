'use client';

import type { ReactNode } from 'react';
import { StatusBadge } from '../StatusBadge';
import { card, cx } from '../ui';
import { useI18n, type MessageKey } from '@/i18n/provider';
import { integrationTone, type IntegrationAdapter } from '@/lib/integrations';

/**
 * The connector registry with its HONEST status (REQ-INT-013/014, REQ-UX-020): Not configured / Configured — not verified /
 * Verified (only after a real check) / Failed / Disabled; read-only connectors are labelled apart from write/send ones
 * (REQ-INT-007); documented-only systems show what is missing (REQ-INT-008); every unavailable connector names its
 * practical manual alternative.
 */
export function IntegrationList({ items, actions }: { items: IntegrationAdapter[]; actions?: (a: IntegrationAdapter) => ReactNode }) {
  const { t, tStatus, formatDateTime, formatNumber } = useI18n();
  const groups: { key: string; title: MessageKey; items: IntegrationAdapter[] }[] = [
    { key: 'read', title: 'integrations.groups.read', items: items.filter((a) => a.availability === 'configurable' && a.direction === 'read') },
    { key: 'send', title: 'integrations.groups.send', items: items.filter((a) => a.availability === 'configurable' && a.direction !== 'read') },
    { key: 'future', title: 'integrations.groups.future', items: items.filter((a) => a.availability === 'documented_only') },
  ];
  return (
    <div className="space-y-6" data-testid="integration-list">
      {groups.map((g) =>
        g.items.length ? (
          <section key={g.key} aria-labelledby={`int-${g.key}`} className="space-y-3">
            <h2 id={`int-${g.key}`} className="text-lg font-semibold">
              {t(g.title)}
            </h2>
            <p className="text-sm text-muted">{t(`integrations.groups.${g.key}Hint` as MessageKey)}</p>
            <ul className="grid gap-3 md:grid-cols-2">
              {g.items.map((a) => {
                const unavailable = a.status !== 'verified' || !a.enabled;
                return (
                  <li key={a.key} className={cx(card, 'flex flex-col gap-2 p-4')} data-testid="integration" data-key={a.key} data-status={a.status}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="font-semibold text-ink">{t(`integrations.adapters.${a.key}.name` as MessageKey)}</h3>
                        <p className="text-xs text-muted">
                          {tStatus('integrationKinds', a.kind)} · {tStatus('integrationDirections', a.direction)}
                        </p>
                      </div>
                      <StatusBadge enumName="integrationStatuses" value={a.status} tone={integrationTone(a.status)} />
                    </div>
                    <p className="text-sm">{t(`integrations.adapters.${a.key}.purpose` as MessageKey)}</p>
                    {a.scopes.length ? (
                      <p className="text-xs text-muted">
                        {t('integrations.scopes')}{' '}
                        {a.scopes.map((s) => (
                          <code key={s} dir="ltr" className="me-1 rounded bg-surface-muted px-1">
                            {s}
                          </code>
                        ))}
                      </p>
                    ) : null}
                    {a.availability === 'documented_only' ? (
                      <p className="text-xs text-muted">{t('integrations.missing', { items: a.prerequisites.map((p) => t(`integrations.prerequisites.${p}` as MessageKey)).join(' · ') })}</p>
                    ) : null}
                    {a.endpointHost ? (
                      <p className="text-xs text-muted">
                        {t('integrations.endpoint')} <code dir="ltr">{a.endpointHost}</code>
                      </p>
                    ) : null}
                    {a.lastCheckedAt ? (
                      <p className="text-xs text-muted">
                        {t('integrations.lastCheck', { when: formatDateTime(a.lastCheckedAt), result: t(`integrations.checkCodes.${(a.lastCheckCode ?? 'unknown').replace(/\./g, '_')}` as MessageKey) })}
                      </p>
                    ) : null}
                    {a.failures24h ? <p className="text-xs font-medium text-danger">{t('integrations.failures', { count: a.failures24h, n: formatNumber(a.failures24h) })}</p> : null}
                    {unavailable ? (
                      <p className="rounded-md border border-info/30 bg-info-soft p-2 text-xs text-ink" data-testid="manual-alternative">
                        {t('integrations.manualPrefix')} {t(`integrations.manual.${a.manualAlternative}` as MessageKey)}
                      </p>
                    ) : null}
                    {actions ? <div className="mt-1 flex flex-wrap gap-2">{actions(a)}</div> : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null,
      )}
    </div>
  );
}

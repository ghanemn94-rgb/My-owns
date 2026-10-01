'use client';

import { useEffect, useState } from 'react';
import { integrationsRoutes } from '@hub/contracts';
import { ConfirmCommandDialog } from '../ConfirmCommandDialog';
import { ErrorState } from '../ErrorState';
import { LoadingState } from '../LoadingState';
import { StatusBadge } from '../StatusBadge';
import { useToast } from '../Toast';
import { FormDialog } from '../planning/dialogs';
import { btn, card, cx, hint, input, label as labelCls } from '../ui';
import { useI18n, type MessageKey } from '@/i18n/provider';
import { api } from '@/lib/api';
import { useIntegrationDeliveries, useIntegrationLogs, useIntegrationsRefresh, useOrgIntegrations, type IntegrationAdapter } from '@/lib/integrations';
import { IntegrationList } from './IntegrationList';

/**
 * Organisation administration of connectors (platform administrators): configure (endpoint passing the SSRF guard, secret
 * REFERENCE only, declared scopes), run the connectivity check, enable a verified connector, disable one, and read its
 * execution log and inbound deliveries. Nothing here can mark a connector "Verified" except a real check.
 */
export function IntegrationsAdmin({ canManage, canDisable }: { canManage: boolean; canDisable: boolean }) {
  const { t } = useI18n();
  const q = useOrgIntegrations(true);
  const refresh = useIntegrationsRefresh();
  const toast = useToast();
  const [configure, setConfigure] = useState<IntegrationAdapter | null>(null);
  const [cmd, setCmd] = useState<{ a: IntegrationAdapter; kind: 'test' | 'enable' | 'disable' } | null>(null);
  const [logs, setLogs] = useState<IntegrationAdapter | null>(null);
  if (q.isLoading) return <LoadingState />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <div className="space-y-4" data-testid="integrations-admin">
      <p className="text-sm text-muted">{t('integrations.admin.hint')}</p>
      <p className="text-xs text-muted">
        {t('integrations.admin.allowlist')}{' '}
        {q.data.egressAllowlist.length ? (
          q.data.egressAllowlist.map((h) => (
            <code key={h} dir="ltr" className="me-1 rounded bg-surface-muted px-1">
              {h}
            </code>
          ))
        ) : (
          <span>{t('integrations.admin.allowlistEmpty')}</span>
        )}
      </p>
      <IntegrationList
        items={q.data.items}
        actions={(a) =>
          a.availability === 'documented_only' ? null : (
            <>
              {canManage ? (
                <button type="button" className={btn.secondary} onClick={() => setConfigure(a)} data-testid={`configure-${a.key}`}>
                  {t('integrations.admin.configure')}
                </button>
              ) : null}
              {canManage && a.status !== 'not_configured' && a.check === 'outbound_endpoint' ? (
                <button type="button" className={btn.secondary} onClick={() => setCmd({ a, kind: 'test' })} data-testid={`test-${a.key}`}>
                  {t('integrations.admin.test')}
                </button>
              ) : null}
              {canManage && a.status === 'verified' && !a.enabled ? (
                <button type="button" className={btn.secondary} onClick={() => setCmd({ a, kind: 'enable' })}>
                  {t('integrations.admin.enable')}
                </button>
              ) : null}
              {canDisable && a.status !== 'not_configured' && a.status !== 'disabled' ? (
                <button type="button" className={btn.ghost} onClick={() => setCmd({ a, kind: 'disable' })}>
                  {t('integrations.admin.disable')}
                </button>
              ) : null}
              <button type="button" className={btn.ghost} onClick={() => setLogs(a)} data-testid={`logs-${a.key}`}>
                {t('integrations.admin.logs')}
              </button>
            </>
          )
        }
      />
      {configure ? <ConfigureDialog a={configure} onClose={() => setConfigure(null)} /> : null}
      {cmd ? (
        <ConfirmCommandDialog
          open
          onClose={() => setCmd(null)}
          title={t(`integrations.admin.${cmd.kind}Title` as MessageKey, { name: t(`integrations.adapters.${cmd.a.key}.name` as MessageKey) })}
          consequences={[t(`integrations.admin.${cmd.kind}C1` as MessageKey)]}
          confirmLabel={t(`integrations.admin.${cmd.kind}` as MessageKey)}
          noteMode={cmd.kind === 'disable' ? 'required' : 'none'}
          noteLabel={t('integrations.admin.reason')}
          expectedVersion={cmd.a.version}
          danger={cmd.kind === 'disable'}
          onConfirm={async ({ note }) => {
            const params = { adapterKey: cmd.a.key };
            if (cmd.kind === 'test') await api(integrationsRoutes.testIntegration, { params, body: { expectedVersion: cmd.a.version } });
            else if (cmd.kind === 'enable') await api(integrationsRoutes.enableIntegration, { params, body: { expectedVersion: cmd.a.version } });
            else await api(integrationsRoutes.disableIntegration, { params, body: { expectedVersion: cmd.a.version, reason: note } });
            await refresh();
            toast.show('success', t('integrations.admin.done'));
            setCmd(null);
          }}
        />
      ) : null}
      {logs ? <LogsPanel a={logs} onClose={() => setLogs(null)} /> : null}
    </div>
  );
}

function ConfigureDialog({ a, onClose }: { a: IntegrationAdapter; onClose: () => void }) {
  const { t } = useI18n();
  const refresh = useIntegrationsRefresh();
  const toast = useToast();
  const [endpointUrl, setEndpoint] = useState('');
  const [secretRef, setSecret] = useState('');
  const [scopes, setScopes] = useState<string[]>(a.scopes);
  useEffect(() => setScopes(a.scopes), [a]);
  return (
    <FormDialog
      open
      onClose={onClose}
      title={t('integrations.admin.configureTitle', { name: t(`integrations.adapters.${a.key}.name` as MessageKey) })}
      submitLabel={t('integrations.admin.save')}
      testId="configure-integration"
      onSubmit={async () => {
        await api(integrationsRoutes.configureIntegration, {
          params: { adapterKey: a.key },
          body: { ...(a.version ? { expectedVersion: a.version } : {}), ...(endpointUrl.trim() ? { endpointUrl: endpointUrl.trim() } : {}), ...(secretRef.trim() ? { secretRef: secretRef.trim() } : {}), scopes },
        });
        await refresh();
        toast.show('success', t('integrations.admin.saved'));
        onClose();
      }}
    >
      <p className="text-sm text-muted">{t('integrations.admin.configureHint')}</p>
      {a.check === 'outbound_endpoint' ? (
        <div>
          <label className={labelCls} htmlFor="int-endpoint">
            {t('integrations.admin.endpoint')}
          </label>
          <input id="int-endpoint" className={cx(input, 'mt-1')} dir="ltr" value={endpointUrl} onChange={(e) => setEndpoint(e.target.value)} data-testid="int-endpoint" />
          <p className={hint}>{t('integrations.admin.endpointHint')}</p>
        </div>
      ) : null}
      <div>
        <label className={labelCls} htmlFor="int-secret">
          {t('integrations.admin.secretRef')}
        </label>
        <input id="int-secret" className={cx(input, 'mt-1')} dir="ltr" value={secretRef} onChange={(e) => setSecret(e.target.value)} data-testid="int-secret" />
        <p className={hint}>{t('integrations.admin.secretRefHint')}</p>
      </div>
      {a.scopes.length ? (
        <fieldset>
          <legend className={labelCls}>{t('integrations.scopes')}</legend>
          {a.scopes.map((s) => (
            <label key={s} className="mt-1 flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" checked={scopes.includes(s)} onChange={(e) => setScopes((cur) => (e.target.checked ? [...cur, s] : cur.filter((x) => x !== s)))} />
              <code dir="ltr">{s}</code>
            </label>
          ))}
        </fieldset>
      ) : null}
    </FormDialog>
  );
}

function LogsPanel({ a, onClose }: { a: IntegrationAdapter; onClose: () => void }) {
  const { t, formatDateTime } = useI18n();
  const logs = useIntegrationLogs(a.key, { page: 1, pageSize: 25 }, true);
  const deliveries = useIntegrationDeliveries(a.key, { page: 1, pageSize: 25 }, a.check === 'inbound_ping');
  return (
    <section className={cx(card, 'space-y-3 p-4')} aria-labelledby="int-logs" data-testid="integration-logs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="int-logs" className="text-lg font-semibold">
          {t('integrations.admin.logsTitle', { name: t(`integrations.adapters.${a.key}.name` as MessageKey) })}
        </h2>
        <button type="button" className={btn.ghost} onClick={onClose}>
          {t('common.actions.close')}
        </button>
      </div>
      {logs.data?.items.length ? (
        <ul className="divide-y divide-line text-sm">
          {logs.data.items.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-2 py-1.5">
              <span className="text-xs whitespace-nowrap text-muted">{formatDateTime(l.createdAt)}</span>
              <span>{t(`integrations.operations.${l.operation}` as MessageKey)}</span>
              <StatusBadge enumName="integrationOutcomes" value={l.outcome} tone={l.outcome === 'success' ? 'success' : l.outcome === 'failed' ? 'danger' : 'warning'} />
              {l.code ? (
                <code className="text-xs" dir="ltr">
                  {l.code}
                </code>
              ) : null}
              {l.actorName ? <span className="text-xs text-muted">{l.actorName}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">{t('integrations.admin.noLogs')}</p>
      )}
      {a.check === 'inbound_ping' ? (
        <>
          <h3 className="font-semibold">{t('integrations.admin.deliveries')}</h3>
          {deliveries.data?.items.length ? (
            <ul className="divide-y divide-line text-sm">
              {deliveries.data.items.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2 py-1.5">
                  <span className="text-xs whitespace-nowrap text-muted">{formatDateTime(d.receivedAt)}</span>
                  <code className="text-xs" dir="ltr">
                    {d.deliveryId}
                  </code>
                  <code className="text-xs" dir="ltr">
                    {d.eventType}
                  </code>
                  <StatusBadge enumName="webhookDeliveryStatuses" value={d.status} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">{t('integrations.admin.noDeliveries')}</p>
          )}
        </>
      ) : null}
    </section>
  );
}

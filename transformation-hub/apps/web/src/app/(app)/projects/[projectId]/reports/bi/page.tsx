'use client';

import { DatabaseZap, Unplug } from 'lucide-react';
import { useEffect, useState } from 'react';
import { reportingRoutes } from '@hub/contracts';
import { clearanceAllows, type Classification } from '@hub/domain';
import { ConfirmCommandDialog } from '@/components/ConfirmCommandDialog';
import { DataTable, type Column } from '@/components/DataTable';
import { SelectField, TextAreaField } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { RestrictedState } from '@/components/RestrictedState';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { FormDialog } from '@/components/planning/dialogs';
import { btn } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { useProjectContext } from '@/lib/project-context';
import { useBiAccess, useReportsRefresh, type BiGrant } from '@/lib/reports';
import { Facts, Panel } from '../_components/rp';

const GRANTABLE = ['internal', 'confidential', 'restricted'] as const;

/**
 * BI exposure of the project (REQ-RPT-011): the sponsor lists the project for the read-only `bi` views read by the
 * restricted BI database role, up to a classification. The platform does not see the BI tool, so the connection is always
 * shown as "Not verified" — never as connected.
 */
export default function BiAccessPage() {
  const { t, formatDateTime } = useI18n();
  const { can } = useProjectContext();
  const bi = useBiAccess();
  const [grantOpen, setGrantOpen] = useState(false);
  const [revoking, setRevoking] = useState<BiGrant | null>(null);
  if (!can('admin.clearance.grant')) return <RestrictedState showHomeLink={false} />;
  const data = bi.data;
  const active = data?.grants.find((g) => g.active) ?? null;
  const columns: Column<BiGrant>[] = [
    { key: 'classification', header: t('reports.bi.columns.classification'), cell: (g) => <StatusBadge enumName="classifications" value={g.maxClassification} tone="neutral" /> },
    { key: 'reason', header: t('reports.bi.columns.reason'), cell: (g) => <span dir="auto" className="whitespace-pre-wrap">{g.reason}</span> },
    { key: 'grantedBy', header: t('reports.bi.columns.grantedBy'), cell: (g) => <span dir="auto">{g.grantedByName ?? g.grantedBy.slice(-6)}</span> },
    { key: 'grantedAt', header: t('reports.bi.columns.grantedAt'), cell: (g) => <span className="whitespace-nowrap">{formatDateTime(g.createdAt)}</span> },
    {
      key: 'state',
      header: t('reports.bi.columns.state'),
      cell: (g) =>
        g.active ? (
          <span className="text-sm font-medium text-success" data-testid="bi-grant-state" data-active="true">
            {t('reports.bi.active')}
          </span>
        ) : (
          <span className="flex flex-col gap-0.5" data-testid="bi-grant-state" data-active="false">
            <span className="text-sm text-muted">{t('reports.bi.revokedState', { date: formatDateTime(g.revokedAt) })}</span>
            {g.revokeReason ? (
              <span dir="auto" className="text-xs text-muted">
                {g.revokeReason}
              </span>
            ) : null}
          </span>
        ),
    },
    {
      key: 'action',
      header: t('reports.bi.columns.action'),
      cell: (g) =>
        g.active ? (
          <button type="button" className={btn.secondary} onClick={() => setRevoking(g)} aria-label={t('reports.bi.revokeFor', { date: formatDateTime(g.createdAt) })} data-testid="bi-revoke">
            {t('reports.bi.revoke')}
          </button>
        ) : null,
    },
  ];
  return (
    <>
      <PageHeader
        title={t('reports.bi.title')}
        description={t('reports.bi.subtitle')}
        actions={
          data && !active ? (
            <button type="button" className={btn.primary} onClick={() => setGrantOpen(true)} data-testid="bi-grant-open">
              <DatabaseZap aria-hidden="true" className="size-4" />
              {t('reports.bi.grant')}
            </button>
          ) : null
        }
      />
      <div className="space-y-4">
        {data ? (
          <Panel title={t('reports.bi.exposure')} testId="bi-status">
            <Facts
              items={[
                {
                  label: t('reports.bi.exposure'),
                  value: data.projectIsDemo ? t('reports.bi.demo') : data.exposed ? t('reports.bi.exposed') : t('reports.bi.notExposed'),
                  testId: 'bi-exposure',
                },
                {
                  label: t('reports.bi.connection'),
                  value: (
                    <span className="inline-flex items-start gap-1.5" data-testid="bi-connection" data-connection={data.connection}>
                      <Unplug aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted" />
                      {t('reports.bi.connectionNotVerified')}
                    </span>
                  ),
                },
                {
                  label: t('reports.bi.views'),
                  wide: true,
                  value: (
                    <ul className="flex flex-wrap gap-1.5">
                      {data.views.map((v) => (
                        <li key={v}>
                          <code dir="ltr" className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-xs">
                            {v}
                          </code>
                        </li>
                      ))}
                    </ul>
                  ),
                },
              ]}
            />
            <p className="mt-3 text-xs text-muted">{t('reports.bi.docs')}</p>
          </Panel>
        ) : null}
        <section aria-labelledby="bi-history-title" className="space-y-2">
          <h2 id="bi-history-title" className="text-lg font-semibold text-ink">
            {t('reports.bi.history')}
          </h2>
          <DataTable caption={t('reports.bi.caption')} columns={columns} rows={data?.grants} rowKey={(g) => g.id} isLoading={bi.isLoading} error={bi.error} onRetry={() => bi.refetch()} emptyTitle={t('reports.bi.empty')} testId="bi-grants" />
        </section>
      </div>
      <GrantDialog open={grantOpen} onClose={() => setGrantOpen(false)} />
      {revoking ? <RevokeDialog grant={revoking} onClose={() => setRevoking(null)} /> : null}
    </>
  );
}

function GrantDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, tStatus } = useI18n();
  const { projectId, me } = useProjectContext();
  const toast = useToast();
  const refresh = useReportsRefresh();
  const options = GRANTABLE.filter((c) => clearanceAllows(me.user.clearance as Classification, c));
  const [max, setMax] = useState<(typeof GRANTABLE)[number]>('internal');
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) {
      setMax('internal');
      setReason('');
    }
  }, [open]);
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={t('reports.bi.grantTitle')}
      submitLabel={t('reports.bi.grantSubmit')}
      disabled={reason.trim().length < 3}
      testId="bi-grant"
      onSubmit={async () => {
        await api(reportingRoutes.grantBiAccess, { params: { projectId }, body: { maxClassification: max, reason: reason.trim() } });
        await refresh();
        toast.show('success', t('reports.bi.granted'));
        onClose();
      }}
    >
      <p className="text-sm text-muted">{t('reports.bi.grantDescription')}</p>
      <SelectField label={t('reports.bi.maxClassification')} required value={max} onChange={(e) => setMax(e.target.value as (typeof GRANTABLE)[number])} data-testid="bi-classification">
        {options.map((c) => (
          <option key={c} value={c}>
            {tStatus('classifications', c)}
          </option>
        ))}
      </SelectField>
      <TextAreaField label={t('reports.bi.reason')} required value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} data-testid="bi-reason" />
    </FormDialog>
  );
}

function RevokeDialog({ grant, onClose }: { grant: BiGrant; onClose: () => void }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const toast = useToast();
  const refresh = useReportsRefresh();
  return (
    <ConfirmCommandDialog
      open
      onClose={onClose}
      title={t('reports.bi.revokeTitle')}
      consequences={[t('reports.bi.revokeDescription')]}
      confirmLabel={t('reports.bi.revokeSubmit')}
      noteMode="required"
      noteLabel={t('reports.bi.reason')}
      expectedVersion={grant.version}
      danger
      onReload={() => void refresh()}
      onConfirm={async ({ note }) => {
        await api(reportingRoutes.revokeBiAccess, { params: { projectId, grantId: grant.id }, body: { expectedVersion: grant.version, reason: note } });
        await refresh();
        toast.show('success', t('reports.bi.revoked'));
        onClose();
      }}
    />
  );
}

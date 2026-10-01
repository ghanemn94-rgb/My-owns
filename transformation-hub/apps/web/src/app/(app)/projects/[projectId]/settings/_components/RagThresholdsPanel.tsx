'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';
import { configRoutes as C } from '@hub/contracts';
import { ConfirmCommandDialog } from '@/components/ConfirmCommandDialog';
import { DataTable, type Column } from '@/components/DataTable';
import { ErrorState } from '@/components/ErrorState';
import { TextField } from '@/components/Field';
import { LoadingState } from '@/components/LoadingState';
import { RestrictedState } from '@/components/RestrictedState';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn, card, cx } from '@/components/ui';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api, isApiError } from '@/lib/api';
import { useRagThresholds, useRefreshConfig, type RagThresholds, type RagVersion } from '@/lib/config';
import { useServerMessages } from '@/lib/i18n-data';
import { useProjectContext } from '@/lib/project-context';

type Values = RagThresholds['inForce']['thresholds'];

const STATE_TONE: Record<RagVersion['state'], 'success' | 'warning' | 'neutral' | 'danger' | 'info'> = {
  pending: 'warning',
  approved: 'success',
  superseded: 'neutral',
  rejected: 'danger',
  withdrawn: 'neutral',
};

function ValuesText({ v }: { v: Values }) {
  const { t, formatNumber } = useI18n();
  return (
    <span className="tabular">
      {t('config.rag.valuesShort', { green: formatNumber(v.greenMaxSlipDays), amber: formatNumber(v.amberMaxSlipDays), stale: formatNumber(v.staleAfterDays) })}
    </span>
  );
}

function RefText({ refInfo }: { refInfo: RagThresholds['inForce']['ref'] }) {
  const { t, formatNumber } = useI18n();
  return refInfo.source === 'approved' && refInfo.versionNo !== null ? (
    <>{t('config.rag.source.approved', { version: formatNumber(refInfo.versionNo) })}</>
  ) : (
    <>{t('config.rag.source.templateDefault', { templateVersion: formatNumber(refInfo.templateVersionNo) })}</>
  );
}

/** Three numbers + a reason; the server validates the order and the bounds again (422 with a translated refusal). */
function ProposeDialog({ open, onClose, current }: { open: boolean; onClose: () => void; current: Values }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useRefreshConfig(projectId);
  const toast = useToast();
  const [green, setGreen] = useState(String(current.greenMaxSlipDays));
  const [amber, setAmber] = useState(String(current.amberMaxSlipDays));
  const [stale, setStale] = useState(String(current.staleAfterDays));
  const n = (s: string) => (/^\d{1,3}$/.test(s.trim()) ? Number(s.trim()) : null);
  const g = n(green), a = n(amber), s = n(stale);
  const orderError = g !== null && a !== null && a < g ? t('config.rag.form.amberBelowGreen') : null;
  const incomplete = g === null || a === null || s === null || !!orderError;
  return (
    <ConfirmCommandDialog
      open={open}
      onClose={onClose}
      title={t('config.rag.propose')}
      confirmLabel={t('config.rag.propose')}
      noteMode="required"
      noteLabel={t('config.rag.form.reason')}
      confirmDisabled={incomplete}
      consequences={[t('config.rag.form.effectPending'), t('config.rag.form.effectApprover'), t('common.command.audited')]}
      onConfirm={async ({ note }) => {
        const r = await api(C.proposeRagThresholds, { params: { projectId }, body: { greenMaxSlipDays: g!, amberMaxSlipDays: a!, staleAfterDays: s!, reason: note } });
        await refresh();
        toast.show('success', t('config.rag.proposed', { version: r.versionNo }));
        onClose();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField label={t('config.rag.fields.green')} hint={t('config.rag.fields.greenHint')} inputMode="numeric" value={green} onChange={(e) => setGreen(e.target.value)} required data-testid="rag-green" error={green && g === null ? t('config.rag.form.wholeNumber') : null} />
        <TextField label={t('config.rag.fields.amber')} hint={t('config.rag.fields.amberHint')} inputMode="numeric" value={amber} onChange={(e) => setAmber(e.target.value)} required data-testid="rag-amber" error={orderError ?? (amber && a === null ? t('config.rag.form.wholeNumber') : null)} />
        <TextField label={t('config.rag.fields.stale')} hint={t('config.rag.fields.staleHint')} inputMode="numeric" value={stale} onChange={(e) => setStale(e.target.value)} required data-testid="rag-stale" error={stale && s === null ? t('config.rag.form.wholeNumber') : null} />
      </div>
    </ConfirmCommandDialog>
  );
}

function PendingBox({ v }: { v: RagVersion }) {
  const { t, formatDateTime } = useI18n();
  const { projectId, can, me } = useProjectContext();
  const refresh = useRefreshConfig(projectId);
  const toast = useToast();
  const [dialog, setDialog] = useState<'approve' | 'reject' | 'withdraw' | null>(null);
  const mine = v.proposedBy === me.user.id;
  const canDecide = can('config.project_settings.approve') && !mine;
  return (
    <div className="space-y-2 rounded-md border border-warning/40 bg-warning-soft p-3" data-testid="rag-pending" data-version={v.versionNo}>
      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
        {t('config.rag.pendingTitle', { version: v.versionNo })}
        <StatusBadge enumName="ragThresholdStates" value={v.state} tone="warning" />
      </p>
      <p className="text-sm">
        {t('config.rag.fromTo')} <ValuesText v={v.basedOn.thresholds} /> → <ValuesText v={v.thresholds} />
      </p>
      <p className="text-sm">
        <span className="text-muted">{t('config.rag.reason')}: </span>
        <span dir="auto" data-user-text>
          {v.reason}
        </span>
      </p>
      <p className="text-xs text-muted">{t('config.rag.proposedBy', { name: v.proposedByName ?? EM_DASH, date: formatDateTime(v.proposedAt) })}</p>
      <p className="text-xs text-ink">{mine ? t('config.rag.ownProposal') : canDecide ? t('config.rag.youDecide') : t('config.rag.awaiting')}</p>
      <div className="flex flex-wrap gap-2">
        {canDecide ? (
          <>
            <button type="button" className={btn.primary} onClick={() => setDialog('approve')} data-testid="rag-approve">
              {t('config.rag.approve')}
            </button>
            <button type="button" className={btn.secondary} onClick={() => setDialog('reject')} data-testid="rag-reject">
              {t('config.rag.reject')}
            </button>
          </>
        ) : null}
        {mine && can('config.project_settings.manage') ? (
          <button type="button" className={btn.secondary} onClick={() => setDialog('withdraw')} data-testid="rag-withdraw">
            {t('config.rag.withdraw')}
          </button>
        ) : null}
      </div>
      <ConfirmCommandDialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={dialog === 'approve' ? t('config.rag.approve') : dialog === 'reject' ? t('config.rag.reject') : t('config.rag.withdraw')}
        confirmLabel={dialog === 'approve' ? t('config.rag.approve') : dialog === 'reject' ? t('config.rag.reject') : t('config.rag.withdraw')}
        noteMode={dialog === 'reject' ? 'required' : 'optional'}
        expectedVersion={v.version}
        danger={dialog === 'reject'}
        consequences={
          dialog === 'approve'
            ? [t('config.rag.approveEffect', { version: v.versionNo }), t('config.rag.approveEffectHistory'), t('common.command.audited')]
            : dialog === 'reject'
              ? [t('config.rag.rejectEffect'), t('common.command.audited')]
              : [t('config.rag.withdrawEffect'), t('common.command.audited')]
        }
        onConfirm={async ({ note }) => {
          const params = { projectId, requestId: v.id };
          if (dialog === 'approve') await api(C.approveRagThresholds, { params, body: { expectedVersion: v.version, ...(note ? { note } : {}) } });
          else if (dialog === 'reject') await api(C.rejectRagThresholds, { params, body: { expectedVersion: v.version, reason: note } });
          else await api(C.withdrawRagThresholds, { params, body: { expectedVersion: v.version, ...(note ? { note } : {}) } });
          await refresh();
          toast.show('success', dialog === 'approve' ? t('config.rag.approved', { version: v.versionNo }) : dialog === 'reject' ? t('config.rag.rejected') : t('config.rag.withdrawn'));
          setDialog(null);
        }}
      />
    </div>
  );
}

/**
 * RAG thresholds of the project (spec §9 measurement rule 4, REQ-PLN-019): the thresholds in force (the approved project
 * version, else the template's proposed default), the rule of each status under them, a pending change with its decision
 * (another person approves — never the proposer) and the version history. Every calculated RAG names the version used.
 */
export function RagThresholdsPanel() {
  const { t, formatDateTime } = useI18n();
  const msg = useServerMessages();
  const { projectId, can } = useProjectContext();
  const q = useRagThresholds(projectId);
  const [proposing, setProposing] = useState(false);
  if (q.isLoading) return <LoadingState />;
  if (q.error) return isApiError(q.error) && (q.error.isHidden || q.error.isForbidden) ? <RestrictedState showHomeLink={false} /> : <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const pending = d.versions.find((v) => v.state === 'pending') ?? null;
  const columns: Column<RagVersion>[] = [
    { key: 'version', header: t('config.rag.columns.version'), isRowHeader: true, cell: (v) => <span className="tabular">{v.versionNo}</span> },
    { key: 'state', header: t('config.rag.columns.state'), cell: (v) => <StatusBadge enumName="ragThresholdStates" value={v.state} tone={STATE_TONE[v.state]} /> },
    { key: 'values', header: t('config.rag.columns.values'), cell: (v) => <ValuesText v={v.thresholds} /> },
    { key: 'reason', header: t('config.rag.columns.reason'), cell: (v) => <span dir="auto" data-user-text>{v.reason}</span> },
    { key: 'proposed', header: t('config.rag.columns.proposed'), cell: (v) => <span className="text-xs">{v.proposedByName ?? EM_DASH} · <span className="tabular">{formatDateTime(v.proposedAt)}</span></span> },
    {
      key: 'decided',
      header: t('config.rag.columns.decided'),
      cell: (v) =>
        v.decidedAt ? (
          <span className="text-xs">
            {v.decidedByName ?? EM_DASH} · <span className="tabular">{formatDateTime(v.decidedAt)}</span>
            {v.decisionNote ? (
              <span className="block" dir="auto" data-user-text>
                {v.decisionNote}
              </span>
            ) : null}
          </span>
        ) : (
          EM_DASH
        ),
    },
  ];
  return (
    <div className="space-y-4" data-testid="rag-thresholds">
      <section aria-labelledby="rag-in-force" className={cx(card, 'space-y-3 p-4')} data-testid="rag-in-force" data-source={d.inForce.ref.source} data-version={d.inForce.ref.versionNo ?? ''}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 id="rag-in-force" className="font-semibold">
              {t('config.rag.inForce')}
            </h3>
            <p className="mt-1 text-sm text-ink">
              <RefText refInfo={d.inForce.ref} />
            </p>
            {d.inForce.approvedAt ? <p className="text-xs text-muted">{t('config.rag.approvedBy', { name: d.inForce.approvedByName ?? EM_DASH, date: formatDateTime(d.inForce.approvedAt) })}</p> : <p className="text-xs text-muted">{t('config.rag.noProjectVersion')}</p>}
          </div>
          {can('config.project_settings.manage') && !pending ? (
            <button type="button" className={btn.primary} onClick={() => setProposing(true)} data-testid="rag-propose">
              <Plus aria-hidden="true" className="size-4" />
              {t('config.rag.propose')}
            </button>
          ) : null}
        </div>
        <dl className="grid gap-3 sm:grid-cols-3">
          {(
            [
              ['green', d.inForce.thresholds.greenMaxSlipDays],
              ['amber', d.inForce.thresholds.amberMaxSlipDays],
              ['stale', d.inForce.thresholds.staleAfterDays],
            ] as const
          ).map(([k, n]) => (
            <div key={k} className="rounded-md bg-surface-muted p-3">
              <dt className="text-xs text-muted">{t(`config.rag.fields.${k}`)}</dt>
              <dd className="tabular text-lg font-semibold" data-testid={`rag-value-${k}`}>
                {n}
              </dd>
            </div>
          ))}
        </dl>
        <div>
          <h4 className="text-sm font-semibold">{t('config.rag.rulesTitle')}</h4>
          <ul className="mt-2 space-y-1.5" data-testid="rag-rules">
            {d.rules.map((r) => (
              <li key={r.status} className="flex flex-wrap items-start gap-2 text-sm">
                <StatusBadge enumName="ragStatuses" value={r.status} />
                <span>{msg(r.explanationI18n, r.explanation)}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-muted">{t('config.rag.templateDefault', { templateVersion: d.templateDefault.templateVersionNo })} <ValuesText v={d.templateDefault.thresholds} /></p>
      </section>
      {pending ? <PendingBox v={pending} /> : null}
      <section aria-labelledby="rag-history" className="space-y-2">
        <h3 id="rag-history" className="font-semibold">
          {t('config.rag.history')}
        </h3>
        <DataTable caption={t('config.rag.history')} columns={columns} rows={d.versions} rowKey={(v) => v.id} emptyTitle={t('config.rag.empty')} testId="rag-history" />
      </section>
      <ProposeDialog key={proposing ? 'open' : 'closed'} open={proposing} onClose={() => setProposing(false)} current={d.inForce.thresholds} />
    </div>
  );
}

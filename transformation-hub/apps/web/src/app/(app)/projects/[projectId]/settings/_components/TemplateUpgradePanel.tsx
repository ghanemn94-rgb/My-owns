'use client';

import { useEffect, useState } from 'react';
import { configRoutes as C, type RouteResponse } from '@hub/contracts';
import { ApiErrorNotice } from '@/components/ApiErrorNotice';
import { ConfirmCommandDialog } from '@/components/ConfirmCommandDialog';
import { DataTable, type Column } from '@/components/DataTable';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { RestrictedState } from '@/components/RestrictedState';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn, card, cx } from '@/components/ui';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api, isApiError } from '@/lib/api';
import { useRefreshConfig, useTemplateUpgrades, type TemplateUpgrade } from '@/lib/config';
import { useLocalized } from '@/lib/i18n-data';
import { useProjectContext } from '@/lib/project-context';
import { UpgradePlanView } from './UpgradePlanView';

type Preview = RouteResponse<typeof C.previewTemplateUpgrade>;

const TONE: Record<TemplateUpgrade['status'], 'warning' | 'success' | 'danger' | 'info'> = { proposed: 'warning', approved: 'info', applied: 'success', rejected: 'danger' };

/** An open upgrade: the stored plan the approver decides on; approve (sponsor, not the proposer) applies it as previewed. */
function OpenUpgrade({ u }: { u: TemplateUpgrade }) {
  const { t, formatDateTime } = useI18n();
  const { projectId, can, me } = useProjectContext();
  const refresh = useRefreshConfig(projectId);
  const toast = useToast();
  const [dialog, setDialog] = useState<'approve' | 'reject' | null>(null);
  const mine = u.proposedBy === me.user.id;
  const canDecide = can('config.template_migration.approve') && !mine;
  const add = u.plan.add;
  return (
    <section className={cx(card, 'space-y-3 border-warning/50 p-4')} data-testid="upgrade-open" data-current={u.current ? 'true' : 'false'} aria-labelledby="upgrade-open-title">
      <h3 id="upgrade-open-title" className="flex flex-wrap items-center gap-2 font-semibold">
        {t('config.upgrade.openTitle', { from: u.fromVersionNo, to: u.toVersionNo })}
        <StatusBadge enumName="templateMigrationStatuses" value={u.status} tone="warning" />
      </h3>
      <p className="text-sm">
        <span className="text-muted">{t('config.upgrade.reason')}: </span>
        <span dir="auto" data-user-text>
          {u.reason ?? EM_DASH}
        </span>
      </p>
      <p className="text-xs text-muted">{t('config.upgrade.proposedBy', { name: u.proposedByName ?? EM_DASH, date: formatDateTime(u.createdAt) })}</p>
      {!u.current ? (
        <p className="rounded-md border border-danger/40 bg-danger-soft p-2 text-sm text-danger" data-testid="upgrade-stale">
          {t('config.upgrade.stale')}
        </p>
      ) : null}
      <UpgradePlanView plan={u.plan} />
      <p className="text-xs text-ink">{mine ? t('config.upgrade.ownProposal') : canDecide ? t('config.upgrade.youDecide') : t('config.upgrade.awaiting')}</p>
      {canDecide ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn.primary} onClick={() => setDialog('approve')} data-testid="upgrade-approve">
            {t('config.upgrade.approve')}
          </button>
          <button type="button" className={btn.secondary} onClick={() => setDialog('reject')} data-testid="upgrade-reject">
            {t('config.upgrade.reject')}
          </button>
        </div>
      ) : null}
      <ConfirmCommandDialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={dialog === 'approve' ? t('config.upgrade.approve') : t('config.upgrade.reject')}
        confirmLabel={dialog === 'approve' ? t('config.upgrade.approve') : t('config.upgrade.reject')}
        noteMode={dialog === 'reject' ? 'required' : 'optional'}
        expectedVersion={u.version}
        danger={dialog === 'reject'}
        consequences={
          dialog === 'approve'
            ? [
                t('config.upgrade.approveEffect', { to: u.toVersionNo }),
                t('config.upgrade.approveEffectCreates', { gates: add.gates.length, workstreams: add.workstreams.length, activities: add.activities.length, kpis: add.kpis.length }),
                t('config.upgrade.approveEffectKeeps'),
                t('common.command.audited'),
              ]
            : [t('config.upgrade.rejectEffect'), t('common.command.audited')]
        }
        onConfirm={async ({ note }) => {
          const params = { projectId, upgradeId: u.id };
          if (dialog === 'approve') await api(C.approveTemplateUpgrade, { params, body: { expectedVersion: u.version, ...(note ? { note } : {}) } });
          else await api(C.rejectTemplateUpgrade, { params, body: { expectedVersion: u.version, reason: note } });
          await refresh();
          toast.show('success', dialog === 'approve' ? t('config.upgrade.applied', { to: u.toVersionNo }) : t('config.upgrade.rejected'));
          setDialog(null);
        }}
      />
    </section>
  );
}

/** Preview of a newer version (nothing changes), then the proposal that carries the hash of the reviewed preview. */
function PreviewBlock({ toVersionId, toVersionNo, onClose }: { toVersionId: string; toVersionNo: number; onClose: () => void }) {
  const { t } = useI18n();
  const { projectId, can } = useProjectContext();
  const refresh = useRefreshConfig(projectId);
  const toast = useToast();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [proposing, setProposing] = useState(false);
  // The preview is a read (POST without effect): computed from the current records each time it is opened.
  useEffect(() => {
    let live = true;
    setBusy(true);
    setError(null);
    api(C.previewTemplateUpgrade, { params: { projectId }, body: { toVersionId } })
      .then((r) => live && setPreview(r))
      .catch((e: unknown) => live && setError(e))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [projectId, toVersionId]);
  return (
    <section className={cx(card, 'space-y-3 p-4')} data-testid="upgrade-preview" aria-labelledby="upgrade-preview-title">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id="upgrade-preview-title" className="font-semibold">
          {t('config.upgrade.previewTitle', { to: toVersionNo })}
        </h3>
        <button type="button" className={btn.ghost} onClick={onClose}>
          {t('config.upgrade.closePreview')}
        </button>
      </div>
      <p className="text-xs text-muted">{t('config.upgrade.previewHint')}</p>
      {busy ? <LoadingState compact /> : null}
      {error ? <ApiErrorNotice error={error} /> : null}
      {preview ? (
        <>
          <UpgradePlanView plan={preview.plan} />
          {can('config.template_migration.propose') ? (
            <button type="button" className={btn.primary} onClick={() => setProposing(true)} data-testid="upgrade-propose">
              {t('config.upgrade.propose')}
            </button>
          ) : (
            <p className="text-sm text-muted">{t('config.upgrade.cannotPropose')}</p>
          )}
        </>
      ) : null}
      <ConfirmCommandDialog
        open={proposing}
        onClose={() => setProposing(false)}
        title={t('config.upgrade.propose')}
        confirmLabel={t('config.upgrade.propose')}
        noteMode="required"
        noteLabel={t('config.upgrade.reason')}
        consequences={[t('config.upgrade.proposeEffect', { to: toVersionNo }), t('config.upgrade.proposeEffectApprover'), t('common.command.audited')]}
        onConfirm={async ({ note }) => {
          await api(C.proposeTemplateUpgrade, { params: { projectId }, body: { toVersionId, planHash: preview!.planHash, reason: note } });
          await refresh();
          toast.show('success', t('config.upgrade.proposed', { to: toVersionNo }));
          setProposing(false);
          onClose();
        }}
      />
    </section>
  );
}

/**
 * Template version of the project (spec §5, REQ-ENT-009, AT-26): the pinned version, newer published versions with a preview
 * of what would change, the open upgrade awaiting the sponsor's approval, and the history. The project keeps its version
 * until an upgrade is approved; nothing existing is ever changed by an upgrade.
 */
export function TemplateUpgradePanel() {
  const { t, formatDate, formatDateTime } = useI18n();
  const loc = useLocalized();
  const { projectId } = useProjectContext();
  const q = useTemplateUpgrades(projectId);
  const [previewing, setPreviewing] = useState<{ id: string; no: number } | null>(null);
  if (q.isLoading) return <LoadingState />;
  if (q.error) return isApiError(q.error) && (q.error.isHidden || q.error.isForbidden) ? <RestrictedState showHomeLink={false} /> : <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const open = d.items.find((u) => u.status === 'proposed') ?? null;
  const history = d.items.filter((u) => u.status !== 'proposed');
  const columns: Column<TemplateUpgrade>[] = [
    { key: 'versions', header: t('config.upgrade.columns.versions'), isRowHeader: true, cell: (u) => <span className="tabular">{t('config.upgrade.fromTo', { from: u.fromVersionNo, to: u.toVersionNo })}</span> },
    { key: 'status', header: t('config.upgrade.columns.status'), cell: (u) => <StatusBadge enumName="templateMigrationStatuses" value={u.status} tone={TONE[u.status]} /> },
    { key: 'reason', header: t('config.upgrade.columns.reason'), cell: (u) => <span dir="auto" data-user-text>{u.reason ?? EM_DASH}</span> },
    { key: 'proposed', header: t('config.upgrade.columns.proposed'), cell: (u) => <span className="text-xs">{u.proposedByName ?? EM_DASH} · <span className="tabular">{formatDateTime(u.createdAt)}</span></span> },
    {
      key: 'decided',
      header: t('config.upgrade.columns.decided'),
      cell: (u) => (
        <span className="text-xs">
          {u.decidedByName ?? EM_DASH} · <span className="tabular">{formatDateTime(u.decidedAt)}</span>
          {u.decisionNote ? (
            <span className="block" dir="auto" data-user-text>
              {u.decisionNote}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'result',
      header: t('config.upgrade.columns.result'),
      cell: (u) => (u.result ? <span className="text-xs">{t('config.upgrade.result', { gates: u.result.gates, workstreams: u.result.workstreams, tasks: u.result.tasks + u.result.milestones, kpis: u.result.kpis })}</span> : EM_DASH),
    },
  ];
  return (
    <div className="space-y-4" data-testid="template-upgrades">
      <section className={cx(card, 'space-y-3 p-4')} aria-labelledby="tpl-current" data-testid="template-current" data-version={d.current.versionNo}>
        <h3 id="tpl-current" className="font-semibold">
          {t('config.upgrade.current')}
        </h3>
        <p className="text-sm">
          <span dir="auto">{loc(d.current.name, d.current.nameAr)}</span> · {t('config.upgrade.version', { version: d.current.versionNo })}
        </p>
        <p className="text-xs text-muted">{t('config.upgrade.pinnedHint')}</p>
        <div>
          <h4 className="text-sm font-semibold">{t('config.upgrade.available')}</h4>
          {d.available.length === 0 ? (
            <p className="mt-1 text-sm text-muted" data-testid="upgrade-none">
              {t('config.upgrade.noneAvailable')}
            </p>
          ) : (
            <ul className="mt-1 space-y-1">
              {d.available.map((v) => (
                <li key={v.versionId} className="flex flex-wrap items-center gap-2 text-sm" data-testid="upgrade-available" data-version={v.versionNo}>
                  <span>{t('config.upgrade.version', { version: v.versionNo })}</span>
                  <span className="text-xs text-muted">{t('config.upgrade.publishedOn', { date: formatDate(v.publishedAt?.slice(0, 10) ?? null) })}</span>
                  {!open ? (
                    <button type="button" className={btn.secondary} onClick={() => setPreviewing({ id: v.versionId, no: v.versionNo })} data-testid="upgrade-preview-open">
                      {t('config.upgrade.preview')}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      {previewing && !open ? <PreviewBlock key={previewing.id} toVersionId={previewing.id} toVersionNo={previewing.no} onClose={() => setPreviewing(null)} /> : null}
      {open ? <OpenUpgrade u={open} /> : null}
      <section aria-labelledby="tpl-history" className="space-y-2">
        <h3 id="tpl-history" className="font-semibold">
          {t('config.upgrade.history')}
        </h3>
        <DataTable caption={t('config.upgrade.history')} columns={columns} rows={history} rowKey={(u) => u.id} emptyTitle={t('config.upgrade.empty')} testId="upgrade-history" />
      </section>
    </div>
  );
}

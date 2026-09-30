'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Pencil, Scale } from 'lucide-react';
import { useState } from 'react';
import { financeRoutes } from '@hub/contracts';
import { BUDGET_DECISION_TYPE_KEYS, OPENING_BALANCE_DECISION_TYPE_KEYS } from '@hub/domain';
import { DemoBadge } from '@/components/DemoBadge';
import { ErrorState } from '@/components/ErrorState';
import { EvidencePanel } from '@/components/EvidencePanel';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { RestrictedState } from '@/components/RestrictedState';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn } from '@/components/ui';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api, isApiError } from '@/lib/api';
import { RECONCILABLE_CATEGORIES, figureRights, finHref, useFinanceRefresh, useSnapshot, type FigureCommand, type SnapshotDetail } from '@/lib/finance';
import { useProjectContext } from '@/lib/project-context';
import { Amount, ApprovalPanel, BackToList, DecisionSelect, Facts, FinCommandDialog, FinanceHistory, MessageList, Panel, Person, SourceText, useWorkstreamLabel } from '../../_components/fin';
import { EditSnapshotDialog, SnapshotReconciliationDialog } from '../../_components/snapshot-forms';

function FigureCommandDialog({ x, cmd, onClose }: { x: SnapshotDetail; cmd: FigureCommand | null; onClose: () => void }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useFinanceRefresh();
  const toast = useToast();
  const [decisionId, setDecisionId] = useState('');
  const opening = x.category === 'opening_balance';
  const params = { projectId, snapshotId: x.id };
  const v = x.version;
  const done = async (msg: string) => {
    await refresh();
    toast.show('success', msg);
    onClose();
  };
  if (!cmd) return null;
  const common = { open: true, onClose, expectedVersion: v, onReload: () => void refresh() };
  switch (cmd) {
    case 'validate':
      return (
        <FinCommandDialog
          {...common}
          title={t('finance.figure.validate.title', { line: x.lineRef })}
          confirmLabel={t('finance.commands.validate')}
          noteMode="required"
          noteLabel={t('finance.figure.validate.note')}
          consequences={[t('finance.figure.validate.effect'), t('finance.figure.validate.sod'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            await api(financeRoutes.validateSnapshot, { params, body: { expectedVersion: v, note } });
            await done(t('finance.figure.validate.done'));
          }}
        />
      );
    case 'approve':
      return (
        <FinCommandDialog
          {...common}
          title={t('finance.figure.approve.title', { line: x.lineRef })}
          confirmLabel={t('finance.commands.approve')}
          confirmDisabled={opening && !decisionId}
          consequences={[t('finance.figure.approve.effect'), t('finance.figure.approve.sod'), ...(opening ? [t('finance.figure.approve.openingBalance')] : []), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            await api(financeRoutes.approveSnapshot, { params, body: { expectedVersion: v, ...(decisionId ? { decisionId } : {}), ...(note ? { note } : {}) } });
            await done(t('finance.figure.approve.done'));
          }}
        >
          <DecisionSelect typeKeys={opening ? OPENING_BALANCE_DECISION_TYPE_KEYS : [...OPENING_BALANCE_DECISION_TYPE_KEYS, ...BUDGET_DECISION_TYPE_KEYS]} value={decisionId} onChange={setDecisionId} required={opening} />
        </FinCommandDialog>
      );
    case 'reject':
      return (
        <FinCommandDialog
          {...common}
          danger
          title={t('finance.figure.reject.title', { line: x.lineRef })}
          confirmLabel={t('finance.commands.reject')}
          noteMode="required"
          noteLabel={t('finance.common.reason')}
          consequences={[t('finance.figure.reject.effect'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            await api(financeRoutes.rejectSnapshot, { params, body: { expectedVersion: v, note } });
            await done(t('finance.figure.reject.done'));
          }}
        />
      );
    case 'reopen':
      return (
        <FinCommandDialog
          {...common}
          title={t('finance.figure.reopen.title', { line: x.lineRef })}
          confirmLabel={t('finance.commands.reopen')}
          noteMode="required"
          noteLabel={t('finance.common.reason')}
          consequences={[t('finance.figure.reopen.effect'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            await api(financeRoutes.reopenSnapshot, { params, body: { expectedVersion: v, note } });
            await done(t('finance.figure.reopen.done'));
          }}
        />
      );
    default:
      return null;
  }
}

/** A figure: its source, the human validation → approval trail with who may act (REQ-FIN-010), reconciliations, evidence. */
export default function SnapshotPage() {
  const { snapshotId } = useParams<{ snapshotId: string }>();
  const { t, tStatus, formatDate, formatDateTime } = useI18n();
  const { projectId, can, me } = useProjectContext();
  const scope = useWorkstreamLabel();
  const q = useSnapshot(snapshotId);
  const [cmd, setCmd] = useState<FigureCommand | null>(null);
  const [edit, setEdit] = useState(false);
  const [recon, setRecon] = useState(false);
  const base = finHref(projectId);
  if (q.isLoading) return <LoadingState />;
  if (q.error) return isApiError(q.error) && (q.error.status === 404 || q.error.status === 403) ? <RestrictedState /> : <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const x = q.data!;
  const rights = figureRights({ state: x.approvalState, createdBy: x.createdBy, approval: x.approval }, me.user.id, can('finance.snapshot.approve'));
  const canEdit = can('finance.budget.manage') && x.approvalState !== 'approved' && x.approvalState !== 'superseded';
  const reconcilable = (RECONCILABLE_CATEGORIES as readonly string[]).includes(x.category) && can('finance.budget.manage');
  return (
    <>
      <PageHeader
        eyebrow={<BackToList href={`${base}/snapshots`} label={t('finance.snapshots.title')} />}
        title={
          <span>
            <span dir="ltr">{x.lineRef}</span> — <span dir="auto">{x.label}</span>
          </span>
        }
        documentTitle={`${x.lineRef} — ${x.label}`}
        badges={
          <>
            <StatusBadge enumName="approvalStates" value={x.approvalState} size="md" />
            <StatusBadge enumName="financialKinds" value={x.kind} tone="neutral" size="md" />
            {x.isDemo ? <DemoBadge /> : null}
          </>
        }
        actions={
          <>
            {canEdit ? (
              <button type="button" className={btn.secondary} onClick={() => setEdit(true)} data-testid="snapshot-edit">
                <Pencil aria-hidden="true" className="size-4" />
                {t('finance.common.edit')}
              </button>
            ) : null}
            {reconcilable ? (
              <button type="button" className={btn.secondary} onClick={() => setRecon(true)} data-testid="snapshot-reconcile">
                <Scale aria-hidden="true" className="size-4" />
                {t('finance.recon.create.action')}
              </button>
            ) : null}
          </>
        }
      />
      <div className="space-y-6" data-testid="snapshot-detail" data-state={x.approvalState}>
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title={t('finance.figure.title')} testId="figure-facts">
            <Facts
              items={[
                { label: t('finance.snapshots.amount'), value: <Amount value={x.amount} showUnits testId="figure-amount" />, testId: 'fact-amount' },
                { label: t('finance.snapshots.period'), value: <span dir="ltr" className="tabular">{x.period}</span> },
                { label: t('finance.snapshots.kind'), value: tStatus('financialKinds', x.kind) },
                { label: t('finance.snapshots.category'), value: tStatus('financialCategories', x.category) },
                { label: t('finance.snapshots.source'), value: <SourceText sourceType={x.sourceType} sourceRef={x.sourceRef} sourceDocumentId={x.sourceDocumentId} sheet={x.sourceSheet} cell={x.sourceCell} />, wide: true },
                {
                  label: t('finance.common.tsa'),
                  value: x.tsaServiceId ? (
                    <Link className={btn.link} href={`/projects/${projectId}/readiness/tsa/${x.tsaServiceId}`}>
                      {t('finance.common.openTsa')}
                    </Link>
                  ) : (
                    EM_DASH
                  ),
                },
                { label: t('finance.common.workstream'), value: scope(x.workstreamId) },
                { label: t('finance.common.classification'), value: tStatus('classifications', x.classification) },
                { label: t('finance.snapshots.approvalDate'), value: <span className="tabular">{formatDate(x.approvalDate)}</span> },
                {
                  label: t('finance.common.created'),
                  value: (
                    <span>
                      <Person id={x.createdBy} people={x.people} /> · <span className="tabular">{formatDateTime(x.createdAt)}</span>
                    </span>
                  ),
                  wide: true,
                },
                { label: t('finance.common.evidence'), value: <span className="tabular">{t('finance.common.evidenceCount', { active: x.evidence.active, conflicting: x.evidence.conflicting })}</span> },
              ]}
            />
          </Panel>
          <ApprovalPanel
            approval={x.approval}
            createdBy={x.createdBy}
            people={x.people}
            rights={rights}
            onCommand={setCmd}
            approveRule={x.category === 'opening_balance' ? t('finance.figure.approve.openingBalance') : undefined}
            decisionHref={x.approval.approvalDecisionId ? `/projects/${projectId}/committee/decisions/${x.approval.approvalDecisionId}` : null}
          />
        </div>
        {(RECONCILABLE_CATEGORIES as readonly string[]).includes(x.category) ? (
          <Panel title={t('finance.recon.title')} testId="figure-reconciliations">
            {x.reconciliations.length === 0 ? (
              <p className="text-sm text-muted">{t('finance.recon.noneForFigure')}</p>
            ) : (
              <ul className="space-y-3">
                {x.reconciliations.map((r) => (
                  <li key={r.id} className="space-y-1 text-sm" data-flag={r.flag}>
                    <p className="flex flex-wrap items-center gap-2">
                      <Link className={btn.link} href={`${base}/reconciliations/${r.id}`} dir="ltr">
                        {r.code}
                      </Link>
                      <span dir="auto">{r.counterpartyLabel}</span>
                      <StatusBadge enumName="approvalStates" value={r.status} label={t(`finance.recon.statuses.${r.status}`)} />
                    </p>
                    <MessageList messages={r.notesI18n} fallback={r.notes} tone={r.unreconciled ? 'warning' : 'neutral'} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ) : null}
        <EvidencePanel targetType="financial_snapshot" targetId={x.id} title={t('finance.common.evidenceTitle')} />
        <FinanceHistory entityType="financial_snapshot" entityId={x.id} />
      </div>
      <FigureCommandDialog key={cmd ?? 'none'} x={x} cmd={cmd} onClose={() => setCmd(null)} />
      <EditSnapshotDialog snapshot={x} open={edit} onClose={() => setEdit(false)} />
      {reconcilable ? <SnapshotReconciliationDialog snapshot={x} open={recon} onClose={() => setRecon(false)} /> : null}
    </>
  );
}

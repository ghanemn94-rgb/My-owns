'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Pencil, UserX } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { DemoBadge } from '@/components/DemoBadge';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { RestrictedState } from '@/components/RestrictedState';
import { StatusBadge } from '@/components/StatusBadge';
import { btn } from '@/components/ui';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { isApiError } from '@/lib/api';
import { finHref, useReconciliation } from '@/lib/finance';
import { useProjectContext } from '@/lib/project-context';
import { Amount, BackToList, ButtonRow, CmdButton, Facts, FinanceHistory, MessageList, Panel, Person, UText } from '../../_components/fin';
import { EditReconciliationDialog, ReconCommandDialog, ReconFlagBadge, type ReconCommand } from '../../_components/recon';

/** Intercompany reconciliation (REQ-FIN-004): balances in the same currency and unit, flagged difference, independent review. */
export default function ReconciliationPage() {
  const { reconciliationId } = useParams<{ reconciliationId: string }>();
  const { t, tStatus, formatDateTime } = useI18n();
  const { projectId, can, me } = useProjectContext();
  const q = useReconciliation(reconciliationId);
  const [cmd, setCmd] = useState<ReconCommand | null>(null);
  const [edit, setEdit] = useState(false);
  const base = finHref(projectId);
  if (q.isLoading) return <LoadingState />;
  if (q.error) return isApiError(q.error) && (q.error.status === 404 || q.error.status === 403) ? <RestrictedState /> : <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const r = q.data!;
  const manage = can('finance.budget.manage');
  const reviewer = can('finance.snapshot.approve');
  const iPrepared = r.preparedBy === me.user.id;
  const buttons: ReactNode[] = [];
  if (reviewer && r.status !== 'reconciled' && !iPrepared) buttons.push(<CmdButton key="reconcile" label={t('finance.recon.reconcile.action')} onClick={() => setCmd('reconcile')} testId="cmd-reconcile" variant="primary" />);
  if (manage && r.status === 'open') buttons.push(<CmdButton key="dispute" label={t('finance.recon.dispute.action')} onClick={() => setCmd('dispute')} testId="cmd-dispute" variant="danger" />);
  if (reviewer && r.status !== 'open') buttons.push(<CmdButton key="reopen" label={t('finance.recon.reopen.action')} onClick={() => setCmd('reopen')} testId="cmd-reopen" />);
  return (
    <>
      <PageHeader
        eyebrow={<BackToList href={`${base}/reconciliations`} label={t('finance.recon.title')} />}
        title={
          <span>
            <span dir="ltr">{r.code}</span> — <span dir="auto">{r.counterpartyLabel}</span>
          </span>
        }
        documentTitle={`${r.code} — ${r.counterpartyLabel}`}
        badges={
          <>
            <StatusBadge enumName="approvalStates" value={r.status} label={t(`finance.recon.statuses.${r.status}`)} size="md" />
            <ReconFlagBadge r={r} />
            {r.isDemo ? <DemoBadge /> : null}
          </>
        }
        actions={
          manage && r.status !== 'reconciled' ? (
            <button type="button" className={btn.secondary} onClick={() => setEdit(true)} data-testid="recon-edit">
              <Pencil aria-hidden="true" className="size-4" />
              {t('finance.common.edit')}
            </button>
          ) : null
        }
      />
      <div className="space-y-6" data-testid="recon-detail" data-status={r.status} data-flag={r.flag}>
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title={t('finance.recon.balances')} testId="recon-balances">
            <Facts
              items={[
                { label: t('finance.recon.ourBalance'), value: <Amount value={r.ourBalance} showUnits /> },
                { label: t('finance.recon.theirBalance'), value: r.theirBalance ? <Amount value={r.theirBalance} showUnits /> : <span className="text-warning">{t('finance.recon.counterpartyMissing')}</span> },
                { label: t('finance.recon.difference'), value: <Amount value={r.difference} showUnits testId="recon-difference" />, testId: 'fact-difference' },
                { label: t('finance.snapshots.period'), value: <span dir="ltr">{r.period}</span> },
                { label: t('finance.recon.explanation'), value: <UText value={r.explanation} multiline />, wide: true },
                { label: t('finance.recon.sourceRef'), value: <UText value={r.sourceRef} multiline />, wide: true },
                {
                  label: t('finance.recon.figure'),
                  value: r.financialSnapshotId ? (
                    <Link className={btn.link} href={`${base}/snapshots/${r.financialSnapshotId}`}>
                      {t('finance.recon.openFigure')}
                    </Link>
                  ) : (
                    EM_DASH
                  ),
                },
                { label: t('finance.common.classification'), value: tStatus('classifications', r.classification) },
              ]}
            />
            <div className="mt-3">
              <MessageList messages={r.notesI18n} fallback={r.notes} tone={r.unreconciled ? 'warning' : 'neutral'} testId="recon-notes" />
            </div>
          </Panel>
          <Panel title={t('finance.recon.review')} testId="recon-review" actions={<ButtonRow>{buttons}</ButtonRow>}>
            <Facts
              items={[
                { label: t('finance.recon.preparedBy'), value: <Person id={r.preparedBy} people={r.people} />, testId: 'recon-prepared-by' },
                {
                  label: t('finance.recon.reviewedBy'),
                  value: r.reviewerUserId ? (
                    <span>
                      <Person id={r.reviewerUserId} people={r.people} /> · <span className="tabular">{formatDateTime(r.reviewedAt)}</span>
                    </span>
                  ) : (
                    <span className="text-muted">{t('finance.recon.notReviewed')}</span>
                  ),
                },
              ]}
            />
            <ul className="mt-3 list-disc space-y-1 ps-5 text-sm text-ink" data-testid="who-may-act">
              <li>{t('finance.recon.ruleReviewer')}</li>
              <li>{t('finance.recon.ruleExplain')}</li>
            </ul>
            {reviewer && iPrepared && r.status !== 'reconciled' ? (
              <p className="mt-3 flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft p-2 text-sm text-ink" data-testid="sod-reason">
                <UserX aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                {t('finance.recon.youPrepared')}
              </p>
            ) : null}
            {buttons.length === 0 ? <p className="mt-3 text-sm text-muted">{t('finance.common.noCommands')}</p> : null}
          </Panel>
        </div>
        <FinanceHistory entityType="intercompany_reconciliation" entityId={r.id} />
      </div>
      <ReconCommandDialog key={cmd ?? 'none'} r={r} cmd={cmd} onClose={() => setCmd(null)} />
      {manage ? <EditReconciliationDialog r={r} open={edit} onClose={() => setEdit(false)} /> : null}
    </>
  );
}

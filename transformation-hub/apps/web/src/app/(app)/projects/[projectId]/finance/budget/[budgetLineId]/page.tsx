'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ClipboardPen, Gavel, Pencil } from 'lucide-react';
import { useState } from 'react';
import { DemoBadge } from '@/components/DemoBadge';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { RestrictedState } from '@/components/RestrictedState';
import { StatusBadge } from '@/components/StatusBadge';
import { btn } from '@/components/ui';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { isApiError } from '@/lib/api';
import { finHref, useBudgetLine } from '@/lib/finance';
import { useProjectContext } from '@/lib/project-context';
import { EditBudgetLineDialog, RecordActualsDialog, RecordBudgetApprovalDialog } from '../../_components/budget-forms';
import { Amount, BackToList, Facts, FinanceHistory, MessageList, Panel, Person, UText, useUnitLabel, useWorkstreamLabel } from '../../_components/fin';

/** Budget line: approved vs committed vs spent (REQ-FIN-003), the governance decision behind the approval, the TSA it carries. */
export default function BudgetLinePage() {
  const { budgetLineId } = useParams<{ budgetLineId: string }>();
  const { t, tStatus, formatDate, formatDateTime } = useI18n();
  const { projectId, can } = useProjectContext();
  const unit = useUnitLabel();
  const scope = useWorkstreamLabel();
  const q = useBudgetLine(budgetLineId);
  const [dialog, setDialog] = useState<'edit' | 'actuals' | 'approval' | null>(null);
  const base = finHref(projectId);
  if (q.isLoading) return <LoadingState />;
  if (q.error) return isApiError(q.error) && (q.error.status === 404 || q.error.status === 403) ? <RestrictedState /> : <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const x = q.data!;
  const manage = can('finance.budget.manage');
  return (
    <>
      <PageHeader
        eyebrow={<BackToList href={`${base}/budget`} label={t('finance.budget.title')} />}
        title={
          <span>
            <span dir="ltr">{x.code}</span> — <span dir="auto">{x.name}</span>
          </span>
        }
        documentTitle={`${x.code} — ${x.name}`}
        badges={
          <>
            <StatusBadge enumName="approvalStates" value={x.approvalState} size="md" />
            <StatusBadge enumName="financialCategories" value={x.category} tone="neutral" size="md" />
            {x.isDemo ? <DemoBadge /> : null}
          </>
        }
        actions={
          manage ? (
            <>
              <button type="button" className={btn.secondary} onClick={() => setDialog('edit')} data-testid="budget-edit">
                <Pencil aria-hidden="true" className="size-4" />
                {t('finance.common.edit')}
              </button>
              <button type="button" className={btn.secondary} onClick={() => setDialog('actuals')} data-testid="budget-actuals">
                <ClipboardPen aria-hidden="true" className="size-4" />
                {t('finance.budget.actuals.action')}
              </button>
              <button type="button" className={btn.primary} onClick={() => setDialog('approval')} data-testid="budget-approval">
                <Gavel aria-hidden="true" className="size-4" />
                {t('finance.budget.approval.action')}
              </button>
            </>
          ) : null
        }
      />
      <div className="space-y-6" data-testid="budget-detail">
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title={t('finance.budget.position')} testId="budget-position">
            <p className="mb-3 text-sm text-muted">{t('finance.budget.positionNote', { currency: x.currency, unit: unit(x.unitScale) })}</p>
            <Facts
              items={[
                { label: t('finance.budget.proposed'), value: <Amount value={x.proposed} /> },
                { label: t('finance.budget.approved'), value: x.approved ? <Amount value={x.approved} /> : <span className="text-muted">{t('finance.budget.notApproved')}</span>, testId: 'fact-approved' },
                { label: t('finance.budget.committed'), value: <Amount value={x.committed} /> },
                { label: t('finance.budget.spent'), value: <Amount value={x.spent} /> },
                { label: t('finance.budget.openCommitment'), value: <Amount value={x.openCommitment} /> },
                { label: t('finance.budget.uncommitted'), value: <Amount value={x.uncommitted} /> },
                { label: t('finance.budget.actualsAsOf'), value: <span className="tabular">{formatDate(x.actualsAsOf)}</span> },
                { label: t('finance.budget.actualsSource'), value: <UText value={x.actualsSourceRef} /> },
              ]}
            />
            <div className="mt-3">
              <MessageList messages={x.flagsI18n} fallback={x.flags} tone={x.flagsI18n.some((m) => m.code !== 'finance.budget.no_approved_budget') ? 'danger' : 'warning'} testId="budget-flags" />
            </div>
            <p className="mt-3 text-xs text-muted">{t('finance.budget.convention')}</p>
          </Panel>
          <Panel title={t('finance.budget.approvalTitle')} testId="budget-approval-panel">
            <Facts
              items={[
                {
                  label: t('finance.budget.approvalDecision'),
                  value: x.approvalDecisionId ? (
                    <Link className={btn.link} href={`/projects/${projectId}/committee/decisions/${x.approvalDecisionId}`}>
                      {t('finance.approval.decision')}
                    </Link>
                  ) : (
                    <span className="text-muted">{t('finance.budget.noDecision')}</span>
                  ),
                  wide: true,
                },
                {
                  label: t('finance.budget.recordedBy'),
                  value: x.approvedBy ? (
                    <span>
                      <Person id={x.approvedBy} people={x.people} /> · <span className="tabular">{formatDateTime(x.approvedAt)}</span>
                    </span>
                  ) : (
                    EM_DASH
                  ),
                  wide: true,
                },
              ]}
            />
            <p className="mt-3 text-sm text-ink">{t('finance.budget.approvedByDecision')}</p>
          </Panel>
          <Panel title={t('finance.budget.details')}>
            <Facts
              items={[
                { label: t('finance.snapshots.category'), value: tStatus('financialCategories', x.category) },
                { label: t('finance.summary.currencyUnit'), value: <span><span dir="ltr">{x.currency}</span> · {unit(x.unitScale)}</span> },
                { label: t('finance.common.workstream'), value: scope(x.workstreamId) },
                { label: t('finance.common.classification'), value: tStatus('classifications', x.classification) },
                { label: t('finance.budget.sourceRef'), value: <UText value={x.sourceRef} multiline />, wide: true },
                { label: t('finance.common.created'), value: <span className="tabular">{formatDateTime(x.createdAt)}</span> },
              ]}
            />
          </Panel>
          <Panel title={t('finance.budget.tsaTitle')} testId="budget-tsa">
            {x.tsa ? (
              <div className="space-y-2 text-sm">
                <p className="flex flex-wrap items-center gap-2">
                  <Link className={btn.link} href={`/projects/${projectId}/readiness/tsa/${x.tsa.id}`} dir="ltr">
                    {x.tsa.code}
                  </Link>
                  <span dir="auto">{x.tsa.name}</span>
                </p>
                <p>
                  {t('finance.costs.registerCharge')}: <Amount value={x.tsa.charge} showUnits />
                </p>
                <p className="text-muted">{t('finance.budget.tsaCountedOnce')}</p>
              </div>
            ) : x.tsaServiceId ? (
              <p className="text-sm text-muted">{t('finance.common.tsaNotVisible')}</p>
            ) : (
              <p className="text-sm text-muted">{t('finance.budget.noTsa')}</p>
            )}
          </Panel>
        </div>
        <FinanceHistory entityType="budget_line" entityId={x.id} />
      </div>
      {manage ? (
        <>
          <EditBudgetLineDialog line={x} open={dialog === 'edit'} onClose={() => setDialog(null)} />
          <RecordActualsDialog line={x} open={dialog === 'actuals'} onClose={() => setDialog(null)} />
          <RecordBudgetApprovalDialog line={x} open={dialog === 'approval'} onClose={() => setDialog(null)} />
        </>
      ) : null}
    </>
  );
}

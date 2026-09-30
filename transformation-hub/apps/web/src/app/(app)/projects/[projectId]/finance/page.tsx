'use client';

import Link from 'next/link';
import { ActivityHistory } from '@/components/ActivityHistory';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { MetricCard } from '@/components/MetricCard';
import { PageHeader } from '@/components/PageHeader';
import { ScrollRegion } from '@/components/ScrollRegion';
import { btn } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import { finHref, useFinanceSummary } from '@/lib/finance';
import { useProjectContext } from '@/lib/project-context';
import { AggregatePanel } from './_components/aggregate';
import { Amount, Callout, MessageList, Panel, StatusCounts, useUnitLabel } from './_components/fin';

/**
 * Finance & value summary (screen 10). Every count comes from the API, scoped to the caller's finance clearance and
 * workstream reach; every number links to the records that make it up. Money is shown per currency and unit scale as
 * the API grouped it — never added across groups here. Totals across figures go through the API's aggregation (AT-29).
 */
export default function FinanceSummaryPage() {
  const { t, formatNumber } = useI18n();
  const { projectId } = useProjectContext();
  const unit = useUnitLabel();
  const summary = useFinanceSummary();
  const base = finHref(projectId);
  const s = summary.data;
  return (
    <>
      <PageHeader title={t('finance.summary.title')} description={t('finance.summary.subtitle')} />
      <Callout testId="not-valuation-engine">{t('finance.common.notValuationEngine')}</Callout>
      {summary.isLoading ? <LoadingState /> : null}
      {summary.error ? <ErrorState error={summary.error} onRetry={() => summary.refetch()} /> : null}
      {s ? (
        <div className="mt-4 space-y-6" data-testid="finance-summary">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label={t('finance.summary.figures')} value={s.snapshots.total} href={`${base}/snapshots`} />
            <MetricCard label={t('finance.summary.underReview')} value={s.snapshots.byState['under_review'] ?? 0} href={`${base}/snapshots?approvalState=under_review`} />
            <MetricCard label={t('finance.summary.budgetLines')} value={s.budget.lines} href={`${base}/budget`} hint={t('finance.summary.flaggedLines', { count: formatNumber(s.budget.flaggedLines) })} />
            <MetricCard label={t('finance.summary.unreconciled')} value={s.intercompany.unreconciled} href={`${base}/reconciliations?unreconciled=true`} hint={t('finance.summary.reconciliationsTotal', { count: formatNumber(s.intercompany.total) })} />
            <MetricCard label={t('finance.summary.models')} value={s.models.total} href={`${base}/models`} hint={t('finance.summary.versions', { count: formatNumber(s.models.versions) })} />
            <MetricCard label={t('finance.summary.approvedValues')} value={s.models.approvedValueVersions} href={`${base}/models`} />
            <MetricCard label={t('finance.summary.benefits')} value={s.benefits.total} href={`${base}/benefits`} />
            <MetricCard label={t('finance.summary.kpis')} value={s.kpis.total} href={`${base}/benefits#kpis`} />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title={t('finance.summary.figuresByKind')}>
              <StatusCounts enumName="financialKinds" counts={s.snapshots.byKind} href={(k) => `${base}/snapshots?kind=${k}`} testId="figures-by-kind" />
            </Panel>
            <Panel title={t('finance.summary.figuresByState')}>
              <StatusCounts enumName="approvalStates" counts={s.snapshots.byState} href={(k) => `${base}/snapshots?approvalState=${k}`} testId="figures-by-state" />
            </Panel>
            <Panel title={t('finance.summary.benefitsByStatus')}>
              <StatusCounts enumName="benefitStatuses" counts={s.benefits.byStatus} href={(k) => `${base}/benefits?status=${k}`} testId="benefits-by-status" />
            </Panel>
          </div>

          <Panel title={t('finance.summary.budgetByCurrency')} testId="budget-groups" actions={<Link className={btn.link} href={`${base}/budget`}>{t('finance.summary.openBudget')}</Link>}>
            <p className="mb-3 text-sm text-muted">{t('finance.summary.perCurrencyNote')}</p>
            {s.budget.groups.length === 0 ? (
              <p className="text-sm text-muted">{t('finance.budget.empty')}</p>
            ) : (
              <ScrollRegion label={t('finance.summary.budgetByCurrency')} className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <caption className="sr-only">{t('finance.summary.budgetByCurrency')}</caption>
                  <thead className="bg-surface-muted">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-start font-semibold">{t('finance.summary.currencyUnit')}</th>
                      <th scope="col" className="px-3 py-2 text-start font-semibold">{t('finance.summary.lineCount')}</th>
                      <th scope="col" className="px-3 py-2 text-start font-semibold">{t('finance.budget.approvedRecorded')}</th>
                      <th scope="col" className="px-3 py-2 text-start font-semibold">{t('finance.budget.committed')}</th>
                      <th scope="col" className="px-3 py-2 text-start font-semibold">{t('finance.budget.spent')}</th>
                      <th scope="col" className="px-3 py-2 text-start font-semibold">{t('finance.budget.openCommitment')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.budget.groups.map((g) => (
                      <tr key={`${g.currency}-${g.unitScale}`} className="border-t border-line" data-currency={g.currency} data-unit-scale={g.unitScale}>
                        <th scope="row" className="px-3 py-2 text-start font-medium">
                          <span dir="ltr">{g.currency}</span> · {unit(g.unitScale)}
                        </th>
                        <td className="px-3 py-2 tabular">
                          <Link className={btn.link} href={`${base}/budget`}>
                            {formatNumber(g.lineCount)}
                          </Link>
                        </td>
                        <td className="px-3 py-2">
                          <Amount value={g.approved} />
                        </td>
                        <td className="px-3 py-2">
                          <Amount value={g.committed} />
                        </td>
                        <td className="px-3 py-2">
                          <Amount value={g.spent} />
                        </td>
                        <td className="px-3 py-2">
                          <Amount value={g.openCommitment} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollRegion>
            )}
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title={t('finance.summary.differences')} testId="recon-differences">
              {s.intercompany.differences.length === 0 ? (
                <p className="text-sm text-muted">{t('finance.summary.noDifferences')}</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {s.intercompany.differences.map((d) => (
                    <li key={`${d.currency}-${d.unitScale}`} className="flex flex-wrap items-center gap-2">
                      <Amount value={{ amount: d.amount, currency: d.currency, unitScale: d.unitScale }} showUnits />
                      <Link className={btn.link} href={`${base}/reconciliations?unreconciled=true`}>
                        {t('finance.summary.differenceCount', { count: formatNumber(d.count) })}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3">
                <StatusCounts
                  enumName="approvalStates"
                  counts={s.intercompany.byFlag}
                  href={() => `${base}/reconciliations`}
                  testId="recon-by-flag"
                  label={(f) => t(`finance.recon.flags.${f as 'reconciled'}`)}
                />
              </div>
            </Panel>
            <Panel title={t('finance.summary.findings')} testId="summary-findings">
              <MessageList messages={s.findingsI18n} fallback={s.findings} tone="warning" empty={t('finance.summary.noFindings')} />
              <p className="mt-2 text-xs text-muted">{t('finance.summary.findingsHint')}</p>
            </Panel>
          </div>

          <AggregatePanel />
          <ActivityHistory projectId={projectId} />
        </div>
      ) : null}
    </>
  );
}

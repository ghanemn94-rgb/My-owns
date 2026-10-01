'use client';

import Link from 'next/link';
import { DataTable, type Column } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { PageHeader } from '@/components/PageHeader';
import { RestrictedState } from '@/components/RestrictedState';
import { StatusBadge } from '@/components/StatusBadge';
import { btn } from '@/components/ui';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { useProjectContext } from '@/lib/project-context';
import { useKpiCatalogue, useReportLabels, type KpiEntry } from '@/lib/reports';
import { Callout } from '../_components/rp';

/**
 * Proposed KPI catalogue (spec §11; REQ-RPT-012..014): every attribute of each KPI and its value computed now from the
 * records the caller may read. A KPI without source records stays "Proposed — no data" (never a historical value); a
 * source outside the caller's access reveals nothing.
 */
export default function KpiCataloguePage() {
  const { t, tStatus, hasStatus, locale, formatDate, formatDateTime } = useI18n();
  const { projectId, project, can } = useProjectContext();
  const cat = useKpiCatalogue();
  const L = useReportLabels(project.timezone);
  const loc = (en: string, ar: string | null) => (locale === 'ar' && ar ? ar : en);
  const columns: Column<KpiEntry>[] = [
    {
      key: 'kpi',
      header: t('reports.kpis.columns.kpi'),
      isRowHeader: true,
      cell: (k) => (
        <span className="flex flex-col gap-1">
          <span className="font-medium" dir="auto" data-user-text={locale === 'ar' && !k.nameAr ? '' : undefined}>
            {loc(k.name, k.nameAr)}
          </span>
          <span className="flex flex-wrap items-center gap-1">
            {k.isProposal ? <StatusBadge enumName="verificationStatuses" value="proposed" label={t('reports.kpis.proposal')} /> : null}
            {k.isDemo ? <DemoBadge /> : null}
          </span>
          {can('finance.record.read') ? (
            <Link className={`${btn.link} text-xs`} href={`/projects/${projectId}/finance/kpis/${k.kpiId}`} aria-label={t('reports.kpis.openInFinance', { kpi: loc(k.name, k.nameAr) })}>
              <span dir="ltr">{k.key}</span>
            </Link>
          ) : (
            <span className="text-xs text-muted" dir="ltr">
              {k.key}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'definition',
      header: t('reports.kpis.columns.definition'),
      cell: (k) => (
        <span className="flex min-w-56 flex-col gap-1 text-sm">
          <span dir="auto" data-user-text={locale === 'ar' && !k.definitionAr ? '' : undefined}>
            {loc(k.definition, k.definitionAr)}
          </span>
          <span className="text-xs text-muted">
            {t('reports.kpis.labels.formula')}:{' '}
            <span dir="auto" data-user-text={k.formulaAr ? undefined : ''}>
              {loc(k.formula, k.formulaAr)}
            </span>
          </span>
        </span>
      ),
    },
    {
      key: 'unit',
      header: t('reports.kpis.columns.unit'),
      cell: (k) => (
        <span className="flex flex-col text-sm">
          {/* QA-P5-07: fixed vocabularies are translated; a free value is shown as entered. */}
          {hasStatus('kpiUnits', k.unit) ? <span>{tStatus('kpiUnits', k.unit)}</span> : <span dir="auto" data-user-text="">{k.unit}</span>}
          {hasStatus('kpiPeriods', k.period) ? (
            <span className="text-xs text-muted">{tStatus('kpiPeriods', k.period)}</span>
          ) : (
            <span className="text-xs text-muted" dir="auto" data-user-text="">
              {k.period}
            </span>
          )}
        </span>
      ),
    },
    { key: 'owner', header: t('reports.kpis.columns.owner'), cell: (k) => (k.ownerRole ? tStatus('roleKeys', k.ownerRole) : <span className="text-muted">{EM_DASH}</span>) },
    { key: 'source', header: t('reports.kpis.columns.source'), cell: (k) => (
        <span dir="auto" data-user-text={k.sourceAr ? undefined : ''}>
          {loc(k.source, k.sourceAr)}
        </span>
      ),
    },
    {
      key: 'target',
      header: t('reports.kpis.columns.target'),
      cell: (k) => (
        <span className="flex min-w-40 flex-col gap-1 text-sm">
          {k.target ? (
            <span dir="auto" data-user-text="">
              {k.target}
            </span>
          ) : (
            <span>{t('reports.kpis.labels.noTarget')}</span>
          )}
          <span className="flex flex-col gap-0.5 text-xs text-muted">
            {(['green', 'amber', 'red'] as const).map((band) => (
              <span key={band}>
                {t(`reports.kpis.labels.${band}`)}:{' '}
                <bdi dir="auto" data-user-text={k.thresholdsAr ? undefined : ''}>
                  {loc(k.thresholds[band], k.thresholdsAr?.[band] ?? null)}
                </bdi>
              </span>
            ))}
          </span>
        </span>
      ),
    },
    { key: 'direction', header: t('reports.kpis.columns.direction'), cell: (k) => tStatus('kpiDirections', k.direction) },
    { key: 'frequency', header: t('reports.kpis.columns.frequency'), cell: (k) =>
        hasStatus('kpiFrequencies', k.frequency) ? (
          tStatus('kpiFrequencies', k.frequency)
        ) : (
          <span dir="auto" data-user-text="">
            {k.frequency}
          </span>
        ),
    },
    {
      key: 'verified',
      header: t('reports.kpis.columns.verified'),
      cell: (k) => (
        <span className="flex flex-col gap-1">
          <StatusBadge enumName="verificationStatuses" value={k.verificationStatus} />
          <span className="text-xs text-muted">{k.lastVerifiedAt ? formatDateTime(k.lastVerifiedAt) : t('reports.kpis.never')}</span>
        </span>
      ),
    },
    {
      key: 'value',
      header: t('reports.kpis.columns.value'),
      cell: (k) => (
        <span className="flex min-w-40 flex-col gap-1" data-testid="kpi-value" data-kpi={k.key} data-state={k.current.state} data-value={k.current.value ?? ''}>
          {k.current.state === 'computed' ? (
            <span className="tabular text-base font-semibold text-ink">{L.number(k.current.value)}</span>
          ) : null}
          <span className={k.current.state === 'computed' ? 'text-xs text-muted' : 'text-sm text-muted'}>{t(`reports.kpis.states.${k.current.state}`)}</span>
          {k.current.state === 'computed' && k.current.numerator !== null && k.current.denominator !== null ? (
            <span className="text-xs text-muted">{t('reports.kpis.fraction', { numerator: L.number(k.current.numerator), denominator: L.number(k.current.denominator) })}</span>
          ) : null}
          {k.current.notes.map((n) => (
            <span key={n} className="text-xs text-muted" data-code={n}>
              {L.note(n)}
            </span>
          ))}
        </span>
      ),
    },
  ];
  if (!can('reports.report.generate')) return <RestrictedState showHomeLink={false} />;
  return (
    <>
      <PageHeader title={t('reports.kpis.title')} description={t('reports.kpis.subtitle')} badges={cat.data ? <span className="text-sm text-muted">{t('reports.kpis.asOf', { date: formatDate(cat.data.asOfLocalDate) })}</span> : null} />
      {cat.data && !cat.data.definitionsReadable ? (
        <div className="mb-4">
          <Callout tone="info" testId="kpi-definitions-restricted">
            {t('reports.kpis.definitionsRestricted')}
          </Callout>
        </div>
      ) : null}
      <DataTable
        caption={t('reports.kpis.caption')}
        columns={columns}
        rows={cat.data?.items}
        rowKey={(k) => k.kpiId}
        isLoading={cat.isLoading}
        error={cat.error}
        onRetry={() => cat.refetch()}
        emptyTitle={t('reports.kpis.empty')}
        testId="kpi-catalogue"
      />
    </>
  );
}

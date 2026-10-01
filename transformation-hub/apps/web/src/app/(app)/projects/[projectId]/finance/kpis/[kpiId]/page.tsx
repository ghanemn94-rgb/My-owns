'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { DataTable, type Column } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { RestrictedState } from '@/components/RestrictedState';
import { StatusBadge } from '@/components/StatusBadge';
import { btn } from '@/components/ui';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { isApiError } from '@/lib/api';
import { finHref, useKpi, type KpiDetail } from '@/lib/finance';
import { useLocalized } from '@/lib/i18n-data';
import { useProjectContext } from '@/lib/project-context';
import { RecordObservationDialog } from '../../_components/benefit-forms';
import { BackToList, Facts, FinanceHistory, Panel, Person, UText } from '../../_components/fin';

type Observation = KpiDetail['observations'][number];

/** A KPI definition (spec §11) and its observations — append-only: a correction is a new observation. */
export default function KpiPage() {
  const { kpiId } = useParams<{ kpiId: string }>();
  const { t, tStatus, formatDateTime } = useI18n();
  const { projectId, can } = useProjectContext();
  const loc = useLocalized();
  const q = useKpi(kpiId);
  const [observe, setObserve] = useState(false);
  const base = finHref(projectId);
  if (q.isLoading) return <LoadingState />;
  if (q.error) return isApiError(q.error) && (q.error.status === 404 || q.error.status === 403) ? <RestrictedState /> : <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const k = q.data!;
  const name = loc(k.name, k.nameAr);
  const columns: Column<Observation>[] = [
    { key: 'period', header: t('finance.snapshots.period'), isRowHeader: true, cell: (o) => <span dir="ltr">{o.period}</span> },
    { key: 'value', header: t('finance.kpis.observe.valueColumn'), cell: (o) => <span dir="ltr" className="tabular">{o.value ?? EM_DASH}</span> },
    {
      key: 'ratio',
      header: t('finance.kpis.observe.ratio'),
      cell: (o) =>
        o.numerator !== null && o.denominator !== null ? (
          <span dir="ltr" className="tabular">
            {o.numerator} / {o.denominator}
          </span>
        ) : (
          <span className="text-muted">{EM_DASH}</span>
        ),
    },
    { key: 'quality', header: t('finance.kpis.observe.dataQuality'), cell: (o) => t(`finance.kpis.quality.${o.dataQuality}`) },
    { key: 'source', header: t('finance.kpis.observe.source'), cell: (o) => <span dir="auto">{o.sourceRef ?? EM_DASH}</span> },
    {
      key: 'recorded',
      header: t('finance.kpis.observe.recorded'),
      cell: (o) => (
        <span className="text-xs">
          <Person id={o.recordedBy} people={k.people} /> · <span className="tabular">{formatDateTime(o.computedAt)}</span>
        </span>
      ),
    },
    { key: 'note', header: t('finance.common.note'), cell: (o) => <UText value={o.note} /> },
  ];
  return (
    <>
      <PageHeader
        eyebrow={<BackToList href={`${base}/benefits#kpis`} label={t('finance.kpis.title')} />}
        title={
          <span>
            <span dir="ltr">{k.key}</span> — <span dir="auto">{name}</span>
          </span>
        }
        documentTitle={`${k.key} — ${name}`}
        badges={
          <>
            <StatusBadge enumName="verificationStatuses" value={k.verificationStatus} size="md" />
            {k.isDemo ? <DemoBadge /> : null}
          </>
        }
        actions={
          can('finance.kpi.manage') ? (
            <button type="button" className={btn.primary} onClick={() => setObserve(true)} data-testid="kpi-observe">
              <Plus aria-hidden="true" className="size-4" />
              {t('finance.kpis.observe.action')}
            </button>
          ) : null
        }
      />
      <div className="space-y-6" data-testid="kpi-detail">
        <Panel title={t('finance.kpis.definitionTitle')}>
          <Facts
            items={[
              // QA-P34-01h: a template KPI shows its template Arabic definition (null once the definition was edited).
              { label: t('finance.kpis.definition'), value: <UText value={loc(k.definition, k.definitionAr)} multiline />, wide: true },
              { label: t('finance.kpis.formula'), value: <UText value={k.formula} multiline />, wide: true },
              { label: t('finance.kpis.unit'), value: <UText value={k.unit} /> },
              { label: t('finance.kpis.period'), value: <UText value={k.period} /> },
              { label: t('finance.kpis.frequency'), value: <UText value={k.frequency} /> },
              { label: t('finance.kpis.direction'), value: tStatus('kpiDirections', k.direction) },
              { label: t('finance.kpis.target'), value: <UText value={k.target} /> },
              { label: t('finance.kpis.source'), value: <UText value={k.source} multiline />, wide: true },
              { label: t('finance.kpis.green'), value: <UText value={k.thresholds.green} /> },
              { label: t('finance.kpis.amber'), value: <UText value={k.thresholds.amber} /> },
              { label: t('finance.kpis.red'), value: <UText value={k.thresholds.red} /> },
              { label: t('finance.kpis.owner'), value: k.ownerUserId ? <Person id={k.ownerUserId} people={k.people} /> : k.ownerRole ? tStatus('roleKeys', k.ownerRole) : EM_DASH },
              { label: t('finance.kpis.computation'), value: <UText value={k.computation} /> },
              {
                label: t('finance.kpis.benefit'),
                value: k.benefitId ? (
                  <Link className={btn.link} href={`${base}/benefits/${k.benefitId}`}>
                    {t('finance.kpis.openBenefit')}
                  </Link>
                ) : (
                  EM_DASH
                ),
              },
              { label: t('finance.common.classification'), value: tStatus('classifications', k.classification) },
            ]}
          />
        </Panel>
        <section aria-labelledby="obs-heading" className="space-y-2">
          <h2 id="obs-heading" className="text-lg font-semibold text-ink">
            {t('finance.kpis.observations')}
          </h2>
          <p className="text-sm text-muted">{t('finance.kpis.observe.appendOnly')}</p>
          <DataTable
            caption={t('finance.kpis.observations')}
            columns={columns}
            rows={k.observations}
            rowKey={(o) => o.id}
            emptyTitle={t('finance.kpis.noObservation')}
            clientPageSize={20}
            testId="observations-table"
          />
        </section>
        <FinanceHistory entityType="kpi" entityId={k.id} />
      </div>
      {can('finance.kpi.manage') ? <RecordObservationDialog kpi={k} open={observe} onClose={() => setObserve(false)} /> : null}
    </>
  );
}

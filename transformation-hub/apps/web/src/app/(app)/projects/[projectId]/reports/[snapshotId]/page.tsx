'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ChevronLeft, ShieldAlert, ShieldCheck } from 'lucide-react';
import { DemoBadge } from '@/components/DemoBadge';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { btn, card, cx } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import { useProjectContext } from '@/lib/project-context';
import { reportsHref, scopeText, useReportLabels, useReportSnapshot } from '@/lib/reports';
import { Callout, Facts } from '../_components/rp';
import { ChangesPanel, ExportsPanel, SnapshotSectionView, sectionAnchor } from '../_components/snapshot-view';

/**
 * One frozen report snapshot (REQ-RPT-001..008, REQ-RPT-017): its metadata (as-of date, scope, baseline, classification,
 * unverified data, generator, content hash), the changes since the previous snapshot, every section the viewer may read
 * now (the others show only their title) and the viewer's own files. The API re-checks access on every load.
 */
export default function ReportSnapshotPage() {
  const { t, tStatus, formatDate, formatDateTime, formatNumber } = useI18n();
  const { projectId } = useProjectContext();
  const { snapshotId } = useParams<{ snapshotId: string }>();
  const snap = useReportSnapshot(snapshotId);
  const L = useReportLabels(snap.data?.project.timezone);
  const back = (
    <Link href={reportsHref(projectId)} className={cx(btn.link, 'inline-flex items-center gap-1 text-sm')}>
      <ChevronLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
      {t('reports.detail.back')}
    </Link>
  );
  if (snap.isLoading) return <LoadingState />;
  if (snap.error || !snap.data) return <ErrorState error={snap.error} onRetry={() => snap.refetch()} />;
  const s = snap.data;
  const kindLabel = tStatus('reportKinds', s.kind);
  return (
    <div className="space-y-5" data-testid="report-detail" data-kind={s.kind} data-hash={s.contentHash} data-complete={s.complete}>
      <PageHeader
        eyebrow={back}
        title={kindLabel}
        documentTitle={`${kindLabel} — ${formatDate(s.asOfLocalDate)}`}
        badges={
          <>
            {s.includesDemoData ? <DemoBadge /> : null}
            <StatusBadge enumName="classifications" value={s.classification} tone="neutral" />
            {s.integrity === 'verified' ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-success" data-testid="integrity" data-integrity={s.integrity}>
                <ShieldCheck aria-hidden="true" className="size-4" />
                {t('reports.detail.integrity.verified')}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-danger" data-testid="integrity" data-integrity={s.integrity}>
                <ShieldAlert aria-hidden="true" className="size-4" />
                {t('reports.detail.integrity.mismatch')}
              </span>
            )}
          </>
        }
        description={L.meta('snapshotNote')}
      />

      {s.project.isDemo ? <Callout tone="warning">{L.meta('demoBanner')}</Callout> : null}
      {!s.complete ? (
        <Callout tone="info" testId="partial-note">
          {L.meta('partialView')}
        </Callout>
      ) : null}

      <section className={cx(card, 'p-4')} aria-labelledby="report-meta-title" data-testid="report-meta">
        <h2 id="report-meta-title" className="mb-3 text-lg font-semibold text-ink">
          {L.meta('metadata')}
        </h2>
        <Facts
          items={[
            { label: L.meta('project'), value: <span dir="auto">{`${s.project.code} — ${s.project.name}`}</span> },
            { label: L.meta('asOf'), value: `${formatDate(s.asOfLocalDate)} (${L.dateOf(s.asOf)})`, testId: 'meta-as-of' },
            { label: L.meta('scope'), value: <span dir="auto">{scopeText(L, s)}</span>, testId: 'meta-scope' },
            { label: L.meta('baseline'), value: s.baseline ? L.meta('baselineVersion', { version: s.baseline.versionNo }) : L.meta('noBaseline'), testId: 'meta-baseline' },
            { label: L.meta('classification'), value: tStatus('classifications', s.classification), testId: 'meta-classification' },
            { label: L.meta('unverifiedData'), value: s.unverifiedCount ? L.meta('unverifiedCount', { count: formatNumber(s.unverifiedCount) }) : L.meta('none'), testId: 'meta-unverified' },
            { label: L.meta('generatedBy'), value: <span dir="auto">{s.generatedByName ?? L.meta('none')}</span> },
            { label: L.meta('generatedAt'), value: formatDateTime(s.generatedAt) },
            { label: t('reports.detail.sectionsNav'), value: t('reports.detail.sectionCount', { included: formatNumber(s.includedSectionCount), total: formatNumber(s.sectionCount) }), testId: 'meta-sections' },
            {
              label: L.meta('contentHash'),
              value: (
                <code dir="ltr" className="break-all font-mono text-xs" data-testid="meta-hash">
                  {s.contentHash}
                </code>
              ),
              wide: true,
            },
          ]}
        />
        <p className="mt-3 text-xs text-muted">{L.note('report.internal_approval_label')}</p>
      </section>

      <ChangesPanel snapshot={s} L={L} />

      <nav aria-label={t('reports.detail.sectionsNav')} className={cx(card, 'p-4')} data-testid="report-toc">
        <h2 className="mb-2 text-lg font-semibold text-ink">{L.meta('contents')}</h2>
        <ol className="grid list-decimal gap-1 ps-5 text-sm sm:grid-cols-2">
          {s.sections.map((sec) => (
            <li key={sec.key}>
              <a href={`#${sectionAnchor(sec.key)}`} className={cx(btn.link, !sec.included && 'text-muted')}>
                {L.section(sec.key)}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="space-y-4">
        {s.sections.map((sec) => (
          <SnapshotSectionView key={sec.key} section={sec} L={L} />
        ))}
      </div>

      <ExportsPanel snapshot={s} />
    </div>
  );
}

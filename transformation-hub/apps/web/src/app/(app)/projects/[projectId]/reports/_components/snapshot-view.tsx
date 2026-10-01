'use client';

import Link from 'next/link';
import { Download, EyeOff, FileDown } from 'lucide-react';
import { useState } from 'react';
import { isApiError } from '@/lib/api';
import { DataTable, type Column } from '@/components/DataTable';
import { ScrollRegion } from '@/components/ScrollRegion';
import { StatusBadge } from '@/components/StatusBadge';
import { btn, card, cx } from '@/components/ui';
import { INTL_LOCALE } from '@/i18n/config';
import { EM_DASH, useI18n, type MessageKey } from '@/i18n/provider';
import { formatBytes } from '@/lib/documents';
import { useProjectContext } from '@/lib/project-context';
import { exportDownloadHref, reportsHref, useReportDiff, useReportExports, type ReportExport, type ReportLabels, type SnapshotDetail, type SnapshotDiff, type SnapshotSection, type SnapshotTable } from '@/lib/reports';
import { ExportReportDialog, Panel } from './rp';

const NUMERIC = new Set(['number', 'percent', 'money']);
/** Instants recorded as text (e.g. computed at, approved at) are dates: kept on one line. */
const isInstant = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v);
const NO_WRAP = new Set(['code', 'date', 'number', 'percent', 'money', 'boolean']);
/**
 * Record texts shown as recorded (titles, names, codes; a template text without an Arabic source): marked `data-user-text`
 * so the Arabic-screen check (e2e/tests/qa-rtl-detector.ts) does not mistake them for untranslated UI text.
 */
const USER_TEXT = new Set(['text', 'bilingual', 'person']);

/** Anchor id of a section (keys may contain dots, e.g. `kpis.planning`). */
export const sectionAnchor = (key: string) => `section-${key.replace(/[^A-Za-z0-9_-]/g, '-')}`;

/** One table of a section, with exactly the headers and cell texts the exported files print. */
function ReportTableView({ table, L }: { table: SnapshotTable; L: ReportLabels }) {
  const title = L.table(table.key);
  return (
    <div className="space-y-1.5" data-testid="report-table" data-table={table.key} data-rows={table.rows.length} data-total={table.totalRows}>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {table.rows.length === 0 ? (
        <p className="text-sm text-muted">{L.meta('noRows')}</p>
      ) : (
        <ScrollRegion label={title} className="overflow-x-auto rounded-md border border-line">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{title}</caption>
            <thead className="bg-surface-muted">
              <tr>
                {table.columns.map((c) => (
                  <th key={c.key} scope="col" className={cx('border-b border-line px-2.5 py-1.5 text-start text-xs font-semibold text-ink', NUMERIC.has(c.type) && 'text-end')}>
                    {L.column(c.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i} className="border-b border-line last:border-b-0">
                  {table.columns.map((c) => (
                    <td key={c.key} className={cx('px-2.5 py-1.5 align-top', NUMERIC.has(c.type) && 'text-end tabular', (NO_WRAP.has(c.type) || isInstant(r[c.key])) && 'whitespace-nowrap')} data-column={c.key}>
                      {c.type === 'code' ? (
                        <span dir="ltr" data-user-text="">
                          {L.cell(c.type, c.enumName, r[c.key])}
                        </span>
                      ) : (
                        <span dir="auto" className={c.type === 'text' || c.type === 'bilingual' ? 'break-words' : undefined} data-user-text={USER_TEXT.has(c.type) && r[c.key] !== null && r[c.key] !== '' ? '' : undefined}>
                          {L.cell(c.type, c.enumName, r[c.key])}
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      )}
      {table.truncated ? <p className="text-xs text-muted">{L.meta('truncated', { shown: L.number(table.rows.length), total: L.number(table.totalRows) })}</p> : null}
    </div>
  );
}

/** A section of the snapshot: its figures, tables, notes, unverified data and sources — or, outside the viewer's access, only its title. */
export function SnapshotSectionView({ section, L }: { section: SnapshotSection; L: ReportLabels }) {
  const { t, tStatus, formatNumber } = useI18n();
  const id = sectionAnchor(section.key);
  const isKpi = section.key.startsWith('kpis.');
  return (
    <section aria-labelledby={`${id}-title`} id={id} className={cx(card, 'scroll-mt-4 space-y-4 p-4')} data-testid="report-section" data-section={section.key} data-included={section.included}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${id}-title`} className="text-base font-semibold text-ink">
          {L.section(section.key)}
        </h2>
        {section.included && section.classification ? (
          <StatusBadge enumName="classifications" value={section.classification} tone="neutral" label={L.meta('sectionClassification', { classification: tStatus('classifications', section.classification) })} />
        ) : null}
      </div>
      {!section.included ? (
        <p className="flex items-start gap-2 text-sm text-muted" data-testid="section-withheld">
          <EyeOff aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {L.meta('withheld')}
        </p>
      ) : (
        <>
          {!isKpi && section.figures.length ? (
            <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-label={L.meta('figures')}>
              {section.figures.map((f) => (
                <div key={f.key} className="rounded-md border border-line bg-surface-muted/50 px-3 py-2" data-testid="report-figure" data-key={f.key} data-value={f.value ?? ''}>
                  <dt className="text-xs text-muted">{L.figure(f.key)}</dt>
                  <dd className="tabular text-lg font-semibold text-ink">{L.figureText(f.unit, f.value)}</dd>
                  {f.compared && f.previous !== f.value ? <dd className="text-xs text-muted">{L.meta('previous', { value: L.figureText(f.unit, f.previous) })}</dd> : null}
                </div>
              ))}
            </dl>
          ) : null}
          {section.tables.map((tb) => (
            <ReportTableView key={tb.key} table={tb} L={L} />
          ))}
          {section.notes.length ? (
            <div>
              <h3 className="text-sm font-semibold text-ink">{L.meta('notesTitle')}</h3>
              <ul className="mt-1 list-disc space-y-0.5 ps-5 text-sm text-ink" data-testid="section-notes">
                {section.notes.map((n, i) => (
                  <li key={`${n.code}-${i}`} data-code={n.code}>
                    {L.note(n)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {section.unverified.length ? (
            <div>
              <h3 className="text-sm font-semibold text-ink">{L.meta('unverifiedData')}</h3>
              <ul className="mt-1 space-y-0.5 text-sm" data-testid="section-unverified">
                {section.unverified.map((u, i) => (
                  <li key={`${u.id ?? u.label}-${i}`} className="flex flex-wrap items-center gap-2">
                    <span dir="auto" data-user-text="">
                      {u.label}
                    </span>
                    <StatusBadge enumName="verificationStatuses" value={u.status} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {section.sourceRefs.length ? (
            <details className="text-sm">
              <summary className="cursor-pointer font-medium text-ink">
                {L.meta('sources')} ({formatNumber(section.sourceRefs.length)})
              </summary>
              <ul className="mt-1 space-y-0.5 ps-5 text-muted">
                {section.sourceRefs.map((s, i) => (
                  <li key={`${s.id ?? s.label}-${i}`} dir="auto" data-user-text={s.type === 'register' ? undefined : ''}>
                    {L.source(s)}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}

/** Figures that changed since the previous snapshot of the same kind and scope (sections readable in both). */
export function ChangesPanel({ snapshot, L }: { snapshot: SnapshotDetail; L: ReportLabels }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const diff = useReportDiff(snapshot.id, !!snapshot.previousSnapshotId);
  const hidden = isApiError(diff.error) && diff.error.isHidden;
  type Change = SnapshotDiff['changes'][number];
  const columns: Column<Change>[] = [
    { key: 'section', header: t('reports.detail.changes.section'), cell: (c) => L.section(c.section) },
    { key: 'figure', header: t('reports.detail.changes.figure'), isRowHeader: true, cell: (c) => L.figure(c.key) },
    { key: 'before', header: t('reports.detail.changes.before'), cell: (c) => <span className="tabular">{L.number(c.before)}</span> },
    { key: 'after', header: t('reports.detail.changes.after'), cell: (c) => <span className="tabular">{L.number(c.after)}</span> },
    { key: 'delta', header: t('reports.detail.changes.delta'), cell: (c) => <span className="tabular" dir="ltr">{c.delta === null ? EM_DASH : `${c.delta > 0 ? '+' : ''}${L.number(c.delta)}`}</span> },
  ];
  return (
    <Panel
      title={t('reports.detail.changes.title')}
      testId="report-changes"
      actions={
        snapshot.previousSnapshotId && !hidden ? (
          <Link className={btn.link} href={reportsHref(projectId, `/${snapshot.previousSnapshotId}`)} data-testid="previous-snapshot">
            {t('reports.detail.openPrevious')}
          </Link>
        ) : null
      }
    >
      {!snapshot.previousSnapshotId ? (
        <p className="text-sm text-muted">{t('reports.detail.changes.first')}</p>
      ) : hidden ? (
        <p className="text-sm text-muted">{t('reports.detail.changes.unavailable')}</p>
      ) : diff.data && diff.data.changes.length === 0 ? (
        <p className="text-sm text-muted" data-testid="changes-none">
          {t('reports.detail.changes.none')}
        </p>
      ) : (
        <DataTable
          caption={t('reports.detail.changes.caption')}
          columns={columns}
          rows={diff.data?.changes}
          rowKey={(c) => `${c.section}.${c.key}`}
          isLoading={diff.isLoading}
          error={diff.error}
          onRetry={() => diff.refetch()}
          emptyTitle={t('reports.detail.changes.none')}
          testId="changes-table"
        />
      )}
    </Panel>
  );
}

/** The caller's own files of this snapshot: status (polled while rendering), size, download link once ready. */
export function ExportsPanel({ snapshot }: { snapshot: SnapshotDetail }) {
  const { t, tStatus, formatDateTime, locale } = useI18n();
  const { projectId } = useProjectContext();
  const [open, setOpen] = useState(false);
  const list = useReportExports(snapshot.id, snapshot.canExport);
  const columns: Column<ReportExport>[] = [
    {
      key: 'file',
      header: t('reports.exports.columns.file'),
      isRowHeader: true,
      cell: (e) => (e.filename ? <span dir="ltr" className="break-all">{e.filename}</span> : <span className="text-muted">{t('reports.exports.pending')}</span>),
    },
    { key: 'format', header: t('reports.exports.columns.format'), cell: (e) => tStatus('exportFormats', e.format) },
    { key: 'language', header: t('reports.exports.columns.language'), cell: (e) => t(`reports.exports.languages.${e.locale}`) },
    {
      key: 'status',
      header: t('reports.exports.columns.status'),
      cell: (e) => (
        <span className="flex flex-col gap-0.5" data-testid="export-status" data-status={e.status} data-format={e.format} data-locale={e.locale}>
          <StatusBadge enumName="reportExportStatuses" value={e.status} tone={e.status === 'ready' ? 'success' : e.status === 'failed' ? 'danger' : e.status === 'cancelled' ? 'warning' : 'info'} />
          {e.errorCode ? <span className="text-xs text-muted">{t(`reports.exports.errors.${e.errorCode}` as MessageKey)}</span> : null}
        </span>
      ),
    },
    { key: 'size', header: t('reports.exports.columns.size'), cell: (e) => <span className="whitespace-nowrap tabular">{formatBytes(e.sizeBytes, INTL_LOCALE[locale])}</span> },
    { key: 'requested', header: t('reports.exports.columns.requested'), cell: (e) => <span className="whitespace-nowrap">{formatDateTime(e.createdAt)}</span> },
    {
      key: 'action',
      header: t('reports.exports.columns.action'),
      cell: (e) =>
        e.status === 'ready' && e.filename ? (
          <a className={cx(btn.secondary, 'whitespace-nowrap')} href={exportDownloadHref(projectId, e.id)} download={e.filename} aria-label={t('reports.exports.downloadFor', { file: e.filename })} data-testid="export-download">
            <Download aria-hidden="true" className="size-4" />
            {t('reports.exports.download')}
          </a>
        ) : (
          <span className="text-muted">{EM_DASH}</span>
        ),
    },
  ];
  return (
    <Panel
      title={t('reports.exports.title')}
      testId="report-exports"
      actions={
        snapshot.canExport ? (
          <button type="button" className={btn.primary} onClick={() => setOpen(true)} data-testid="export-report-open">
            <FileDown aria-hidden="true" className="size-4" />
            {t('reports.exports.request')}
          </button>
        ) : null
      }
    >
      <p className="mb-3 text-sm text-muted">{t('reports.exports.description')}</p>
      {snapshot.canExport ? (
        <DataTable
          caption={t('reports.exports.caption')}
          columns={columns}
          rows={list.data?.items}
          rowKey={(e) => e.id}
          isLoading={list.isLoading}
          error={list.error}
          onRetry={() => list.refetch()}
          emptyTitle={t('reports.exports.empty')}
          testId="exports-table"
        />
      ) : (
        <p className="text-sm text-muted" data-testid="export-not-allowed">
          {t('reports.detail.exportNotAllowed')}
        </p>
      )}
      {snapshot.canExport ? <ExportReportDialog open={open} onClose={() => setOpen(false)} snapshot={snapshot} /> : null}
    </Panel>
  );
}

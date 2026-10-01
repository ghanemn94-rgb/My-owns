'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { COMMITTEE_RECORD_REPORT_KINDS, GENERATABLE_REPORT_KINDS, REPORT_EXPORT_FORMATS, REPORT_LOCALES, WORKSTREAM_SCOPED_REPORT_KINDS, reportingRoutes, type GeneratableReportKind, type ReportExportFormat } from '@hub/contracts';
import { SelectField } from '@/components/Field';
import { useToast } from '@/components/Toast';
import { FormDialog } from '@/components/planning/dialogs';
import { cx, hint } from '@/components/ui';
import { useI18n, type MessageKey } from '@/i18n/provider';
import { api } from '@/lib/api';
import { useProjectContext } from '@/lib/project-context';
import { useWorkstreams } from '@/lib/queries';
import { reportsHref, useReportsRefresh, type SnapshotDetail } from '@/lib/reports';
import { workstreamName } from '@/lib/workstreams';
import { useMeetingList } from '../../committee/_components/gov';

export { FilterBar, FilterSelect, Facts, Section, useUrlState } from '../../committee/_components/gov';
export { Panel, Callout } from '../../readiness/_components/rd';

// ---------------------------------------------------------------------------------------------------------------
// Sub-navigation

const TABS = [
  { key: 'snapshots', segment: '', permission: 'reports.snapshot.read' },
  { key: 'kpis', segment: '/kpis', permission: 'reports.report.generate' },
  { key: 'bi', segment: '/bi', permission: 'admin.clearance.grant' },
] as const;

export function ReportsTabs() {
  const { t } = useI18n();
  const { projectId, can } = useProjectContext();
  const pathname = usePathname() ?? '';
  const base = reportsHref(projectId);
  const tabs = TABS.filter((tab) => can(tab.permission));
  // Snapshot detail pages (/reports/<id>) belong to the snapshots tab.
  const active = (segment: string) =>
    segment === '' ? !TABS.some((x) => x.segment && (pathname === `${base}${x.segment}` || pathname.startsWith(`${base}${x.segment}/`))) : pathname === `${base}${segment}` || pathname.startsWith(`${base}${segment}/`);
  if (tabs.length < 2) return null;
  return (
    <nav aria-label={t('reports.tabs.label')} className="mb-5 overflow-x-auto border-b border-line" data-testid="reports-tabs">
      <ul className="flex min-w-max gap-1">
        {tabs.map((tab) => {
          const on = active(tab.segment);
          return (
            <li key={tab.key}>
              <Link
                href={`${base}${tab.segment}`}
                aria-current={on ? 'page' : undefined}
                data-tab={tab.key}
                className={cx('inline-flex min-h-10 items-center border-b-2 px-3 text-sm font-medium', on ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-ink')}
              >
                {t(`reports.tabs.${tab.key}`)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Generate a report (snapshot command)

export function GenerateReportDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (snapshotId: string) => void }) {
  const { t, tStatus, locale, formatDate } = useI18n();
  const { projectId, can } = useProjectContext();
  const toast = useToast();
  const refresh = useReportsRefresh();
  const committeeRecords = can('reports.snapshot.create');
  const kinds = GENERATABLE_REPORT_KINDS.filter((k) => committeeRecords || !COMMITTEE_RECORD_REPORT_KINDS.includes(k));
  const [kind, setKind] = useState<GeneratableReportKind>('executive_summary');
  const [workstreamId, setWorkstreamId] = useState('');
  const [meetingId, setMeetingId] = useState('');
  useEffect(() => {
    if (open) {
      setKind('executive_summary');
      setWorkstreamId('');
      setMeetingId('');
    }
  }, [open]);
  const scoped = WORKSTREAM_SCOPED_REPORT_KINDS.includes(kind);
  const minutes = kind === 'minutes';
  const workstreams = useWorkstreams(projectId, open && scoped);
  const meetings = useMeetingList({ pageSize: 100 }, open && minutes);
  const meetingItems = meetings.data?.items ?? [];
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={t('reports.generate.title')}
      submitLabel={t('reports.generate.submit')}
      disabled={minutes && !meetingId}
      testId="generate-report"
      onSubmit={async () => {
        const created = await api(reportingRoutes.generateReport, {
          params: { projectId },
          body: { kind, ...(scoped && workstreamId ? { workstreamId } : {}), ...(minutes && meetingId ? { meetingId } : {}) },
        });
        await refresh();
        toast.show('success', t('reports.generate.done'));
        onClose();
        onCreated(created.id);
      }}
    >
      <p className="text-sm text-muted">{t('reports.generate.description')}</p>
      <SelectField
        label={t('reports.generate.kind')}
        required
        value={kind}
        onChange={(e) => setKind(e.target.value as GeneratableReportKind)}
        hint={t(`reports.generate.kindHints.${kind}` as MessageKey)}
        data-testid="report-kind"
      >
        {kinds.map((k) => (
          <option key={k} value={k}>
            {tStatus('reportKinds', k)}
          </option>
        ))}
      </SelectField>
      {!committeeRecords ? <p className={hint}>{t('reports.generate.committeeKindsHint')}</p> : null}
      {scoped ? (
        <SelectField label={t('reports.generate.workstream')} value={workstreamId} onChange={(e) => setWorkstreamId(e.target.value)} hint={t('reports.generate.workstreamHint')} data-testid="report-workstream">
          <option value="">{t('reports.generate.workstreamAll')}</option>
          {(workstreams.data?.items ?? []).map((w) => (
            <option key={w.id} value={w.id}>
              {w.code} — {workstreamName(w, locale)}
            </option>
          ))}
        </SelectField>
      ) : null}
      {minutes ? (
        <>
          <SelectField label={t('reports.generate.meeting')} required value={meetingId} onChange={(e) => setMeetingId(e.target.value)} data-testid="report-meeting">
            <option value="">{t('reports.generate.meetingSelect')}</option>
            {meetingItems.map((m) => (
              <option key={m.id} value={m.id}>
                {t('reports.generate.meetingOption', { committee: m.committeeName, number: m.number, title: m.title, date: formatDate(m.scheduledAt.slice(0, 10)) })}
              </option>
            ))}
          </SelectField>
          {meetings.data && meetingItems.length === 0 ? <p className="text-sm text-muted">{t('reports.generate.meetingNone')}</p> : null}
        </>
      ) : null}
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Export a snapshot (format + language)

/** Formats suggested first for a report kind (every format is available for every kind). */
function suggestedFormat(kind: string): ReportExportFormat {
  if (kind === 'committee_pack') return 'pptx';
  if (kind === 'minutes') return 'docx';
  return 'pdf';
}

export function ExportReportDialog({ open, onClose, snapshot }: { open: boolean; onClose: () => void; snapshot: SnapshotDetail }) {
  const { t, tStatus, locale } = useI18n();
  const { projectId } = useProjectContext();
  const toast = useToast();
  const refresh = useReportsRefresh();
  const [format, setFormat] = useState<ReportExportFormat>(suggestedFormat(snapshot.kind));
  const [fileLocale, setFileLocale] = useState<'en' | 'ar'>(locale);
  useEffect(() => {
    if (open) {
      setFormat(suggestedFormat(snapshot.kind));
      setFileLocale(locale);
    }
  }, [open, snapshot.kind, locale]);
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={t('reports.exports.dialogTitle')}
      submitLabel={t('reports.exports.submit')}
      testId="export-report"
      onSubmit={async () => {
        await api(reportingRoutes.requestReportExport, { params: { projectId, snapshotId: snapshot.id }, body: { format, locale: fileLocale } });
        await refresh();
        toast.show('success', t('reports.exports.requested'));
        onClose();
      }}
    >
      <p className="text-sm text-muted">{t('reports.exports.dialogDescription')}</p>
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink">{t('reports.exports.format')}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {REPORT_EXPORT_FORMATS.map((f) => (
            <label key={f} className={cx('flex cursor-pointer gap-3 rounded-md border p-3', format === f ? 'border-primary bg-primary-soft' : 'border-line hover:bg-surface-muted')}>
              <input type="radio" name="report-format" className="mt-1 size-4 accent-[var(--hub-primary)]" checked={format === f} onChange={() => setFormat(f)} data-testid={`export-format-${f}`} />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink">{tStatus('exportFormats', f)}</span>
                <span className="block text-xs text-muted">{t(`reports.exports.formatHints.${f}`)}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink">{t('reports.exports.language')}</legend>
        <div className="flex flex-wrap gap-2">
          {REPORT_LOCALES.map((l) => (
            <label key={l} className={cx('flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm', fileLocale === l ? 'border-primary bg-primary-soft' : 'border-line hover:bg-surface-muted')}>
              <input type="radio" name="report-locale" className="size-4 accent-[var(--hub-primary)]" checked={fileLocale === l} onChange={() => setFileLocale(l)} data-testid={`export-locale-${l}`} />
              <span>{t(`reports.exports.languages.${l}`)}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </FormDialog>
  );
}

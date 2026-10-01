'use client';

import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { buildPath, reportingRoutes, type ReportCellDto, type RouteQuery, type RouteResponse, type ServerMessageDto } from '@hub/contracts';
import { INTL_LOCALE } from '@/i18n/config';
import { EM_DASH, humanize, useI18n, type MessageKey, type StatusEnum } from '@/i18n/provider';
import { api } from './api';
import { useProjectContext } from './project-context';

/**
 * Reports (spec §11, §10 screen 16b; REQ-RPT-001..017) — types, query keys, hooks and the label / cell formatting of a
 * snapshot. The screen shows exactly what the exported files print: the same labels (`reports.content.*`, kept equal to
 * the API's file labels by apps/api/test/reporting/report-labels.spec.ts) and the same number, date and money formats.
 * The API re-checks the viewer's access on every read; this client only renders what it returns.
 */

type R = typeof reportingRoutes;
export type SnapshotSummary = RouteResponse<R['listReportSnapshots']>['items'][number];
export type SnapshotDetail = RouteResponse<R['getReportSnapshot']>;
export type SnapshotSection = SnapshotDetail['sections'][number];
export type SnapshotTable = SnapshotSection['tables'][number];
export type SnapshotFigure = SnapshotSection['figures'][number];
export type SnapshotDiff = RouteResponse<R['diffReportSnapshot']>;
export type ReportExport = RouteResponse<R['getReportExport']>;
export type KpiCatalogue = RouteResponse<R['getKpiCatalogue']>;
export type KpiEntry = KpiCatalogue['items'][number];
export type BiAccess = RouteResponse<R['getBiAccess']>;
export type BiGrant = BiAccess['grants'][number];

export const rk = {
  root: (pid: string) => ['reports', pid] as const,
  list: (pid: string, q: object) => ['reports', pid, 'list', q] as const,
  snapshot: (pid: string, id: string) => ['reports', pid, 'snapshot', id] as const,
  diff: (pid: string, id: string) => ['reports', pid, 'diff', id] as const,
  exports: (pid: string, id: string) => ['reports', pid, 'exports', id] as const,
  kpis: (pid: string) => ['reports', pid, 'kpis'] as const,
  bi: (pid: string) => ['reports', pid, 'bi'] as const,
};

export function reportsHref(projectId: string, segment = '') {
  return `/projects/${projectId}/reports${segment}`;
}

/** Same-origin download of a ready export (the API re-checks access and the checksum, and audits the download). */
export function exportDownloadHref(projectId: string, exportId: string) {
  return buildPath(reportingRoutes.downloadReportExport.path, { projectId, exportId });
}

export function useReportsRefresh() {
  const queryClient = useQueryClient();
  const { projectId } = useProjectContext();
  return useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: rk.root(projectId) });
  }, [queryClient, projectId]);
}

export function useReportSnapshots(query: RouteQuery<R['listReportSnapshots']>) {
  const { projectId, can } = useProjectContext();
  return useQuery({
    queryKey: rk.list(projectId, query),
    queryFn: ({ signal }) => api(reportingRoutes.listReportSnapshots, { params: { projectId }, query, signal }),
    enabled: can('reports.snapshot.read'),
    placeholderData: (prev) => prev,
  });
}

export function useReportSnapshot(snapshotId: string) {
  const { projectId } = useProjectContext();
  return useQuery({
    queryKey: rk.snapshot(projectId, snapshotId),
    queryFn: ({ signal }) => api(reportingRoutes.getReportSnapshot, { params: { projectId, snapshotId }, signal }),
    retry: false,
  });
}

export function useReportDiff(snapshotId: string, enabled: boolean) {
  const { projectId } = useProjectContext();
  return useQuery({
    queryKey: rk.diff(projectId, snapshotId),
    queryFn: ({ signal }) => api(reportingRoutes.diffReportSnapshot, { params: { projectId, snapshotId }, query: {}, signal }),
    enabled,
    retry: false,
  });
}

const PENDING: readonly string[] = ['queued', 'rendering'];

/** The caller's own exports of a snapshot; polls every 2 s while one is queued or rendering. */
export function useReportExports(snapshotId: string, enabled: boolean) {
  const { projectId } = useProjectContext();
  return useQuery({
    queryKey: rk.exports(projectId, snapshotId),
    queryFn: ({ signal }) => api(reportingRoutes.listReportExports, { params: { projectId, snapshotId }, query: { pageSize: 50 }, signal }),
    enabled,
    refetchInterval: (q) => (q.state.data?.items.some((e) => PENDING.includes(e.status)) ? 2000 : false),
  });
}

export function useKpiCatalogue() {
  const { projectId, can } = useProjectContext();
  return useQuery({
    queryKey: rk.kpis(projectId),
    queryFn: ({ signal }) => api(reportingRoutes.getKpiCatalogue, { params: { projectId }, signal }),
    enabled: can('reports.report.generate'),
  });
}

export function useBiAccess() {
  const { projectId, can } = useProjectContext();
  return useQuery({
    queryKey: rk.bi(projectId),
    queryFn: ({ signal }) => api(reportingRoutes.getBiAccess, { params: { projectId }, signal }),
    enabled: can('admin.clearance.grant'),
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Labels and values — the same texts and formats as the exported files (apps/api/src/modules/reporting/render).

type Money = { amount: string; currency: string; unitScale: number };
const isMoney = (v: unknown): v is Money => !!v && typeof v === 'object' && 'amount' in v && 'currency' in v;
const isBilingual = (v: unknown): v is { en: string; ar: string | null } => !!v && typeof v === 'object' && 'en' in v;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T/;

export type ReportLabels = ReturnType<typeof useReportLabels>;

/**
 * Report content labels and value formatting. `timezone` is the project's (instants are shown there, as in the files);
 * business dates are calendar dates and never shift a day.
 */
export function useReportLabels(timezone = 'Asia/Riyadh') {
  const { t, tStatus, hasStatus, locale } = useI18n();
  return useMemo(() => {
    const intl = INTL_LOCALE[locale];
    const dateFmt = new Intl.DateTimeFormat(intl, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    const dateTimeFmt = new Intl.DateTimeFormat(intl, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: timezone });
    const numFmt = new Intl.NumberFormat(intl, { maximumFractionDigits: 1 });
    const groupFmt = new Intl.NumberFormat(intl);
    const decimalSep = new Intl.NumberFormat(intl, { minimumFractionDigits: 1 }).formatToParts(1.5).find((p) => p.type === 'decimal')?.value ?? '.';

    /** A content label; unknown keys (a newer snapshot schema) are humanised rather than shown as an i18n key. */
    const label = (group: string, key: string, values?: Record<string, string | number>) => {
      const k = `reports.content.${group}.${key}`;
      const s = t(k as MessageKey, values);
      return s === k ? humanize(key) : s;
    };
    const meta = (key: string, values?: Record<string, string | number>) => label('meta', key, values);
    const dateOf = (v: string | null | undefined) => {
      if (!v) return EM_DASH;
      if (ISO_DATE.test(v)) return dateFmt.format(new Date(`${v}T00:00:00Z`));
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? v : dateTimeFmt.format(d);
    };
    const number = (n: number | null | undefined) => (n === null || n === undefined ? EM_DASH : numFmt.format(n));
    const money = (m: Money) => {
      const neg = m.amount.startsWith('-');
      const [int, frac = ''] = m.amount.replace('-', '').split('.');
      let grouped: string;
      try {
        grouped = groupFmt.format(BigInt(int || '0'));
      } catch {
        grouped = int ?? '0';
      }
      const scale = m.unitScale === 1000 ? meta('thousands') : m.unitScale === 1_000_000 ? meta('millions') : '';
      return `${neg ? '-' : ''}${m.currency} ${grouped}${decimalSep}${(frac + '00').slice(0, 2)}${scale ? ` ${scale}` : ''}`;
    };
    const enumLabel = (enumName: string | null, value: string) => {
      let name = enumName;
      let v = value;
      if (!name && value.includes(':')) [name, v] = value.split(':', 2) as [string, string];
      if (!name) return v;
      const own = `reports.content.enums.${name}.${v}`;
      const ownText = t(own as MessageKey);
      if (ownText !== own) return ownText;
      return hasStatus(name as StatusEnum, v) ? tStatus(name as StatusEnum, v) : v.replace(/_/g, ' ');
    };
    const figureText = (unit: string, v: number | null) => (v === null ? EM_DASH : unit === 'percent' ? `${number(v)}%` : number(v));
    /** One table cell, exactly as the files print it. */
    const cell = (type: string, enumName: string | null, v: ReportCellDto | undefined): string => {
      if (v === null || v === undefined || v === '') return type === 'person' ? meta('notAssigned') : EM_DASH;
      if (isBilingual(v)) return locale === 'ar' ? (v.ar ?? v.en) : v.en;
      if (isMoney(v)) return money(v);
      if (typeof v === 'boolean') return v ? meta('yes') : meta('no');
      switch (type) {
        case 'date':
          return dateOf(String(v));
        case 'number':
          return typeof v === 'number' ? number(v) : String(v);
        case 'percent':
          return typeof v === 'number' ? `${number(v)}%` : String(v);
        case 'enum':
          return enumLabel(enumName, String(v));
        case 'text':
          return typeof v === 'string' && ISO_INSTANT.test(v) ? dateOf(v) : String(v);
        default:
          return String(v);
      }
    };
    /** Server explanation (code + parameters): dates and numbers in the active language, as in the files. */
    const note = (m: ServerMessageDto | string) => {
      const code = typeof m === 'string' ? m : m.code;
      const params: Record<string, string | number> = {};
      for (const [k, v] of Object.entries(typeof m === 'string' ? {} : m.params)) params[k] = typeof v === 'string' && ISO_DATE.test(v) ? dateOf(v) : typeof v === 'number' ? number(v) : v;
      return label('notes', code, params);
    };
    return {
      meta,
      section: (key: string) => label('sections', key),
      table: (key: string) => label('tables', key),
      column: (key: string) => label('columns', key),
      figure: (key: string) => label('figures', key),
      note,
      /** A source reference: registers in the active language, record references (codes, titles) as recorded. */
      source: (r: { type: string; label: string }) => (r.type === 'register' ? label('sources', r.label) : r.label),
      enumLabel,
      cell,
      figureText,
      dateOf,
      number,
    };
  }, [t, tStatus, hasStatus, locale, timezone]);
}

/** Scope of a snapshot in words (whole project / workstream code / meeting minutes). */
export function scopeText(L: ReportLabels, s: { scope: { workstreamCode: string | null; meetingId: string | null } }) {
  return s.scope.workstreamCode ? L.meta('scopeWorkstream', { code: s.scope.workstreamCode }) : s.scope.meetingId ? L.meta('scopeMeeting') : L.meta('scopeProject');
}

import type { Classification, ServerMessage } from '@hub/domain';
import type { ReportCellDto, ReportColumnType, ReportFigureDto, ReportTableDto } from '@hub/contracts';
import type { ReportSectionAccess } from '@hub/db';

/**
 * Stored shape of a report snapshot payload (`report_snapshot.payload`, schema `hub.report/1`). Everything a renderer or
 * a screen shows comes from here — never from live records — so the figures of a snapshot never change (REQ-RPT-016).
 */
export interface StoredSection {
  key: string;
  access: ReportSectionAccess;
  figures: ReportFigureDto[];
  tables: ReportTableDto[];
  notes: ServerMessage[];
  unverified: { type: string; id: string | null; label: string; status: string }[];
  sourceRefs: { type: string; id: string | null; label: string }[];
}

export interface StoredReportPayload {
  schemaVersion: string;
  kind: string;
  project: { id: string; code: string; name: string; timezone: string; isDemo: boolean };
  asOf: string;
  asOfLocalDate: string;
  scope: { workstreamId: string | null; workstreamCode: string | null; workstreamName: string | null; workstreamNameAr: string | null; meetingId: string | null };
  baseline: { id: string; versionNo: number; approvedAt: string | null } | null;
  generatedBy: { id: string | null; name: string | null };
  sections: StoredSection[];
}

/** Maximum rows kept per table in a snapshot (the total is recorded; `truncated` tells the reader). */
export const TABLE_ROW_LIMIT = 200;

export function table(key: string, columns: [string, ReportColumnType, string?][], rows: Record<string, ReportCellDto>[], limit = TABLE_ROW_LIMIT): ReportTableDto {
  return {
    key,
    columns: columns.map(([k, type, enumName]) => ({ key: k, type, enumName: enumName ?? null })),
    rows: rows.slice(0, limit),
    totalRows: rows.length,
    truncated: rows.length > limit,
  };
}

export function figure(key: string, value: number | null, unit: ReportFigureDto['unit'] = 'count'): ReportFigureDto {
  return { key, value, unit, compared: false, previous: null };
}

/** Bilingual cell for template-seeded titles (Arabic null when the record has none). */
export const bi = (en: string, ar: string | null | undefined) => ({ en, ar: ar ?? null });

export function section(key: string, access: ReportSectionAccess, parts: Partial<Omit<StoredSection, 'key' | 'access'>> = {}): StoredSection {
  return {
    key,
    access,
    figures: parts.figures ?? [],
    tables: parts.tables ?? [],
    notes: parts.notes ?? [],
    unverified: parts.unverified ?? [],
    sourceRefs: parts.sourceRefs ?? [],
  };
}

export type { Classification };

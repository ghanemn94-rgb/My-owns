import { maxClassification, type Classification } from '@hub/domain';
import type { ReportSectionDtoT, ReportSnapshot, ReportSnapshotSummary } from '@hub/contracts';
import type { schema } from '@hub/db';
import { payloadHash } from '../../platform/ids';
import type { RequestContext } from '../../platform/context';
import type { ReportAccess } from './report-access';
import type { StoredReportPayload, StoredSection } from './report-model';

export type SnapshotRow = typeof schema.reportSnapshot.$inferSelect;

/** What one viewer may see of a snapshot NOW (sections re-checked); null = nothing (→ 404). */
export interface ReportView {
  row: SnapshotRow;
  payload: StoredReportPayload;
  included: StoredSection[];
  sections: { key: string; included: boolean; section: StoredSection | null }[];
  classification: Classification;
  complete: boolean;
}

export function isReportSnapshot(row: Pick<SnapshotRow, 'schemaVersion'>): boolean {
  return !!row.schemaVersion && row.schemaVersion.startsWith('hub.report/');
}

/**
 * Viewer projection of a snapshot (REQ-RPT-017): every section is re-checked against the viewer's CURRENT access; a
 * section that no longer passes is returned without any content. No section left → null (the caller answers 404).
 */
export function buildView(access: ReportAccess, ctx: RequestContext, row: SnapshotRow): ReportView | null {
  if (!isReportSnapshot(row)) return null;
  const payload = row.payload as unknown as StoredReportPayload;
  const sections = payload.sections.map((s) => {
    const ok = access.canSee(ctx, row.projectId, s.access);
    return { key: s.key, included: ok, section: ok ? s : null };
  });
  const included = sections.filter((s) => s.included).map((s) => s.section!);
  if (!included.length) return null;
  return { row, payload, included, sections, classification: maxClassification(included.map((s) => s.access.classification)), complete: included.length === sections.length };
}

/** Cheap list-level check on the `sections` column (no payload needed). */
export function visibleSectionCount(access: ReportAccess, ctx: RequestContext, row: Pick<SnapshotRow, 'projectId' | 'sections' | 'schemaVersion'>): { included: number; total: number; classification: Classification } {
  if (!isReportSnapshot(row)) return { included: 0, total: 0, classification: 'internal' };
  const ok = row.sections.filter((s) => access.canSee(ctx, row.projectId, s));
  return { included: ok.length, total: row.sections.length, classification: maxClassification(ok.map((s) => s.classification)) };
}

export function summaryOf(row: SnapshotRow, counts: { included: number; total: number; classification: Classification }, generatedByName: string | null): ReportSnapshotSummary {
  const scope = (row.scope ?? {}) as Partial<StoredReportPayload['scope']>;
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    locale: row.locale,
    asOf: row.asOf.toISOString(),
    asOfLocalDate: row.asOfLocalDate,
    scope: {
      workstreamId: scope.workstreamId ?? null,
      workstreamCode: scope.workstreamCode ?? null,
      workstreamName: scope.workstreamName ?? null,
      workstreamNameAr: scope.workstreamNameAr ?? null,
      meetingId: scope.meetingId ?? null,
    },
    baselineVersionNo: row.baselineVersionNo,
    classification: counts.classification,
    complete: counts.included === counts.total,
    sectionCount: counts.total,
    includedSectionCount: counts.included,
    includesDemoData: !!row.includesDemoData,
    generatedBy: row.generatedBy,
    generatedByName,
    generatedAt: row.generatedAt.toISOString(),
    contentHash: row.contentHash,
    previousSnapshotId: row.previousSnapshotId,
  };
}

export function sectionDto(s: { key: string; included: boolean; section: StoredSection | null }): ReportSectionDtoT {
  if (!s.included || !s.section) return { key: s.key, included: false, classification: null, workstreamScope: null, figures: [], tables: [], notes: [], unverified: [], sourceRefs: [] };
  const x = s.section;
  return { key: x.key, included: true, classification: x.access.classification, workstreamScope: x.access.workstreamIds, figures: x.figures, tables: x.tables, notes: x.notes, unverified: x.unverified, sourceRefs: x.sourceRefs };
}

export function detailOf(v: ReportView, generatedByName: string | null, approvalLabel: string, canExport: boolean): ReportSnapshot {
  const counts = { included: v.included.length, total: v.sections.length, classification: v.classification };
  return {
    ...summaryOf(v.row, counts, generatedByName),
    project: v.payload.project,
    baseline: v.payload.baseline,
    integrity: payloadHash(v.row.payload) === v.row.contentHash ? 'verified' : 'mismatch',
    unverifiedCount: v.included.reduce((a, s) => a + s.unverified.length, 0),
    approvalLabel,
    sections: v.sections.map(sectionDto),
    canExport,
  };
}

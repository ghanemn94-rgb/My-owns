import { z } from 'zod';
import { REPORT_KINDS, KPI_DIRECTIONS } from '@hub/domain';
import { defineRoute, registerRoutes } from './route';
import { ClassificationSchema, IsoDate, MoneySchema, NoSort, PageQuery, ProjectParams, ServerMessageSchema, SortParam, Uuid, paged } from './common';

/**
 * Reporting (spec §11, ADR-0011): immutable report snapshots with their metadata, genuine XLSX / PDF / PPTX / DOCX
 * exports rendered by the worker from a snapshot, and the proposed KPI catalogue.
 *
 * Access model (REQ-RPT-017, access-matrix §2.6): a snapshot is generated under the generator's current access (every
 * query applies the generator's visibility, workstream reach and clearance inside SQL; partner-room and clean-team
 * material is never included). Each section records the read permission(s) of its records, their highest classification
 * and the workstream reach. Reading or exporting re-checks the viewer's CURRENT access: outside the project, room-only,
 * without `reports.snapshot.read`, or with no section left → 404; a section the viewer can no longer read is returned
 * as `included: false` with no content (no counts, titles or figures).
 */

export const GENERATABLE_REPORT_KINDS = [
  'executive_summary',
  'committee_pack',
  'workstream_weekly',
  'look_ahead',
  'day1_readiness',
  'tsa_exit',
  'jv_closing',
  'health_data_quality',
  'minutes',
] as const;
export type GeneratableReportKind = (typeof GENERATABLE_REPORT_KINDS)[number];
/** Kinds that are committee records: generating them also needs `reports.snapshot.create` (secretariat / PM). */
export const COMMITTEE_RECORD_REPORT_KINDS: readonly GeneratableReportKind[] = ['committee_pack', 'minutes'];
/** Kinds that may be limited to one workstream. */
export const WORKSTREAM_SCOPED_REPORT_KINDS: readonly GeneratableReportKind[] = ['workstream_weekly', 'look_ahead'];

export const REPORT_EXPORT_FORMATS = ['xlsx', 'pdf', 'pptx', 'docx'] as const;
export type ReportExportFormat = (typeof REPORT_EXPORT_FORMATS)[number];
export const REPORT_EXPORT_STATUSES = ['queued', 'rendering', 'ready', 'failed', 'cancelled'] as const;
export type ReportExportStatus = (typeof REPORT_EXPORT_STATUSES)[number];
export const REPORT_LOCALES = ['en', 'ar'] as const;

export const REPORT_COLUMN_TYPES = ['text', 'bilingual', 'code', 'date', 'number', 'percent', 'money', 'enum', 'person', 'boolean'] as const;
export type ReportColumnType = (typeof REPORT_COLUMN_TYPES)[number];
export const REPORT_FIGURE_UNITS = ['count', 'percent', 'days'] as const;

/** Bilingual record text (template-seeded titles): English / primary + Arabic (null when there is no Arabic source). */
export const ReportBilingualText = z.object({ en: z.string(), ar: z.string().nullable() });
export const ReportCell = z.union([z.string(), z.number(), z.boolean(), z.null(), ReportBilingualText, MoneySchema]);
export type ReportCellDto = z.infer<typeof ReportCell>;
export const ReportColumn = z.object({ key: z.string(), type: z.enum(REPORT_COLUMN_TYPES), enumName: z.string().nullable() });
export const ReportTable = z.object({
  key: z.string(),
  columns: z.array(ReportColumn),
  rows: z.array(z.record(z.string(), ReportCell)),
  /** Rows matching the table's rule; `rows` holds at most the table's limit (`truncated` then true). */
  totalRows: z.number().int(),
  truncated: z.boolean(),
});
export type ReportTableDto = z.infer<typeof ReportTable>;
export const ReportFigure = z.object({
  key: z.string(),
  /** Null = no source data (never an invented value). */
  value: z.number().nullable(),
  unit: z.enum(REPORT_FIGURE_UNITS),
  /** True when the previous snapshot of the same kind and scope had this figure and the generator could read it. */
  compared: z.boolean(),
  previous: z.number().nullable(),
});
export type ReportFigureDto = z.infer<typeof ReportFigure>;
export const ReportUnverifiedItem = z.object({ type: z.string(), id: Uuid.nullable(), label: z.string(), status: z.string() });
export const ReportSourceRef = z.object({ type: z.string(), id: Uuid.nullable(), label: z.string() });
export const ReportWorkstreamScope = z.union([z.literal('all'), z.literal('none'), z.array(Uuid)]);

export const ReportSectionDto = z.object({
  key: z.string(),
  /** False: the viewer's current access does not cover this section — nothing of its content is returned. */
  included: z.boolean(),
  classification: ClassificationSchema.nullable(),
  workstreamScope: ReportWorkstreamScope.nullable(),
  figures: z.array(ReportFigure),
  tables: z.array(ReportTable),
  notes: z.array(ServerMessageSchema),
  unverified: z.array(ReportUnverifiedItem),
  sourceRefs: z.array(ReportSourceRef),
});
export type ReportSectionDtoT = z.infer<typeof ReportSectionDto>;

export const ReportScopeDto = z.object({
  workstreamId: Uuid.nullable(),
  workstreamCode: z.string().nullable(),
  workstreamName: z.string().nullable(),
  workstreamNameAr: z.string().nullable(),
  meetingId: Uuid.nullable(),
});

export const ReportSnapshotSummaryDto = z.object({
  id: Uuid,
  kind: z.enum(REPORT_KINDS),
  title: z.string(),
  locale: z.string(),
  asOf: z.string(),
  asOfLocalDate: IsoDate,
  scope: ReportScopeDto,
  baselineVersionNo: z.number().int().nullable(),
  /** Classification of the content this caller may see (max of the included sections). */
  classification: ClassificationSchema,
  /** True when every section is included for this caller. */
  complete: z.boolean(),
  sectionCount: z.number().int(),
  includedSectionCount: z.number().int(),
  includesDemoData: z.boolean(),
  generatedBy: Uuid.nullable(),
  generatedByName: z.string().nullable(),
  generatedAt: z.string(),
  contentHash: z.string(),
  previousSnapshotId: Uuid.nullable(),
});
export type ReportSnapshotSummary = z.infer<typeof ReportSnapshotSummaryDto>;

export const ReportSnapshotDto = ReportSnapshotSummaryDto.extend({
  project: z.object({ id: Uuid, code: z.string(), name: z.string(), timezone: z.string(), isDemo: z.boolean() }),
  baseline: z.object({ id: Uuid, versionNo: z.number().int(), approvedAt: z.string().nullable() }).nullable(),
  /** Content hash recomputed on read: `mismatch` would reveal a modified payload (tamper-evident). */
  integrity: z.enum(['verified', 'mismatch']),
  unverifiedCount: z.number().int(),
  /** Internal electronic approvals shown in the report are not legally certified signatures (REQ-GOV-027). */
  approvalLabel: z.string(),
  sections: z.array(ReportSectionDto),
  canExport: z.boolean(),
});
export type ReportSnapshot = z.infer<typeof ReportSnapshotDto>;

export const GenerateReportBody = z
  .object({
    kind: z.enum(GENERATABLE_REPORT_KINDS),
    /** workstream_weekly / look_ahead only: limit the report to one workstream. */
    workstreamId: Uuid.optional(),
    /** minutes only (required): the meeting whose minutes are reported. */
    meetingId: Uuid.optional(),
  })
  .strict();

export const ReportExportDto = z.object({
  id: Uuid,
  snapshotId: Uuid,
  format: z.enum(REPORT_EXPORT_FORMATS),
  locale: z.enum(REPORT_LOCALES),
  status: z.enum(REPORT_EXPORT_STATUSES),
  filename: z.string().nullable(),
  mimeType: z.string().nullable(),
  sizeBytes: z.number().int().nullable(),
  sha256: z.string().nullable(),
  contentClassification: ClassificationSchema.nullable(),
  includedSections: z.array(z.string()),
  errorCode: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});
export type ReportExport = z.infer<typeof ReportExportDto>;
export const RequestReportExportBody = z.object({ format: z.enum(REPORT_EXPORT_FORMATS), locale: z.enum(REPORT_LOCALES) }).strict();

export const ReportDiffDto = z.object({
  snapshotId: Uuid,
  againstSnapshotId: Uuid.nullable(),
  /** Sections present and readable in both snapshots (only these are compared). */
  comparedSections: z.array(z.string()),
  changes: z.array(z.object({ section: z.string(), key: z.string(), before: z.number().nullable(), after: z.number().nullable(), delta: z.number().nullable() })),
});

export const KPI_VALUE_STATES = ['computed', 'no_data', 'restricted', 'no_calculator'] as const;
export const KpiCatalogueEntryDto = z.object({
  kpiId: Uuid,
  key: z.string(),
  name: z.string(),
  nameAr: z.string().nullable(),
  definition: z.string(),
  definitionAr: z.string().nullable(),
  formula: z.string(),
  unit: z.string(),
  period: z.string(),
  ownerRole: z.string().nullable(),
  source: z.string(),
  target: z.string().nullable(),
  thresholds: z.object({ green: z.string(), amber: z.string(), red: z.string() }),
  direction: z.enum(KPI_DIRECTIONS),
  frequency: z.string(),
  lastVerifiedAt: z.string().nullable(),
  verificationStatus: z.string(),
  classification: ClassificationSchema,
  /** The definition is a proposal until it is confirmed (spec §11): never quoted as a historical fact. */
  isProposal: z.boolean(),
  isDemo: z.boolean(),
  /**
   * Value computed now from the project's records (never stored as history): `computed`, `no_data` (no source records —
   * the KPI stays a proposal), `restricted` (the caller cannot read the source records; nothing is revealed) or
   * `no_calculator` (a user-defined KPI without a deterministic calculator; see its manual observations).
   */
  current: z.object({
    state: z.enum(KPI_VALUE_STATES),
    value: z.number().nullable(),
    numerator: z.number().nullable(),
    denominator: z.number().nullable(),
    notes: z.array(z.string()),
    sourcePermission: z.string().nullable(),
  }),
});
export type KpiCatalogueEntry = z.infer<typeof KpiCatalogueEntryDto>;
export const KpiCatalogueDto = z.object({
  asOfLocalDate: IsoDate,
  /** False when the caller cannot read the project's KPI definitions (finance records — finance.record.read project-wide). */
  definitionsReadable: z.boolean(),
  items: z.array(KpiCatalogueEntryDto),
});

// ---------------------------------------------------------------------------------------------------------------------
// Routes

const P = '/api/v1/projects/:projectId';
const tags = ['reporting'];
const SnapshotParams = ProjectParams.extend({ snapshotId: Uuid });
const ExportParams = ProjectParams.extend({ exportId: Uuid });

export const reportingRoutes = registerRoutes({
  generateReport: defineRoute({
    id: 'reporting.generateReport',
    method: 'POST',
    path: `${P}/report-snapshots`,
    summary:
      'Generate a report from the live records the caller may read and freeze it as an immutable snapshot (content hash, as-of date, scope, baseline, unverified data, classification, sources). Committee packs and minutes also need reports.snapshot.create',
    tags,
    access: 'reports.report.generate',
    params: ProjectParams,
    body: GenerateReportBody,
    response: ReportSnapshotSummaryDto,
  }),
  listReportSnapshots: defineRoute({
    id: 'reporting.listReportSnapshots',
    method: 'GET',
    path: `${P}/report-snapshots`,
    summary: 'Report snapshots the caller may currently open (each section re-checked); default order: newest first',
    tags,
    access: 'reports.snapshot.read',
    params: ProjectParams,
    query: PageQuery.extend({ kind: z.enum(REPORT_KINDS).optional(), sort: SortParam(['generatedAt', 'kind', 'asOfLocalDate']) }),
    response: paged(ReportSnapshotSummaryDto),
  }),
  getReportSnapshot: defineRoute({
    id: 'reporting.getReportSnapshot',
    method: 'GET',
    path: `${P}/report-snapshots/:snapshotId`,
    summary: 'A frozen report snapshot; the viewer’s permissions are re-checked for every section on every access',
    tags,
    access: 'reports.snapshot.read',
    params: SnapshotParams,
    response: ReportSnapshotDto,
  }),
  diffReportSnapshot: defineRoute({
    id: 'reporting.diffReportSnapshot',
    method: 'GET',
    path: `${P}/report-snapshots/:snapshotId/diff`,
    summary: 'Figures that changed since another snapshot (default: the previous snapshot of the same kind and scope); only sections readable in both are compared',
    tags,
    access: 'reports.snapshot.read',
    params: SnapshotParams,
    query: z.object({ against: Uuid.optional() }).strict(),
    response: ReportDiffDto,
  }),
  getKpiCatalogue: defineRoute({
    id: 'reporting.getKpiCatalogue',
    method: 'GET',
    path: `${P}/kpi-catalogue`,
    summary:
      'Proposed KPI catalogue (spec §11) with every attribute and the value computed now from the records the caller may read; a KPI without source records stays a proposal with no value',
    tags,
    access: 'reports.report.generate',
    params: ProjectParams,
    response: KpiCatalogueDto,
  }),
});

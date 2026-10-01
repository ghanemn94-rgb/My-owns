import { pgTable, uuid, text, integer, jsonb, varchar, date, bigint, unique, index, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { Classification } from '@hub/domain';
import {
  pk,
  orgIdCol,
  projectIdCol,
  createdAt,
  updatedAt,
  createdBy,
  versionCol,
  ts,
  projectFk,
  type FkTarget,
  classification,
  reportKind,
  exportFormat,
  importStatus,
  importRowAction,
  isDemo,
} from './_common';
import { project } from './portfolio';
import { baselineVersion } from './planning';
import { sourceRecord, document, documentVersion } from './documents';

/**
 * Access metadata of one section of a report snapshot (ADR-0011 amendment, REQ-RPT-017): which read permission(s) the
 * section's records need, the highest classification among them, whether finance-domain clearance applies, and the
 * workstream reach the generator had (`all` = project-wide, `none` = records without a workstream, or the list of
 * workstreams the content is limited to). Every read and export re-checks it against the viewer's CURRENT access.
 */
export interface ReportSectionAccess {
  key: string;
  permissions: string[];
  classification: Classification;
  domain: 'finance' | null;
  workstreamIds: 'all' | 'none' | string[];
}

/**
 * Report snapshot — immutable in content (append-only trigger rejects UPDATE / DELETE / TRUNCATE; REVOKE UPDATE, DELETE
 * for the runtime role — post-migrate.sql §4). Figures never change after later source updates; permission is re-checked
 * on every access (spec §11). Rows written by the reporting module carry `schema_version` (`hub.report/1`) and per-section
 * access metadata in `sections`; frozen meeting packs of the governance module leave both empty.
 */
export const reportSnapshot = pgTable(
  'report_snapshot',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    kind: reportKind('kind').notNull(),
    title: text('title').notNull(),
    locale: varchar('locale', { length: 5 }).notNull().default('en'),
    asOf: ts('as_of').notNull(),
    asOfLocalDate: date('as_of_local_date', { mode: 'string' }).notNull(),
    scope: jsonb('scope').$type<Record<string, unknown>>().notNull(),
    baselineVersionId: uuid('baseline_version_id'),
    baselineVersionNo: integer('baseline_version_no'),
    classification: classification('classification').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    unverifiedData: jsonb('unverified_data').$type<string[]>().notNull().default([]),
    sourceRefs: jsonb('source_refs').$type<{ type: string; id: string; label?: string }[]>().notNull().default([]),
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    previousSnapshotId: uuid('previous_snapshot_id'),
    includesDemoData: jsonb('includes_demo_data').$type<boolean>().notNull().default(false),
    /** `hub.report/1` for report snapshots of the reporting module; null for governance meeting packs. */
    schemaVersion: varchar('schema_version', { length: 32 }),
    /** Per-section access metadata (see ReportSectionAccess) — the list filter re-checks it without loading payloads. */
    sections: jsonb('sections').$type<ReportSectionAccess[]>().notNull().default([]),
    generatedBy: uuid('generated_by'),
    generatedAt: createdAt(),
  },
  (t) => [
    projectFk('report_snapshot_baseline_fk', t.projectId, t.baselineVersionId, (): FkTarget => baselineVersion),
    projectFk('report_snapshot_previous_fk', t.projectId, t.previousSnapshotId, { projectId: t.projectId, id: t.id }),
    unique('report_snapshot_pid_uq').on(t.projectId, t.id),
    index('report_snapshot_kind_idx').on(t.projectId, t.kind),
    index('report_snapshot_generated_idx').on(t.projectId, t.generatedAt),
  ],
);

/**
 * File export of a snapshot (REQ-RPT-007..010, REQ-INT-011). Requested through the API, rendered by the worker from the
 * snapshot only (re-authorizing the requester at execution — AT-19), stored through the object-storage adapter and
 * downloadable only by its requester after a fresh permission re-check. Never sent anywhere: there is no recipient.
 * `included_sections` records which sections the requester could see when the file was rendered; the download re-checks
 * each of them.
 */
export const reportExport = pgTable(
  'report_export',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    snapshotId: uuid('snapshot_id').notNull(),
    format: exportFormat('format').notNull(),
    locale: varchar('locale', { length: 5 }).notNull().default('en'),
    /** queued → rendering → ready | failed | cancelled (requester lost access before the file was produced). */
    status: varchar('status', { length: 16 }).notNull().default('queued'),
    storageKey: text('storage_key'),
    filename: text('filename'),
    mimeType: varchar('mime_type', { length: 128 }),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    sha256: varchar('sha256', { length: 64 }),
    includedSections: jsonb('included_sections').$type<string[]>().notNull().default([]),
    /** Classification of the content actually rendered (max of the included sections). */
    contentClassification: classification('content_classification'),
    errorCode: varchar('error_code', { length: 64 }),
    /** The requester (the only person who may download the file). */
    createdBy: createdBy().notNull(),
    createdAt: createdAt(),
    completedAt: ts('completed_at'),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    projectFk('report_export_snapshot_fk', t.projectId, t.snapshotId, (): FkTarget => reportSnapshot),
    unique('report_export_pid_uq').on(t.projectId, t.id),
    index('report_export_snapshot_idx').on(t.projectId, t.snapshotId, t.createdBy),
    check('report_export_status_ck', sql`${t.status} in ('queued', 'rendering', 'ready', 'failed', 'cancelled')`),
    check('report_export_locale_ck', sql`${t.locale} in ('en', 'ar')`),
    check(
      'report_export_ready_ck',
      sql`${t.status} <> 'ready' or (${t.storageKey} is not null and ${t.filename} is not null and ${t.sizeBytes} is not null and ${t.sha256} is not null and ${t.completedAt} is not null)`,
    ),
  ],
);

/**
 * BI exposure of a project (REQ-RPT-011, access-matrix §9 `bi_reader`, threat model DF-09 / C-36): the project's sponsor
 * lists the project for the read-only BI views (schema `bi`) and sets the highest classification the BI database role
 * `hub_bi` may read there (never above the sponsor's own clearance). Demo projects are never exposed, whatever the grant.
 * One active grant per project; a change is a revoke and a new grant (history kept).
 */
export const biAccessGrant = pgTable(
  'bi_access_grant',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    maxClassification: classification('max_classification').notNull(),
    reason: text('reason').notNull(),
    grantedBy: uuid('granted_by').notNull(),
    createdAt: createdAt(),
    revokedAt: ts('revoked_at'),
    revokedBy: uuid('revoked_by'),
    revokeReason: text('revoke_reason'),
    version: versionCol(),
  },
  (t) => [
    unique('bi_access_grant_pid_uq').on(t.projectId, t.id),
    uniqueIndex('bi_access_grant_active_uq').on(t.projectId).where(sql`revoked_at is null`),
    check('bi_access_grant_revoke_ck', sql`(${t.revokedAt} is null) = (${t.revokedBy} is null)`),
  ],
);

/** One mapped-and-validated cell of an import row as stored for the preview (values only — formulas are never evaluated). */
export interface ImportCellJson {
  v: string | number | boolean | null;
  f?: string;
  e?: true;
  d?: true;
}
/** A server-computed explanation (code + parameters) — translated by the web (`imports.messages.<code>`). */
export interface ImportMessageJson {
  code: string;
  params: Record<string, string | number>;
}

/**
 * Import batch (spec §17, REQ-INT-001..005, REQ-INT-015, REQ-SRC-009). The uploaded file is preserved as a document
 * version + a source-register entry with its SHA-256 (or held in the quarantine area when the pre-scan flags it). Status
 * changes only through the import commands (parse job → map → submit → approve (second person) → rollback). The approval
 * binds to `preview_hash` — the row plan the uploader submitted.
 */
export const importBatch = pgTable(
  'import_batch',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    code: varchar('code', { length: 32 }).notNull(),
    /** risk | task | decision | source_claims | document_claims (IMPORT_TARGETS). */
    kind: varchar('kind', { length: 32 }).notNull(),
    fileType: varchar('file_type', { length: 16 }).notNull(),
    filename: text('filename').notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    classification: classification('classification').notNull(),
    documentId: uuid('document_id'),
    documentVersionId: uuid('document_version_id'),
    sourceId: uuid('source_id'),
    /** Quarantine-area object key when the import pre-scan held the file (never parsed, never served). */
    quarantineKey: text('quarantine_key'),
    status: importStatus('status').notNull().default('uploaded'),
    failureCode: varchar('failure_code', { length: 64 }),
    failureDetail: text('failure_detail'),
    /** Sheets found by the parser: name, rows, columns (spreadsheets) — the uploader picks one. */
    sheets: jsonb('sheets').$type<{ name: string; rows: number; columns: number }[]>().notNull().default([]),
    sheet: text('sheet'),
    headerRow: integer('header_row'),
    headers: jsonb('headers').$type<string[]>().notNull().default([]),
    mapping: jsonb('mapping').$type<Record<string, string>>(),
    summary: jsonb('summary').$type<Record<string, number>>().notNull().default({}),
    /** File-level findings (formula cells, external links, data connections, hyperlinks, extraction not configured …). */
    findings: jsonb('findings').$type<ImportMessageJson[]>().notNull().default([]),
    /** Hash of the validated row plan; the approval is refused when the re-validated plan differs (409). */
    previewHash: varchar('preview_hash', { length: 64 }),
    submittedAt: ts('submitted_at'),
    approvedBy: uuid('approved_by'),
    approvedAt: ts('approved_at'),
    appliedAt: ts('applied_at'),
    rejectedBy: uuid('rejected_by'),
    rejectedAt: ts('rejected_at'),
    decisionNote: text('decision_note'),
    rolledBackBy: uuid('rolled_back_by'),
    rolledBackAt: ts('rolled_back_at'),
    rollbackReason: text('rollback_reason'),
    isDemo: isDemo(),
    createdAt: createdAt(),
    /** The uploader — never the approver (imports.batch.approve is not_self). */
    createdBy: createdBy().notNull(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    projectFk('import_batch_source_fk', t.projectId, t.sourceId, (): FkTarget => sourceRecord),
    projectFk('import_batch_document_fk', t.projectId, t.documentId, (): FkTarget => document),
    projectFk('import_batch_docver_fk', t.projectId, t.documentVersionId, (): FkTarget => documentVersion),
    unique('import_batch_pid_uq').on(t.projectId, t.id),
    uniqueIndex('import_batch_code_uq').on(t.projectId, t.code),
    index('import_batch_status_idx').on(t.projectId, t.status, t.createdAt),
    check('import_batch_kind_ck', sql`${t.kind} in ('risk', 'task', 'decision', 'source_claims', 'document_claims')`),
    check('import_batch_file_type_ck', sql`${t.fileType} in ('xlsx', 'csv', 'docx', 'pdf', 'png', 'jpeg', 'unknown')`),
    check('import_batch_approval_ck', sql`${t.status} not in ('applied', 'rolled_back') or (${t.approvedBy} is not null and ${t.approvedAt} is not null and ${t.appliedAt} is not null)`),
    check('import_batch_not_self_ck', sql`${t.approvedBy} is null or ${t.approvedBy} <> ${t.createdBy}`),
  ],
);

/** Parsed sheet of a batch (values only; formula text kept for display, never evaluated). Written by the parse job. */
export const importSheet = pgTable(
  'import_sheet',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    batchId: uuid('batch_id').notNull(),
    sheetNo: integer('sheet_no').notNull(),
    name: text('name').notNull(),
    rows: jsonb('rows').$type<(ImportCellJson | null)[][]>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [projectFk('import_sheet_batch_fk', t.projectId, t.batchId, (): FkTarget => importBatch), uniqueIndex('import_sheet_uq').on(t.batchId, t.sheetNo)],
);

/**
 * One row of the preview / comparison (REQ-SRC-009): the mapped cells, the checked values, the planned action, the
 * matching record (duplicate detection) with its field differences, and the item-by-item decision of the approver.
 */
export const importRow = pgTable(
  'import_row',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    batchId: uuid('batch_id').notNull(),
    rowNo: integer('row_no').notNull(),
    raw: jsonb('raw').$type<Record<string, ImportCellJson | null>>().notNull(),
    normalized: jsonb('normalized').$type<Record<string, string | number | null>>().notNull().default({}),
    action: importRowAction('action').notNull(),
    errors: jsonb('errors').$type<ImportMessageJson[]>().notNull().default([]),
    warnings: jsonb('warnings').$type<ImportMessageJson[]>().notNull().default([]),
    notes: jsonb('notes').$type<ImportMessageJson[]>().notNull().default([]),
    formulaFields: jsonb('formula_fields').$type<string[]>().notNull().default([]),
    /** Existing record this row matches (duplicate detection): type, id and code. */
    matchType: varchar('match_type', { length: 32 }),
    matchId: uuid('match_id'),
    matchCode: varchar('match_code', { length: 64 }),
    /** Why the matching record is governed (committee_decision, approved_baseline) — changes become change requests. */
    governedReason: varchar('governed_reason', { length: 32 }),
    diff: jsonb('diff').$type<{ field: string; from: string | number | null; to: string | number | null }[]>().notNull().default([]),
    duplicateOfRow: integer('duplicate_of_row'),
    /** Approver's item-by-item decision at approval: accepted | declined (null before / for rows that were not applicable). */
    decision: varchar('decision', { length: 16 }),
  },
  (t) => [
    projectFk('import_row_batch_fk', t.projectId, t.batchId, (): FkTarget => importBatch),
    uniqueIndex('import_row_uq').on(t.batchId, t.rowNo),
    check('import_row_decision_ck', sql`${t.decision} is null or ${t.decision} in ('accepted', 'declined')`),
  ],
);

/**
 * A record produced by an applied batch (REQ-INT-002 / -003): which row produced it, the record and its version right
 * after the import — rollback removes it only while it is unchanged since (no FK to the record on purpose: a rollback
 * deletes the record and this row keeps the history). Records are created in the batch's own project, in the same
 * transaction.
 */
export const importOutput = pgTable(
  'import_output',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    batchId: uuid('batch_id').notNull(),
    rowNo: integer('row_no').notNull(),
    recordType: varchar('record_type', { length: 32 }).notNull(),
    recordId: uuid('record_id').notNull(),
    recordCode: varchar('record_code', { length: 64 }),
    createdVersion: integer('created_version').notNull(),
    rolledBackAt: ts('rolled_back_at'),
    createdAt: createdAt(),
  },
  (t) => [
    projectFk('import_output_batch_fk', t.projectId, t.batchId, (): FkTarget => importBatch),
    index('import_output_batch_idx').on(t.batchId),
    check('import_output_type_ck', sql`${t.recordType} in ('risk', 'task', 'source_claim', 'change_request')`),
  ],
);

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
} from './_common';
import { project } from './portfolio';
import { baselineVersion } from './planning';
import { sourceRecord, documentVersion } from './documents';

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

export const importBatch = pgTable(
  'import_batch',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    kind: varchar('kind', { length: 32 }).notNull(), // wbs | perimeter | raid | kpi | ...
    sourceId: uuid('source_id'),
    documentVersionId: uuid('document_version_id'),
    filename: text('filename'),
    status: importStatus('status').notNull().default('uploaded'),
    sheet: text('sheet'),
    headerRow: integer('header_row'),
    mapping: jsonb('mapping').$type<Record<string, string>>(),
    summary: jsonb('summary').$type<Record<string, number>>(),
    errors: jsonb('errors').$type<{ row: number; message: string }[]>().notNull().default([]),
    approvedBy: uuid('approved_by'),
    approvedAt: ts('approved_at'),
    appliedAt: ts('applied_at'),
    rolledBackAt: ts('rolled_back_at'),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    projectFk('import_batch_source_fk', t.projectId, t.sourceId, (): FkTarget => sourceRecord),
    projectFk('import_batch_docver_fk', t.projectId, t.documentVersionId, (): FkTarget => documentVersion),unique('import_batch_pid_uq').on(t.projectId, t.id)],
);

export const importRow = pgTable(
  'import_row',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    batchId: uuid('batch_id').notNull(),
    rowNo: integer('row_no').notNull(),
    raw: jsonb('raw').$type<Record<string, unknown>>().notNull(),
    normalized: jsonb('normalized').$type<Record<string, unknown>>(),
    action: importRowAction('action').notNull(),
    message: text('message'),
    targetType: varchar('target_type', { length: 32 }),
    targetId: uuid('target_id'),
    before: jsonb('before').$type<Record<string, unknown>>(),
    after: jsonb('after').$type<Record<string, unknown>>(),
  },
  (t) => [projectFk('import_row_batch_fk', t.projectId, t.batchId, (): FkTarget => importBatch), uniqueIndex('import_row_uq').on(t.batchId, t.rowNo)],
);

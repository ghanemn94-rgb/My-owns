import { pgTable, uuid, text, integer, jsonb, varchar, date, bigint, unique, index, uniqueIndex } from 'drizzle-orm/pg-core';
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
  classification,
  reportKind,
  exportFormat,
  importStatus,
  importRowAction,
} from './_common';
import { project } from './portfolio';

/**
 * Report snapshot — immutable in content (trigger blocks UPDATE of payload columns and DELETE). Figures never
 * change after later source updates; permission is re-checked on every access (spec §11).
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
    generatedBy: uuid('generated_by'),
    generatedAt: createdAt(),
  },
  (t) => [unique('report_snapshot_pid_uq').on(t.projectId, t.id), index('report_snapshot_kind_idx').on(t.projectId, t.kind)],
);

export const reportExport = pgTable(
  'report_export',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    snapshotId: uuid('snapshot_id').notNull(),
    format: exportFormat('format').notNull(),
    storageKey: text('storage_key').notNull(),
    filename: text('filename').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    createdBy: createdBy(),
    createdAt: createdAt(),
  },
  (t) => [projectFk('report_export_snapshot_fk', t.projectId, t.snapshotId, reportSnapshot)],
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
  (t) => [unique('import_batch_pid_uq').on(t.projectId, t.id)],
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
  (t) => [projectFk('import_row_batch_fk', t.projectId, t.batchId, importBatch), uniqueIndex('import_row_uq').on(t.batchId, t.rowNo)],
);

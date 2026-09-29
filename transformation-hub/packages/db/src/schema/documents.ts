import { pgTable, uuid, text, integer, jsonb, varchar, date, boolean, bigint, unique, uniqueIndex, index, numeric } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  pk,
  orgIdCol,
  projectIdCol,
  createdAt,
  updatedAt,
  createdBy,
  versionCol,
  isDemo,
  ts,
  projectFk,
  classification,
  documentKind,
  scanStatus,
  evidenceLinkStatus,
  sourceType,
  extractionStatus,
  verificationStatus,
  tsvector,
} from './_common';
import { project } from './portfolio';
import { partnerRoom } from './jv';

/**
 * Document metadata. Access = project membership AND clearance ≥ classification AND (room_id is null OR active
 * room grant). Titles of inaccessible documents are never returned (AT-03).
 */
export const document = pgTable(
  'document',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    title: text('title').notNull(),
    kind: documentKind('kind').notNull(),
    classification: classification('classification').notNull().default('confidential'),
    roomId: uuid('room_id'),
    ownerUserId: uuid('owner_user_id'),
    currentVersionId: uuid('current_version_id'),
    legalHold: boolean('legal_hold').notNull().default(false),
    legalHoldReason: text('legal_hold_reason'),
    retentionUntil: date('retention_until', { mode: 'string' }),
    deletedAt: ts('deleted_at'),
    deletedBy: uuid('deleted_by'),
    deletionReason: text('deletion_reason'),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [
    unique('document_pid_uq').on(t.projectId, t.id),
    projectFk('document_room_fk', t.projectId, t.roomId, partnerRoom),
    index('document_project_idx').on(t.projectId, t.kind),
  ],
);

export const documentVersion = pgTable(
  'document_version',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    documentId: uuid('document_id').notNull(),
    versionNo: integer('version_no').notNull(),
    storageKey: text('storage_key').notNull(), // opaque key in object storage; never a public URL
    filename: text('filename').notNull(),
    mimeType: varchar('mime_type', { length: 128 }).notNull(),
    detectedType: varchar('detected_type', { length: 64 }),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    scanStatus: scanStatus('scan_status').notNull().default('pending'),
    scanDetail: text('scan_detail'),
    extractionStatus: extractionStatus('extraction_status').notNull().default('not_performed'),
    pageCount: integer('page_count'),
    uploadedBy: uuid('uploaded_by').notNull(),
    uploadedAt: createdAt(),
    note: text('note'),
  },
  (t) => [
    unique('document_version_pid_uq').on(t.projectId, t.id),
    projectFk('document_version_document_fk', t.projectId, t.documentId, document),
    uniqueIndex('document_version_uq').on(t.documentId, t.versionNo),
  ],
);

/** Links a document version (or a note) as evidence for any record (gate criterion, CP, transfer, action…). */
export const evidenceLink = pgTable(
  'evidence_link',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    targetType: varchar('target_type', { length: 32 }).notNull(),
    targetId: uuid('target_id').notNull(),
    documentId: uuid('document_id'),
    documentVersionId: uuid('document_version_id'),
    note: text('note'),
    purpose: text('purpose'),
    status: evidenceLinkStatus('status').notNull().default('active'),
    conflictWithLinkId: uuid('conflict_with_link_id'),
    conflictNote: text('conflict_note'),
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: ts('reviewed_at'),
    addedBy: uuid('added_by').notNull(),
    createdAt: createdAt(),
    version: versionCol(),
  },
  (t) => [
    unique('evidence_link_pid_uq').on(t.projectId, t.id),
    projectFk('evidence_link_document_fk', t.projectId, t.documentId, document),
    projectFk('evidence_link_version_fk', t.projectId, t.documentVersionId, documentVersion),
    index('evidence_link_target_idx').on(t.projectId, t.targetType, t.targetId),
  ],
);

/** Source register (spec §2): report date, as-of date and extraction date kept separate. */
export const sourceRecord = pgTable(
  'source_record',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    code: varchar('code', { length: 32 }).notNull(),
    sourceType: sourceType('source_type').notNull(),
    filename: text('filename'),
    sourceVersion: varchar('source_version', { length: 32 }),
    checksum: varchar('checksum', { length: 64 }),
    ownerLabel: text('owner_label'),
    uploadedAt: ts('uploaded_at'),
    reportDate: date('report_date', { mode: 'string' }),
    asOfDate: date('as_of_date', { mode: 'string' }),
    extractionDate: date('extraction_date', { mode: 'string' }),
    extractionStatus: extractionStatus('extraction_status').notNull().default('not_performed'),
    extractionNote: text('extraction_note'),
    documentVersionId: uuid('document_version_id'),
    supersedesSourceId: uuid('supersedes_source_id'),
    classification: classification('classification').notNull().default('confidential'),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    version: versionCol(),
  },
  (t) => [
    unique('source_record_pid_uq').on(t.projectId, t.id),
    uniqueIndex('source_record_code_uq').on(t.projectId, t.code),
    projectFk('source_record_docver_fk', t.projectId, t.documentVersionId, documentVersion),
  ],
);

/**
 * Individual claim extracted from a source. Never changes current project status automatically (AT-01):
 * `appliedToRecord` is only set through a reviewed "apply claim" command.
 */
export const sourceClaim = pgTable(
  'source_claim',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    sourceId: uuid('source_id').notNull(),
    location: text('location').notNull(), // text/cell/row/page/image region
    subject: text('subject').notNull(), // what the claim is about, e.g. "Workstream: Legal & Regulatory — status"
    targetType: varchar('target_type', { length: 32 }),
    targetId: uuid('target_id'),
    field: varchar('field', { length: 64 }),
    extractedValue: text('extracted_value').notNull(),
    sourceReportedValue: text('source_reported_value'),
    confirmedValue: text('confirmed_value'),
    confidence: numeric('confidence', { precision: 4, scale: 3 }),
    verificationStatus: verificationStatus('verification_status').notNull().default('unknown'),
    reviewerUserId: uuid('reviewer_user_id'),
    reviewedAt: ts('reviewed_at'),
    conflictWithClaimId: uuid('conflict_with_claim_id'),
    appliedToRecord: boolean('applied_to_record').notNull().default(false),
    appliedBy: uuid('applied_by'),
    appliedAt: ts('applied_at'),
    isDemo: isDemo(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    version: versionCol(),
  },
  (t) => [
    unique('source_claim_pid_uq').on(t.projectId, t.id),
    projectFk('source_claim_source_fk', t.projectId, t.sourceId, sourceRecord),
    index('source_claim_target_idx').on(t.projectId, t.targetType, t.targetId),
  ],
);

/**
 * Retrieval index chunk. ACL attributes are denormalized (room, classification) so retrieval can apply the
 * caller's ACL inside SQL before ranking. Invalidated (deleted) when the document/version/ACL changes.
 */
export const documentChunk = pgTable(
  'document_chunk',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: projectIdCol().references(() => project.id),
    documentId: uuid('document_id').notNull(),
    documentVersionId: uuid('document_version_id').notNull(),
    roomId: uuid('room_id'),
    classification: classification('classification').notNull(),
    ordinal: integer('ordinal').notNull(),
    page: integer('page'),
    section: text('section'),
    text: text('text').notNull(),
    tsv: tsvector('tsv').generatedAlwaysAs(sql`to_tsvector('simple', coalesce(section, '') || ' ' || text)`),
    suspiciousInstructions: boolean('suspicious_instructions').notNull().default(false),
    indexedAt: createdAt(),
  },
  (t) => [
    projectFk('document_chunk_document_fk', t.projectId, t.documentId, document),
    projectFk('document_chunk_version_fk', t.projectId, t.documentVersionId, documentVersion),
    index('document_chunk_tsv_idx').using('gin', t.tsv),
    index('document_chunk_doc_idx').on(t.documentId),
  ],
);

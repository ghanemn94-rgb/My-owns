import { z } from 'zod';
import { CLASSIFICATIONS, IMPORT_ROW_ACTIONS, IMPORT_STATUSES, IMPORT_TARGETS, ALLOWED_FILE_TYPES } from '@hub/domain';
import { defineRoute, registerRoutes } from './route';
import { ClassificationSchema, ExpectedVersion, NoSort, PageQuery, ProjectParams, RequiredText, ServerMessageSchema, SortParam, Text, Uuid, idParams, paged } from './common';

/**
 * Excel / CSV / document import wizard (spec §17, §2; REQ-INT-001..005, REQ-INT-015, REQ-SRC-009, REQ-SEC-014/015, AT-01,
 * AT-25). Upload (safe file path: size limit, signature pre-scan → quarantine, magic-byte allowlist, SHA-256, preserved as
 * a document version and a source-register entry) → parse in the worker (isolated parser with time / memory limits; values
 * only, formulas never evaluated, links never opened) → mapping → validation and preview (duplicate detection against the
 * register and within the file; comparison with the current records) → submit → approval by a SECOND person, item by item
 * → apply (draft / proposed records, claims, change requests — never an update of an existing record) → rollback where
 * feasible. Batches are visible to holders of `imports.batch.read` whose clearance covers the batch classification
 * (404 otherwise).
 */

export const IMPORT_TARGET_LIST = IMPORT_TARGETS;
export const ImportTargetSchema = z.enum(IMPORT_TARGETS);
export const ImportStatusSchema = z.enum(IMPORT_STATUSES);
export const ImportRowActionSchema = z.enum(IMPORT_ROW_ACTIONS);
const T = ['Imports'];

const BatchParams = idParams('batchId');

export const ImportBatchSummary = z.object({
  id: Uuid,
  code: z.string(),
  target: ImportTargetSchema,
  /** `unknown`: a file held by the pre-scan before its type was established. */
  fileType: z.enum([...ALLOWED_FILE_TYPES, 'unknown']),
  filename: z.string(),
  status: ImportStatusSchema,
  classification: ClassificationSchema,
  sizeBytes: z.number().int(),
  summary: z.record(z.string(), z.number()),
  isDemo: z.boolean(),
  createdBy: Uuid,
  createdByName: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int(),
});
export type ImportBatchSummaryDto = z.infer<typeof ImportBatchSummary>;

export const ImportOutputDto = z.object({
  rowNo: z.number().int(),
  recordType: z.enum(['risk', 'task', 'source_claim', 'change_request']),
  recordId: Uuid,
  recordCode: z.string().nullable(),
  rolledBack: z.boolean(),
});

export const ImportFieldDto = z.object({
  key: z.string(),
  type: z.string(),
  required: z.boolean(),
  values: z.array(z.string()).nullable(),
});

export const ImportBatchDetail = ImportBatchSummary.extend({
  sha256: z.string(),
  documentId: Uuid.nullable(),
  documentVersionId: Uuid.nullable(),
  sourceId: Uuid.nullable(),
  sourceCode: z.string().nullable(),
  failureCode: z.string().nullable(),
  failureDetail: z.string().nullable(),
  sheets: z.array(z.object({ name: z.string(), rows: z.number().int(), columns: z.number().int() })),
  sheet: z.string().nullable(),
  headerRow: z.number().int().nullable(),
  headers: z.array(z.string()),
  mapping: z.record(z.string(), z.string()).nullable(),
  /** Mapping proposed from the header row (null until parsed; spreadsheets only). */
  suggestedMapping: z.record(z.string(), z.string()).nullable(),
  /** First rows of each sheet as header candidates (headerless columns named "Column <letter>"), for the mapping step. */
  sheetPreview: z.record(z.string(), z.array(z.array(z.string()))),
  fields: z.array(ImportFieldDto),
  findings: z.array(ServerMessageSchema),
  submittedAt: z.string().nullable(),
  approvedBy: Uuid.nullable(),
  approvedByName: z.string().nullable(),
  approvedAt: z.string().nullable(),
  rejectedBy: Uuid.nullable(),
  rejectedAt: z.string().nullable(),
  decisionNote: z.string().nullable(),
  rolledBackBy: Uuid.nullable(),
  rolledBackAt: z.string().nullable(),
  rollbackReason: z.string().nullable(),
  outputs: z.array(ImportOutputDto),
  /** Row numbers an approver may accept (planned create / proposed change / change request), for item-by-item review. */
  applicableRows: z.array(z.number().int()),
  /** What the caller may do now (UI hints — the server re-checks every command). */
  canMap: z.boolean(),
  canSubmit: z.boolean(),
  /** Approve (apply): a second person whose own authority covers the records the accepted rows create. */
  canApprove: z.boolean(),
  /** Reject: any second person holding the import approval permission. */
  canReject: z.boolean(),
  canRollback: z.boolean(),
  canCancel: z.boolean(),
});
export type ImportBatchDetailDto = z.infer<typeof ImportBatchDetail>;

export const ImportCellDto = z.object({ v: z.union([z.string(), z.number(), z.boolean(), z.null()]), f: z.string().optional(), e: z.literal(true).optional(), d: z.literal(true).optional() });
export const ImportRowDto = z.object({
  rowNo: z.number().int(),
  action: ImportRowActionSchema,
  cells: z.record(z.string(), ImportCellDto.nullable()),
  values: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
  errors: z.array(ServerMessageSchema),
  warnings: z.array(ServerMessageSchema),
  notes: z.array(ServerMessageSchema),
  formulaFields: z.array(z.string()),
  /** Existing record this row matches (duplicate detection) — only when the caller can read that record type. */
  match: z.object({ type: z.string(), id: Uuid, code: z.string().nullable() }).nullable(),
  governedReason: z.string().nullable(),
  /** Comparison with the current record: field, current value, value in the file. */
  diff: z.array(z.object({ field: z.string(), from: z.union([z.string(), z.number(), z.null()]), to: z.union([z.string(), z.number(), z.null()]) })),
  duplicateOfRow: z.number().int().nullable(),
  decision: z.enum(['accepted', 'declined']).nullable(),
});
export type ImportRowDtoT = z.infer<typeof ImportRowDto>;

export const ImportPolicyDto = z.object({
  maxUploadBytes: z.number().int(),
  limits: z.object({ maxSheets: z.number().int(), maxRows: z.number().int(), maxColumns: z.number().int(), maxCells: z.number().int(), timeoutMs: z.number().int(), heapMb: z.number().int() }),
  targets: z.array(z.object({ target: ImportTargetSchema, fileTypes: z.array(z.enum(ALLOWED_FILE_TYPES)), fields: z.array(ImportFieldDto) })),
  scanner: z.object({ engine: z.string(), enterprise: z.boolean() }),
  /** Honest status: no OCR engine / PDF text extractor is configured in this build. */
  ocr: z.literal('not_configured'),
  pdfText: z.literal('not_configured'),
  /** Parser isolation: a separate process (heap cap, timeout, Node permission model, empty environment); OS-level network isolation is a deployment control. */
  parser: z.object({ isolation: z.literal('child_process'), permissionModel: z.literal(true), osNetworkIsolation: z.literal('not_configured'), formulas: z.literal('never_evaluated') }),
});

const ListQuery = PageQuery.extend({
  sort: SortParam(['createdAt', 'code', 'status']),
  status: ImportStatusSchema.optional(),
  target: ImportTargetSchema.optional(),
});

export const importsRoutes = registerRoutes({
  importPolicy: defineRoute({
    id: 'imports.policy',
    method: 'GET',
    path: '/api/v1/projects/:projectId/imports/policy',
    summary: 'Import limits, targets and fields, and the honest scanner / OCR / parser status',
    tags: T,
    access: 'imports.batch.read',
    params: ProjectParams,
    response: ImportPolicyDto,
  }),
  listImports: defineRoute({
    id: 'imports.list',
    method: 'GET',
    path: '/api/v1/projects/:projectId/imports',
    summary: 'Batch history (only batches whose classification the caller is cleared for)',
    tags: T,
    access: 'imports.batch.read',
    params: ProjectParams,
    query: ListQuery,
    response: paged(ImportBatchSummary),
  }),
  uploadImport: defineRoute({
    id: 'imports.upload',
    method: 'POST',
    path: '/api/v1/projects/:projectId/imports',
    summary:
      'Upload a file for import: raw application/octet-stream body, header x-filename (percent-encoded UTF-8). Size limit → signature pre-scan (quarantine) → type allowlist for the target → preserved as a document version + source register entry (SHA-256) → parse job queued. Nothing is fetched from URLs.',
    tags: T,
    access: 'imports.batch.create',
    command: true,
    upload: true,
    params: ProjectParams,
    query: z.object({
      target: ImportTargetSchema,
      classification: z.enum(CLASSIFICATIONS).default('confidential'),
      /** A previous source this file supersedes (e.g. a newer workbook version) — the previous source is preserved. */
      supersedesSourceId: Uuid.optional(),
      note: Text(500).optional(),
    }),
    response: ImportBatchSummary,
  }),
  getImport: defineRoute({
    id: 'imports.get',
    method: 'GET',
    path: '/api/v1/projects/:projectId/imports/:batchId',
    summary: 'Batch detail: file identity, sheets, mapping, summary, file-level findings, records produced',
    tags: T,
    access: 'imports.batch.read',
    params: BatchParams,
    response: ImportBatchDetail,
  }),
  listImportRows: defineRoute({
    id: 'imports.rows',
    method: 'GET',
    path: '/api/v1/projects/:projectId/imports/:batchId/rows',
    summary: 'Preview and comparison with the current records, row by row (fixed order: row number)',
    tags: T,
    access: 'imports.batch.read',
    params: BatchParams,
    query: PageQuery.extend({ sort: NoSort, action: ImportRowActionSchema.optional() }),
    response: paged(ImportRowDto),
  }),
  mapImport: defineRoute({
    id: 'imports.map',
    method: 'POST',
    path: '/api/v1/projects/:projectId/imports/:batchId/mapping',
    summary: 'Choose the sheet, header row and column mapping, then validate (uploader only; before submission)',
    tags: T,
    access: 'imports.batch.create',
    command: true,
    params: BatchParams,
    body: z.object({
      expectedVersion: ExpectedVersion,
      sheet: RequiredText(200),
      headerRow: z.number().int().min(1).max(5).default(1),
      mapping: z.record(z.string().regex(/^[A-Za-z]{1,32}$/), RequiredText(200)),
    }),
    response: ImportBatchDetail,
  }),
  submitImport: defineRoute({
    id: 'imports.submit',
    method: 'POST',
    path: '/api/v1/projects/:projectId/imports/:batchId/submit',
    summary: 'Submit the validated preview for approval by a second person (uploader only)',
    tags: T,
    access: 'imports.batch.create',
    command: true,
    params: BatchParams,
    body: z.object({ expectedVersion: ExpectedVersion, note: Text(1000).optional() }),
    response: ImportBatchDetail,
  }),
  approveImport: defineRoute({
    id: 'imports.approve',
    method: 'POST',
    path: '/api/v1/projects/:projectId/imports/:batchId/approve',
    summary:
      'Approve and apply the ACCEPTED rows (item by item; not the uploader). Creates draft / proposed records, claims and change requests only; never updates an existing record (REQ-INT-015). 409 when the records changed since submission.',
    tags: T,
    access: 'imports.batch.approve',
    command: true,
    params: BatchParams,
    body: z.object({ expectedVersion: ExpectedVersion, acceptedRows: z.array(z.number().int().min(1)).max(5000), note: Text(1000).optional() }),
    response: ImportBatchDetail,
  }),
  rejectImport: defineRoute({
    id: 'imports.reject',
    method: 'POST',
    path: '/api/v1/projects/:projectId/imports/:batchId/reject',
    summary: 'Reject a submitted batch with a reason (not the uploader); nothing is applied',
    tags: T,
    access: 'imports.batch.approve',
    command: true,
    params: BatchParams,
    body: z.object({ expectedVersion: ExpectedVersion, reason: RequiredText(1000) }),
    response: ImportBatchDetail,
  }),
  cancelImport: defineRoute({
    id: 'imports.cancel',
    method: 'POST',
    path: '/api/v1/projects/:projectId/imports/:batchId/cancel',
    summary: 'Cancel a batch before it is applied (uploader only); the preserved source stays in the register',
    tags: T,
    access: 'imports.batch.create',
    command: true,
    params: BatchParams,
    body: z.object({ expectedVersion: ExpectedVersion, reason: Text(1000).optional() }),
    response: ImportBatchDetail,
  }),
  rollbackImport: defineRoute({
    id: 'imports.rollback',
    method: 'POST',
    path: '/api/v1/projects/:projectId/imports/:batchId/rollback',
    summary:
      'Roll back an applied batch where feasible: removes the records it created when none was changed since, none is referenced and the preserved file is not under legal hold; otherwise 422 with the blocking records',
    tags: T,
    access: 'imports.batch.rollback',
    command: true,
    params: BatchParams,
    body: z.object({ expectedVersion: ExpectedVersion, reason: RequiredText(1000) }),
    response: ImportBatchDetail,
  }),
});

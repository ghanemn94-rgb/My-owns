import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  IMPORT_LIMITS,
  IMPORT_MESSAGES_EN,
  IMPORT_TARGETS,
  IMPORT_TARGET_FIELDS,
  IMPORT_TARGET_FILE_TYPES,
  assertAcceptedRows,
  assertMapping,
  assertPreviewUnchanged,
  clearanceAllows,
  detectDangerousSignature,
  detectFileType,
  forbidden,
  importSourceType,
  importTransition,
  invalid,
  isDocumentTarget,
  notFound,
  ruleViolation,
  sanitizeFilename,
  serverMessage,
  suggestMapping,
  type AllowedFileType,
  type Classification,
  type ImportCell,
  type ImportCommand,
  type ImportStatus,
  type ImportTarget,
  type ServerMessage,
} from '@hub/domain';
import type { ImportBatchDetailDto, ImportBatchSummaryDto, RouteInput, importsRoutes } from '@hub/contracts';
import { DbService } from '../../platform/db.service';
import { PolicyService } from '../../platform/policy.service';
import { AuditService } from '../../platform/audit.service';
import { OutboxService } from '../../platform/outbox.service';
import { Clock } from '../../platform/clock';
import { APP_CONFIG, type AppConfig } from '../../platform/config';
import { JobQueue, type ClaimedJob } from '../../platform/jobs/job-queue.service';
import { JobContextFactory } from '../../platform/jobs/job-context';
import type { RequestContext } from '../../platform/context';
import { assertVersion, loadInProject, nextCode, offsetOf, pageOf, likeContains } from '../../platform/helpers';
import { orderBySort } from '../../platform/sort';
import { newId, sha256Hex } from '../../platform/ids';
import { DocumentsService } from '../documents/documents.service';
import { OBJECT_STORAGE, storageKey, type ObjectStorage } from '../documents/storage/object-storage';
import { ImportPlanner, headersOf, previewHash, type PlanRow } from './import-planner';
import { ImportApplier } from './import-apply';
import { pdfActiveContent, zipEntryNames } from './file-checks';
import { runSandboxedParse, type SandboxOutcome } from './sandbox/sandbox';
import type { ParseFindings, ParsedCell } from './sandbox/parser';

type R = typeof importsRoutes;
type Batch = typeof schema.importBatch.$inferSelect;

/** Job kind of the sandboxed parser (worker). Payload: the batch id only. */
export const PARSE_IMPORT_JOB = 'imports.parse';
/** The parser's service identity only reads the batch it was given (deny-all otherwise). */
const IMPORTS_SERVICE_PERMISSIONS = ['imports.batch.read'];
const SPREADSHEET_TYPES: readonly AllowedFileType[] = ['xlsx', 'csv'];
const PREVIEW_ROWS = 5;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/**
 * Import wizard (spec §17; REQ-INT-001..005, REQ-INT-015, REQ-SRC-009, REQ-SEC-014/015, AT-01, AT-25). Mutation flow:
 * session → policy (imports.batch.* with the batch classification; uploader-only steps; not_self approval) → contract →
 * domain rules (packages/domain/src/imports.ts) → one transaction with the change, audit rows and outbox events.
 */
@Injectable()
export class ImportsService {
  private readonly log = new Logger('imports');
  constructor(
    private readonly db: DbService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly queue: JobQueue,
    private readonly contexts: JobContextFactory,
    private readonly clock: Clock,
    private readonly docs: DocumentsService,
    private readonly planner: ImportPlanner,
    private readonly applier: ImportApplier,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // ------------------------------------------------------------------------------------------------ reads
  policyInfo() {
    const up = this.docs.uploadPolicy();
    return {
      maxUploadBytes: this.config.storage.maxUploadBytes,
      limits: { maxSheets: IMPORT_LIMITS.maxSheets, maxRows: IMPORT_LIMITS.maxRows, maxColumns: IMPORT_LIMITS.maxColumns, maxCells: IMPORT_LIMITS.maxCells, timeoutMs: IMPORT_LIMITS.timeoutMs, heapMb: IMPORT_LIMITS.heapMb },
      targets: IMPORT_TARGETS.map((t) => ({ target: t, fileTypes: [...IMPORT_TARGET_FILE_TYPES[t]], fields: this.fieldsOf(t) })),
      scanner: up.scanner,
      ocr: 'not_configured' as const,
      pdfText: 'not_configured' as const,
      parser: { isolation: 'child_process' as const, permissionModel: true as const, osNetworkIsolation: 'not_configured' as const, formulas: 'never_evaluated' as const },
    };
  }

  private fieldsOf(t: ImportTarget) {
    return IMPORT_TARGET_FIELDS[t].map((f) => ({ key: f.key, type: f.type, required: f.required, values: f.values ? [...f.values] : null }));
  }

  private async names(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
    const list = [...new Set(ids.filter((x): x is string => !!x))];
    if (!list.length) return new Map();
    const rows = await this.db.tx().select({ id: schema.appUser.id, name: schema.appUser.displayName }).from(schema.appUser).where(inArray(schema.appUser.id, list));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private summaryDto(b: Batch, names: Map<string, string>): ImportBatchSummaryDto {
    return {
      id: b.id,
      code: b.code,
      target: b.kind as ImportTarget,
      fileType: b.fileType as AllowedFileType | 'unknown',
      filename: b.filename,
      status: b.status as ImportStatus,
      classification: b.classification as Classification,
      sizeBytes: b.sizeBytes,
      summary: b.summary ?? {},
      isDemo: b.isDemo,
      createdBy: b.createdBy,
      createdByName: names.get(b.createdBy) ?? null,
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
      version: b.version,
    };
  }

  /** Load a batch of the project the caller may see (classification) and hold `permission` on — 404 otherwise. */
  private async load(ctx: RequestContext, projectId: string, batchId: string, permission = 'imports.batch.read'): Promise<Batch> {
    const b = await loadInProject(this.db, schema.importBatch, projectId, batchId);
    this.policy.assert(ctx, permission, { projectId, classification: b.classification as Classification });
    return b;
  }

  async list(ctx: RequestContext, projectId: string, q: RouteInput<R['listImports']>['query']) {
    const B = schema.importBatch;
    const where = and(
      eq(B.projectId, projectId),
      this.policy.visibilitySql(ctx, projectId, { classification: B.classification }),
      q.status ? eq(B.status, q.status) : undefined,
      q.target ? eq(B.kind, q.target) : undefined,
      q.q ? or(ilike(B.code, likeContains(q.q)), ilike(B.filename, likeContains(q.q))) : undefined,
    ) as SQL;
    const [{ n }] = (await this.db.tx().select({ n: count() }).from(B).where(where)) as [{ n: number }];
    const rows = await this.db
      .tx()
      .select()
      .from(B)
      .where(where)
      .orderBy(...orderBySort(q.sort, { createdAt: B.createdAt, code: B.code, status: B.status }, B.id, [desc(B.createdAt), desc(B.id)]))
      .limit(q.pageSize)
      .offset(offsetOf(q));
    const names = await this.names(rows.map((r) => r.createdBy));
    return pageOf(rows.map((r) => this.summaryDto(r, names)), Number(n), q);
  }

  async get(ctx: RequestContext, projectId: string, batchId: string): Promise<ImportBatchDetailDto> {
    return this.detail(ctx, await this.load(ctx, projectId, batchId));
  }

  private async detail(ctx: RequestContext, b: Batch): Promise<ImportBatchDetailDto> {
    const names = await this.names([b.createdBy, b.approvedBy]);
    const target = b.kind as ImportTarget;
    const sheets = await this.db
      .tx()
      .select({ name: schema.importSheet.name, preview: sql<(ImportCell | null)[][]>`coalesce(jsonb_path_query_array(${schema.importSheet.rows}, ${`$[0 to ${PREVIEW_ROWS - 1}]`}::jsonpath), '[]'::jsonb)` })
      .from(schema.importSheet)
      .where(and(eq(schema.importSheet.batchId, b.id), eq(schema.importSheet.projectId, b.projectId)))
      .orderBy(asc(schema.importSheet.sheetNo));
    const sheetPreview: Record<string, string[][]> = {};
    for (const s of sheets) sheetPreview[s.name] = (s.preview ?? []).map((r) => headersOf(r));
    let suggested: Record<string, string> | null = null;
    if (!isDocumentTarget(target) && sheets.length) {
      const name = b.sheet && sheetPreview[b.sheet] ? b.sheet : sheets[0]!.name;
      const hdr = sheetPreview[name]?.[(b.headerRow ?? 1) - 1] ?? [];
      suggested = suggestMapping(target, hdr);
    }
    const [src] = b.sourceId ? await this.db.tx().select({ code: schema.sourceRecord.code }).from(schema.sourceRecord).where(and(eq(schema.sourceRecord.id, b.sourceId), eq(schema.sourceRecord.projectId, b.projectId))) : [];
    const outputs = await this.db.tx().select().from(schema.importOutput).where(and(eq(schema.importOutput.batchId, b.id), eq(schema.importOutput.projectId, b.projectId))).orderBy(asc(schema.importOutput.rowNo), asc(schema.importOutput.createdAt));
    const uploader = ctx.principal.userId === b.createdBy;
    const res = { projectId: b.projectId, classification: b.classification as Classification };
    const applicable = (b.summary?.['create'] ?? 0) + (b.summary?.['update'] ?? 0) + (b.summary?.['conflict'] ?? 0);
    return {
      ...this.summaryDto(b, names),
      sha256: b.sha256,
      documentId: b.documentId,
      documentVersionId: b.documentVersionId,
      sourceId: b.sourceId,
      sourceCode: src?.code ?? null,
      failureCode: b.failureCode,
      failureDetail: b.failureDetail,
      sheets: b.sheets ?? [],
      sheet: b.sheet,
      headerRow: b.headerRow,
      headers: b.headers ?? [],
      mapping: b.mapping ?? null,
      suggestedMapping: suggested,
      sheetPreview,
      fields: this.fieldsOf(target),
      findings: b.findings ?? [],
      submittedAt: iso(b.submittedAt),
      approvedBy: b.approvedBy,
      approvedByName: b.approvedBy ? (names.get(b.approvedBy) ?? null) : null,
      approvedAt: iso(b.approvedAt),
      rejectedBy: b.rejectedBy,
      rejectedAt: iso(b.rejectedAt),
      decisionNote: b.decisionNote,
      rolledBackBy: b.rolledBackBy,
      rolledBackAt: iso(b.rolledBackAt),
      rollbackReason: b.rollbackReason,
      outputs: outputs.map((o) => ({ rowNo: o.rowNo, recordType: o.recordType as 'risk' | 'task' | 'source_claim' | 'change_request', recordId: o.recordId, recordCode: o.recordCode, rolledBack: !!o.rolledBackAt })),
      canMap: uploader && !isDocumentTarget(target) && (b.status === 'parsed' || b.status === 'validated') && this.policy.can(ctx, 'imports.batch.create', res),
      canSubmit: uploader && b.status === 'validated' && applicable > 0 && this.policy.can(ctx, 'imports.batch.create', res),
      canApprove: !uploader && b.status === 'submitted' && this.policy.can(ctx, 'imports.batch.approve', { ...res, requesterUserId: b.createdBy }),
      canRollback: b.status === 'applied' && this.policy.can(ctx, 'imports.batch.rollback', res),
      canCancel: uploader && ['uploaded', 'parsed', 'validated', 'submitted'].includes(b.status) && this.policy.can(ctx, 'imports.batch.create', res),
    };
  }

  /** Preview / comparison rows. The current values of a matched record are shown only to readers of that record. */
  async rows(ctx: RequestContext, projectId: string, batchId: string, q: RouteInput<R['listImportRows']>['query']) {
    const b = await this.load(ctx, projectId, batchId);
    const W = schema.importRow;
    const where = and(eq(W.batchId, b.id), eq(W.projectId, projectId), q.action ? eq(W.action, q.action) : undefined) as SQL;
    const [{ n }] = (await this.db.tx().select({ n: count() }).from(W).where(where)) as [{ n: number }];
    const rows = await this.db.tx().select().from(W).where(where).orderBy(asc(W.rowNo)).limit(q.pageSize).offset(offsetOf(q));
    const decisionIds = rows.filter((r) => r.matchType === 'decision' && r.matchId).map((r) => r.matchId!);
    const visibleDecisions = decisionIds.length
      ? new Set(
          (
            await this.db
              .tx()
              .select({ id: schema.decision.id })
              .from(schema.decision)
              .where(and(eq(schema.decision.projectId, projectId), inArray(schema.decision.id, decisionIds), this.policy.visibilitySql(ctx, projectId, { classification: schema.decision.classification })))
          ).map((x) => x.id),
        )
      : new Set<string>();
    const readable = (type: string | null, id: string | null) => {
      if (!type || !id) return false;
      if (type === 'decision') return this.policy.canInProject(ctx, 'governance.decision.read', projectId) && visibleDecisions.has(id);
      if (type === 'project') return this.policy.canInProject(ctx, 'portfolio.project.read', projectId);
      return this.policy.canInProject(ctx, 'planning.plan.read', projectId);
    };
    return pageOf(
      rows.map((r) => {
        const show = readable(r.matchType, r.matchId);
        return {
          rowNo: r.rowNo,
          action: r.action,
          cells: r.raw,
          values: r.normalized,
          errors: r.errors,
          warnings: r.warnings,
          notes: show || !r.matchId ? r.notes : r.notes.filter((m) => !('code' in m.params)),
          formulaFields: r.formulaFields,
          match: show && r.matchType && r.matchId ? { type: r.matchType, id: r.matchId, code: r.matchCode } : null,
          governedReason: r.governedReason,
          diff: show ? r.diff : [],
          duplicateOfRow: r.duplicateOfRow,
          decision: (r.decision as 'accepted' | 'declined' | null) ?? null,
        };
      }),
      Number(n),
      q,
    );
  }

  // ------------------------------------------------------------------------------------------------ upload
  /**
   * Upload (AT-25): size limit → signature pre-scan and PDF active content (quarantine, never parsed) → type allowlist of
   * the target → the existing safe document path (scanner adapter, magic bytes, SHA-256, storage) → source register entry
   * with the hash (REQ-INT-002 source preservation) → parse job. Nothing is fetched from URLs.
   */
  async upload(ctx: RequestContext, projectId: string, input: { bytes: Buffer; filename: string | undefined; query: RouteInput<R['uploadImport']>['query'] }) {
    const q = input.query;
    const target = q.target as ImportTarget;
    if (!clearanceAllows(ctx.principal.clearance, q.classification)) throw ruleViolation('imports.classification_above_clearance', "A batch's classification cannot exceed the uploader's clearance");
    this.policy.assert(ctx, 'imports.batch.create', { projectId, classification: q.classification });
    const bytes = input.bytes;
    if (bytes.length > this.config.storage.maxUploadBytes) {
      throw new HttpException({ message: `File exceeds the ${Math.round(this.config.storage.maxUploadBytes / 1048576)} MB limit`, code: 'imports.upload.too_large' }, 413);
    }
    if (bytes.length === 0) throw ruleViolation('imports.upload.empty', 'The file is empty');
    if (!input.filename || !input.filename.trim()) throw invalid('imports.upload.filename_required', 'The x-filename header is required');
    let rawName = input.filename;
    try {
      rawName = decodeURIComponent(input.filename);
    } catch {
      /* not percent-encoded */
    }
    const filename = sanitizeFilename(rawName);
    const sha256 = sha256Hex(bytes);
    const [project] = await this.db.tx().select({ isDemo: schema.project.isDemo, orgId: schema.project.orgId }).from(schema.project).where(eq(schema.project.id, projectId));
    if (!project) throw notFound();
    let supersedes: string | null = null;
    if (q.supersedesSourceId) {
      const prev = await loadInProject(this.db, schema.sourceRecord, projectId, q.supersedesSourceId);
      if (!this.policy.canSee(ctx, { projectId, classification: prev.classification as Classification })) throw notFound();
      const [already] = await this.db.tx().select({ id: schema.sourceRecord.id }).from(schema.sourceRecord).where(and(eq(schema.sourceRecord.projectId, projectId), eq(schema.sourceRecord.supersedesSourceId, prev.id)));
      if (already) throw ruleViolation('sources.already_superseded', 'That source was already superseded by a newer source');
      supersedes = prev.id;
    }
    const batchId = newId();
    const code = await nextCode(this.db, schema.importBatch, projectId, 'IMP');
    const base = { id: batchId, orgId: project.orgId, projectId, code, kind: target, filename, sha256, sizeBytes: bytes.length, classification: q.classification, isDemo: project.isDemo, createdBy: ctx.principal.userId! };

    // 1. Pre-scan: dangerous signatures (EICAR, executables, scripts) and PDF active content → quarantine area, never parsed.
    const danger = detectDangerousSignature(bytes);
    const isPdf = bytes.subarray(0, 5).toString('latin1') === '%PDF-';
    const pdfActive = isPdf ? pdfActiveContent(bytes) : null;
    if (danger || pdfActive) {
      const reason = danger ? `${danger.kind}: ${danger.detail}` : `PDF active content (/${pdfActive})`;
      const key = storageKey('quarantine', projectId, batchId);
      await this.storage.put(key, bytes);
      const guess = detectFileType(bytes, filename, bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50 ? zipEntryNames(bytes) : null);
      await this.db.tx().insert(schema.importBatch).values({ ...base, fileType: guess.ok ? guess.type : 'unknown', quarantineKey: key, status: 'quarantined', failureCode: 'imports.upload.quarantined', failureDetail: reason.slice(0, 300) });
      await this.audit.record({ action: 'imports.batch.create', entityType: 'import_batch', entityId: batchId, projectId, reason: `quarantined: ${reason}`, after: { code, target, filename, sha256, sizeBytes: bytes.length, status: 'quarantined' } });
      await this.audit.record({ action: 'security.file_quarantined', entityType: 'import_batch', entityId: batchId, projectId, reason, after: { sha256, filename } });
      const [row] = await this.db.tx().select().from(schema.importBatch).where(eq(schema.importBatch.id, batchId));
      return this.summaryDto(row!, await this.names([row!.createdBy]));
    }

    // 2. Type allowlist (magic bytes + extension; macro-enabled Office refused) and the target's accepted types.
    const zipNames = bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50 ? zipEntryNames(bytes) : null;
    const det = detectFileType(bytes, filename, zipNames);
    if (!det.ok) throw ruleViolation(`imports.upload.${det.code}`, det.reason, { filename });
    if (!IMPORT_TARGET_FILE_TYPES[target].includes(det.type)) {
      throw ruleViolation('imports.upload.type_not_for_target', `A ${det.type.toUpperCase()} file cannot be imported as ${target.replace(/_/g, ' ')} (accepted: ${IMPORT_TARGET_FILE_TYPES[target].join(', ')})`, { fileType: det.type, target });
    }

    // 3. The existing safe file path: the file is kept as a document version (scanner adapter, SHA-256, storage).
    const doc = await this.docs.create(ctx, projectId, { title: `Import ${code} — ${filename}`.slice(0, 300), kind: 'source_upload', classification: q.classification });
    const up = await this.docs.uploadVersion(ctx, projectId, doc.id, { bytes, filename: input.filename, declaredType: undefined, note: q.note ?? `Imported through ${code}` });
    if (up.sha256 !== sha256) throw new Error('import: stored hash differs from the received bytes');
    if (up.scanStatus === 'quarantined') {
      await this.db.tx().insert(schema.importBatch).values({ ...base, fileType: det.type, documentId: doc.id, documentVersionId: up.versionId, status: 'quarantined', failureCode: 'imports.upload.quarantined', failureDetail: String(up.scanDetail ?? '').slice(0, 300) });
      await this.audit.record({ action: 'imports.batch.create', entityType: 'import_batch', entityId: batchId, projectId, reason: 'quarantined by the scanner adapter', after: { code, target, filename, sha256, status: 'quarantined' } });
      const [row] = await this.db.tx().select().from(schema.importBatch).where(eq(schema.importBatch.id, batchId));
      return this.summaryDto(row!, await this.names([row!.createdBy]));
    }

    // 4. Source preservation (spec §2): a source-register entry with the file's checksum; a superseded source is kept.
    const sourceId = newId();
    const srcCode = await nextCode(this.db, schema.sourceRecord, projectId, 'SRC');
    await this.db
      .tx()
      .insert(schema.sourceRecord)
      .values({
        id: sourceId,
        orgId: project.orgId,
        projectId,
        code: srcCode,
        sourceType: importSourceType(det.type),
        filename,
        checksum: sha256,
        uploadedAt: this.clock.now(),
        extractionStatus: 'not_performed',
        extractionNote: `Import ${code}: extraction pending (sandboxed parser)`,
        documentVersionId: up.versionId,
        supersedesSourceId: supersedes,
        classification: q.classification,
        isDemo: project.isDemo,
        createdBy: ctx.principal.userId,
      });
    await this.audit.record({ action: 'documents.source.create', entityType: 'source_record', entityId: sourceId, projectId, reason: `import ${code}`, after: { code: srcCode, sourceType: importSourceType(det.type), filename, checksum: sha256, supersedesSourceId: supersedes } });
    await this.outbox.emit({ type: 'source.updated', projectId, aggregateType: 'source_record', aggregateId: sourceId, payload: { sourceId, change: 'created', supersedesSourceId: supersedes } });

    await this.db.tx().insert(schema.importBatch).values({ ...base, fileType: det.type, documentId: doc.id, documentVersionId: up.versionId, sourceId, status: 'uploaded' });
    await this.queue.enqueue({ kind: PARSE_IMPORT_JOB, orgId: project.orgId, projectId, payload: { batchId }, idempotencyKey: `import-parse:${batchId}`, requestedBy: ctx.principal.userId, maxAttempts: 3 });
    await this.audit.record({ action: 'imports.batch.create', entityType: 'import_batch', entityId: batchId, projectId, after: { code, target, filename, fileType: det.type, sha256, sizeBytes: bytes.length, classification: q.classification, sourceId, documentId: doc.id } });
    const [row] = await this.db.tx().select().from(schema.importBatch).where(eq(schema.importBatch.id, batchId));
    return this.summaryDto(row!, await this.names([row!.createdBy]));
  }

  // ------------------------------------------------------------------------------------------------ parse (worker)
  /**
   * Worker: read the preserved file (checksum verified), parse it in the sandbox (time / memory limits, no network), store
   * the sheets and file-level findings. Spreadsheets wait for the mapping; documents become validated claim rows. A refused
   * file fails the batch with a code — the worker itself keeps running.
   */
  async parseJob(job: ClaimedJob): Promise<Record<string, unknown>> {
    const projectId = job.project_id;
    const batchId = String(job.payload['batchId'] ?? '');
    if (!projectId || !/^[0-9a-f-]{36}$/i.test(batchId)) return { skipped: 'bad_payload' };
    const ctx = this.contexts.forService(job, 'svc-imports', IMPORTS_SERVICE_PERMISSIONS);
    const prep = await this.db.run(ctx, async () => {
      const [b] = await this.db.tx().select().from(schema.importBatch).where(and(eq(schema.importBatch.id, batchId), eq(schema.importBatch.projectId, projectId)));
      if (!b || b.status !== 'uploaded' || !b.documentVersionId) return null;
      const [v] = await this.db.tx().select({ key: schema.documentVersion.storageKey }).from(schema.documentVersion).where(and(eq(schema.documentVersion.id, b.documentVersionId), eq(schema.documentVersion.projectId, projectId)));
      return v ? { b, key: v.key } : null;
    });
    // AT-03 worker path: a batch id that is not a pending batch of the job's own project is never touched.
    if (!prep) return { skipped: 'not_pending' };
    const { b } = prep;
    let outcome: SandboxOutcome;
    let bytes: Buffer | null = null;
    try {
      const chunks: Buffer[] = [];
      for await (const c of await this.storage.get(prep.key)) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c as Uint8Array));
      bytes = Buffer.concat(chunks);
    } catch {
      bytes = null;
    }
    if (!bytes) outcome = { ok: false, code: 'imports.parse.file_missing', detail: 'The preserved file could not be read' };
    else if (sha256Hex(bytes) !== b.sha256) outcome = { ok: false, code: 'imports.parse.integrity', detail: 'The preserved file does not match its recorded checksum' };
    else if (!['xlsx', 'csv', 'docx'].includes(b.fileType)) {
      outcome = { ok: true, result: { sheets: [], findings: { formulaCells: 0, harmfulFormulaCells: 0, externalLinks: 0, dataConnections: false, hyperlinks: 0, paragraphs: 0, truncatedParagraphs: false } } };
    } else {
      await this.queue.extendLease(job, IMPORT_LIMITS.timeoutMs + 60_000);
      outcome = await runSandboxedParse(bytes, b.fileType as 'xlsx' | 'csv' | 'docx');
    }
    return this.db.run(ctx, async () => {
      const rows = await this.db.query<{ status: string }>(`select status from import_batch where id = $1 and project_id = $2 for update`, [b.id, projectId]);
      if (rows.rows[0]?.status !== 'uploaded') return { skipped: 'not_pending' };
      const today = this.clock.today((await this.projectTz(projectId)) ?? 'Asia/Riyadh');
      if (!outcome.ok) {
        const status = importTransition('uploaded', 'parse_failed');
        await this.db.tx().update(schema.importBatch).set({ status, failureCode: outcome.code.slice(0, 64), failureDetail: outcome.detail.slice(0, 300), updatedAt: new Date(), version: sql`${schema.importBatch.version} + 1` }).where(eq(schema.importBatch.id, b.id));
        if (b.sourceId) await this.db.tx().update(schema.sourceRecord).set({ extractionStatus: 'failed', extractionDate: today, extractionNote: `Import ${b.code}: refused by the parser (${outcome.code})`, version: sql`${schema.sourceRecord.version} + 1` }).where(and(eq(schema.sourceRecord.id, b.sourceId), eq(schema.sourceRecord.projectId, projectId)));
        await this.audit.record({ action: 'imports.batch.parse', entityType: 'import_batch', entityId: b.id, projectId, outcome: 'rejected', reason: `${outcome.code}: ${outcome.detail}`.slice(0, 500) });
        return { status, code: outcome.code };
      }
      const res = outcome.result;
      const findings = this.fileFindings(res.findings, b.fileType as AllowedFileType);
      if (res.sheets.length) {
        await this.db.tx().insert(schema.importSheet).values(res.sheets.map((s, i) => ({ id: newId(), orgId: b.orgId, projectId, batchId: b.id, sheetNo: i + 1, name: s.name, rows: s.rows as (ImportCell | null)[][] })));
      }
      const sheetsMeta = res.sheets.map((s) => ({ name: s.name, rows: s.rows.length, columns: s.rows.reduce((m, r) => Math.max(m, r.length), 0) }));
      const performed = ['xlsx', 'csv', 'docx'].includes(b.fileType);
      let status: ImportStatus;
      const values: Partial<Batch> = { sheets: sheetsMeta, findings, updatedAt: new Date() };
      if (isDocumentTarget(b.kind as ImportTarget)) {
        status = importTransition('uploaded', 'extracted');
        const plan = this.planner.planDocument((res.sheets[0]?.rows ?? []) as (ImportCell | null)[][]);
        await this.writeRows(b, plan);
        Object.assign(values, { sheet: res.sheets[0]?.name ?? null, headerRow: null, summary: this.summarize(plan), previewHash: previewHash(plan) });
      } else status = importTransition('uploaded', 'parsed');
      await this.db.tx().update(schema.importBatch).set({ ...values, status, version: sql`${schema.importBatch.version} + 1` }).where(eq(schema.importBatch.id, b.id));
      if (b.sourceId) {
        await this.db
          .tx()
          .update(schema.sourceRecord)
          .set({
            extractionStatus: performed ? 'performed' : 'not_performed',
            extractionDate: performed ? today : null,
            extractionNote: performed ? `Import ${b.code}: values extracted by the sandboxed parser (formulas never evaluated)` : `Import ${b.code}: no OCR / PDF text extractor is configured — nothing extracted; review the file and record claims by hand`,
            version: sql`${schema.sourceRecord.version} + 1`,
          })
          .where(and(eq(schema.sourceRecord.id, b.sourceId), eq(schema.sourceRecord.projectId, projectId)));
      }
      await this.audit.record({ action: 'imports.batch.parse', entityType: 'import_batch', entityId: b.id, projectId, after: { status, sheets: sheetsMeta, findings: findings.map((f) => f.code) } });
      return { status, sheets: sheetsMeta.length };
    });
  }

  private async projectTz(projectId: string): Promise<string | null> {
    const [p] = await this.db.tx().select({ tz: schema.project.timezone }).from(schema.project).where(eq(schema.project.id, projectId));
    return p?.tz ?? null;
  }

  private fileFindings(f: ParseFindings, fileType: AllowedFileType): ServerMessage[] {
    const out: ServerMessage[] = [];
    if (f.formulaCells) out.push(serverMessage('imports.file.formula_cells', { count: f.formulaCells }));
    if (f.harmfulFormulaCells) out.push(serverMessage('imports.file.harmful_formulas', { count: f.harmfulFormulaCells }));
    if (f.externalLinks) out.push(serverMessage('imports.file.external_links', { count: f.externalLinks }));
    if (f.dataConnections) out.push(serverMessage('imports.file.data_connections'));
    if (f.hyperlinks) out.push(serverMessage('imports.file.hyperlinks', { count: f.hyperlinks }));
    if (fileType === 'docx') out.push(serverMessage('imports.file.paragraphs', { count: f.paragraphs }));
    if (f.truncatedParagraphs) out.push(serverMessage('imports.file.truncated_paragraphs', { count: IMPORT_LIMITS.maxParagraphs }));
    if (['pdf', 'png', 'jpeg'].includes(fileType)) out.push(serverMessage('imports.file.extraction_not_configured'));
    for (const m of out) if (!(m.code in IMPORT_MESSAGES_EN)) throw new Error(`missing import message ${m.code}`);
    return out;
  }

  private summarize(plan: PlanRow[]): Record<string, number> {
    const s: Record<string, number> = { rows: plan.length, create: 0, update: 0, conflict: 0, skip: 0, error: 0, warnings: 0, formulaCells: 0 };
    for (const r of plan) {
      s[r.action] = (s[r.action] ?? 0) + 1;
      if (r.warnings.length) s['warnings']! += 1;
      s['formulaCells']! += r.formulaFields.length;
    }
    return s;
  }

  private async writeRows(b: Batch, plan: PlanRow[]) {
    await this.db.tx().delete(schema.importRow).where(and(eq(schema.importRow.batchId, b.id), eq(schema.importRow.projectId, b.projectId)));
    for (let i = 0; i < plan.length; i += 500) {
      const chunk = plan.slice(i, i + 500);
      if (!chunk.length) break;
      await this.db
        .tx()
        .insert(schema.importRow)
        .values(
          chunk.map((r) => ({
            id: newId(),
            orgId: b.orgId,
            projectId: b.projectId,
            batchId: b.id,
            rowNo: r.rowNo,
            raw: r.raw as Record<string, ParsedCell | null>,
            normalized: r.values,
            action: r.action,
            errors: r.errors,
            warnings: r.warnings,
            notes: r.notes,
            formulaFields: r.formulaFields,
            matchType: r.matchType,
            matchId: r.matchId,
            matchCode: r.matchCode,
            governedReason: r.governedReason,
            diff: r.diff,
            duplicateOfRow: r.duplicateOfRow,
          })),
        );
    }
  }

  // ------------------------------------------------------------------------------------------------ commands
  private transition(b: Batch, command: ImportCommand): ImportStatus {
    return importTransition(b.status as ImportStatus, command);
  }

  private assertUploader(ctx: RequestContext, b: Batch) {
    if (ctx.principal.userId !== b.createdBy) throw forbidden('imports.not_uploader', 'Only the person who uploaded the file can map, submit or cancel this batch');
  }

  private async lockBatch(b: Batch, expectedVersion: number): Promise<Batch> {
    await this.db.query(`select id from import_batch where id = $1 and project_id = $2 for update`, [b.id, b.projectId]);
    const [cur] = await this.db.tx().select().from(schema.importBatch).where(and(eq(schema.importBatch.id, b.id), eq(schema.importBatch.projectId, b.projectId)));
    assertVersion(cur!, expectedVersion, 'import batch');
    return cur!;
  }

  private async update(b: Batch, values: Partial<Batch>): Promise<Batch> {
    const [row] = await this.db
      .tx()
      .update(schema.importBatch)
      .set({ ...values, updatedAt: new Date(), version: sql`${schema.importBatch.version} + 1` })
      .where(and(eq(schema.importBatch.id, b.id), eq(schema.importBatch.projectId, b.projectId), eq(schema.importBatch.version, b.version)))
      .returning();
    if (!row) throw new HttpException({ message: 'The batch changed meanwhile — reload it', code: 'conflict.version' }, 409);
    return row;
  }

  private async sheetRows(b: Batch, sheet: string): Promise<(ImportCell | null)[][]> {
    const [s] = await this.db.tx().select({ rows: schema.importSheet.rows }).from(schema.importSheet).where(and(eq(schema.importSheet.batchId, b.id), eq(schema.importSheet.projectId, b.projectId), eq(schema.importSheet.name, sheet)));
    if (!s) throw ruleViolation('imports.mapping.unknown_sheet', `Sheet "${sheet}" is not in the file`, { sheet });
    return s.rows as (ImportCell | null)[][];
  }

  /** Re-plan a spreadsheet batch from its stored mapping, as the uploader sees the records (map and approval). */
  private async replan(viewer: RequestContext, b: Batch, sheet: string, headerRow: number, mapping: Record<string, string>) {
    const rows = await this.sheetRows(b, sheet);
    const headers = headersOf(rows[headerRow - 1]);
    assertMapping(b.kind as ImportTarget, mapping, headers);
    const plan = await this.planner.plan(viewer, b.projectId, b.kind as ImportTarget, rows, headerRow, mapping, headers);
    return { plan, headers };
  }

  async map(ctx: RequestContext, projectId: string, batchId: string, body: RouteInput<R['mapImport']>['body']) {
    const b0 = await this.load(ctx, projectId, batchId, 'imports.batch.create');
    this.assertUploader(ctx, b0);
    if (isDocumentTarget(b0.kind as ImportTarget)) throw ruleViolation('imports.mapping.not_applicable', 'Document imports have no column mapping');
    const b = await this.lockBatch(b0, body.expectedVersion);
    const status = this.transition(b, 'map');
    const { plan, headers } = await this.replan(ctx, b, body.sheet, body.headerRow, body.mapping);
    await this.writeRows(b, plan);
    const summary = this.summarize(plan);
    const row = await this.update(b, { status, sheet: body.sheet, headerRow: body.headerRow, headers, mapping: body.mapping, summary, previewHash: previewHash(plan) });
    await this.audit.record({ action: 'imports.batch.map', entityType: 'import_batch', entityId: b.id, projectId, before: { status: b.status }, after: { status, sheet: body.sheet, headerRow: body.headerRow, mapping: body.mapping, summary } });
    return this.detail(ctx, row);
  }

  async submit(ctx: RequestContext, projectId: string, batchId: string, body: RouteInput<R['submitImport']>['body']) {
    const b0 = await this.load(ctx, projectId, batchId, 'imports.batch.create');
    this.assertUploader(ctx, b0);
    const b = await this.lockBatch(b0, body.expectedVersion);
    const status = this.transition(b, 'submit');
    const applicable = (b.summary?.['create'] ?? 0) + (b.summary?.['update'] ?? 0) + (b.summary?.['conflict'] ?? 0);
    if (applicable === 0) throw ruleViolation('imports.nothing_to_apply', 'No row of this batch can be applied (all are errors, duplicates or unchanged)');
    const row = await this.update(b, { status, submittedAt: this.clock.now() });
    await this.audit.record({ action: 'imports.batch.submit', entityType: 'import_batch', entityId: b.id, projectId, before: { status: b.status }, after: { status, previewHash: b.previewHash, summary: b.summary }, reason: body.note ?? null });
    await this.outbox.emit({ type: 'approval.pending', projectId, aggregateType: 'import_batch', aggregateId: b.id, payload: { importBatchId: b.id, code: b.code, requiredPermission: 'imports.batch.approve', uploaderUserId: b.createdBy } });
    return this.detail(ctx, row);
  }

  /**
   * Approval by a second person, item by item (REQ-INT-002, REQ-SRC-009): role → state → separation of duties; the plan is
   * re-built as the uploader sees the records now and must equal the submitted preview (409 otherwise); then the accepted
   * rows are applied in this transaction with the approver's authority (REQ-INT-015: no update of an existing record).
   */
  async approve(ctx: RequestContext, projectId: string, batchId: string, body: RouteInput<R['approveImport']>['body']) {
    const b0 = await loadInProject(this.db, schema.importBatch, projectId, batchId);
    const res = { projectId, classification: b0.classification as Classification };
    this.policy.assertApproval(ctx, 'imports.batch.approve', { ...res, requesterUserId: b0.createdBy }, () => this.transition(b0, 'approve'));
    const b = await this.lockBatch(b0, body.expectedVersion);
    const status = this.transition(b, 'approve');
    let plan: PlanRow[];
    let sheetName = b.sheet ?? '';
    if (isDocumentTarget(b.kind as ImportTarget)) {
      const [s] = await this.db.tx().select({ rows: schema.importSheet.rows, name: schema.importSheet.name }).from(schema.importSheet).where(and(eq(schema.importSheet.batchId, b.id), eq(schema.importSheet.projectId, projectId)));
      plan = this.planner.planDocument((s?.rows ?? []) as (ImportCell | null)[][]);
      sheetName = s?.name ?? 'Document';
    } else {
      // The uploader's CURRENT view: a record that changed, appeared or was hidden since submission makes the preview stale.
      const viewer = await this.contexts.forUser(b.createdBy, projectId, ctx.correlationId);
      if (!viewer) throw ruleViolation('imports.uploader_access_revoked', 'The uploader no longer has access to this project — the batch cannot be approved; reject it');
      plan = (await this.replan(viewer, b, b.sheet!, b.headerRow ?? 1, b.mapping ?? {})).plan;
    }
    assertPreviewUnchanged(b.previewHash, previewHash(plan));
    const applicable = new Set(plan.filter((r) => r.action === 'create' || r.action === 'update' || r.action === 'conflict').map((r) => r.rowNo));
    assertAcceptedRows(body.acceptedRows, applicable);
    const accepted = new Set(body.acceptedRows);
    const outputs = await this.applier.apply(ctx, b, plan.filter((r) => accepted.has(r.rowNo)), sheetName);
    const declined = [...applicable].filter((n) => !accepted.has(n));
    const rowsOf = (nums: number[]) => and(eq(schema.importRow.batchId, b.id), eq(schema.importRow.projectId, projectId), inArray(schema.importRow.rowNo, nums));
    await this.db.tx().update(schema.importRow).set({ decision: 'accepted' }).where(rowsOf([...accepted]));
    if (declined.length) await this.db.tx().update(schema.importRow).set({ decision: 'declined' }).where(rowsOf(declined));
    const now = this.clock.now();
    const row = await this.update(b, { status, approvedBy: ctx.principal.userId, approvedAt: now, appliedAt: now, decisionNote: body.note ?? null });
    const counts: Record<string, number> = {};
    for (const o of outputs) counts[o.recordType] = (counts[o.recordType] ?? 0) + 1;
    await this.audit.record({ action: 'imports.batch.approve', entityType: 'import_batch', entityId: b.id, projectId, before: { status: b.status }, after: { status, acceptedRows: body.acceptedRows.length, declinedRows: applicable.size - accepted.size, outputs: counts, previewHash: b.previewHash }, reason: body.note ?? null });
    if (b.sourceId) await this.outbox.emit({ type: 'source.updated', projectId, aggregateType: 'source_record', aggregateId: b.sourceId, payload: { sourceId: b.sourceId, change: 'import_applied', importBatchId: b.id } });
    await this.outbox.emit({ type: 'import.decided', projectId, aggregateType: 'import_batch', aggregateId: b.id, payload: { importBatchId: b.id, code: b.code, outcome: 'applied', uploaderUserId: b.createdBy } });
    return this.detail(ctx, row);
  }

  async reject(ctx: RequestContext, projectId: string, batchId: string, body: RouteInput<R['rejectImport']>['body']) {
    const b0 = await loadInProject(this.db, schema.importBatch, projectId, batchId);
    this.policy.assertApproval(ctx, 'imports.batch.approve', { projectId, classification: b0.classification as Classification, requesterUserId: b0.createdBy }, () => this.transition(b0, 'reject'));
    const b = await this.lockBatch(b0, body.expectedVersion);
    const status = this.transition(b, 'reject');
    const row = await this.update(b, { status, rejectedBy: ctx.principal.userId, rejectedAt: this.clock.now(), decisionNote: body.reason });
    await this.audit.record({ action: 'imports.batch.reject', entityType: 'import_batch', entityId: b.id, projectId, before: { status: b.status }, after: { status }, reason: body.reason });
    await this.outbox.emit({ type: 'import.decided', projectId, aggregateType: 'import_batch', aggregateId: b.id, payload: { importBatchId: b.id, code: b.code, outcome: 'rejected', uploaderUserId: b.createdBy } });
    return this.detail(ctx, row);
  }

  async cancel(ctx: RequestContext, projectId: string, batchId: string, body: RouteInput<R['cancelImport']>['body']) {
    const b0 = await this.load(ctx, projectId, batchId, 'imports.batch.create');
    this.assertUploader(ctx, b0);
    const b = await this.lockBatch(b0, body.expectedVersion);
    const status = this.transition(b, 'cancel');
    const row = await this.update(b, { status, decisionNote: body.reason ?? null });
    await this.audit.record({ action: 'imports.batch.cancel', entityType: 'import_batch', entityId: b.id, projectId, before: { status: b.status }, after: { status }, reason: body.reason ?? null });
    return this.detail(ctx, row);
  }

  /** Rollback where feasible (REQ-INT-003, C-31): refused while the preserved file is on legal hold or any record changed. */
  async rollback(ctx: RequestContext, projectId: string, batchId: string, body: RouteInput<R['rollbackImport']>['body']) {
    const b0 = await this.load(ctx, projectId, batchId, 'imports.batch.rollback');
    const b = await this.lockBatch(b0, body.expectedVersion);
    const status = this.transition(b, 'rollback');
    if (b.documentId) {
      const [d] = await this.db.tx().select({ hold: schema.document.legalHold }).from(schema.document).where(and(eq(schema.document.id, b.documentId), eq(schema.document.projectId, projectId)));
      if (d?.hold) {
        await this.audit.recordDetached(ctx, { action: 'imports.batch.rollback', entityType: 'import_batch', entityId: b.id, projectId, outcome: 'rejected', reason: 'imports.rollback.legal_hold' });
        throw ruleViolation('imports.rollback.legal_hold', 'The imported file is under legal hold — the batch cannot be rolled back until the hold is released');
      }
    }
    const outputs = await this.db.tx().select().from(schema.importOutput).where(and(eq(schema.importOutput.batchId, b.id), eq(schema.importOutput.projectId, projectId)));
    const blockers = await this.applier.rollbackBlockers(projectId, outputs);
    if (blockers.length) {
      await this.audit.recordDetached(ctx, { action: 'imports.batch.rollback', entityType: 'import_batch', entityId: b.id, projectId, outcome: 'rejected', reason: 'imports.rollback.not_feasible', after: { blockers: blockers.slice(0, 50) } });
      throw ruleViolation('imports.rollback.not_feasible', `Rollback is not feasible: ${blockers.length} record(s) changed or are used since the import`, { blockers: blockers.slice(0, 50) });
    }
    const n = await this.applier.rollback(ctx, b, outputs, body.reason);
    const row = await this.update(b, { status, rolledBackBy: ctx.principal.userId, rolledBackAt: this.clock.now(), rollbackReason: body.reason });
    await this.audit.record({ action: 'imports.batch.rollback', entityType: 'import_batch', entityId: b.id, projectId, before: { status: b.status }, after: { status, records: n }, reason: body.reason });
    if (b.sourceId) await this.outbox.emit({ type: 'source.updated', projectId, aggregateType: 'source_record', aggregateId: b.sourceId, payload: { sourceId: b.sourceId, change: 'import_rolled_back', importBatchId: b.id } });
    await this.outbox.emit({ type: 'import.decided', projectId, aggregateType: 'import_batch', aggregateId: b.id, payload: { importBatchId: b.id, code: b.code, outcome: 'rolled_back', uploaderUserId: b.createdBy } });
    return this.detail(ctx, row);
  }
}

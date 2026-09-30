import { HttpException, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { and, asc, count, desc, eq, inArray, isNull, sql, SQL } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  EVIDENCE_TARGET_READ_PERMISSION,
  CLASSIFICATIONS,
  Classification,
  classificationRank,
  clearanceAllows,
  conflict,
  notFound,
  ruleViolation,
  invalid,
  sanitizeFilename,
  detectFileType,
  assertDisposable,
  disposalAuthority,
  AllowedFileType,
  ALLOWED_FILE_TYPES,
  FILE_TYPE_INFO,
  TEXT_EXTRACTABLE_TYPES,
} from '@hub/domain';
import { DbService } from '../../platform/db.service';
import { PolicyService } from '../../platform/policy.service';
import { AuditService } from '../../platform/audit.service';
import { OutboxService } from '../../platform/outbox.service';
import { Clock } from '../../platform/clock';
import { APP_CONFIG, AppConfig } from '../../platform/config';
import type { RequestContext } from '../../platform/context';
import { newId, payloadHash } from '../../platform/ids';
import { assertVersion, evidenceLinkVisibleSql, likeContains, loadInProject, pageOf, offsetOf, updateVersioned } from '../../platform/helpers';
import { RecordVisibility } from '../../platform/record-visibility';
import { orderBySort } from '../../platform/sort';
import type { RouteInput, documentsRoutes } from '@hub/contracts';
import { OBJECT_STORAGE, ObjectStorage, storageKey } from './storage/object-storage';
import { MALWARE_SCANNER, MalwareScanner } from './files/scanner';
import { listZipEntries } from './files/zip';

type DocRow = typeof schema.document.$inferSelect;
type VersionRow = typeof schema.documentVersion.$inferSelect;
export interface LoadedDoc {
  doc: DocRow;
  roomIsCleanTeam: boolean;
}

/** Versions that must never be served, linked or indexed. */
export const UNUSABLE_SCAN_STATUSES = new Set(['quarantined', 'rejected', 'pending']);

/** A version may be downloaded/indexed only when not quarantined/pending, and `not_scanned` only when the deployment allows
 *  unscanned files (ADR-0010: default off in production, on in development/demo). */
export function scanUsable(status: string, allowUnscanned: boolean): boolean {
  if (UNUSABLE_SCAN_STATUSES.has(status)) return false;
  if (status === 'not_scanned') return allowUnscanned;
  return true;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);


@Injectable()
export class DocumentsService {
  constructor(
    private readonly db: DbService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(MALWARE_SCANNER) private readonly scanner: MalwareScanner,
  ) {}

  // ---------------------------------------------------------------------------------------------------- helpers
  /** Load a document of the project (404 otherwise) with its room's clean-team flag for ABAC. */
  async loadDoc(projectId: string, documentId: string): Promise<LoadedDoc> {
    const rows = await this.db
      .tx()
      .select({ doc: schema.document, cleanTeam: schema.partnerRoom.isCleanTeam })
      .from(schema.document)
      .leftJoin(schema.partnerRoom, and(eq(schema.partnerRoom.id, schema.document.roomId), eq(schema.partnerRoom.projectId, schema.document.projectId)))
      .where(and(eq(schema.document.id, documentId), eq(schema.document.projectId, projectId)));
    const r = rows[0];
    if (!r) throw notFound();
    return { doc: r.doc, roomIsCleanTeam: r.cleanTeam ?? false };
  }

  attrs(l: LoadedDoc) {
    return { projectId: l.doc.projectId, classification: l.doc.classification as Classification, roomId: l.doc.roomId, roomIsCleanTeam: l.roomIsCleanTeam, ownerUserIds: [l.doc.ownerUserId, l.doc.createdBy] };
  }

  /** Visible = in scope, clearance ≥ classification, room granted — and not disposed. */
  async loadVisibleDoc(ctx: RequestContext, projectId: string, documentId: string, permission = 'documents.document.read'): Promise<LoadedDoc> {
    const l = await this.loadDoc(projectId, documentId);
    this.policy.assert(ctx, permission, this.attrs(l));
    if (l.doc.deletedAt) throw notFound();
    return l;
  }

  /** In-SQL visibility predicate over the `document` table (AT-03): scope, clearance, room grants, not disposed. */
  visibleDocsWhere(ctx: RequestContext, projectId: string): SQL {
    return and(
      eq(schema.document.projectId, projectId),
      isNull(schema.document.deletedAt),
      this.policy.visibilitySql(ctx, projectId, { classification: schema.document.classification, room: schema.document.roomId }),
    )!;
  }

  private async project(projectId: string) {
    const [p] = await this.db.tx().select({ isDemo: schema.project.isDemo, timezone: schema.project.timezone }).from(schema.project).where(eq(schema.project.id, projectId));
    if (!p) throw notFound();
    return p;
  }

  async loadRoom(projectId: string, roomId: string) {
    const r = await loadInProject(this.db, schema.partnerRoom, projectId, roomId);
    return r;
  }

  private versionDto(v: VersionRow) {
    return {
      id: v.id,
      versionNo: v.versionNo,
      filename: v.filename,
      mimeType: v.mimeType,
      detectedType: (v.detectedType as AllowedFileType | null) ?? null,
      sizeBytes: v.sizeBytes,
      sha256: v.sha256,
      scanStatus: v.scanStatus,
      scanDetail: v.scanDetail,
      extractionStatus: v.extractionStatus,
      uploadedBy: v.uploadedBy,
      uploadedAt: v.uploadedAt.toISOString(),
      note: v.note,
      downloadable: scanUsable(v.scanStatus, this.config.storage.allowUnscanned),
    };
  }

  private summaryDto(d: DocRow, v: VersionRow | null) {
    return {
      id: d.id,
      title: d.title,
      kind: d.kind,
      classification: d.classification,
      roomId: d.roomId,
      isDemo: d.isDemo,
      legalHold: d.legalHold,
      retentionUntil: d.retentionUntil,
      currentVersion: v
        ? { id: v.id, versionNo: v.versionNo, filename: v.filename, detectedType: (v.detectedType as AllowedFileType | null) ?? null, sizeBytes: v.sizeBytes, scanStatus: v.scanStatus, extractionStatus: v.extractionStatus, uploadedAt: v.uploadedAt.toISOString() }
        : null,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
      version: d.version,
    };
  }

  /** Invalidate the retrieval index of a document (spec §12.1: changes/revocations invalidate affected indexes). */
  async invalidateChunks(documentId: string): Promise<number> {
    const r = await this.db.tx().delete(schema.documentChunk).where(eq(schema.documentChunk.documentId, documentId)).returning({ id: schema.documentChunk.id });
    return r.length;
  }

  /** Re-assessment trigger for every record that relies on this document as evidence (spec §14). */
  private async emitEvidenceChangedForDocument(projectId: string, documentId: string, change: string) {
    const targets = await this.db
      .tx()
      .selectDistinct({ targetType: schema.evidenceLink.targetType, targetId: schema.evidenceLink.targetId })
      .from(schema.evidenceLink)
      .where(and(eq(schema.evidenceLink.projectId, projectId), eq(schema.evidenceLink.documentId, documentId), inArray(schema.evidenceLink.status, ['active', 'conflicting'])));
    for (const t of targets) {
      await this.outbox.emit({ type: 'evidence.changed', projectId, aggregateType: t.targetType, aggregateId: t.targetId, payload: { targetType: t.targetType, targetId: t.targetId, documentId, change, conflict: false } });
    }
    return targets.length;
  }

  // ---------------------------------------------------------------------------------------------------- reads
  /** Limits and honest scanner/storage status for upload screens (no secrets, no paths). */
  uploadPolicy() {
    return {
      maxUploadBytes: this.config.storage.maxUploadBytes,
      acceptedTypes: ALLOWED_FILE_TYPES.map((type) => ({ type, mime: FILE_TYPE_INFO[type].mime, extensions: [...FILE_TYPE_INFO[type].extensions], textExtractable: TEXT_EXTRACTABLE_TYPES.includes(type) })),
      scanner: { engine: this.scanner.engine, enterprise: this.scanner.enterprise },
      allowUnscanned: this.config.storage.allowUnscanned,
      storageStatus: this.storage.status,
    };
  }

  async list(ctx: RequestContext, projectId: string, q: { page: number; pageSize: number; q?: string; sort?: RouteInput<typeof documentsRoutes.listDocuments>['query']['sort']; kind?: string; classification?: string }) {
    const tx = this.db.tx();
    const d = schema.document;
    const conds: (SQL | undefined)[] = [this.visibleDocsWhere(ctx, projectId)];
    if (q.kind) conds.push(eq(d.kind, q.kind as DocRow['kind']));
    if (q.classification) conds.push(eq(d.classification, q.classification as Classification));
    if (q.q) conds.push(sql`(to_tsvector('simple', ${d.title}) @@ websearch_to_tsquery('simple', ${q.q}) or ${d.title} ilike ${likeContains(q.q)})`);
    const where = and(...conds);
    const [{ total }] = (await tx.select({ total: count() }).from(d).where(where)) as [{ total: number }];
    const order = orderBySort(q.sort, { title: d.title, kind: d.kind, createdAt: d.createdAt, updatedAt: d.updatedAt }, d.id, [desc(d.updatedAt), asc(d.title), asc(d.id)]);
    const rows = await tx
      .select({ d, v: schema.documentVersion })
      .from(d)
      .leftJoin(schema.documentVersion, and(eq(schema.documentVersion.id, d.currentVersionId), eq(schema.documentVersion.projectId, d.projectId)))
      .where(where)
      .orderBy(...order)
      .limit(q.pageSize)
      .offset(offsetOf(q));
    return pageOf(
      rows.map((r) => this.summaryDto(r.d, r.v)),
      Number(total),
      q,
    );
  }

  /**
   * Search titles and indexed content of documents the caller may read. The ACL predicate is applied on the LIVE
   * document row inside the WHERE clause before ranking; only chunks of the current version are searched.
   */
  async search(ctx: RequestContext, projectId: string, q: { q: string; page: number; pageSize: number; kind?: string; classification?: string }) {
    const tx = this.db.tx();
    const d = schema.document;
    const c = schema.documentChunk;
    const vis = and(
      this.visibleDocsWhere(ctx, projectId),
      q.kind ? eq(d.kind, q.kind as DocRow['kind']) : undefined,
      q.classification ? eq(d.classification, q.classification as Classification) : undefined,
    )!;
    const tsq = sql`websearch_to_tsquery('simple', ${q.q})`;
    const hits = sql`
      select ${d.id} as document_id, 'title'::text as matched_in, null::uuid as version_id, null::text as section, null::text as snippet,
             (ts_rank(to_tsvector('simple', ${d.title}), ${tsq}) + case when ${d.title} ilike ${likeContains(q.q)} then 1 else 0 end)::float8 as rank
        from ${d}
       where ${vis} and (to_tsvector('simple', ${d.title}) @@ ${tsq} or ${d.title} ilike ${likeContains(q.q)})
      union all
      select ${c.documentId}, 'content', ${c.documentVersionId}, ${c.section},
             ts_headline('simple', ${c.text}, ${tsq}, 'StartSel=«,StopSel=»,MaxFragments=1,MaxWords=25,MinWords=5'),
             ts_rank(${c.tsv}, ${tsq})::float8
        from ${c} join ${d} on ${d.id} = ${c.documentId} and ${d.projectId} = ${c.projectId} and ${d.currentVersionId} = ${c.documentVersionId}
       where ${vis} and ${c.projectId} = ${projectId} and ${c.tsv} @@ ${tsq}`;
    const best = sql`select distinct on (document_id) * from (${hits}) h order by document_id, rank desc`;
    const totalRes = await tx.execute<{ n: number }>(sql`select count(*)::int as n from (${best}) b`);
    const rows = await tx.execute<{ document_id: string; matched_in: 'title' | 'content'; version_id: string | null; section: string | null; snippet: string | null; rank: number; title: string; kind: string; classification: string }>(sql`
      select b.*, ${d.title} as title, ${d.kind} as kind, ${d.classification} as classification
        from (${best}) b join ${d} on ${d.id} = b.document_id
       order by b.rank desc, ${d.title} asc
       limit ${q.pageSize} offset ${offsetOf(q)}`);
    return pageOf(
      rows.rows.map((r) => ({
        documentId: r.document_id,
        title: r.title,
        kind: r.kind as DocRow['kind'],
        classification: r.classification as Classification,
        matchedIn: r.matched_in,
        versionId: r.version_id,
        section: r.section,
        snippet: r.snippet,
      })),
      Number(totalRes.rows[0]?.n ?? 0),
      q,
    );
  }

  async get(ctx: RequestContext, projectId: string, documentId: string) {
    const l = await this.loadVisibleDoc(ctx, projectId, documentId);
    const tx = this.db.tx();
    const versions = await tx
      .select()
      .from(schema.documentVersion)
      .where(and(eq(schema.documentVersion.documentId, documentId), eq(schema.documentVersion.projectId, projectId)))
      .orderBy(desc(schema.documentVersion.versionNo));
    const current = versions.find((v) => v.id === l.doc.currentVersionId) ?? null;
    // Counted like the evidence lists (SEC-P1R-04/05): only links whose target the caller can read.
    const targets = new RecordVisibility(this.policy, ctx, projectId, { reach: true, readPermission: (t) => (EVIDENCE_TARGET_READ_PERMISSION as Record<string, string>)[t] });
    const ev = await tx.execute<{ active: number; conflicting: number }>(sql`
      select count(*) filter (where e.status = 'active')::int as active, count(*) filter (where e.status = 'conflicting')::int as conflicting
        from evidence_link e left join document d on d.id = e.document_id and d.project_id = e.project_id
       where e.project_id = ${projectId} and e.document_id = ${documentId}
         and ${evidenceLinkVisibleSql(this.policy, ctx, projectId)}
         and ${targets.targetSql(sql.raw('e.target_type'), sql.raw('e.target_id'))}`);
    const [pending] = await tx
      .select()
      .from(schema.approvalRequest)
      .where(
        and(
          eq(schema.approvalRequest.projectId, projectId),
          eq(schema.approvalRequest.subjectType, 'document'),
          eq(schema.approvalRequest.subjectId, documentId),
          eq(schema.approvalRequest.action, 'documents.document.dispose'),
          eq(schema.approvalRequest.status, 'pending'),
        ),
      )
      .limit(1);
    return {
      ...this.summaryDto(l.doc, current),
      legalHoldReason: l.doc.legalHoldReason,
      ownerUserId: l.doc.ownerUserId,
      createdBy: l.doc.createdBy,
      versions: versions.map((v) => this.versionDto(v)),
      evidence: ev.rows[0] ?? { active: 0, conflicting: 0 },
      pendingDisposalRequest: pending ? { id: pending.id, requestedBy: pending.requestedBy, reason: pending.note, createdAt: pending.createdAt.toISOString() } : null,
    };
  }

  // ---------------------------------------------------------------------------------------------------- create / upload
  async create(ctx: RequestContext, projectId: string, body: { title: string; kind: DocRow['kind']; classification: Classification; roomId?: string; retentionUntil?: string }) {
    if (!clearanceAllows(ctx.principal.clearance, body.classification)) {
      throw ruleViolation('documents.classification_above_clearance', "A document's classification cannot exceed the uploader's clearance");
    }
    let roomIsCleanTeam = false;
    if (body.roomId) roomIsCleanTeam = (await this.loadRoom(projectId, body.roomId)).isCleanTeam;
    this.policy.assert(ctx, 'documents.document.upload', { projectId, classification: body.classification, roomId: body.roomId ?? null, roomIsCleanTeam });
    const p = await this.project(projectId);
    const id = newId();
    await this.db
      .tx()
      .insert(schema.document)
      .values({
        id,
        orgId: ctx.principal.orgId,
        projectId,
        title: body.title,
        kind: body.kind,
        classification: body.classification,
        roomId: body.roomId ?? null,
        ownerUserId: ctx.principal.userId,
        retentionUntil: body.retentionUntil ?? null,
        isDemo: p.isDemo,
        createdBy: ctx.principal.userId,
      });
    await this.audit.record({ action: 'documents.document.create', entityType: 'document', entityId: id, projectId, after: { title: body.title, kind: body.kind, classification: body.classification, roomId: body.roomId ?? null, retentionUntil: body.retentionUntil ?? null } });
    return { id, version: 1 };
  }

  /**
   * Upload pipeline (ADR-0010, AT-25): size limit → signature check (quarantine) → magic-byte allowlist →
   * SHA-256 → object storage under a server-generated key → version row. Nothing is fetched from URLs.
   */
  async uploadVersion(ctx: RequestContext, projectId: string, documentId: string, input: { bytes: Buffer; filename: string | undefined; declaredType: string | undefined; note?: string }) {
    const l = await this.loadVisibleDoc(ctx, projectId, documentId, 'documents.document.upload');
    if (l.doc.legalHold) throw ruleViolation('documents.legal_hold_active', 'The document is under legal hold — new versions are refused until the hold is released');
    const bytes = input.bytes;
    if (bytes.length > this.config.storage.maxUploadBytes) {
      throw new HttpException({ message: `File exceeds the ${Math.round(this.config.storage.maxUploadBytes / 1048576)} MB limit`, code: 'documents.upload.too_large' }, 413);
    }
    if (bytes.length === 0) throw ruleViolation('documents.upload.empty', 'The file is empty');
    if (!input.filename || !input.filename.trim()) throw invalid('documents.upload.filename_required', 'The x-filename header is required');
    let rawName = input.filename;
    try {
      rawName = decodeURIComponent(input.filename);
    } catch {
      /* not percent-encoded — use as is */
    }
    const filename = sanitizeFilename(rawName);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const scan = await this.scanner.scan(bytes);
    const zipEntries = bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50 ? listZipEntries(bytes) : null;
    const det = detectFileType(bytes, filename, zipEntries);
    const tx = this.db.tx();
    const [{ next }] = (await tx
      .select({ next: sql<number>`coalesce(max(${schema.documentVersion.versionNo}), 0)::int + 1` })
      .from(schema.documentVersion)
      .where(eq(schema.documentVersion.documentId, documentId))) as [{ next: number }];
    const versionId = newId();
    const declaredType = (input.declaredType ?? '').slice(0, 128) || null;

    if (scan.status === 'quarantined') {
      // Stored in the quarantine area for security review; never current, downloadable or indexed.
      const key = storageKey('quarantine', projectId, versionId);
      await this.storage.put(key, bytes);
      await tx.insert(schema.documentVersion).values({
        id: versionId,
        orgId: ctx.principal.orgId,
        projectId,
        documentId,
        versionNo: next,
        storageKey: key,
        filename,
        mimeType: 'application/octet-stream',
        detectedType: det.ok ? det.type : null,
        sizeBytes: bytes.length,
        sha256,
        scanStatus: 'quarantined',
        scanDetail: `${scan.engine}: ${scan.detail}`,
        extractionStatus: 'not_performed',
        uploadedBy: ctx.principal.userId!,
        note: input.note ?? null,
      });
      await this.audit.record({
        action: 'documents.document.upload',
        entityType: 'document_version',
        entityId: versionId,
        projectId,
        reason: `quarantined: ${scan.detail}`,
        after: { documentId, versionNo: next, filename, sha256, sizeBytes: bytes.length, scanStatus: 'quarantined', declaredType },
      });
      await this.audit.record({ action: 'security.file_quarantined', entityType: 'document_version', entityId: versionId, projectId, reason: scan.detail, after: { documentId, sha256, engine: scan.engine } });
      return { documentId, versionId, versionNo: next, filename, detectedType: det.ok ? det.type : null, mimeType: 'application/octet-stream', sizeBytes: bytes.length, sha256, scanStatus: 'quarantined' as const, scanDetail: scan.detail, extractionStatus: 'not_performed' as const, isCurrent: false };
    }

    if (!det.ok) throw ruleViolation(`documents.upload.${det.code}`, det.reason, { filename });

    const key = storageKey('documents', projectId, versionId);
    await this.storage.put(key, bytes);
    const scanStatus = scan.status; // 'not_scanned' unless an enterprise scanner is configured
    await tx.insert(schema.documentVersion).values({
      id: versionId,
      orgId: ctx.principal.orgId,
      projectId,
      documentId,
      versionNo: next,
      storageKey: key,
      filename,
      mimeType: det.mime,
      detectedType: det.type,
      sizeBytes: bytes.length,
      sha256,
      scanStatus,
      scanDetail: `${scan.engine}: ${scan.detail}`,
      extractionStatus: 'not_performed',
      uploadedBy: ctx.principal.userId!,
      note: input.note ?? null,
    });
    await tx
      .update(schema.document)
      .set({ currentVersionId: versionId, updatedAt: new Date(), version: sql`${schema.document.version} + 1` })
      .where(and(eq(schema.document.id, documentId), eq(schema.document.projectId, projectId)));
    await this.audit.record({
      action: 'documents.document.upload',
      entityType: 'document_version',
      entityId: versionId,
      projectId,
      after: { documentId, versionNo: next, filename, sha256, sizeBytes: bytes.length, detectedType: det.type, scanStatus, declaredType },
    });
    await this.outbox.emit({ type: 'document.changed', projectId, aggregateType: 'document', aggregateId: documentId, payload: { documentId, versionId, reason: 'version_uploaded' } });
    await this.emitEvidenceChangedForDocument(projectId, documentId, 'new_document_version');
    return { documentId, versionId, versionNo: next, filename, detectedType: det.type, mimeType: det.mime, sizeBytes: bytes.length, sha256, scanStatus, scanDetail: scan.detail, extractionStatus: 'not_performed' as const, isCurrent: true };
  }

  // ---------------------------------------------------------------------------------------------------- download
  /** SHA-256 of the stored object (streamed). Null when the object is missing. */
  async storedHash(key: string): Promise<string | null> {
    let s: Readable;
    try {
      s = await this.storage.get(key);
    } catch {
      return null;
    }
    const h = createHash('sha256');
    for await (const chunk of s) h.update(chunk as Buffer);
    return h.digest('hex');
  }

  /** C-40: verify the stored object against the recorded SHA-256; a mismatch blocks the file and is a security event. */
  async assertIntegrity(ctx: RequestContext, v: VersionRow, purpose: string) {
    const actual = await this.storedHash(v.storageKey);
    if (actual !== v.sha256) {
      await this.audit.recordDetached(ctx, {
        action: 'security.integrity_mismatch',
        entityType: 'document_version',
        entityId: v.id,
        projectId: v.projectId,
        outcome: 'error',
        reason: `${purpose}: stored object ${actual ? 'hash differs from' : 'missing for'} the recorded SHA-256`,
      });
      throw conflict('documents.integrity_mismatch', 'The stored file does not match its recorded checksum — access blocked and reported');
    }
  }

  /** Authorised, audited download (C-15). Returns the stream; the controller sets attachment/nosniff headers. */
  async openDownload(ctx: RequestContext, projectId: string, documentId: string, versionId: string) {
    const l = await this.loadVisibleDoc(ctx, projectId, documentId, 'documents.document.download');
    const [v] = await this.db
      .tx()
      .select()
      .from(schema.documentVersion)
      .where(and(eq(schema.documentVersion.id, versionId), eq(schema.documentVersion.documentId, documentId), eq(schema.documentVersion.projectId, projectId)));
    if (!v) throw notFound();
    if (!scanUsable(v.scanStatus, this.config.storage.allowUnscanned)) {
      await this.audit.recordDetached(ctx, { action: 'documents.document.download', entityType: 'document_version', entityId: v.id, projectId, outcome: 'rejected', reason: `version is ${v.scanStatus}` });
      throw ruleViolation('documents.version_not_downloadable', `This version is ${v.scanStatus} and cannot be downloaded`);
    }
    await this.assertIntegrity(ctx, v, 'download');
    await this.audit.record({
      action: 'documents.document.download',
      entityType: 'document_version',
      entityId: v.id,
      projectId,
      after: { documentId, versionNo: v.versionNo, sha256: v.sha256, sizeBytes: v.sizeBytes, classification: l.doc.classification },
    });
    return { stream: await this.storage.get(v.storageKey), filename: v.filename, mime: v.mimeType, size: v.sizeBytes };
  }

  // ---------------------------------------------------------------------------------------------------- ACL changes
  async changeClassification(ctx: RequestContext, projectId: string, documentId: string, body: { expectedVersion: number; classification: Classification; reason: string }, direction: 'raise' | 'lower') {
    const l = await this.loadDoc(projectId, documentId);
    const perm = direction === 'raise' ? 'documents.document.classify' : 'documents.document.declassify';
    if (direction === 'raise') this.policy.assert(ctx, perm, this.attrs(l));
    else {
      // Separation of duties: the document's owner/creator cannot lower its classification; neither known → fail closed (I-R3).
      this.policy.assertGranted(ctx, perm, this.attrs(l));
      const selves = [...new Set([l.doc.createdBy, l.doc.ownerUserId].filter(Boolean) as string[])];
      for (const self of selves.length ? selves : [null]) this.policy.assert(ctx, perm, { ...this.attrs(l), requesterUserId: self });
    }
    if (l.doc.deletedAt) throw notFound();
    const cur = classificationRank(l.doc.classification as Classification);
    const next = classificationRank(body.classification);
    if (direction === 'raise' && next < cur) throw ruleViolation('documents.use_declassify', 'Lowering a classification requires the declassify command');
    if (direction === 'lower' && next >= cur) throw ruleViolation('documents.use_classify', 'Declassify can only lower the classification');
    if (next === cur) throw ruleViolation('documents.classification_unchanged', 'The classification is unchanged');
    if (!clearanceAllows(ctx.principal.clearance, body.classification)) throw ruleViolation('documents.classification_above_clearance', 'You cannot classify above your own clearance');
    assertVersion(l.doc, body.expectedVersion, 'document');
    const row = await updateVersioned(this.db, schema.document, { id: documentId, projectId, expectedVersion: body.expectedVersion }, { classification: body.classification });
    const invalidated = await this.invalidateChunks(documentId);
    await this.audit.record({ action: perm, entityType: 'document', entityId: documentId, projectId, before: { classification: l.doc.classification }, after: { classification: body.classification, chunksInvalidated: invalidated }, reason: body.reason });
    await this.outbox.emit({ type: 'document.changed', projectId, aggregateType: 'document', aggregateId: documentId, payload: { documentId, reason: 'classification_changed' } });
    await this.outbox.emit({ type: 'permission.changed', projectId, aggregateType: 'document', aggregateId: documentId, payload: { documentId, change: 'classification', from: l.doc.classification, to: body.classification } });
    return { id: documentId, version: row['version'] as number };
  }

  async moveRoom(ctx: RequestContext, projectId: string, documentId: string, body: { expectedVersion: number; roomId: string | null; reason: string }) {
    const l = await this.loadVisibleDoc(ctx, projectId, documentId, 'documents.document.classify');
    if ((l.doc.roomId ?? null) === body.roomId) throw ruleViolation('documents.room_unchanged', 'The document is already in that room');
    if (l.roomIsCleanTeam) {
      throw ruleViolation('documents.clean_team_release_required', 'Clean-team material leaves its room only through the clean-team output release process');
    }
    let targetCleanTeam = false;
    if (body.roomId) {
      const room = await this.loadRoom(projectId, body.roomId);
      targetCleanTeam = room.isCleanTeam;
      // The caller must be able to see the destination room (hidden otherwise).
      if (!this.policy.canSee(ctx, { projectId, classification: l.doc.classification as Classification, roomId: body.roomId, roomIsCleanTeam: targetCleanTeam })) throw notFound();
    }
    assertVersion(l.doc, body.expectedVersion, 'document');
    const row = await updateVersioned(this.db, schema.document, { id: documentId, projectId, expectedVersion: body.expectedVersion }, { roomId: body.roomId });
    const invalidated = await this.invalidateChunks(documentId);
    await this.audit.record({ action: 'documents.document.move_room', entityType: 'document', entityId: documentId, projectId, before: { roomId: l.doc.roomId }, after: { roomId: body.roomId, chunksInvalidated: invalidated }, reason: body.reason });
    await this.outbox.emit({ type: 'document.changed', projectId, aggregateType: 'document', aggregateId: documentId, payload: { documentId, reason: 'room_changed' } });
    await this.outbox.emit({ type: 'permission.changed', projectId, aggregateType: 'document', aggregateId: documentId, payload: { documentId, change: 'room', from: l.doc.roomId, to: body.roomId } });
    return { id: documentId, version: row['version'] as number };
  }

  // ---------------------------------------------------------------------------------------------------- hold / retention / disposal
  async setLegalHold(ctx: RequestContext, projectId: string, documentId: string, body: { expectedVersion: number; hold: boolean; reason: string }) {
    const l = await this.loadVisibleDoc(ctx, projectId, documentId, 'documents.legal_hold.manage');
    if (l.doc.legalHold === body.hold) throw ruleViolation('documents.legal_hold_unchanged', body.hold ? 'The document is already under legal hold' : 'The document is not under legal hold');
    const row = await updateVersioned(this.db, schema.document, { id: documentId, projectId, expectedVersion: body.expectedVersion }, { legalHold: body.hold, legalHoldReason: body.hold ? body.reason : null });
    await this.audit.record({
      action: body.hold ? 'documents.legal_hold.place' : 'documents.legal_hold.release',
      entityType: 'document',
      entityId: documentId,
      projectId,
      before: { legalHold: l.doc.legalHold, legalHoldReason: l.doc.legalHoldReason },
      after: { legalHold: body.hold },
      reason: body.reason,
    });
    return { id: documentId, version: row['version'] as number };
  }

  async setRetention(ctx: RequestContext, projectId: string, documentId: string, body: { expectedVersion: number; retentionUntil: string | null; reason: string }) {
    const l = await this.loadVisibleDoc(ctx, projectId, documentId, 'documents.legal_hold.manage');
    const row = await updateVersioned(this.db, schema.document, { id: documentId, projectId, expectedVersion: body.expectedVersion }, { retentionUntil: body.retentionUntil });
    await this.audit.record({ action: 'documents.retention.set', entityType: 'document', entityId: documentId, projectId, before: { retentionUntil: l.doc.retentionUntil }, after: { retentionUntil: body.retentionUntil }, reason: body.reason });
    return { id: documentId, version: row['version'] as number };
  }

  /** Rejected retention/hold checks are audited against the document itself (AT-27), then rethrown. */
  private async assertDisposableAudited(ctx: RequestContext, l: LoadedDoc, action: string, today: string) {
    try {
      assertDisposable(l.doc, today);
    } catch (e) {
      await this.audit.recordDetached(ctx, {
        action,
        entityType: 'document',
        entityId: l.doc.id,
        projectId: l.doc.projectId,
        outcome: 'rejected',
        reason: (e as Error).message,
        before: { legalHold: l.doc.legalHold, retentionUntil: l.doc.retentionUntil },
      });
      throw e;
    }
  }

  async requestDisposal(ctx: RequestContext, projectId: string, documentId: string, body: { expectedVersion: number; reason: string }) {
    const l = await this.loadVisibleDoc(ctx, projectId, documentId, 'documents.document.archive');
    const p = await this.project(projectId);
    assertVersion(l.doc, body.expectedVersion, 'document');
    await this.assertDisposableAudited(ctx, l, 'documents.disposal.request', this.clock.today(p.timezone));
    const tx = this.db.tx();
    const pendingRequests = await tx
      .select()
      .from(schema.approvalRequest)
      .where(and(eq(schema.approvalRequest.projectId, projectId), eq(schema.approvalRequest.subjectType, 'document'), eq(schema.approvalRequest.subjectId, documentId), eq(schema.approvalRequest.action, 'documents.document.dispose'), eq(schema.approvalRequest.status, 'pending')));
    for (const old of pendingRequests) {
      if (old.subjectVersion === l.doc.version) throw conflict('documents.disposal_already_requested', 'A disposal request for this document is already pending');
      // The document changed since that request (e.g. hold placed/released): the old request can no longer be executed.
      await updateVersioned(this.db, schema.approvalRequest, { id: old.id, projectId, expectedVersion: old.version }, { status: 'invalidated' });
      await this.audit.record({ action: 'documents.disposal.invalidate', entityType: 'approval_request', entityId: old.id, projectId, before: { status: 'pending', subjectVersion: old.subjectVersion }, after: { status: 'invalidated', documentVersion: l.doc.version } });
    }
    const payload = { documentId, documentVersion: l.doc.version, reason: body.reason };
    const id = newId();
    await tx.insert(schema.approvalRequest).values({
      id,
      orgId: ctx.principal.orgId,
      projectId,
      subjectType: 'document',
      subjectId: documentId,
      subjectVersion: l.doc.version,
      action: 'documents.document.dispose',
      payload,
      payloadHash: payloadHash(payload),
      requiredPermission: 'documents.document.dispose',
      requestedBy: ctx.principal.userId!,
      note: body.reason,
    });
    await this.audit.record({ action: 'documents.disposal.request', entityType: 'document', entityId: documentId, projectId, after: { approvalRequestId: id }, reason: body.reason });
    await this.outbox.emit({ type: 'approval.pending', projectId, aggregateType: 'approval_request', aggregateId: id, payload: { approvalRequestId: id, subjectType: 'document', subjectId: documentId, requiredPermission: 'documents.document.dispose' } });
    return { requestId: id };
  }

  async dispose(ctx: RequestContext, projectId: string, documentId: string, body: { expectedVersion: number; requestId: string; reason: string }) {
    const l = await this.loadDoc(projectId, documentId);
    // SEC-P2-06: role and visibility first — a document the caller cannot see answers 404 before any request validation.
    this.policy.assertGranted(ctx, 'documents.document.dispose', this.attrs(l));
    const p = await this.project(projectId);
    const today = this.clock.today(p.timezone);
    const req = await loadInProject(this.db, schema.approvalRequest, projectId, body.requestId);
    if (req.subjectType !== 'document' || req.subjectId !== documentId || req.action !== 'documents.document.dispose' || req.status !== 'pending') {
      throw ruleViolation('documents.disposal_request_invalid', 'The disposal request does not match this document or is no longer pending');
    }
    const [matrix] = await this.db
      .tx()
      .select({ status: schema.authorityMatrixVersion.status, isDemoPolicy: schema.authorityMatrixVersion.isDemoPolicy, effectiveFrom: schema.authorityMatrixVersion.effectiveFrom, effectiveTo: schema.authorityMatrixVersion.effectiveTo })
      .from(schema.authorityMatrixVersion)
      .where(and(eq(schema.authorityMatrixVersion.projectId, projectId), eq(schema.authorityMatrixVersion.status, 'approved')))
      .orderBy(desc(schema.authorityMatrixVersion.versionNo))
      .limit(1);
    const authority = disposalAuthority({ matrix: matrix ?? null, today, projectIsDemo: p.isDemo, demoMode: this.config.demoMode });
    // not_self against the requester AND the document owner/creator; authority from the matrix (or demo policy).
    const selves = [...new Set([req.requestedBy, l.doc.createdBy, l.doc.ownerUserId].filter(Boolean) as string[])];
    for (const self of selves.length ? selves : [null]) {
      this.policy.assert(ctx, 'documents.document.dispose', { ...this.attrs(l), requesterUserId: self, withinAuthority: authority.within });
    }
    // Retention / legal hold first: the refusal reason that matters is audited against the document (AT-27).
    await this.assertDisposableAudited(ctx, l, 'documents.document.dispose', today);
    assertVersion(l.doc, body.expectedVersion, 'document');
    if (req.subjectVersion !== l.doc.version) throw conflict('documents.disposal_request_stale', 'The document changed after the disposal request — a new request is required');
    const now = new Date();
    const row = await updateVersioned(this.db, schema.document, { id: documentId, projectId, expectedVersion: body.expectedVersion }, { deletedAt: now, deletedBy: ctx.principal.userId, deletionReason: body.reason });
    const tx = this.db.tx();
    await updateVersioned(this.db, schema.approvalRequest, { id: req.id, projectId, expectedVersion: req.version }, { status: 'approved' });
    await tx.insert(schema.approvalRecord).values({
      id: newId(),
      orgId: ctx.principal.orgId,
      projectId,
      approvalRequestId: req.id,
      approverUserId: ctx.principal.userId!,
      decision: 'approve',
      comment: body.reason,
      authorityBasis: authority.basis,
      payloadHash: req.payloadHash,
    });
    const invalidated = await this.invalidateChunks(documentId);
    // Evidence relying on a disposed document is no longer active: links are kept (history) but superseded.
    const superseded = await tx
      .update(schema.evidenceLink)
      .set({ status: 'superseded', conflictNote: sql`coalesce(${schema.evidenceLink.conflictNote}, ${'Document disposed: ' + body.reason})`, version: sql`${schema.evidenceLink.version} + 1` })
      .where(and(eq(schema.evidenceLink.projectId, projectId), eq(schema.evidenceLink.documentId, documentId), inArray(schema.evidenceLink.status, ['active', 'conflicting'])))
      .returning({ targetType: schema.evidenceLink.targetType, targetId: schema.evidenceLink.targetId });
    for (const t of new Map(superseded.map((s) => [`${s.targetType}:${s.targetId}`, s])).values()) {
      await this.outbox.emit({ type: 'evidence.changed', projectId, aggregateType: t.targetType, aggregateId: t.targetId, payload: { targetType: t.targetType, targetId: t.targetId, documentId, change: 'document_disposed', conflict: false } });
    }
    await this.audit.record({
      action: 'documents.document.dispose',
      entityType: 'document',
      entityId: documentId,
      projectId,
      before: { deletedAt: null, legalHold: l.doc.legalHold, retentionUntil: l.doc.retentionUntil },
      after: { deletedAt: now.toISOString(), approvalRequestId: req.id, authorityBasis: authority.basis, chunksInvalidated: invalidated, evidenceLinksSuperseded: superseded.length },
      reason: body.reason,
    });
    await this.outbox.emit({ type: 'document.changed', projectId, aggregateType: 'document', aggregateId: documentId, payload: { documentId, reason: 'disposed' } });
    return { id: documentId, version: row['version'] as number };
  }

  /** Allowed classifications for a clearance (used by other services' SQL filters). */
  static allowedClassifications(clearance: Classification): Classification[] {
    return CLASSIFICATIONS.filter((c) => clearanceAllows(clearance, c));
  }
}

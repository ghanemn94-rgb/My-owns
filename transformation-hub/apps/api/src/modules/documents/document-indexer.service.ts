import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { schema } from '@hub/db';
import { AllowedFileType, chunkText, detectInstructionLikeContent } from '@hub/domain';
import { DbService } from '../../platform/db.service';
import { PolicyService } from '../../platform/policy.service';
import { AuditService } from '../../platform/audit.service';
import type { RequestContext } from '../../platform/context';
import { newId } from '../../platform/ids';
import { OBJECT_STORAGE, ObjectStorage } from './storage/object-storage';
import { DocumentsService, scanUsable } from './documents.service';
import { APP_CONFIG, AppConfig } from '../../platform/config';
import { extractText } from './files/text-extract';

export interface IndexResult {
  documentId: string;
  outcome: 'indexed' | 'cleared' | 'skipped';
  chunks: number;
  reason: string;
}

/**
 * Builds the retrieval index (`document_chunk`) the AI runtime reads (spec §12.1). Runs in the worker under a
 * service principal with an explicit permission allowlist. Idempotent: every run deletes the document's chunks and
 * rebuilds them from the CURRENT, usable version only. ACL attributes (room, classification) are derived from the
 * document by a DB trigger; retrieval must still join the live document ACL.
 */
@Injectable()
export class DocumentIndexer {
  constructor(
    private readonly db: DbService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly docs: DocumentsService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async reindex(ctx: RequestContext, projectId: string, documentId: string): Promise<IndexResult> {
    const tx = this.db.tx();
    let loaded;
    try {
      loaded = await this.docs.loadDoc(projectId, documentId);
    } catch {
      return { documentId, outcome: 'skipped', chunks: 0, reason: 'document not found' };
    }
    this.policy.assert(ctx, 'documents.document.read', this.docs.attrs(loaded));
    const { doc } = loaded;
    const clear = async (reason: string): Promise<IndexResult> => {
      const n = await this.docs.invalidateChunks(documentId);
      return { documentId, outcome: 'cleared', chunks: n, reason };
    };
    if (doc.deletedAt) return clear('document disposed');
    if (loaded.roomIsCleanTeam) return clear('clean-team room material is not indexed (D-09)');
    if (!doc.currentVersionId) return clear('no current version');
    const [v] = await tx.select().from(schema.documentVersion).where(and(eq(schema.documentVersion.id, doc.currentVersionId), eq(schema.documentVersion.projectId, projectId)));
    if (!v) return clear('current version missing');
    if (!scanUsable(v.scanStatus, this.config.storage.allowUnscanned)) return clear(`version is ${v.scanStatus}`);

    let bytes: Buffer;
    try {
      const chunks: Buffer[] = [];
      for await (const c of await this.storage.get(v.storageKey)) chunks.push(c as Buffer);
      bytes = Buffer.concat(chunks);
    } catch {
      await this.markExtraction(v.id, 'failed');
      return clear('stored object unavailable');
    }
    if (createHash('sha256').update(bytes).digest('hex') !== v.sha256) {
      await this.markExtraction(v.id, 'failed');
      await this.audit.record({ action: 'security.integrity_mismatch', entityType: 'document_version', entityId: v.id, projectId, outcome: 'error', reason: 'indexing: stored object hash differs from the recorded SHA-256' });
      return clear('integrity mismatch — not indexed');
    }

    const ex = extractText((v.detectedType as AllowedFileType | null) ?? null, bytes);
    if (ex.status !== 'performed') {
      await this.markExtraction(v.id, ex.status);
      return clear(ex.note);
    }
    const chunks = chunkText(ex.text, ex.chunkKind);
    await this.docs.invalidateChunks(documentId);
    let suspicious = 0;
    for (const c of chunks) {
      const flag = detectInstructionLikeContent(`${c.section ?? ''}\n${c.text}`).suspicious;
      if (flag) suspicious++;
      await tx.insert(schema.documentChunk).values({
        id: newId(),
        orgId: doc.orgId,
        projectId,
        documentId,
        documentVersionId: v.id,
        // Overwritten from the parent document by the hub_chunk_acl_sync trigger (single source of truth).
        roomId: doc.roomId,
        classification: doc.classification,
        ordinal: c.ordinal,
        page: c.page,
        section: c.section,
        text: c.text,
        suspiciousInstructions: flag,
      });
    }
    await this.markExtraction(v.id, 'performed');
    await this.audit.record({ action: 'documents.index', entityType: 'document_version', entityId: v.id, projectId, after: { documentId, chunks: chunks.length, suspiciousChunks: suspicious } });
    return { documentId, outcome: 'indexed', chunks: chunks.length, reason: ex.note };
  }

  private async markExtraction(versionId: string, status: 'performed' | 'not_performed' | 'failed') {
    await this.db.tx().update(schema.documentVersion).set({ extractionStatus: status }).where(eq(schema.documentVersion.id, versionId));
  }
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { schema } from '@hub/db';
import { conflict, notFound, ruleViolation } from '@hub/domain';
import type { ReportExport, ReportExportFormat, RouteInput, reportingRoutes } from '@hub/contracts';
import { DbService } from '../../platform/db.service';
import { AuditService } from '../../platform/audit.service';
import { JobQueue, type ClaimedJob } from '../../platform/jobs/job-queue.service';
import { JobContextFactory } from '../../platform/jobs/job-context';
import { loadInProject, pageOf } from '../../platform/helpers';
import { newId, sha256Hex } from '../../platform/ids';
import type { RequestContext } from '../../platform/context';
import { OBJECT_STORAGE, storageKey, type ObjectStorage } from '../documents/storage/object-storage';
import { ReportAccess } from './report-access';
import { SnapshotsService } from './snapshots.service';
import { buildView } from './report-view';
import { buildRenderDoc, type RenderDoc } from './render/document';
import { ReportRenderers } from './render/renderers';
import type { ReportLocale } from './render/labels';

type R = typeof reportingRoutes;
type ExportRow = typeof schema.reportExport.$inferSelect;

/** Job kind of the export renderer (worker). Payload: the export id only — never content (TB-14). */
export const RENDER_EXPORT_JOB = 'reporting.render_export';
/** The renderer's service identity holds no permission: it only closes an export whose requester lost access. */
export const REPORTING_SERVICE_PERMISSIONS: string[] = [];

/**
 * Snapshot exports (REQ-RPT-007..010, REQ-INT-011, AT-19, AT-24). Requesting an export records it and enqueues a job;
 * the WORKER renders the file from the snapshot as the requester (re-resolved at execution: a requester who lost access
 * gets nothing — the export is cancelled), stores it through the object-storage adapter and marks it ready. The file is
 * downloadable only by its requester, after the same per-section re-check, with its checksum verified. Nothing is sent
 * anywhere: there is no recipient, channel or URL in an export.
 */
@Injectable()
export class ExportsService {
  private readonly log = new Logger('reporting.exports');
  constructor(
    private readonly db: DbService,
    private readonly access: ReportAccess,
    private readonly audit: AuditService,
    private readonly snapshots: SnapshotsService,
    private readonly queue: JobQueue,
    private readonly contexts: JobContextFactory,
    private readonly renderers: ReportRenderers,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  dto(r: ExportRow): ReportExport {
    return {
      id: r.id,
      snapshotId: r.snapshotId,
      format: r.format as ReportExportFormat,
      locale: r.locale as ReportLocale,
      status: r.status as ReportExport['status'],
      filename: r.filename,
      mimeType: r.mimeType,
      sizeBytes: r.sizeBytes,
      sha256: r.sha256,
      contentClassification: r.contentClassification,
      includedSections: r.includedSections,
      errorCode: r.errorCode,
      createdAt: r.createdAt.toISOString(),
      completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    };
  }

  async request(ctx: RequestContext, projectId: string, snapshotId: string, body: RouteInput<R['requestReportExport']>['body']) {
    const v = await this.snapshots.view(ctx, projectId, snapshotId, 'reports.snapshot.export');
    const unavailable = await this.renderers.unavailable(body.format);
    if (unavailable) throw ruleViolation('report.export_format_unavailable', `The ${body.format.toUpperCase()} renderer is not available in this deployment (${unavailable})`, { format: body.format });
    const id = newId();
    await this.db
      .tx()
      .insert(schema.reportExport)
      .values({ id, orgId: v.row.orgId, projectId, snapshotId, format: body.format, locale: body.locale, status: 'queued', createdBy: ctx.principal.userId!, includedSections: v.included.map((s) => s.key) });
    await this.queue.enqueue({ kind: RENDER_EXPORT_JOB, orgId: v.row.orgId, projectId, payload: { exportId: id }, idempotencyKey: `report-export:${id}`, requestedBy: ctx.principal.userId, maxAttempts: 3 });
    await this.audit.record({ action: 'reports.snapshot.export', entityType: 'report_export', entityId: id, projectId, after: { snapshotId, format: body.format, locale: body.locale, step: 'requested', sections: v.included.map((s) => s.key) } });
    return this.dto(await this.ownExport(ctx, projectId, id));
  }

  /** The caller's own export (exports are bound to their requester; anybody else gets 404). */
  private async ownExport(ctx: RequestContext, projectId: string, exportId: string): Promise<ExportRow> {
    this.access.assertProjectReader(ctx, projectId, 'reports.snapshot.export');
    const r = await loadInProject(this.db, schema.reportExport, projectId, exportId);
    if (!ctx.principal.userId || r.createdBy !== ctx.principal.userId) throw notFound();
    return r;
  }

  async list(ctx: RequestContext, projectId: string, snapshotId: string, q: RouteInput<R['listReportExports']>['query']) {
    await this.snapshots.view(ctx, projectId, snapshotId, 'reports.snapshot.export');
    const E = schema.reportExport;
    const where = and(eq(E.projectId, projectId), eq(E.snapshotId, snapshotId), eq(E.createdBy, ctx.principal.userId!));
    const [{ n }] = (await this.db.tx().select({ n: sql<number>`count(*)::int` }).from(E).where(where)) as [{ n: number }];
    const rows = await this.db.tx().select().from(E).where(where).orderBy(desc(E.createdAt), desc(E.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize);
    return pageOf(rows.map((r) => this.dto(r)), Number(n), q);
  }

  async get(ctx: RequestContext, projectId: string, exportId: string) {
    const r = await this.ownExport(ctx, projectId, exportId);
    await this.snapshots.view(ctx, projectId, r.snapshotId, 'reports.snapshot.export');
    return this.dto(r);
  }

  /** Audited download by the requester after re-checking every section the file contains and its checksum. */
  async download(ctx: RequestContext, projectId: string, exportId: string) {
    const r = await this.ownExport(ctx, projectId, exportId);
    const v = await this.snapshots.view(ctx, projectId, r.snapshotId, 'reports.snapshot.export');
    if (r.status !== 'ready' || !r.storageKey || !r.sha256 || !r.filename) throw conflict('report.export_not_ready', `The export is ${r.status}`);
    const now = new Set(v.included.map((s) => s.key));
    if (!r.includedSections.every((k) => now.has(k))) {
      // The file contains a section the requester can no longer read: it is never handed out again.
      await this.audit.recordDetached(ctx, { action: 'reports.snapshot.export', entityType: 'report_export', entityId: r.id, projectId, outcome: 'denied', reason: 'a section of the file is outside the requester’s current access' });
      throw notFound();
    }
    const chunks: Buffer[] = [];
    for await (const c of await this.storage.get(r.storageKey)) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c as Uint8Array));
    const bytes = Buffer.concat(chunks);
    if (sha256Hex(bytes) !== r.sha256) {
      await this.audit.recordDetached(ctx, { action: 'reports.snapshot.export', entityType: 'report_export', entityId: r.id, projectId, outcome: 'error', reason: 'stored file checksum mismatch' });
      throw conflict('report.export_integrity', 'The stored file does not match its recorded checksum');
    }
    await this.audit.record({ action: 'reports.snapshot.export', entityType: 'report_export', entityId: r.id, projectId, after: { step: 'downloaded', snapshotId: r.snapshotId, format: r.format, sha256: r.sha256, sizeBytes: r.sizeBytes, sections: r.includedSections } });
    return { bytes, filename: r.filename, mime: r.mimeType ?? 'application/octet-stream' };
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Worker

  private async close(job: ClaimedJob, exportId: string, status: 'failed' | 'cancelled', errorCode: string) {
    const ctx = this.contexts.forService(job, 'svc-reporting', REPORTING_SERVICE_PERMISSIONS);
    await this.db.run(ctx, async () => {
      const E = schema.reportExport;
      const [r] = await this.db.tx().select().from(E).where(and(eq(E.id, exportId), eq(E.projectId, job.project_id!)));
      if (!r || !['queued', 'rendering'].includes(r.status)) return;
      await this.db.tx().update(E).set({ status, errorCode, completedAt: new Date(), updatedAt: new Date(), version: sql`${E.version} + 1` }).where(eq(E.id, exportId));
      await this.audit.record({ action: 'reports.snapshot.export', entityType: 'report_export', entityId: exportId, projectId: job.project_id, outcome: status === 'cancelled' ? 'denied' : 'error', reason: errorCode, after: { step: status } });
    });
  }

  /**
   * Render job (AT-19): the requester is re-resolved from the database at execution; without current access the export is
   * cancelled and nothing is rendered. After rendering, access is re-checked once more before the file is published.
   */
  async render(job: ClaimedJob): Promise<Record<string, unknown>> {
    const exportId = String((job.payload as { exportId?: string }).exportId ?? '');
    const projectId = job.project_id;
    if (!projectId || !exportId) return { skipped: 'no export' };
    const user = job.requested_by ? await this.contexts.forUser(job.requested_by, projectId, `job-${job.id}`) : null;
    if (!user) {
      await this.close(job, exportId, 'cancelled', 'requester_access_revoked');
      return { cancelled: 'requester_access_revoked' };
    }
    const prepared = await this.db.run(user, async () => {
      const E = schema.reportExport;
      const [r] = await this.db.tx().select().from(E).where(and(eq(E.id, exportId), eq(E.projectId, projectId)));
      if (!r || !['queued', 'rendering'].includes(r.status) || r.createdBy !== user.principal.userId) return { state: 'done' as const };
      const snap = await this.db.tx().select().from(schema.reportSnapshot).where(and(eq(schema.reportSnapshot.id, r.snapshotId), eq(schema.reportSnapshot.projectId, projectId)));
      const v = snap[0] ? buildView(this.access, user, snap[0]) : null;
      if (!v || !this.access.policy.can(user, 'reports.snapshot.export', { projectId, classification: 'internal' })) return { state: 'revoked' as const };
      if (r.status === 'queued') await this.db.tx().update(E).set({ status: 'rendering', updatedAt: new Date(), version: sql`${E.version} + 1` }).where(eq(E.id, exportId));
      const doc = buildRenderDoc({
        payload: v.payload,
        contentHash: v.row.contentHash,
        classification: v.classification,
        sections: v.sections.map((s) => ({ key: s.key, section: s.section })),
        locale: r.locale as ReportLocale,
      });
      return { state: 'render' as const, row: r, doc, included: v.included.map((s) => s.key), classification: v.classification };
    });
    if (prepared.state === 'done') return { skipped: 'export already finished' };
    if (prepared.state === 'revoked') {
      await this.close(job, exportId, 'cancelled', 'requester_access_revoked');
      return { cancelled: 'requester_access_revoked' };
    }
    let file: { bytes: Buffer; mime: string; ext: string };
    try {
      file = await this.renderers.render(prepared.row.format as ReportExportFormat, prepared.doc as RenderDoc);
    } catch (e) {
      this.log.error(`render ${exportId} failed: ${(e as Error).message}`);
      if (job.attempts >= job.max_attempts) {
        await this.close(job, exportId, 'failed', (e as { code?: string }).code === 'report.renderer_unavailable' ? 'renderer_unavailable' : 'render_failed');
        return { failed: true };
      }
      throw e;
    }
    const key = storageKey('reports', projectId, exportId);
    await this.storage.put(key, file.bytes);
    const sha256 = sha256Hex(file.bytes);
    const again = await this.contexts.forUser(job.requested_by!, projectId, `job-${job.id}`);
    const published = again
      ? await this.db.run(again, async () => {
          const E = schema.reportExport;
          const snap = await loadInProject(this.db, schema.reportSnapshot, projectId, prepared.row.snapshotId);
          const v = buildView(this.access, again, snap);
          const now = new Set(v?.included.map((s) => s.key) ?? []);
          if (!v || !prepared.included.every((k) => now.has(k)) || !this.access.policy.can(again, 'reports.snapshot.export', { projectId, classification: 'internal' })) return false;
          await this.db
            .tx()
            .update(E)
            .set({
              status: 'ready',
              storageKey: key,
              filename: `${(prepared.doc as RenderDoc).filenameBase}.${file.ext}`,
              mimeType: file.mime,
              sizeBytes: file.bytes.length,
              sha256,
              includedSections: prepared.included,
              contentClassification: prepared.classification,
              completedAt: new Date(),
              updatedAt: new Date(),
              version: sql`${E.version} + 1`,
            })
            .where(and(eq(E.id, exportId), sql`${E.status} in ('queued', 'rendering')`));
          await this.audit.record({ action: 'reports.snapshot.export', entityType: 'report_export', entityId: exportId, projectId, after: { step: 'rendered', format: prepared.row.format, locale: prepared.row.locale, sha256, sizeBytes: file.bytes.length, sections: prepared.included } });
          return true;
        })
      : false;
    if (!published) {
      await this.storage.delete(key);
      await this.close(job, exportId, 'cancelled', 'requester_access_revoked');
      return { cancelled: 'requester_access_revoked_during_render' };
    }
    return { exportId, sha256, sizeBytes: file.bytes.length };
  }
}

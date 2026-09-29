import type { INestApplicationContext } from '@nestjs/common';
import { JobRegistry } from '../../platform/jobs/job-registry';
import { JobContextFactory } from '../../platform/jobs/job-context';
import { DbService } from '../../platform/db.service';
import type { ClaimedJob } from '../../platform/jobs/job-queue.service';
import { DocumentIndexer } from './document-indexer.service';

export const INDEX_JOB = 'documents.index_version';
/** Maintenance identity: reads documents to (re)build the index; holds no other permission (ARCH-09). */
const SERVICE_PERMISSIONS = ['documents.document.read'];

/** Register this module's job handlers and outbox subscriptions (called by src/jobs.ts in the worker). */
export function registerDocumentsJobs(app: INestApplicationContext): void {
  const registry = app.get(JobRegistry);
  if (registry.handler(INDEX_JOB)) return; // idempotent (tests may register twice)
  const contexts = app.get(JobContextFactory);
  const db = app.get(DbService);
  const indexer = app.get(DocumentIndexer);
  registry.register(INDEX_JOB, async (job: ClaimedJob) => {
    const documentId = typeof job.payload['documentId'] === 'string' ? job.payload['documentId'] : null;
    if (!job.project_id || !documentId) return { skipped: 'no document reference' };
    const ctx = contexts.forService(job, 'svc-documents', SERVICE_PERMISSIONS);
    const r = await db.run(ctx, () => indexer.reindex(ctx, job.project_id!, documentId));
    return { ...r };
  });
  // Uploads, classification/room changes and disposal all emit document.changed → rebuild or clear the index.
  registry.subscribe('document.changed', INDEX_JOB);
}

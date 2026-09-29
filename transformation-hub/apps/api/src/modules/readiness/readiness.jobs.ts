import type { INestApplicationContext } from '@nestjs/common';
import { JobRegistry } from '../../platform/jobs/job-registry';
import { JobContextFactory } from '../../platform/jobs/job-context';
import { DbService } from '../../platform/db.service';
import type { ClaimedJob } from '../../platform/jobs/job-queue.service';
import { TsaService, TSA_EXPIRY_JOB } from './tsa.service';

/**
 * Explicit permission allowlist of the readiness service identity (deny by default — ARCH-09). The expiry scan reads the
 * TSA register and records the expired-unresolved state + escalation; it never exits, extends or notifies externally.
 */
export const READINESS_SERVICE_PERMISSIONS = ['readiness.register.read', 'readiness.tsa.manage'];

/** Register this module's job handlers (called by src/jobs.ts in the worker). */
export function registerReadinessJobs(app: INestApplicationContext): void {
  const registry = app.get(JobRegistry);
  const contexts = app.get(JobContextFactory);
  const db = app.get(DbService);
  const tsa = app.get(TsaService);

  // AT-10 / REQ-TSA-003: daily per-project schedule (created with the project's first TSA). Idempotent: outbox events are
  // deduplicated per TSA / end date / kind and the expired-unresolved transition happens once.
  registry.register(TSA_EXPIRY_JOB, async (job: ClaimedJob) => {
    if (!job.project_id) return { skipped: 'schedule without project' };
    const projectId = job.project_id;
    const ctx = contexts.forService(job, 'svc-readiness', READINESS_SERVICE_PERMISSIONS);
    return db.run(ctx, () => tsa.scanExpiry(ctx, projectId));
  });
}

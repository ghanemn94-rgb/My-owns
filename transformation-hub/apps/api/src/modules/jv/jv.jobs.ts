import type { INestApplicationContext } from '@nestjs/common';
import { JobRegistry } from '../../platform/jobs/job-registry';
import { JobContextFactory } from '../../platform/jobs/job-context';
import { DbService } from '../../platform/db.service';
import type { ClaimedJob } from '../../platform/jobs/job-queue.service';
import { OBLIGATION_OVERDUE_JOB, PostCloseService } from './postclose.service';

/**
 * Explicit permission allowlist of the JV service identity (deny by default — ARCH-09). The overdue scan reads the
 * post-close register and records the overdue state + escalation; it never verifies, waives, confirms or notifies
 * externally (those are human-only commands).
 */
export const JV_SERVICE_PERMISSIONS = ['jv.deal.read', 'jv.closing_checklist.manage'];

/** Register this module's job handlers (called by src/jobs.ts in the worker). */
export function registerJvJobs(app: INestApplicationContext): void {
  const registry = app.get(JobRegistry);
  const contexts = app.get(JobContextFactory);
  const db = app.get(DbService);
  const post = app.get(PostCloseService);

  // REQ-JV-016: daily per-project schedule (created with the project's first obligation), project timezone. Idempotent.
  registry.register(OBLIGATION_OVERDUE_JOB, async (job: ClaimedJob) => {
    if (!job.project_id) return { skipped: 'schedule without project' };
    const projectId = job.project_id;
    const ctx = contexts.forService(job, 'svc-jv', JV_SERVICE_PERMISSIONS);
    return db.run(ctx, () => post.scanOverdue(ctx, projectId));
  });
}

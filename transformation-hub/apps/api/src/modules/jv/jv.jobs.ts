import type { INestApplicationContext } from '@nestjs/common';
import { JobRegistry } from '../../platform/jobs/job-registry';
import { JobContextFactory } from '../../platform/jobs/job-context';
import { DbService } from '../../platform/db.service';
import type { ClaimedJob } from '../../platform/jobs/job-queue.service';
import { OBLIGATION_OVERDUE_JOB, PostCloseService } from './postclose.service';
import { CP_LONG_STOP_JOB, TransactionsService } from './transactions.service';

/**
 * Explicit permission allowlists of the JV service identity, ONE PER JOB (deny by default — ARCH-09; SEC-P34-17: each job
 * holds only what it uses). The overdue scan reads the post-close register and records the overdue state + escalation
 * (`jv.closing_checklist.manage`, asserted by `PostCloseService.scanOverdue`); the CP long-stop scan (DOM-P4-04) records the
 * lapsed state + escalation (`jv.cp.manage`, asserted by `TransactionsService.scanLongStops`). Neither job reads the deal
 * register through the API (`jv.deal.read` is not needed), and neither ever verifies, waives, extends, confirms or notifies
 * externally (human-only commands).
 */
export const JV_OBLIGATION_SCAN_PERMISSIONS: readonly string[] = ['jv.closing_checklist.manage'];
export const JV_LONG_STOP_SCAN_PERMISSIONS: readonly string[] = ['jv.cp.manage'];

/** Register this module's job handlers (called by src/jobs.ts in the worker). */
export function registerJvJobs(app: INestApplicationContext): void {
  const registry = app.get(JobRegistry);
  const contexts = app.get(JobContextFactory);
  const db = app.get(DbService);
  const post = app.get(PostCloseService);
  const tx = app.get(TransactionsService);

  // REQ-JV-016: daily per-project schedule (created with the project's first obligation), project timezone. Idempotent.
  registry.register(OBLIGATION_OVERDUE_JOB, async (job: ClaimedJob) => {
    if (!job.project_id) return { skipped: 'schedule without project' };
    const projectId = job.project_id;
    const ctx = contexts.forService(job, 'svc-jv', [...JV_OBLIGATION_SCAN_PERMISSIONS]);
    return db.run(ctx, () => post.scanOverdue(ctx, projectId));
  });

  // DOM-P4-04 / REQ-JV-013: daily per-project schedule (created with the project's first CP long-stop date), project
  // timezone. Idempotent: a lapse happens once, at most one escalation per CP and long-stop date.
  registry.register(CP_LONG_STOP_JOB, async (job: ClaimedJob) => {
    if (!job.project_id) return { skipped: 'schedule without project' };
    const projectId = job.project_id;
    const ctx = contexts.forService(job, 'svc-jv', [...JV_LONG_STOP_SCAN_PERMISSIONS]);
    return db.run(ctx, () => tx.scanLongStops(ctx, projectId));
  });
}

import type { INestApplicationContext } from '@nestjs/common';
import { JobRegistry } from '../../platform/jobs/job-registry';
import type { ClaimedJob } from '../../platform/jobs/job-queue.service';
import { ExportsService, RENDER_EXPORT_JOB } from './exports.service';

/**
 * Register this module's job handlers (called by src/jobs.ts in the worker). The export renderer re-resolves the
 * requester at execution (AT-19) and produces a file in internal storage only — it has no outbound channel (REQ-INT-011).
 */
export function registerReportingJobs(app: INestApplicationContext): void {
  const registry = app.get(JobRegistry);
  const exports = app.get(ExportsService);
  registry.register(RENDER_EXPORT_JOB, (job: ClaimedJob) => exports.render(job));
}

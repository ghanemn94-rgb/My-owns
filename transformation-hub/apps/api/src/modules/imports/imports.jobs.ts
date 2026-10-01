import type { INestApplicationContext } from '@nestjs/common';
import { JobRegistry } from '../../platform/jobs/job-registry';
import type { ClaimedJob } from '../../platform/jobs/job-queue.service';
import { ImportsService, PARSE_IMPORT_JOB } from './imports.service';

/** Register this module's job handlers (called by src/jobs.ts in the worker): the sandboxed parser of uploaded files. */
export function registerImportsJobs(app: INestApplicationContext): void {
  const registry = app.get(JobRegistry);
  const imports = app.get(ImportsService);
  registry.register(PARSE_IMPORT_JOB, (job: ClaimedJob) => imports.parseJob(job));
}

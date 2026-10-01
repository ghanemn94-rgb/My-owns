import type { INestApplicationContext } from '@nestjs/common';
import { JobRegistry } from '../../platform/jobs/job-registry';
import type { ClaimedJob } from '../../platform/jobs/job-queue.service';
import { IntegrationsService, PROCESS_WEBHOOK_JOB, RECONCILE_WEBHOOKS_JOB } from './integrations.service';

/**
 * Register this module's job handlers (called by src/jobs.ts in the worker): inbound webhook processing (exactly once per
 * delivery id, retries with back-off by the job queue) and the scheduled reconciliation / failure monitoring.
 */
export function registerIntegrationsJobs(app: INestApplicationContext): void {
  const registry = app.get(JobRegistry);
  const integrations = app.get(IntegrationsService);
  registry.register(PROCESS_WEBHOOK_JOB, (job: ClaimedJob) => integrations.processJob(job));
  registry.register(RECONCILE_WEBHOOKS_JOB, (job: ClaimedJob) => integrations.reconcileJob(job));
}

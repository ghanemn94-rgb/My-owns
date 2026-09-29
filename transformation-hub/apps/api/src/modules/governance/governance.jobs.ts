import type { INestApplicationContext } from '@nestjs/common';

/** Register this module's job handlers and outbox subscriptions (called by src/jobs.ts in the worker). */
export function registerGovernanceJobs(_app: INestApplicationContext): void {
  // e.g. app.get(JobRegistry).register('governance.something', handler); registry.subscribe('evidence.changed', 'governance.something');
}

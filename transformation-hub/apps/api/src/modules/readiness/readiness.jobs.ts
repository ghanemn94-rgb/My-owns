import type { INestApplicationContext } from '@nestjs/common';

/** Register this module's job handlers and outbox subscriptions (called by src/jobs.ts in the worker). */
export function registerReadinessJobs(_app: INestApplicationContext): void {
  // e.g. app.get(JobRegistry).register('readiness.something', handler); registry.subscribe('evidence.changed', 'readiness.something');
}

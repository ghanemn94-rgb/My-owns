import type { INestApplicationContext } from '@nestjs/common';

/** Register this module's job handlers and outbox subscriptions (called by src/jobs.ts in the worker). */
export function registerFinanceJobs(_app: INestApplicationContext): void {
  // e.g. app.get(JobRegistry).register('finance.something', handler); registry.subscribe('evidence.changed', 'finance.something');
}

import type { INestApplicationContext } from '@nestjs/common';

/** Register this module's job handlers and outbox subscriptions (called by src/jobs.ts in the worker). */
export function registerAiJobs(_app: INestApplicationContext): void {
  // e.g. app.get(JobRegistry).register('ai.something', handler); registry.subscribe('evidence.changed', 'ai.something');
}

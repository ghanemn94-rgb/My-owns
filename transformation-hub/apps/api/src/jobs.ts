import type { INestApplicationContext } from '@nestjs/common';
import { JobRegistry } from './platform/jobs/job-registry';

/**
 * Central registration of job handlers and outbox subscriptions (each module adds its own registrar here).
 */
export function registerJobHandlers(app: INestApplicationContext) {
  const registry = app.get(JobRegistry);
  // Placeholder no-op subscription so permission changes are observable in tests; modules register real handlers.
  if (!registry.handler('system.noop')) registry.register('system.noop', async () => ({ ok: true }));
}

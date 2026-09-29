import type { INestApplicationContext } from '@nestjs/common';

/**
 * The NewCo module registers no job handlers: incorporation commands recompute the status dimensions synchronously through
 * the gates module's StatusDimensionsService, and approval validity is evaluated on read (`validityState`). A scheduled
 * "approval expiring" notification is not implemented (see the module report).
 */
export function registerNewcoJobs(_app: INestApplicationContext): void {
  // intentionally empty
}

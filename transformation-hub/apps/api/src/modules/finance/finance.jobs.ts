import type { INestApplicationContext } from '@nestjs/common';

/**
 * Register this module's job handlers and outbox subscriptions (called by src/jobs.ts in the worker).
 *
 * The finance module needs no background job: every derived view (budget position, separation cost view with the TSA
 * charge counted once, reconciliation flags, value-basis findings, aggregates) is computed live, inside the caller's scope,
 * on read. The module EMITS `approval.pending` (figure / model version validated, benefit realization awaiting
 * verification) for the notifications module; it subscribes to nothing. A service identity is never given a finance
 * permission: validation, approval and verification are human acts (REQ-FIN-010).
 */
export function registerFinanceJobs(_app: INestApplicationContext): void {
  // Intentionally empty (see above).
}

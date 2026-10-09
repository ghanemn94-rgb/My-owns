// access queues (T-DG4-BE-B; p4-work-split §I+C.2; stub by T-DG4-BE-A): delegation.expiry_sweep (REQ-S10-010, ADR-0026 §3),
// the queue of a job_schedule row, created with the standard bounded retry policy and the ops.failed dead-letter queue
// (queues/index.ts). No outbox event feeds it: the schedule starts the job.
import type { QueueSpec } from "./spec.ts";

/** The scheduled job queue (job_schedule row `delegation.expiry_sweep`; standard retry policy and ops.failed). */
export const ACCESS_QUEUES: readonly QueueSpec[] = [{ name: "delegation.expiry_sweep" }];
export const ACCESS_EVENT_QUEUES: Readonly<Record<string, string>> = {};

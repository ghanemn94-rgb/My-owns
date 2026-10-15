// jobs queues (P5; ADR-0043 §6; p5-work-split §D.4; T-DG5-BE-I2), created with the standard bounded retry policy and
// the ops.failed dead-letter queue (queues/index.ts):
//   jobs.run_now  the consumer of the internal outbox event `job.run_requested` ("run now" of a scheduled job). It needs
//                 pg-boss itself, so worker.ts registers it outside DOMAIN_HANDLERS (like automation.failure_retry).
// No queue here decides an approval.
import type { QueueSpec } from "./spec.ts";

export const JOBS_QUEUES: readonly QueueSpec[] = [{ name: "jobs.run_now" }];

export const JOBS_EVENT_QUEUES: Readonly<Record<string, string>> = { "job.run_requested": "jobs.run_now" };

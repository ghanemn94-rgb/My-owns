// approvals queues (T-DG4-BE-B; p4-work-split §I+C.2; stub by T-DG4-BE-A): approval.escalation_scan (REQ-S10-019, ADR-0026 §6),
// the queue of a job_schedule row, created with the standard bounded retry policy and the ops.failed dead-letter queue
// (queues/index.ts). No outbox event feeds it: the schedule starts the job.
import type { QueueSpec } from "./spec.ts";

/** The scheduled job queue (job_schedule row `approval.escalation_scan`; standard retry policy and ops.failed). */
export const APPROVALS_QUEUES: readonly QueueSpec[] = [{ name: "approval.escalation_scan" }];
export const APPROVALS_EVENT_QUEUES: Readonly<Record<string, string>> = {};

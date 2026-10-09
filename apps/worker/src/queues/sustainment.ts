// sustainment queues (T-DG4-BE-I2; p4-work-split §F+G FG.5; stub by T-DG4-BE-A): the two daily scans of slice G
// (ADR-0034 §6), created with the standard bounded retry policy and the ops.failed dead-letter queue (queues/index.ts).
// Both are started by their `job_schedule` rows (0050; the schedule kit, schedules.ts); they consume no outbox event,
// so they add no event -> queue entry. The `control_check.failed` event this slice emits is consumed by slice E's
// raid.corrective_control (queues/raid.ts).
import type { QueueSpec } from "./spec.ts";

export const SUSTAINMENT_QUEUES: readonly QueueSpec[] = [
  { name: "sustainment.review_scan" },
  { name: "sustainment.control_check_scan" },
];
export const SUSTAINMENT_EVENT_QUEUES: Readonly<Record<string, string>> = {};

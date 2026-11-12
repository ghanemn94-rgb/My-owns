// retention queues (P7; stub by T-DG7-BE-A, p7-plan §5.1 and §5.3; filled by T-DG7-BE-G, ADR-0067 §4), created with
// the standard bounded retry policy and the ops.failed dead-letter queue (queues/index.ts):
//   retention.archive  the consumer of the internal outbox event `retention_run.requested` (createRetentionRun,
//                      createRetentionDryRun; the relay's singleton key is the event's idempotency key = the run id) and
//                      of its own schedule `retention.archive` (weekly, Asia/Riyadh), which ships DISABLED (0148).
//                      It runs each run exactly once under the retentionRun lock (730410).
// No queue here decides an approval.
import type { QueueSpec } from "./spec.ts";

export const RETENTION_QUEUES: readonly QueueSpec[] = [{ name: "retention.archive" }];
export const RETENTION_EVENT_QUEUES: Readonly<Record<string, string>> = {
  "retention_run.requested": "retention.archive",
};

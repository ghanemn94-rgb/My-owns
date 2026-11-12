// transfer queues (P7; stub by T-DG7-BE-A, p7-plan §5.1 and §5.3; filled by T-DG7-BE-C, ADR-0064 §7), created with the
// standard bounded retry policy and the ops.failed dead-letter queue (queues/index.ts):
//   transfer.export  the consumer of the internal outbox event `migration_export.requested` (on demand, no schedule;
//                    the relay's singleton key is the event's idempotency key `migration_export.requested:<exportId>`).
//                    It writes the package exactly once per export under the migrationExport lock (730402).
// No queue here decides an approval.
import type { QueueSpec } from "./spec.ts";

export const TRANSFER_QUEUES: readonly QueueSpec[] = [{ name: "transfer.export" }];
export const TRANSFER_EVENT_QUEUES: Readonly<Record<string, string>> = {
  "migration_export.requested": "transfer.export",
};

// demo queues (P5; stub by T-DG5-BE-A; filled by T-DG5-BE-S, ADR-0050 §6, §10), created with the standard bounded retry
// policy and the ops.failed dead-letter queue (queues/index.ts):
//   demo.reset  the consumer of the internal outbox event `demo.reset_requested` (the in-app demo reset; on demand, no
//               schedule; the relay's singleton key is the event's idempotency key). Its handler acknowledges the
//               request in the processed_message ledger BEFORE it drops the database, so a retry never drops twice.
// No queue here decides an approval.
import type { QueueSpec } from "./spec.ts";

export const DEMO_QUEUES: readonly QueueSpec[] = [{ name: "demo.reset" }];
export const DEMO_EVENT_QUEUES: Readonly<Record<string, string>> = { "demo.reset_requested": "demo.reset" };

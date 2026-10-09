// gates queues (P4 stub, T-DG4-BE-A; p4-work-split §I+C.1): gate.submitted / gate.decided consumers (REQ-S12-009, REQ-S12-010). Owned and filled by BE-K, which adds its
// queue specs (created with the standard retry policy and the ops.failed dead-letter queue) and its outbox event ->
// queue entries here; queues/index.ts already aggregates this file.
import type { QueueSpec } from "./spec.ts";

export const GATES_QUEUES: readonly QueueSpec[] = [];
export const GATES_EVENT_QUEUES: Readonly<Record<string, string>> = {};

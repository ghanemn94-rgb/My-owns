// access queues (P4 stub, T-DG4-BE-A; p4-work-split §I+C.1): delegation.expiry_sweep (REQ-S10-010). Owned and filled by BE-B, which adds its
// queue specs (created with the standard retry policy and the ops.failed dead-letter queue) and its outbox event ->
// queue entries here; queues/index.ts already aggregates this file.
import type { QueueSpec } from "./spec.ts";

export const ACCESS_QUEUES: readonly QueueSpec[] = [];
export const ACCESS_EVENT_QUEUES: Readonly<Record<string, string>> = {};

// benefits queues (P4 stub, T-DG4-BE-A; p4-work-split §I+C.1): the Finance validation queue (REQ-S12-014) and pending measurements (REQ-S07-014). Owned and filled by KBE-E, which adds its
// queue specs (created with the standard retry policy and the ops.failed dead-letter queue) and its outbox event ->
// queue entries here; queues/index.ts already aggregates this file.
import type { QueueSpec } from "./spec.ts";

export const BENEFITS_QUEUES: readonly QueueSpec[] = [];
export const BENEFITS_EVENT_QUEUES: Readonly<Record<string, string>> = {};

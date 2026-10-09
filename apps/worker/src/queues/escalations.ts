// escalations queues (P4 stub, T-DG4-BE-A; p4-work-split §I+C.1): escalation timers (REQ-S12-011, REQ-PB-082). Owned and filled by BE-G, which adds its
// queue specs (created with the standard retry policy and the ops.failed dead-letter queue) and its outbox event ->
// queue entries here; queues/index.ts already aggregates this file.
import type { QueueSpec } from "./spec.ts";

export const ESCALATIONS_QUEUES: readonly QueueSpec[] = [];
export const ESCALATIONS_EVENT_QUEUES: Readonly<Record<string, string>> = {};

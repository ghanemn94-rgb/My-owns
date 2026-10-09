// sustainment queues (P4 stub, T-DG4-BE-A; p4-work-split §I+C.1): recurring BAU reviews and control checks (slice G). Owned and filled by BE-I, which adds its
// queue specs (created with the standard retry policy and the ops.failed dead-letter queue) and its outbox event ->
// queue entries here; queues/index.ts already aggregates this file.
import type { QueueSpec } from "./spec.ts";

export const SUSTAINMENT_QUEUES: readonly QueueSpec[] = [];
export const SUSTAINMENT_EVENT_QUEUES: Readonly<Record<string, string>> = {};

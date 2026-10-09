// adoption queues (P4 stub, T-DG4-BE-A; p4-work-split §I+C.1): adoption indicators (slice F). Owned and filled by KBE-F, which adds its
// queue specs (created with the standard retry policy and the ops.failed dead-letter queue) and its outbox event ->
// queue entries here; queues/index.ts already aggregates this file.
import type { QueueSpec } from "./spec.ts";

export const ADOPTION_QUEUES: readonly QueueSpec[] = [];
export const ADOPTION_EVENT_QUEUES: Readonly<Record<string, string>> = {};

// raid queues (P4 stub, T-DG4-BE-A; p4-work-split §I+C.1): the deviation, variance, adoption-check and control-check consumers (slice E). Owned and filled by BE-D, which adds its
// queue specs (created with the standard retry policy and the ops.failed dead-letter queue) and its outbox event ->
// queue entries here; queues/index.ts already aggregates this file.
import type { QueueSpec } from "./spec.ts";

export const RAID_QUEUES: readonly QueueSpec[] = [];
export const RAID_EVENT_QUEUES: Readonly<Record<string, string>> = {};

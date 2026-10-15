// Notification digest queue (P5; ADR-0044 §5, §8; T-DG5-BE-L): the `notification.digest` schedule (0075, every 15
// minutes) with the standard bounded retry policy and the ops.failed dead-letter queue (queues/index.ts). No event
// feeds it: held notifications are found by the job itself.
import type { QueueSpec } from "./spec.ts";

export const DIGESTS_QUEUES: readonly QueueSpec[] = [{ name: "notification.digest" }];
export const DIGESTS_EVENT_QUEUES: Readonly<Record<string, string>> = {};

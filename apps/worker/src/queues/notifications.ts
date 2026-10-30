// notifications queues (P6; ADR-0054 §3; REQ-S12-023; T-DG6-BE-I2; stub by T-DG6-BE-A), created with the standard
// bounded retry policy and the ops.failed dead-letter queue (queues/index.ts):
//   notifications.fanout          consumer of inbox_notification.created: the channel deliveries of one notification,
//                                 once, after its producing transaction committed; nothing when no channel is enabled;
//   notifications.delivery_sweep  every minute (job_schedule 0120): released and digest notifications, retries with
//                                 backoff, and pending sends an interrupted run left.
// Each runs under its own service identity (0120; ../kit.ts JOB_SERVICE_IDENTITIES). Neither decides an approval.
import type { QueueSpec } from "./spec.ts";

export const NOTIFICATIONS_QUEUES: readonly QueueSpec[] = [
  { name: "notifications.fanout" },
  { name: "notifications.delivery_sweep" },
];
export const NOTIFICATIONS_EVENT_QUEUES: Readonly<Record<string, string>> = {
  "inbox_notification.created": "notifications.fanout",
};

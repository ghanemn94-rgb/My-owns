// launch queues (P5; stub by T-DG5-BE-A, p5-plan §5.1 and §5.3; filled by T-DG5-BE-P2, p5-work-split §H.2): the
// Day-90 leadership test task job (ADR-0048 §4), created with the standard bounded retry policy and the ops.failed
// dead-letter queue (queues/index.ts). It is started by its `job_schedule` row (0086, daily 00:50 Asia/Riyadh; the
// schedule kit, schedules.ts) and consumes no outbox event, so it adds no event -> queue entry.
import type { QueueSpec } from "./spec.ts";

export const LAUNCH_QUEUES: readonly QueueSpec[] = [{ name: "launch.day_ninety_tests" }];
export const LAUNCH_EVENT_QUEUES: Readonly<Record<string, string>> = {};

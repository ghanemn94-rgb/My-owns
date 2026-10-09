// meetings queues (T-DG4-BE-F; p4-work-split §D.1; stub by T-DG4-BE-A): the meeting-series generation job of slice D
// (ADR-0032 §2, §10), created with the standard bounded retry policy and the ops.failed dead-letter queue
// (queues/index.ts). It is started by its daily `job_schedule` row (the schedule kit, schedules.ts); it consumes no
// outbox event, so it adds no event -> queue entry.
import type { QueueSpec } from "./spec.ts";

export const MEETINGS_QUEUES: readonly QueueSpec[] = [{ name: "governance.meeting_series_generate" }];
export const MEETINGS_EVENT_QUEUES: Readonly<Record<string, string>> = {};

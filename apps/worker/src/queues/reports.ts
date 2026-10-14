// reports queues (P5; stub by T-DG5-BE-A, p5-plan §5.1 and §5.3): the owning P5 task declares its queues here, created
// with the standard bounded retry policy and the ops.failed dead-letter queue (queues/index.ts). Empty until then.
import type { QueueSpec } from "./spec.ts";

export const REPORTS_QUEUES: readonly QueueSpec[] = [];
export const REPORTS_EVENT_QUEUES: Readonly<Record<string, string>> = {};

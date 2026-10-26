// search queues (P6; stub by T-DG6-BE-A, p6-plan §5.1 and §5.3): BE-P (index maintenance and reindex) declares its queues here, created
// with the standard bounded retry policy and the ops.failed dead-letter queue (queues/index.ts). Empty until then.
import type { QueueSpec } from "./spec.ts";

export const SEARCH_QUEUES: readonly QueueSpec[] = [];
export const SEARCH_EVENT_QUEUES: Readonly<Record<string, string>> = {};

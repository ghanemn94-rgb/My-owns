// integrations queues (P6; stub by T-DG6-BE-A, p6-plan §5.1 and §5.3): BE-L (connector runs and retries), then BE-M/BE-N declares its queues here, created
// with the standard bounded retry policy and the ops.failed dead-letter queue (queues/index.ts). Empty until then.
import type { QueueSpec } from "./spec.ts";

export const INTEGRATIONS_QUEUES: readonly QueueSpec[] = [];
export const INTEGRATIONS_EVENT_QUEUES: Readonly<Record<string, string>> = {};

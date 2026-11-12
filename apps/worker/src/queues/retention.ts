// retention queues (P7; stub by T-DG7-BE-A, p7-plan §5.1 and §5.3): the retention.archive job's queue (ADR-0067 §4;
// T-DG7-BE-G) is declared here, created with the standard bounded retry policy and the ops.failed dead-letter queue
// (queues/index.ts). Empty until then.
import type { QueueSpec } from "./spec.ts";

export const RETENTION_QUEUES: readonly QueueSpec[] = [];
export const RETENTION_EVENT_QUEUES: Readonly<Record<string, string>> = {};

// transfer queues (P7; stub by T-DG7-BE-A, p7-plan §5.1 and §5.3): the transfer.export job's queue (ADR-0064 §7;
// T-DG7-BE-C) is declared here, created with the standard bounded retry policy and the ops.failed dead-letter queue
// (queues/index.ts). Empty until then.
import type { QueueSpec } from "./spec.ts";

export const TRANSFER_QUEUES: readonly QueueSpec[] = [];
export const TRANSFER_EVENT_QUEUES: Readonly<Record<string, string>> = {};

// approvals queues (P4 stub, T-DG4-BE-A; p4-work-split §I+C.1): approval.escalation_scan (REQ-S10-019, ADR-0026 §6). Owned and filled by BE-B, which adds its
// queue specs (created with the standard retry policy and the ops.failed dead-letter queue) and its outbox event ->
// queue entries here; queues/index.ts already aggregates this file.
import type { QueueSpec } from "./spec.ts";

export const APPROVALS_QUEUES: readonly QueueSpec[] = [];
export const APPROVALS_EVENT_QUEUES: Readonly<Record<string, string>> = {};

// kpi queues (P4 stub, T-DG4-BE-A; p4-work-split §I+C.1): kpi.reporting_period_open (REQ-S12-005) and the KPI recalculation (REQ-S12-006). Owned and filled by KBE-C, which adds its
// queue specs (created with the standard retry policy and the ops.failed dead-letter queue) and its outbox event ->
// queue entries here; queues/index.ts already aggregates this file.
import type { QueueSpec } from "./spec.ts";

export const KPI_QUEUES: readonly QueueSpec[] = [];
export const KPI_EVENT_QUEUES: Readonly<Record<string, string>> = {};

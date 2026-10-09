// kpi queues (T-DG4-KBE-C; p4-work-split §A.3, §I+C.5; stub by T-DG4-BE-A): the KPI recalculation (REQ-S07-013,
// REQ-S12-006; ADR-0027 §8) and kpi.reporting_period_open (REQ-S12-005; ADR-0025 §4), both created with the standard
// retry policy and the ops.failed dead-letter queue (queues/index.ts). The four trigger events of a calculation run go
// to the one kpi.recalculate queue; its consumer writes one run per trigger (unique trigger key).
import type { QueueSpec } from "./spec.ts";

export const KPI_QUEUES: readonly QueueSpec[] = [{ name: "kpi.recalculate" }, { name: "kpi.reporting_period_open" }];
export const KPI_EVENT_QUEUES: Readonly<Record<string, string>> = {
  "kpi.actual_accepted": "kpi.recalculate",
  "kpi.threshold_changed": "kpi.recalculate",
  "kpi.trajectory_approved": "kpi.recalculate",
  "kpi.version_activated": "kpi.recalculate",
};

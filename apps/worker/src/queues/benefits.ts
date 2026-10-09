// benefits queues (T-DG4-KBE-E; p4-work-split §B.3; ADR-0030 §3, §6; stub by T-DG4-BE-A): the Finance validation queue
// (REQ-S12-014), the pending values after an accepted KPI actual (REQ-S07-014) and the acknowledgement of the Finance
// decision events, each created with the standard retry policy and the ops.failed dead-letter queue (queues/index.ts).
// benefit.variance_evaluated is consumed by slice E (BE-D maps it in queues/raid.ts).
import type { QueueSpec } from "./spec.ts";

export const BENEFITS_QUEUES: readonly QueueSpec[] = [
  { name: "benefits.finance_queue" },
  { name: "benefits.recalculate_pending" },
  { name: "benefits.value_decided" },
];
export const BENEFITS_EVENT_QUEUES: Readonly<Record<string, string>> = {
  "benefit.evidence_submitted": "benefits.finance_queue",
  "kpi.values_recalculated": "benefits.recalculate_pending",
  "benefit.value_validated": "benefits.value_decided",
  "benefit.value_rejected": "benefits.value_decided",
};

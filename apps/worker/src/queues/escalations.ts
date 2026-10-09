// escalations queues (T-DG4-BE-G; p4-work-split §D.2; stub by T-DG4-BE-A): the decision-SLA and blocker-red
// escalation jobs of slice D (ADR-0032 §7, §8.3, §10), created with the standard bounded retry policy and the ops.failed
// dead-letter queue (queues/index.ts):
//   governance.decision_sla_scan        daily schedule (working days only; the handler checks the business calendar)
//   governance.blocker_escalation       consumer of the outbox event blocker_status.recorded
//   governance.blocker_escalation_scan  daily schedule
// The two scans are started by their `job_schedule` rows (the schedule kit, schedules.ts); those rows need a
// repair-range migration (T-DG4-BE-G handback). The event maps to its one consumer queue.
import type { QueueSpec } from "./spec.ts";

export const ESCALATIONS_QUEUES: readonly QueueSpec[] = [
  { name: "governance.decision_sla_scan" },
  { name: "governance.blocker_escalation" },
  { name: "governance.blocker_escalation_scan" },
];
export const ESCALATIONS_EVENT_QUEUES: Readonly<Record<string, string>> = {
  "blocker_status.recorded": "governance.blocker_escalation",
};

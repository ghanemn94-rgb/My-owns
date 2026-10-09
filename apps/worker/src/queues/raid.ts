// raid queues (T-DG4-BE-D2; p4-work-split §E.2; stub by T-DG4-BE-A): the four corrective-action consumers of slice E
// (ADR-0031 §5.4), created with the standard bounded retry policy and the ops.failed dead-letter queue
// (queues/index.ts). Each producer event goes to its one consumer queue (handlers/raid.ts):
//   kpi.deviation_evaluated (KBE-C)       -> raid.corrective_kpi
//   benefit.variance_evaluated (KBE-E)    -> raid.corrective_benefit
//   adoption.check_failed (slice F)       -> raid.corrective_adoption
//   control_check.failed (slice G)        -> raid.corrective_control
// Each entry here names RAID's one queue for the event. Since D-102 an event type may also feed other domains' queues
// (kpi.deviation_evaluated feeds adoption.indicator_evaluated too, queues/adoption.ts): queues/index.ts merges the
// domain maps into QUEUES_FOR_EVENT and the relay sends one job per queue in the same transaction.
import type { QueueSpec } from "./spec.ts";

export const RAID_QUEUES: readonly QueueSpec[] = [
  { name: "raid.corrective_kpi" },
  { name: "raid.corrective_benefit" },
  { name: "raid.corrective_adoption" },
  { name: "raid.corrective_control" },
];
export const RAID_EVENT_QUEUES: Readonly<Record<string, string>> = {
  "kpi.deviation_evaluated": "raid.corrective_kpi",
  "benefit.variance_evaluated": "raid.corrective_benefit",
  "adoption.check_failed": "raid.corrective_adoption",
  "control_check.failed": "raid.corrective_control",
};

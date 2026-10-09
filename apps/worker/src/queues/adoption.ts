// adoption queues (T-DG4-KBE-F; p4-work-split §F+G FG.3; stub by T-DG4-BE-A): the below-trajectory consumer of slice F
// (ADR-0033 §4), created with the standard bounded retry policy and the ops.failed dead-letter queue
// (queues/index.ts). kpi.deviation_evaluated (KBE-C, ADR-0027 §8) also feeds RAID's raid.corrective_kpi: the relay
// fans the event out to both queues in one transaction (D-102), each job with its own deterministic id.
import type { QueueSpec } from "./spec.ts";

export const ADOPTION_INDICATOR_EVALUATED_QUEUE = "adoption.indicator_evaluated";

export const ADOPTION_QUEUES: readonly QueueSpec[] = [{ name: ADOPTION_INDICATOR_EVALUATED_QUEUE }];
export const ADOPTION_EVENT_QUEUES: Readonly<Record<string, string>> = {
  "kpi.deviation_evaluated": ADOPTION_INDICATOR_EVALUATED_QUEUE,
};

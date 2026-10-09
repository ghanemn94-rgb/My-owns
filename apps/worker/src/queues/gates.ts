// gates queues (T-DG4-BE-K; ADR-0035 §7; p4-work-split §H H.1; stub by T-DG4-BE-A): the two consumers of the product-gate
// outbox events, created with the standard bounded retry policy and the ops.failed dead-letter queue (queues/index.ts):
//   gates.submitted   consumer of gate.submitted (approver tasks; REQ-S12-009)
//   gates.decided     consumer of gate.decided   (close tasks, enable next phase steps and the G5 scope; REQ-S12-010)
// Neither event had a consumer before, so each maps to its one queue here (D-102 fan-out: another slice may add its own
// queue for the same event in its own file). BE-K2 appends its gate.exception_expiry_scan queue (p4-work-split §H H.2).
import type { QueueSpec } from "./spec.ts";

export const GATES_QUEUES: readonly QueueSpec[] = [{ name: "gates.submitted" }, { name: "gates.decided" }];
export const GATES_EVENT_QUEUES: Readonly<Record<string, string>> = {
  "gate.submitted": "gates.submitted",
  "gate.decided": "gates.decided",
};

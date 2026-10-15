// portfolio queues (P5; ADR-0044 §8; T-DG5-BE-J): the consumer of `dependency.slipped` (starter 9, REQ-S12-012), with
// the standard bounded retry policy and the ops.failed dead-letter queue (queues/index.ts). D-102 fan-out: the same
// event also feeds automation.evaluate (admin rules on `dependency.slipped`, queues/automation.ts).
import type { QueueSpec } from "./spec.ts";

export const PORTFOLIO_QUEUES: readonly QueueSpec[] = [{ name: "portfolio.dependency_slip" }];
export const PORTFOLIO_EVENT_QUEUES: Readonly<Record<string, string>> = {
  "dependency.slipped": "portfolio.dependency_slip",
};

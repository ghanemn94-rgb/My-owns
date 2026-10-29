// automation queues (P5; ADR-0043 §5, §7; p5-work-split §D.2; T-DG5-BE-H2), created with the standard bounded retry
// policy (5 retries, 10 s, exponential backoff) and the ops.failed dead-letter queue (queues/index.ts):
//   automation.evaluate     the engine's consumer of every admin-selectable EVENT trigger (automation_trigger rows with
//                           trigger_kind 'event' and admin_selectable; the integration test compares this map with
//                           the catalogue). D-102 fan-out: each event keeps its DG4 consumer too.
//   automation.tick_hourly  the hourly engine tick (job_schedule seeded by 0074, minute 7, Asia/Riyadh)
//   automation.tick_daily   the daily engine tick (job_schedule seeded by 0074, 00:20, Asia/Riyadh)
// The starters keep their DG4 queues (ADR-0044 §1). No queue here decides an approval.
import type { QueueSpec } from "./spec.ts";

export const AUTOMATION_QUEUES: readonly QueueSpec[] = [
  { name: "automation.evaluate" },
  { name: "automation.tick_hourly" },
  { name: "automation.tick_daily" },
  // T-DG5-BE-I (ADR-0043 §5, §7): the failure queue's two internal consumers (apps/worker/src/worker.ts registers the
  // retry dispatcher; handlers/automation.ts the job.failed consumer, which BE-J wraps as starter 16).
  { name: "automation.failure_retry" },
  { name: "automation.job_failed" },
];

/** The admin-selectable event triggers of 0074, 0075 and 0116 (automation_trigger), each fed to the engine. */
export const AUTOMATION_EVENT_TRIGGERS = [
  "adoption.check_failed",
  "benefit.evidence_submitted",
  "benefit.variance_evaluated",
  "blocker_status.recorded",
  "connector.run_failed", // T-DG6-BE-K2 (0116; ADR-0053 §3)
  "control_check.failed",
  "data.stale", // T-DG6-BE-K2 (0117; ADR-0053 §3)
  "dependency.slipped",
  "gate.decided",
  "gate.submitted",
  "kpi.actual_accepted",
  "kpi.deviation_evaluated",
  "kpi.threshold_changed",
  "kpi.trajectory_approved",
  "kpi.values_recalculated",
  "kpi.version_activated",
  "procedure_step.activated",
  "transformation.created",
] as const;

export const AUTOMATION_EVENT_QUEUES: Readonly<Record<string, string>> = Object.fromEntries([
  ...AUTOMATION_EVENT_TRIGGERS.map((t) => [t, "automation.evaluate"]),
  // T-DG5-BE-I: the internal failure-queue events (not admin-selectable triggers; never evaluated as rules here).
  ["automation_failure.retry_requested", "automation.failure_retry"],
  ["job.failed", "automation.job_failed"],
]);

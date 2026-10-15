// reports queues (P5; stub by T-DG5-BE-A, p5-plan §5.1 and §5.3), created with the standard bounded retry policy and
// the ops.failed dead-letter queue (queues/index.ts).
//   reports.owner_update_tasks (T-DG5-KBE-D; ADR-0045 §6, §10): the daily owner-update task job, scheduled by the
//   job_schedule row seeded by 0080 (00:40 Asia/Riyadh). No outbox event feeds it.
//   reports.export (T-DG5-BE-M; ADR-0046 §5): renders one export job; fed by the `export_job.requested` outbox event
//   the API writes in the creating transaction (job id = the outbox event id, so a replayed send is a no-op).
import type { QueueSpec } from "./spec.ts";

export const REPORTS_QUEUES: readonly QueueSpec[] = [
  { name: "reports.owner_update_tasks" },
  { name: "reports.export" },
];
export const REPORTS_EVENT_QUEUES: Readonly<Record<string, string>> = { "export_job.requested": "reports.export" };

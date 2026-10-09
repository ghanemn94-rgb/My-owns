// A probe job handler for the kill-and-restart test (REQ-S16-005 A13; ADR-0025 §3; T-DG4-BE-A). It is built ONLY from
// the kit every P4 handler must use: runOnce (effects + processed_message ledger in one transaction) and
// createWorkItemOnce (one task and one reminder per dedupe key). With `hang` it stops inside the transaction after its
// effects were written and before COMMIT, so a killed process leaves nothing committed. All data is SYNTHETIC.
import { z } from "zod";
import type { JobHandler } from "../src/handlers/index.ts";
import { createWorkItemOnce, jobActor, runOnce } from "../src/kit.ts";

export const PROBE_QUEUE = "test.restart_probe";
export const PROBE_CONSUMER = "test.restart_probe.v1";
export const probeJob = z.strictObject({ key: z.string(), organizationId: z.uuid(), ownerUserId: z.uuid() });

export function probeHandler(options: { hang?: () => Promise<void> } = {}): JobHandler {
  return {
    queue: PROBE_QUEUE,
    handle: async (db, data, jobId) => {
      const job = probeJob.parse(data);
      const r = await runOnce(db, PROBE_CONSUMER, job.key, async (tx) => {
        const created = await createWorkItemOnce(tx, jobActor(jobId), {
          organizationId: job.organizationId,
          kind: "kpi_update_due",
          assigneeUserId: job.ownerUserId,
          subjectType: "kpi_definition",
          subjectId: job.organizationId,
          linkPath: "/kpi/restart-probe",
          messageKey: "tasks.kpi_update_due",
          messageParams: { periodLabel: "2026-10" },
          periodLabel: "2026-10",
          dedupeKey: job.key,
        });
        if (options.hang) await options.hang();
        return created.outcome;
      });
      return r.outcome === "done" ? r.result : "duplicate";
    },
  };
}

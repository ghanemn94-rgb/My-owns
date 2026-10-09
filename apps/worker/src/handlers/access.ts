// access job handlers (T-DG4-BE-B; p4-work-split §I+C.2; ADR-0026 §3; REQ-S10-010): `delegation.expiry_sweep`.
// It only updates the DISPLAYED status of delegations whose end has passed (`active` -> `expired`, version + 1, one
// audit event as the service actor), each in its own runOnce transaction keyed `delegation.expire:<id>`. Capability
// never depends on it: the API's `actsFor` reads the window (effective_from <= now() < effective_to) at use time, so a
// delegate loses the delegator's capability the instant effective_to passes, whether or not this job has run. A job
// never decides a business approval.
import { insertAuditEvent, sql, type Db } from "@mth/db";
import { z } from "zod";
import { jobActor, runOnce } from "../kit.ts";
import type { JobHandler } from "./spec.ts";

export const EXPIRY_SWEEP_QUEUE = "delegation.expiry_sweep";
export const EXPIRY_CONSUMER = "delegation.expiry_sweep.v1";
const BATCH = 1000;

/** Job data: the schedule sends {}; an operator (or a test) may scope one run to one organization. */
const sweepData = z.object({ organizationId: z.uuid().optional() }).loose();

export interface ExpirySweepResult {
  readonly selected: number;
  readonly expired: number;
  readonly duplicates: number;
  readonly skipped: number;
}

export async function sweepExpiredDelegations(db: Db, data: unknown, jobId: string): Promise<ExpirySweepResult> {
  const opts = sweepData.parse(data ?? {});
  const org = opts.organizationId ?? null;
  const rows = await sql<{ id: string }>`
    SELECT d.id FROM delegation d
    WHERE d.status = 'active' AND d.effective_to <= now()
      AND (${org}::uuid IS NULL OR d.organization_id = ${org}::uuid)
    ORDER BY d.effective_to, d.id
    LIMIT ${BATCH}`.execute(db);
  let expired = 0;
  let duplicates = 0;
  let skipped = 0;
  for (const { id } of rows.rows) {
    const r = await runOnce(db, EXPIRY_CONSUMER, `delegation.expire:${id}`, async (tx) => {
      const current = await tx
        .selectFrom("delegation")
        .select(["id", "organization_id", "status", "version"])
        .where("id", "=", id)
        .where("status", "=", "active")
        .where("effective_to", "<=", sql<Date>`now()`)
        .forUpdate()
        .executeTakeFirst();
      if (!current) return "skipped" as const;
      const updated = await tx
        .updateTable("delegation")
        .set({ status: "expired", version: sql<number>`version + 1`, updated_at: sql<Date>`now()`, updated_by: null })
        .where("id", "=", id)
        .where("version", "=", current.version)
        .returning("version")
        .executeTakeFirstOrThrow();
      await insertAuditEvent(tx, jobActor(jobId), {
        action: "delegation.expire",
        recordType: "delegation",
        recordId: id,
        organizationId: current.organization_id,
        priorVersion: current.version,
        newVersion: updated.version,
        changes: { status: { from: "active", to: "expired" } },
      });
      return "expired" as const;
    });
    if (r.outcome === "duplicate") duplicates += 1;
    else if (r.result === "expired") expired += 1;
    else skipped += 1;
  }
  return { selected: rows.rows.length, expired, duplicates, skipped };
}

export const ACCESS_HANDLERS: readonly JobHandler[] = [
  { queue: EXPIRY_SWEEP_QUEUE, handle: (db, data, jobId) => sweepExpiredDelegations(db, data, jobId) },
];

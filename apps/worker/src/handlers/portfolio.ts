// portfolio job handlers (P5; ADR-0044 §7, §8; REQ-S12-012 "a 5-day slip notifies each affected owner once";
// M0232; p5-work-split §E.1; T-DG5-BE-J): starter 9 `starter.dependency_slip`, registered through withStarterRule.
//
//   queue / consumer            trigger                        idempotency key (runOnce ledger)
//   portfolio.dependency_slip   outbox event dependency.slipped   dependency.slipped:<slipId>
//
// One `dependency_slip` work item (with its inbox notification, the kit) per DISTINCT affected owner named in the
// slip's `affected` list, dedupe `dependency_slip:<slipId>:<userId>`: each affected owner is notified once, even when
// they own several affected initiatives, and a replay creates nothing (the ledger and the dedupe keys). An affected
// initiative without an owner (Unknown) notifies nobody. Forecasts are not touched: they are computed on read (DG4).
// Nothing here decides anything.
import type { Db } from "@mth/db";
import { dependencySlippedV1, outboxEnvelope } from "@mth/shared/schemas";
import { createWorkItemOnce, jobActor, runOnce } from "../kit.ts";
import type { JobHandler } from "./spec.ts";

export const DEPENDENCY_SLIP_QUEUE = "portfolio.dependency_slip";
export const DEPENDENCY_SLIP_CONSUMER = "portfolio.dependency_slip.v1";
export const DEPENDENCY_SLIP_KIND = "dependency_slip";
export const DEPENDENCY_SLIP_MESSAGE = "portfolio.task.dependency_slip";

export interface DependencySlipResult {
  readonly outcome: "done" | "duplicate" | "skipped";
  readonly notified: readonly string[];
}

export async function handleDependencySlipped(db: Db, data: unknown, jobId: string): Promise<DependencySlipResult> {
  const envelope = outboxEnvelope.parse(data);
  if (envelope.eventType !== "dependency.slipped" || envelope.schemaVersion !== 1)
    throw new Error(`${DEPENDENCY_SLIP_CONSUMER}: unexpected event ${envelope.eventType} v${envelope.schemaVersion}`);
  const p = dependencySlippedV1.parse(envelope.payload);
  const actor = jobActor(jobId);
  const r = await runOnce(db, DEPENDENCY_SLIP_CONSUMER, envelope.idempotencyKey, async (tx) => {
    const slip = await tx
      .selectFrom("dependency_slip as s")
      .innerJoin("dependency as d", "d.id", "s.dependency_id")
      .select(["s.id", "s.organization_id", "s.transformation_id", "s.slip_days", "s.affected", "d.code"])
      .where("s.id", "=", p.slipId)
      .executeTakeFirst();
    if (slip === undefined) return [] as string[];
    const owners: string[] = [];
    const codesByOwner = new Map<string, string[]>();
    for (const a of Array.isArray(slip.affected) ? (slip.affected as unknown[]) : []) {
      if (a === null || typeof a !== "object") continue;
      const m = new Map(Object.entries(a as Record<string, unknown>));
      const owner = m.get("ownerUserId");
      const code = m.get("initiativeCode");
      if (typeof owner !== "string") continue;
      if (!codesByOwner.has(owner)) owners.push(owner);
      codesByOwner.set(owner, [...(codesByOwner.get(owner) ?? []), typeof code === "string" ? code : ""]);
    }
    const notified: string[] = [];
    for (const userId of owners) {
      const w = await createWorkItemOnce(tx, actor, {
        organizationId: slip.organization_id,
        transformationId: slip.transformation_id,
        kind: DEPENDENCY_SLIP_KIND,
        assigneeUserId: userId,
        subjectType: "dependency_slip",
        subjectId: slip.id,
        linkPath: `/transformations/${slip.transformation_id}/dependencies`,
        messageKey: DEPENDENCY_SLIP_MESSAGE,
        messageParams: {
          dependencyCode: slip.code,
          slipDays: slip.slip_days,
          initiativeCodes: (codesByOwner.get(userId) ?? []).filter((c) => c.length > 0).join(", "),
        },
        dedupeKey: `dependency_slip:${slip.id}:${userId}`,
      });
      if (w.outcome === "created") notified.push(userId);
    }
    return notified;
  });
  return r.outcome === "duplicate" ? { outcome: "duplicate", notified: [] } : { outcome: "done", notified: r.result };
}

export const PORTFOLIO_HANDLERS: readonly JobHandler[] = [
  { queue: DEPENDENCY_SLIP_QUEUE, handle: handleDependencySlipped },
];

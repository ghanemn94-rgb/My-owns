// Phase progression is gate-controlled (ADR-0015 §2): the ONLY path that moves a transformation's current phase is an
// approved product gate (G1 -> define, G2 -> design, G3 -> mobilize), called by the workflows module inside the gate
// decision transaction. A product gate is a business approval made by a person; it is unrelated to the engineering
// delivery gates DG0-DG7.
import { sql, type Tx } from "@mth/db";
import { PHASES, type Phase } from "@mth/shared";
import type { AuditContext } from "../audit/index.ts";
import { record } from "../audit/index.ts";

/**
 * Moves the transformation forward to `nextPhase` when it is not already there or beyond (a Modular transformation
 * may have entered later). Writes version + 1 and one audit event. Returns the phase transition, or null when the
 * phase did not change.
 */
export async function advancePhaseOnGateApproval(
  tx: Tx,
  audit: AuditContext,
  input: { transformationId: string; nextPhase: Phase; gateCode: string; decisionId: string },
): Promise<{ from: Phase; to: Phase } | null> {
  const t = await tx
    .selectFrom("transformation")
    .select(["id", "organization_id", "current_phase", "version"])
    .where("id", "=", input.transformationId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  const from = t.current_phase as Phase;
  if (PHASES.indexOf(input.nextPhase) <= PHASES.indexOf(from)) return null;
  const updated = await tx
    .updateTable("transformation")
    .set({
      current_phase: input.nextPhase,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: audit.actorUserId ?? undefined,
    })
    .where("id", "=", t.id)
    .where("version", "=", t.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, audit, {
    action: "transformation.phase_advance",
    recordType: "transformation",
    recordId: t.id,
    organizationId: t.organization_id,
    transformationId: t.id,
    priorVersion: t.version,
    newVersion: updated.version,
    reason: `Product gate ${input.gateCode} approved (decision ${input.decisionId})`,
    changes: { currentPhase: { from, to: input.nextPhase } },
  });
  return { from, to: input.nextPhase };
}

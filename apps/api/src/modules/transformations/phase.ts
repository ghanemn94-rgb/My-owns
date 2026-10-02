// Phase progression is gate-controlled (ADR-0015 §2): the ONLY path that moves a transformation's current phase is an
// approved product gate (G1 -> define, G2 -> design, G3 -> mobilize), called by the workflows module inside the gate
// decision transaction. A product gate is a business approval made by a person; it is unrelated to the engineering
// delivery gates DG0-DG7.
//
// Sequence integrity (B0009 "Run Phases 1-6 sequentially", B0023; F-DG2-205): a gate closes ITS OWN phase, so an
// approval advances by exactly one step - from the gate's phase to the next one (diagnose -> define -> design ->
// mobilize), never skipping. The workflows module also refuses to submit or approve a gate before its predecessor is
// approved (Modular entry excepted).
import { sql, type Tx } from "@mth/db";
import { PHASES, type Phase } from "@mth/shared";
import type { AuditContext } from "../audit/index.ts";
import { record } from "../audit/index.ts";
import { problems } from "../platform/index.ts";

/**
 * Moves the transformation from the gate's phase to `nextPhase` (exactly one step). Returns null without a change when
 * the transformation is already beyond the gate's phase (a Modular transformation that entered later). Refuses (422
 * gate.out_of_sequence) when the transformation has not reached the gate's phase, so an approval can never skip a
 * phase. Writes version + 1 and one audit event.
 */
export async function advancePhaseOnGateApproval(
  tx: Tx,
  audit: AuditContext,
  input: { transformationId: string; gatePhase: Phase; nextPhase: Phase; gateCode: string; decisionId: string },
): Promise<{ from: Phase; to: Phase } | null> {
  const gateIdx = PHASES.indexOf(input.gatePhase);
  // Catalogue integrity: a gate's next phase is the phase right after its own.
  if (gateIdx < 0 || PHASES.indexOf(input.nextPhase) !== gateIdx + 1)
    throw new Error(`gate ${input.gateCode}: next phase ${input.nextPhase} does not follow ${input.gatePhase}`);
  const t = await tx
    .selectFrom("transformation")
    .select(["id", "organization_id", "current_phase", "version"])
    .where("id", "=", input.transformationId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  const from = t.current_phase as Phase;
  const fromIdx = PHASES.indexOf(from);
  if (fromIdx > gateIdx) return null;
  if (fromIdx < gateIdx)
    throw problems.businessRule(
      "gate.out_of_sequence",
      `${input.gateCode} closes the ${input.gatePhase} phase, but the transformation is still in ${from}; phases run in sequence.`,
    );
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

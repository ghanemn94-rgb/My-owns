// The read-only gate readiness of a transformation's current phase (T-DG4-KBE-G2; ADR-0037 §1 item 3, §9; REQ-S03-011):
// what the workspace header shows as `gateReadiness`. `reporting` may not import `workflows` (modules.ts), so the
// header reads it through `WorkflowsReadPort` (reporting/ports.ts), which the composition root (server.ts) wires to the
// reader this file builds (the GateFactsProvider precedent, ADR-0021 §7).
//
// The evaluation is the live one the gate view uses (gates.ts gateView): the gate whose phase is the transformation's
// current phase, its recorded status, the DG3 inherited-approval annotation (never a gate status, never an approval),
// and the mandatory criteria that are not complete and not covered today by an accepted, unexpired gate exception
// (ADR-0035 §4). `ready` is true exactly when that count is 0. Nothing is written; no lock is taken. Product gates G1-G6
// are business approvals inside the product; nothing here reads or writes DG0-DG7.
import type { DbOrTx } from "@mth/db";
import type { WorkspaceGateReadiness } from "@mth/shared/schemas";
import { loadGateDefinitions } from "../methodology/index.ts";
import { evaluateGate, loadGateFacts } from "./criteria.ts";
import type { GateFactsProvider } from "./g4.ts";
import { coveringExceptions, exceptionBusinessDate } from "./gate-exceptions.ts";
import { inheritedApprovalOf } from "./gates.ts";

/** The reader the composition root passes to the reporting port: `gateReadiness(db, transformationId)`. */
export type GateReadinessReader = (db: DbOrTx, transformationId: string) => Promise<WorkspaceGateReadiness | null>;

/**
 * Builds the reader over the production GateFactsProvider. Returns null (the header shows Unknown) when the
 * transformation, its current phase's gate definition or its gate instance does not exist.
 */
export function gateReadinessReader(gateFacts: GateFactsProvider): GateReadinessReader {
  return async (db, transformationId) => {
    const t = await db
      .selectFrom("transformation")
      .select(["current_phase"])
      .where("id", "=", transformationId)
      .executeTakeFirst();
    if (!t) return null;
    const def = (await loadGateDefinitions(db)).find((d) => d.phase === t.current_phase);
    if (!def) return null;
    const instance = await db
      .selectFrom("gate_instance")
      .select(["id", "status", "gate_code"])
      .where("transformation_id", "=", transformationId)
      .where("gate_code", "=", def.code)
      .executeTakeFirst();
    if (!instance) return null;
    const criteria = evaluateGate(def, await loadGateFacts(db, transformationId, gateFacts));
    const missing = criteria.filter((c) => c.mandatory && c.completeness !== "complete");
    const covered =
      missing.length === 0
        ? new Map<string, unknown>()
        : await coveringExceptions(db, instance.id, await exceptionBusinessDate(db, transformationId));
    const missingMandatoryCount = missing.filter((c) => !covered.has(c.key)).length;
    return {
      gateCode: instance.gate_code,
      status: instance.status,
      inheritedApproval: inheritedApprovalOf(await gateFacts.inheritedApprovals(db, transformationId), def.code),
      missingMandatoryCount,
      ready: missingMandatoryCount === 0,
    };
  };
}

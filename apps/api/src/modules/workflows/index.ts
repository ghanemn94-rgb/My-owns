// workflows (ADR-0002; master prompt §16 "workflows"): product gates G1-G6, approvals, decisions and
// separation-of-duties rules. P1 SCAFFOLD (D-048, T-DG1-BE3): the module, its boundary (modules.ts `dependsOn`), this
// public interface, its wiring hook and its own test suite exist from DG1, so later stages add code, not new
// boundaries. Its business behaviour lands in P2+ (gate submission with mandatory evidence or an authorized waiver,
// human approvals recorded with assignee, request version, rationale and timestamp, stale-approval rejection, SoD,
// delegation without loops, working-day SLAs on the business calendar).
//
// In P1 the hook registers NO routes - in particular no mutating route - and nothing here can grant an approval.
// G1-G6 are BUSINESS approvals inside the product, granted only by people; they are unrelated to the engineering
// delivery gates DG0-DG7 (G6 never implies DG7, and the reverse). Until the G6 workflow exists, the transformations
// module refuses closure (F-DG1-001).
import type { FastifyInstance } from "fastify";
import type { ModuleDeps, ModuleRegistration } from "../platform/index.ts";

/** The playbook's product gates (business approvals), in order. Not the engineering gates DG0-DG7. */
export const PRODUCT_GATES = ["G1", "G2", "G3", "G4", "G5", "G6"] as const;
export type ProductGate = (typeof PRODUCT_GATES)[number];

/** The gate whose business approval is required before a transformation may be closed (P2+/P4). */
export const CLOSURE_GATE: ProductGate = "G6";

export const WORKFLOWS_MODULE: ModuleRegistration = Object.freeze({
  module: "workflows",
  status: "scaffold",
  deliversIn: "P2",
  routes: Object.freeze([]) as readonly string[],
});

/** Wiring hook called by the composition root (server.ts). P1: registers nothing and reports the scaffold. */
export function registerWorkflowsModule(_app: FastifyInstance, _deps: ModuleDeps): ModuleRegistration {
  return WORKFLOWS_MODULE;
}

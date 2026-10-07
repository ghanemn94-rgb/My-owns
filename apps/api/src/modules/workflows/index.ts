// workflows (ADR-0002, ADR-0015; master prompt §16 "workflows"): product gates G1-G6 (P2 delivers submission and
// decision for G1-G3), the one decision model (T04 design decisions; gate decisions), TOM workshops (workshop mode),
// owned actions, the canonical dependency record and the TOM canvas read model.
//
// G1-G6 are BUSINESS approvals inside the product, granted only by people: the configured approver decides with a
// rationale; the submitter never decides; a decision on a superseded submission is refused; approval advances the
// phase. They are unrelated to the engineering delivery gates DG0-DG7 (G6 never implies DG7, and the reverse).
// Closure of a transformation waits for the G6 workflow (P4); until then the transformations module refuses it.
import type { FastifyInstance } from "fastify";
import type { ModuleDeps, ModuleRegistration } from "../platform/index.ts";
import { registerRegister } from "../transformations/index.ts";
import { registerCanvasRoutes } from "./canvas.ts";
import { registerDecisionRoutes } from "./decisions.ts";
import { actionItemRegister, dependencyRegister, tomWorkshopRegister } from "./design-registers.ts";
import { UNWIRED_GATE_FACTS, type GateFactsProvider } from "./g4.ts";
import { registerGateRoutes } from "./gates.ts";
import { registerWorkshopRoutes } from "./workshops.ts";

export { EVALUATORS, evaluateGate, loadGateFacts, type GateFacts } from "./criteria.ts";
export { isGateApprover } from "./gates.ts";
// P3 (ADR-0021 §1, T-DG3-BE-A): the interface through which the G4 evaluators read portfolio and kpi facts.
export type { GateFactsProvider, KpiP3GateFacts, PortfolioGateFacts } from "./g4.ts";

/** The playbook's product gates (business approvals), in order. Not the engineering gates DG0-DG7. */
export const PRODUCT_GATES = ["G1", "G2", "G3", "G4", "G5", "G6"] as const;
export type ProductGate = (typeof PRODUCT_GATES)[number];

/** The gate whose business approval is required before a transformation may be closed (P4). */
export const CLOSURE_GATE: ProductGate = "G6";

/** Wiring hook called by the composition root (server.ts), which passes the P3 GateFactsProvider (ADR-0021 §1). */
export function registerWorkflowsModule(
  app: FastifyInstance,
  { db }: ModuleDeps,
  options: { readonly gateFacts?: GateFactsProvider } = {},
): ModuleRegistration {
  const routes = [
    ...registerDecisionRoutes(app, db),
    ...registerRegister(app, db, dependencyRegister),
    ...registerRegister(app, db, actionItemRegister),
    ...registerRegister(app, db, tomWorkshopRegister),
    ...registerWorkshopRoutes(app, db),
    ...registerCanvasRoutes(app, db),
    ...registerGateRoutes(app, db, options.gateFacts ?? UNWIRED_GATE_FACTS),
  ];
  return Object.freeze({ module: "workflows", status: "active", deliversIn: "P2", routes: Object.freeze(routes) });
}

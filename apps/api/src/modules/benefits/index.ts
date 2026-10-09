// benefits (P4; p4-plan §2 slice B, ADR-0029/0030): the T14 benefit register, allocations, measurements, Finance
// validation and totals counted once. Finance validation is a human business decision; nothing here approves by
// itself or touches DG0-DG7. Money is decimal strings with a per-row currency (S-5).
import type { FastifyInstance } from "fastify";
import type { ModuleDeps, ModuleRegistration } from "../platform/index.ts";
import { registerBenefitRoutes } from "./routes.ts";
// T-DG4-KBE-E (ADR-0030 §6): the slice A DownstreamImpactProvider (financeReview pending / not_applicable).
import { registerBenefitDownstreamProvider } from "./downstream.ts";

/**
 * Wiring hook called by the composition root (server.ts). Every route file of the module registers here (T-DG4-BE-A
 * created them as stubs; p4-plan §5.1). The module reports "scaffold" until a route exists, then "active".
 */
export function registerBenefitsModule(app: FastifyInstance, deps: ModuleDeps): ModuleRegistration {
  const routes = [...registerBenefitRoutes(app, deps)];
  registerBenefitDownstreamProvider();
  return Object.freeze({
    module: "benefits",
    status: routes.length > 0 ? "active" : "scaffold",
    deliversIn: "P4",
    routes: Object.freeze(routes),
  });
}
// P4 slice J (T-DG4-KBE-G; ADR-0037 §1): read-only benefit facts of the dashboards (slice B counting rules).
export { loadBenefitDashboardFacts, loadBenefitLineEvidence, type BenefitDashboardFacts } from "./dashboard-facts.ts";

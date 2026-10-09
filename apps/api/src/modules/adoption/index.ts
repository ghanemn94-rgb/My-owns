// adoption (P4; p4-plan §2 slice F): T13, stakeholder groups, indicators, interventions and assessments.
import type { FastifyInstance } from "fastify";
import type { ModuleDeps, ModuleRegistration } from "../platform/index.ts";
import { registerAdoptionRoutes } from "./routes.ts";
import { registerAdoptionIndicatorRoutes } from "./indicators.ts";

// P4 slice J (T-DG4-KBE-G; ADR-0037 §1): read-only adoption facts of the dashboards.
export { loadAdoptionDashboardIndicators, type AdoptionDashboardIndicator } from "./dashboard-facts.ts";

/**
 * Wiring hook called by the composition root (server.ts). Every route file of the module registers here (T-DG4-BE-A
 * created them as stubs; p4-plan §5.1). The module reports "scaffold" until a route exists, then "active".
 */
export function registerAdoptionModule(app: FastifyInstance, deps: ModuleDeps): ModuleRegistration {
  const routes = [...registerAdoptionRoutes(app, deps), ...registerAdoptionIndicatorRoutes(app, deps)];
  return Object.freeze({
    module: "adoption",
    status: routes.length > 0 ? "active" : "scaffold",
    deliversIn: "P4",
    routes: Object.freeze(routes),
  });
}

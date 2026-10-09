// reporting (ADR-0002; master prompt §16 "reporting"): report snapshots and exports through @mth/reporting, filtered
// by the same scoped policy function as every other read. P1 SCAFFOLD (D-048, T-DG1-BE3): the module, its boundary
// (modules.ts `dependsOn`), this public interface, its wiring hook and its own test suite exist from DG1, so later
// stages add code, not new boundaries. Its business behaviour (snapshots, exports, scheduled reports) lands in P5.
//
// In P1 the hook registers NO routes and produces no report or export.
import type { FastifyInstance } from "fastify";
import type { ModuleDeps, ModuleRegistration } from "../platform/index.ts";
// P4 route files (T-DG4-BE-A stubs; p4-plan §5.1): BE-M traceability, orphans, modular flags; KBE-G dashboards,
// My Work and the Executive Overview.
import { registerDashboardRoutes } from "./dashboards/index.ts";
import { registerExecutiveOverviewRoutes } from "./executive-overview.ts";
import { registerModularRoutes } from "./modular.ts";
import { registerMyWorkRoutes } from "./my-work.ts";
import { registerOrphanRoutes } from "./orphans.ts";
import { registerTraceabilityRoutes } from "./traceability.ts";

export const REPORTING_MODULE: ModuleRegistration = Object.freeze({
  module: "reporting",
  status: "scaffold",
  deliversIn: "P5",
  routes: Object.freeze([]) as readonly string[],
});

/**
 * Wiring hook called by the composition root (server.ts). P1: registers nothing and reports the scaffold. P4: the
 * route files below are stubs until BE-M and KBE-G fill them; while none registers a route the module stays the
 * route-free scaffold.
 */
export function registerReportingModule(app: FastifyInstance, deps: ModuleDeps): ModuleRegistration {
  const routes = [
    ...registerTraceabilityRoutes(app, deps),
    ...registerOrphanRoutes(app, deps),
    ...registerModularRoutes(app, deps),
    ...registerDashboardRoutes(app, deps),
    ...registerMyWorkRoutes(app, deps),
    ...registerExecutiveOverviewRoutes(app, deps),
  ];
  if (routes.length === 0) return REPORTING_MODULE;
  return Object.freeze({ module: "reporting", status: "active", deliversIn: "P4", routes: Object.freeze(routes) });
}

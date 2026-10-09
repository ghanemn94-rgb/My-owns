// raid (P4; p4-plan §2 slice E, ADR-0031): RAID (T15) on canonical records, actions and corrective-action cases.
import type { FastifyInstance } from "fastify";
import type { ModuleDeps, ModuleRegistration } from "../platform/index.ts";
import { registerRaidRoutes } from "./routes.ts";

/**
 * Wiring hook called by the composition root (server.ts). Every route file of the module registers here (T-DG4-BE-A
 * created them as stubs; p4-plan §5.1). The module reports "scaffold" until a route exists, then "active".
 */
export function registerRaidModule(app: FastifyInstance, deps: ModuleDeps): ModuleRegistration {
  const routes = [...registerRaidRoutes(app, deps)];
  return Object.freeze({
    module: "raid",
    status: routes.length > 0 ? "active" : "scaffold",
    deliversIn: "P4",
    routes: Object.freeze(routes),
  });
}

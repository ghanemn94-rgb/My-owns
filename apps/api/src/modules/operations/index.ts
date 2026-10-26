// operations (P6; p6-plan §2, §3 seam 21): operational exceptions raised by failed jobs and connector runs, and their acknowledgement (slice J).
// Created by T-DG6-BE-A with stub route files; the owning tasks fill them (p6-plan §5.1).
import type { FastifyInstance } from "fastify";
import type { ModuleDeps, ModuleRegistration } from "../platform/index.ts";
import { registerOperationsRoutes } from "./routes.ts";

/**
 * Wiring hook called by the composition root (server.ts). Every route file of the module registers here (T-DG6-BE-A
 * created them as stubs; p6-plan §5.1). The module reports "scaffold" until a route exists, then "active".
 */
export function registerOperationsModule(app: FastifyInstance, deps: ModuleDeps): ModuleRegistration {
  const routes = [...registerOperationsRoutes(app, deps)];
  return Object.freeze({
    module: "operations",
    status: routes.length > 0 ? "active" : "scaffold",
    deliversIn: "P6",
    routes: Object.freeze(routes),
  });
}

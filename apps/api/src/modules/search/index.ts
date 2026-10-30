// search (P6; p6-plan §2, §3 seam 21): the global scoped search (through access's ReadScope), its index maintenance, saved views and help topics (slice H).
// Created by T-DG6-BE-A with stub route files; the owning tasks fill them (p6-plan §5.1).
import type { FastifyInstance } from "fastify";
import type { ModuleDeps, ModuleRegistration } from "../platform/index.ts";
import { registerHelpTopicRoutes } from "./help-topics.ts";
import { registerSearchRoutes } from "./routes.ts";
import { registerSavedViewRoutes } from "./saved-views.ts";

// T-DG6-BE-U (ADR-0059 §4): the scoped search query, for the assistant's retrieval (it may import only this file).
export { SEARCH_RECORD_TYPES, searchRecords, type SearchHit } from "./query.ts";

/**
 * Wiring hook called by the composition root (server.ts). Every route file of the module registers here (T-DG6-BE-A
 * created them as stubs; p6-plan §5.1). The module reports "scaffold" until a route exists, then "active".
 */
export function registerSearchModule(app: FastifyInstance, deps: ModuleDeps): ModuleRegistration {
  const routes = [
    ...registerSearchRoutes(app, deps), // BE-P
    ...registerSavedViewRoutes(app, deps), // BE-Q
    ...registerHelpTopicRoutes(app, deps), // BE-Q
  ];
  return Object.freeze({
    module: "search",
    status: routes.length > 0 ? "active" : "scaffold",
    deliversIn: "P6",
    routes: Object.freeze(routes),
  });
}

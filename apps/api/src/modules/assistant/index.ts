// assistant (P6; p6-plan §2, §3 seam 21): the optional AI assistant: settings, the ModelProvider port, retrieval through search and ReadScope, citations and guardrails (slice D). It registers no action in any registry and imports no writing module, so it has no write path by construction (REQ-S17-008).
// Created by T-DG6-BE-A with stub route files; the owning tasks fill them (p6-plan §5.1). T-DG6-BE-T: the setting and
// conversation routes, the ModelProvider port (provider.ts) and the answer seam (answer.ts, a stub until BE-U).
import type { FastifyInstance } from "fastify";
import type { ModuleDeps, ModuleRegistration } from "../platform/index.ts";
import { registerAssistantRoutes } from "./routes.ts";

export {
  providerFor,
  setAssistantSecretProviders,
  testAdapter,
  type ModelProvider,
  type ModelRequest,
  type ModelResult,
} from "./provider.ts";

/**
 * Wiring hook called by the composition root (server.ts). Every route file of the module registers here (T-DG6-BE-A
 * created them as stubs; p6-plan §5.1). The module reports "scaffold" until a route exists, then "active".
 */
export function registerAssistantModule(app: FastifyInstance, deps: ModuleDeps): ModuleRegistration {
  const routes = [...registerAssistantRoutes(app, deps)];
  return Object.freeze({
    module: "assistant",
    status: routes.length > 0 ? "active" : "scaffold",
    deliversIn: "P6",
    routes: Object.freeze(routes),
  });
}

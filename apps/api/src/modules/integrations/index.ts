// integrations (P6; p6-plan §2, §3 seam 21): connectors, integration runs, test adapters, imports (staging, validation, commit through the ImportTargetRegistry port), webhooks and outbound writes (slices A and B). integrations imports no domain module: each domain registers its import target at composition (server.ts), the AutomationActionRegistry pattern.
// Created by T-DG6-BE-A with stub route files; the owning tasks fill them (p6-plan §5.1).
import type { FastifyInstance } from "fastify";
import type { ModuleDeps, ModuleRegistration } from "../platform/index.ts";
import { registerIntegrationRoutes } from "./routes.ts";
import { startConnectorRunWatch } from "./runs.ts";

/**
 * Wiring hook called by the composition root (server.ts). Every route file of the module registers here (T-DG6-BE-A
 * created them as stubs; p6-plan §5.1). The module reports "scaffold" until a route exists, then "active".
 */
export function registerIntegrationsModule(app: FastifyInstance, deps: ModuleDeps): ModuleRegistration {
  const routes = [...registerIntegrationRoutes(app, deps)];
  // T-DG6-BE-L2 (ADR-0055 §2): the API process executes the due connector runs every 10 s (runs.ts; the BE-K heartbeat
  // watch precedent). Not started by a route-only instance (`{} as ModuleDeps`), nor under NODE_ENV=test, where the
  // suites call `connectorRunWatchStep` themselves so no run executes behind a test's back.
  if (deps.db !== undefined && deps.config?.nodeEnv !== "test") {
    let watch: { stop(): Promise<void> } | null = null;
    app.addHook("onReady", async () => {
      watch = startConnectorRunWatch(deps.db, app.log);
    });
    app.addHook("onClose", async () => {
      await watch?.stop();
    });
  }
  return Object.freeze({
    module: "integrations",
    status: routes.length > 0 ? "active" : "scaffold",
    deliversIn: "P6",
    routes: Object.freeze(routes),
  });
}

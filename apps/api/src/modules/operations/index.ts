// operations (P6; p6-plan §2, §3 seam 21): operational exceptions raised by failed jobs and connector runs, and their acknowledgement (slice J).
// Created by T-DG6-BE-A with stub route files; the owning tasks fill them (p6-plan §5.1). T-DG6-BE-K: the exception and
// heartbeat routes, and the heartbeat watch (ADR-0053 §6), started when the server is ready and stopped when it closes.
import type { FastifyInstance } from "fastify";
import type { ModuleDeps, ModuleRegistration } from "../platform/index.ts";
import { startHeartbeatWatch } from "./heartbeat.ts";
import { registerOperationsRoutes } from "./routes.ts";

export {
  dedupKeyOf,
  raiseOperationalException,
  recoverOperationalException,
  type RaiseExceptionInput,
  type RaiseResult,
} from "./exceptions.ts";
export { heartbeatState, heartbeatWatchStep, readWorkerHeartbeat, type HeartbeatState } from "./heartbeat.ts";

/**
 * Wiring hook called by the composition root (server.ts). Every route file of the module registers here (T-DG6-BE-A
 * created them as stubs; p6-plan §5.1). The module reports "scaffold" until a route exists, then "active".
 */
export function registerOperationsModule(app: FastifyInstance, deps: ModuleDeps): ModuleRegistration {
  const routes = [...registerOperationsRoutes(app, deps)];
  // ADR-0053 §6: the API process checks the worker heartbeat every 60 s (BE-K). Not started by a route-only test
  // instance that never becomes ready (`{} as ModuleDeps`).
  if (deps.db !== undefined) {
    let watch: { stop(): Promise<void> } | null = null;
    app.addHook("onReady", async () => {
      watch = startHeartbeatWatch(deps.db, app.log);
    });
    app.addHook("onClose", async () => {
      await watch?.stop();
    });
  }
  return Object.freeze({
    module: "operations",
    status: routes.length > 0 ? "active" : "scaffold",
    deliversIn: "P6",
    routes: Object.freeze(routes),
  });
}

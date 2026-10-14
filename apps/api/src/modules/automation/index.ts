// automation (P5; p5-plan §2 slice D, §3 seam 24): rule versions, event/schedule evaluation, dry run, execution history, failure queue and service identity. Reads configuration through methodology's ConfigResolver
// port (ADR-0039 §3). Created by T-DG5-BE-A with stub route files; the owning tasks fill them (p5-plan §5.1).
import type { FastifyInstance } from "fastify";
import type { ModuleDeps, ModuleRegistration } from "../platform/index.ts";
import { registerAutomationRoutes } from "./routes.ts";
import { registerAutomationFailureRoutes } from "./failures.ts";

/**
 * Wiring hook called by the composition root (server.ts). Every route file of the module registers here (T-DG5-BE-A
 * created them as stubs; p5-plan §5.1). The module reports "scaffold" until a route exists, then "active".
 */
export function registerAutomationModule(app: FastifyInstance, deps: ModuleDeps): ModuleRegistration {
  const routes = [...registerAutomationRoutes(app, deps), ...registerAutomationFailureRoutes(app, deps)];
  return Object.freeze({
    module: "automation",
    status: routes.length > 0 ? "active" : "scaffold",
    deliversIn: "P5",
    routes: Object.freeze(routes),
  });
}

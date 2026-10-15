// health (P5; p5-plan §2 slice H, §3 seam 24): the 25-question health check, scoring schemes and assessments. Reads configuration through methodology's ConfigResolver
// port (ADR-0039 §3). Created by T-DG5-BE-A with stub route files; the owning tasks fill them (p5-plan §5.1).
import type { FastifyInstance } from "fastify";
import type { ModuleDeps, ModuleRegistration } from "../platform/index.ts";
import { registerHealthCheckRoutes } from "./routes.ts";

// T-DG5-KBE-G (ADR-0048 §6): the health_check_scheme kind provider, registered by one line in server.ts.
export { registerHealthCheckSchemeProvider } from "./provider.ts";

/**
 * Wiring hook called by the composition root (server.ts). Every route file of the module registers here (T-DG5-BE-A
 * created them as stubs; p5-plan §5.1). The module reports "scaffold" until a route exists, then "active".
 */
export function registerHealthModule(app: FastifyInstance, deps: ModuleDeps): ModuleRegistration {
  const routes = [...registerHealthCheckRoutes(app, deps)];
  return Object.freeze({
    module: "health",
    status: routes.length > 0 ? "active" : "scaffold",
    deliversIn: "P5",
    routes: Object.freeze(routes),
  });
}

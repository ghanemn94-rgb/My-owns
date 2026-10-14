// forms (P5; p5-plan §2 slice B, §3 seam 24): form schemas, field types, custom-field values, the form framework and extension record types. Reads configuration through methodology's ConfigResolver
// port (ADR-0039 §3). Created by T-DG5-BE-A with stub route files; the owning tasks fill them (p5-plan §5.1).
import type { FastifyInstance } from "fastify";
import type { ModuleDeps, ModuleRegistration } from "../platform/index.ts";
import { registerFormRoutes } from "./routes.ts";

/**
 * Wiring hook called by the composition root (server.ts). Every route file of the module registers here (T-DG5-BE-A
 * created them as stubs; p5-plan §5.1). The module reports "scaffold" until a route exists, then "active".
 */
export function registerFormsModule(app: FastifyInstance, deps: ModuleDeps): ModuleRegistration {
  const routes = [...registerFormRoutes(app, deps)];
  return Object.freeze({
    module: "forms",
    status: routes.length > 0 ? "active" : "scaffold",
    deliversIn: "P5",
    routes: Object.freeze(routes),
  });
}

// release (P7; p7-plan §2, slice I): the in-app requirement register and About, read from a build-time register
// snapshot. Created by T-DG7-BE-A with a stub route file; T-DG7-BE-H fills it after T-DG7-ARCH-05 designs it (p7-plan
// §5.1). release imports no other module except the platform plumbing and the policy function (p7-plan §2: "release
// reads a build-time register snapshot and imports nothing"), and nothing in the product runtime reads a delivery record.
import type { FastifyInstance } from "fastify";
import type { ModuleDeps, ModuleRegistration } from "../platform/index.ts";
import { registerReleaseRoutes } from "./routes.ts";
import { defaultRegisterSnapshotSource, type RegisterSnapshotSource } from "./snapshot.ts";

export type { RegisterSnapshotSource } from "./snapshot.ts";

/**
 * Wiring hook called by the composition root (server.ts). Every route file of the module registers here (T-DG7-BE-A
 * created it as a stub; p7-plan §5.1). The module reports "scaffold" until a route exists, then "active".
 */
export function registerReleaseModule(
  app: FastifyInstance,
  deps: ModuleDeps,
  source: RegisterSnapshotSource = defaultRegisterSnapshotSource(),
): ModuleRegistration {
  const routes = [...registerReleaseRoutes(app, deps, source)]; // T-DG7-BE-H: the register snapshot source passes through
  return Object.freeze({
    module: "release",
    status: routes.length > 0 ? "active" : "scaffold",
    deliversIn: "P7",
    routes: Object.freeze(routes),
  });
}

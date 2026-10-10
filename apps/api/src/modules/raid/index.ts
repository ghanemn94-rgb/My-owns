// raid (P4; p4-plan §2 slice E, ADR-0031): RAID (T15) on canonical records, actions and corrective-action cases.
// Public interface: registerRaidModule (the wiring hook), the RaidDependencyPort type (implemented by workflows'
// T08 service, passed in by server.ts; ADR-0031 §2), createLinkedAction (an action linked to a RAID source) and
// insertActionItem (the one action insert; T-DG4-BE-R3, ADR-0032 amendment G1).
import type { FastifyInstance } from "fastify";
import type { ModuleDeps, ModuleRegistration } from "../platform/index.ts";
import type { RaidDependencyPort } from "./dependency-port.ts";
import { registerRaidRoutes } from "./routes.ts";

export type { RaidDependencyChanges, RaidDependencyCreate, RaidDependencyPort } from "./dependency-port.ts";
// T-DG4-BE-R3 (ADR-0032 amendment G1): the one action insert, also used by governance's meeting actions.
export {
  createLinkedAction,
  insertActionItem,
  type ActionInsertContext,
  type ActionItemInsert,
  type ActionLink,
} from "./actions.ts";

/** The ports the composition root passes in (raid never imports workflows; ADR-0023 §8 pattern). */
export interface RaidModulePorts {
  /** Writes of RAID Dependency entries on the canonical T08 row; unwired, such a write fails closed (500). */
  readonly dependencies?: RaidDependencyPort;
}

/**
 * Wiring hook called by the composition root (server.ts). Every route file of the module registers here (T-DG4-BE-A
 * created them as stubs; p4-plan §5.1). The module reports "scaffold" until a route exists, then "active".
 */
export function registerRaidModule(
  app: FastifyInstance,
  deps: ModuleDeps,
  ports: RaidModulePorts = {},
): ModuleRegistration {
  const routes = [...registerRaidRoutes(app, deps, ports.dependencies)];
  return Object.freeze({
    module: "raid",
    status: routes.length > 0 ? "active" : "scaffold",
    deliversIn: "P4",
    routes: Object.freeze(routes),
  });
}

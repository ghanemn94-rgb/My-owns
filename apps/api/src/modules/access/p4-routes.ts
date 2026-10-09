// P4 access route registration (T-DG4-BE-A; p4-plan §5.1, p4-work-split §I+C.1): the BE-B route files for groups,
// role mappings and delegations (ADR-0026 §1-§3), created as stubs. Called once by server.ts; BE-B edits only the
// three route files.
import type { FastifyInstance } from "fastify";
import type { ModuleDeps } from "../platform/index.ts";
import { registerDelegationRoutes } from "./delegations.ts";
import { registerGroupRoutes } from "./groups.ts";
import { registerRoleMappingRoutes } from "./role-mappings.ts";

/** Registers the P4 access routes and returns them as "METHOD /path". */
export function registerAccessP4Routes(app: FastifyInstance, deps: ModuleDeps): string[] {
  return [
    ...registerGroupRoutes(app, deps),
    ...registerRoleMappingRoutes(app, deps),
    ...registerDelegationRoutes(app, deps),
  ];
}

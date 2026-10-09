// raid route registration (P4; p4-plan §5.1, p4-work-split §E.1-§E.2): BE-D's lines first (the T15 register, the
// integrated RAID + decision log, RAID-linked actions and the action register), then BE-D2's (corrective-action cases
// and rules), sequential edits, never concurrent. T-DG4-BE-A created this file as a stub.
import type { FastifyInstance } from "fastify";
import type { ModuleDeps } from "../platform/index.ts";
import { registerRaidActionRoutes } from "./actions.ts";
import { registerCorrectiveCaseRoutes } from "./corrective-cases.ts";
import { registerCorrectiveRuleRoutes } from "./corrective-rules.ts";
import type { RaidDependencyPort } from "./dependency-port.ts";
import { registerRaidRegisterRoutes } from "./register.ts";

/** Registers this module's routes and returns them as "METHOD /path". */
export function registerRaidRoutes(
  app: FastifyInstance,
  deps: ModuleDeps,
  dependencies?: RaidDependencyPort,
): string[] {
  return [
    // BE-D (T-DG4-BE-D): register, decision log, actions.
    ...registerRaidRegisterRoutes(app, deps, dependencies),
    ...registerRaidActionRoutes(app, deps),
    // BE-D2 (T-DG4-BE-D2): corrective-action cases, their signals and actions, and the severity and persistence rules.
    ...registerCorrectiveCaseRoutes(app, deps),
    ...registerCorrectiveRuleRoutes(app, deps),
  ];
}

// governance (P4; p4-plan §2, ADR-0026 §5, §7, §9; slices C and D): T11 decision rights and routeByDecisionRight,
// T12 RACI, governance matrices, forums, meetings, the T16 executive decision log and escalations. The only new P4
// module that imports workflows (decision rows, the approval service); workflows never imports it. Business approvals
// requested here are human decisions recorded through the approval service; nothing here touches DG0-DG7.
import type { FastifyInstance } from "fastify";
import type { ModuleDeps, ModuleRegistration } from "../platform/index.ts";
import { registerDecisionRightRoutes } from "./decision-rights.ts";
import { registerRaciRoutes } from "./raci.ts";
import { registerGovernanceMatrixRoutes } from "./matrices.ts";
import { registerForumRoutes } from "./forums.ts";
import { registerMeetingSeriesRoutes } from "./meeting-series.ts";
import { registerMeetingRoutes } from "./meetings.ts";
import { registerAgendaRoutes } from "./agenda.ts";
import { registerMinutesRoutes } from "./minutes.ts";
import { registerExecutiveDecisionRoutes } from "./executive-decisions.ts";
import { registerEscalationRoutes } from "./escalations.ts";

/**
 * Wiring hook called by the composition root (server.ts). Every route file of the module registers here (T-DG4-BE-A
 * created them as stubs; p4-plan §5.1). The module reports "scaffold" until a route exists, then "active".
 */
export function registerGovernanceModule(app: FastifyInstance, deps: ModuleDeps): ModuleRegistration {
  const routes = [
    ...registerDecisionRightRoutes(app, deps),
    ...registerRaciRoutes(app, deps),
    ...registerGovernanceMatrixRoutes(app, deps),
    ...registerForumRoutes(app, deps),
    ...registerMeetingSeriesRoutes(app, deps),
    ...registerMeetingRoutes(app, deps),
    ...registerAgendaRoutes(app, deps),
    ...registerMinutesRoutes(app, deps),
    ...registerExecutiveDecisionRoutes(app, deps),
    ...registerEscalationRoutes(app, deps),
  ];
  return Object.freeze({
    module: "governance",
    status: routes.length > 0 ? "active" : "scaffold",
    deliversIn: "P4",
    routes: Object.freeze(routes),
  });
}

// sustainment (P4; p4-plan §2 slice G): BAU handover, performance areas, controls, continuous improvement, lessons,
// the status model and the governed closure. Product gate G6 never implies the engineering gate DG7.
import type { FastifyInstance } from "fastify";
import type { ModuleDeps, ModuleRegistration } from "../platform/index.ts";
import { registerPerformanceAreaRoutes } from "./performance-areas.ts";
import { registerHandoverRoutes } from "./handovers.ts";
import { registerControlRoutes } from "./controls.ts";
import { registerImprovementRoutes } from "./improvement.ts";
import { registerLessonRoutes } from "./lessons.ts";
import { registerStatusModelRoutes } from "./status-model.ts";
import { registerTransitionDecisionRoutes } from "./transition-decisions.ts";
import { registerClosureRoutes } from "./closure.ts";

// T-DG4-BE-J (D-107, orchestrator wiring): the transition-decision approval port, set by the composition root because
// sustainment may not import workflows, and the status-model reads consumed by slice J and BE-K.
export { wireTransitionDecisionApprovals } from "./transition-decisions.ts";
export { valueStatusOf, initiativeStatusModel, transformationStatusModel, bauStateOf } from "./status-model.ts";

/**
 * Wiring hook called by the composition root (server.ts). Every route file of the module registers here (T-DG4-BE-A
 * created them as stubs; p4-plan §5.1). The module reports "scaffold" until a route exists, then "active".
 */
export function registerSustainmentModule(app: FastifyInstance, deps: ModuleDeps): ModuleRegistration {
  const routes = [
    ...registerPerformanceAreaRoutes(app, deps),
    ...registerHandoverRoutes(app, deps),
    ...registerControlRoutes(app, deps),
    ...registerImprovementRoutes(app, deps),
    ...registerLessonRoutes(app, deps),
    ...registerStatusModelRoutes(app, deps),
    ...registerTransitionDecisionRoutes(app, deps),
    ...registerClosureRoutes(app, deps),
  ];
  return Object.freeze({
    module: "sustainment",
    status: routes.length > 0 ? "active" : "scaffold",
    deliversIn: "P4",
    routes: Object.freeze(routes),
  });
}

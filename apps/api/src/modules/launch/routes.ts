// The 90-day launch plan routes (P5 slice H; ADR-0048 §1-§3, §7-§9; p5-work-split §H.1; T-DG5-BE-P fills BE-A's stub).
// BE-P2 appends the Day-90 test's registration lines after these (p5-work-split §H.2).
import type { FastifyInstance } from "fastify";
import type { ModuleDeps } from "../platform/index.ts";
import { registerLaunchPlanRoutes } from "./plan.ts";
import { registerLaunchPredecessorRoutes } from "./predecessors.ts";
import { registerLaunchTaskRoutes } from "./tasks.ts";
import { registerLaunchTemplateRoutes } from "./template.ts";

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerLaunchRoutes(app: FastifyInstance, deps: ModuleDeps): string[] {
  return [
    ...registerLaunchTemplateRoutes(app, deps),
    ...registerLaunchPlanRoutes(app, deps),
    ...registerLaunchTaskRoutes(app, deps),
    ...registerLaunchPredecessorRoutes(app, deps),
  ];
}

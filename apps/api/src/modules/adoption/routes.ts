// adoption route registration (P4; p4-plan §5.1, p4-work-split §F+G FG.1-FG.2): BE-H's lines first (the T13 register,
// champions, involvement, champion constraints and interventions), then BE-H2's (forms, invitations, assessment and
// training records), sequential edits, never concurrent. T-DG4-BE-A created this file as a stub; indicators.ts is
// KBE-F's and registers through its own line in index.ts.
import type { FastifyInstance } from "fastify";
import type { ModuleDeps } from "../platform/index.ts";
import { registerAdoptionInterventionRoutes } from "./interventions.ts";
import { registerAdoptionRegisterRoutes } from "./register.ts";
import { registerAssessmentRoutes } from "./assessments.ts";
import { registerTrainingRoutes } from "./training.ts";

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerAdoptionRoutes(app: FastifyInstance, deps: ModuleDeps): string[] {
  return [
    // BE-H (T-DG4-BE-H): T13 stakeholder groups, the adoption plan, champions, involvement, champion constraints.
    ...registerAdoptionRegisterRoutes(app, deps),
    // BE-H (T-DG4-BE-H): adoption interventions and their My Work items.
    ...registerAdoptionInterventionRoutes(app, deps),
    // BE-H2 (T-DG4-BE-H2): feedback and assessment forms, invitations, assessment records.
    ...registerAssessmentRoutes(app, deps),
    // BE-H2 (T-DG4-BE-H2): training attendance records (completion is attendance, never adoption).
    ...registerTrainingRoutes(app, deps),
  ];
}

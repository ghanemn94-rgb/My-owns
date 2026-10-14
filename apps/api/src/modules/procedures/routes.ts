// Route registration of the procedures module (P5 slice C; p5-work-split §C.1-§C.3). T-DG5-BE-F fills the definition
// routes and registers the `procedure` kind provider; BE-F2 (instances, steps, my procedures) and then BE-G (the
// coverage view) add their own lines below, sequentially (§C.4).
import type { FastifyInstance } from "fastify";
import type { ModuleDeps } from "../platform/index.ts";
import { registerMethodologyCoverageRoutes } from "./coverage.ts";
import { registerProcedureDefinitionRoutes } from "./definitions.ts";
import { registerProcedureInstanceRoutes } from "./instances.ts";
import { registerProcedureOutputAdapters } from "./outputs/index.ts";
import { registerMyProcedureStepRoutes } from "./my-steps.ts";
import { registerProceduresKindProvider } from "./provider.ts";
import { registerProcedureStepRoutes } from "./steps.ts";

/** Registers the procedures routes and returns them as "METHOD /path". */
export function registerProcedureRoutes(app: FastifyInstance, deps: ModuleDeps): string[] {
  // The `procedure` kind's provider hooks into methodology's registry (ADR-0042 §1; T-DG5-BE-F).
  registerProceduresKindProvider();
  // The output adapters of ADR-0042 §3, one per output record type (T-DG5-BE-G; procedures/outputs/**).
  registerProcedureOutputAdapters();
  return [
    ...registerProcedureDefinitionRoutes(app, deps), // T-DG5-BE-F: list/validate/get/put/remove procedure definitions
    ...registerProcedureInstanceRoutes(app, deps), // T-DG5-BE-F2: list/launch/get instances, inputs, cancel
    ...registerProcedureStepRoutes(app, deps), // T-DG5-BE-F2: complete/skip/assign/evidence of a step
    ...registerMyProcedureStepRoutes(app, deps), // T-DG5-BE-F2: my procedures
    ...registerMethodologyCoverageRoutes(app, deps), // T-DG5-BE-G: the methodology coverage view
  ];
}

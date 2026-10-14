// Route registration of the procedures module (P5 slice C; p5-work-split §C.1-§C.3). T-DG5-BE-F fills the definition
// routes and registers the `procedure` kind provider; BE-F2 (instances, steps, my procedures) and then BE-G (the
// coverage view) add their own lines below, sequentially (§C.4).
import type { FastifyInstance } from "fastify";
import type { ModuleDeps } from "../platform/index.ts";
import { registerProcedureDefinitionRoutes } from "./definitions.ts";
import { registerProceduresKindProvider } from "./provider.ts";

/** Registers the procedures routes and returns them as "METHOD /path". */
export function registerProcedureRoutes(app: FastifyInstance, deps: ModuleDeps): string[] {
  // The `procedure` kind's provider hooks into methodology's registry (ADR-0042 §1; T-DG5-BE-F).
  registerProceduresKindProvider();
  return [
    ...registerProcedureDefinitionRoutes(app, deps), // T-DG5-BE-F: list/validate/get/put/remove procedure definitions
    // BE-F2 (instances.ts, steps.ts, my-steps.ts) registers here.
    // BE-G (coverage.ts) registers here.
  ];
}

// reporting (ADR-0002; master prompt §16 "reporting"): report snapshots and exports through @mth/reporting, filtered
// by the same scoped policy function as every other read. P1 SCAFFOLD (D-048, T-DG1-BE3): the module, its boundary
// (modules.ts `dependsOn`), this public interface, its wiring hook and its own test suite exist from DG1, so later
// stages add code, not new boundaries. Its business behaviour (snapshots, exports, scheduled reports) lands in P5.
//
// In P1 the hook registers NO routes and produces no report or export.
import type { FastifyInstance } from "fastify";
import type { ModuleDeps, ModuleRegistration } from "../platform/index.ts";

export const REPORTING_MODULE: ModuleRegistration = Object.freeze({
  module: "reporting",
  status: "scaffold",
  deliversIn: "P5",
  routes: Object.freeze([]) as readonly string[],
});

/** Wiring hook called by the composition root (server.ts). P1: registers nothing and reports the scaffold. */
export function registerReportingModule(_app: FastifyInstance, _deps: ModuleDeps): ModuleRegistration {
  return REPORTING_MODULE;
}

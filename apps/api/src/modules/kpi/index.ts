// kpi (ADR-0002; master prompt §16 "formulas"): KPI, benefit and formula calculations through @mth/calc, with decimal
// arithmetic for money and rates. P1 SCAFFOLD (D-048, T-DG1-BE3): the module, its boundary (modules.ts `dependsOn`),
// this public interface, its wiring hook and its own test suite exist from DG1, so later stages add code, not new
// boundaries. Its business behaviour (versioned formulas, KPI values, benefit tracking and Finance validation as a
// human action) lands in P4.
//
// In P1 the hook registers NO routes, and no value is computed: there is nothing here that could show a missing or
// stale figure as zero or green. When values arrive, a missing value is "unknown" and an outdated one "stale".
import type { FastifyInstance } from "fastify";
import type { ModuleDeps, ModuleRegistration } from "../platform/index.ts";

/** Freshness of a KPI or benefit value. Missing data is "unknown" and outdated data "stale", never zero or green. */
export const VALUE_FRESHNESS = ["unknown", "stale", "current"] as const;
export type ValueFreshness = (typeof VALUE_FRESHNESS)[number];

export const KPI_MODULE: ModuleRegistration = Object.freeze({
  module: "kpi",
  status: "scaffold",
  deliversIn: "P4",
  routes: Object.freeze([]) as readonly string[],
});

/** Wiring hook called by the composition root (server.ts). P1: registers nothing and reports the scaffold. */
export function registerKpiModule(_app: FastifyInstance, _deps: ModuleDeps): ModuleRegistration {
  return KPI_MODULE;
}

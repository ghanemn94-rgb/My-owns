// kpi (ADR-0002; master prompt §16 "formulas/KPI"): KPI definitions, baselines, T02 outcome KPIs and value pools (P2),
// with decimal arithmetic for every amount and KPI value (@mth/shared value.ts; never a float). Later stages add
// versioned formulas, KPI actuals and the benefit register (P4) through this same boundary.
//
// Missing data is Unknown (NULL), never zero; an outdated validation is stale, never "validated"; an unquantified
// value pool is never 0. Finance validation and trajectory approval are human actions by FIN and SP/BO - this module
// records them; it never grants a business approval by itself.
//
// Public interface:
//  - registerKpiModule: wiring hook called by the composition root (server.ts);
//  - loadKpiGateFacts / KpiGateFacts: facts for the product-gate G1/G2 criteria (workflows module, p2-work-split §3).
import type { FastifyInstance } from "fastify";
import type { ModuleDeps, ModuleRegistration } from "../platform/index.ts";
import { registerKpiRoutes } from "./routes.ts";

export { loadKpiGateFacts, type KpiGateFacts } from "./gate-facts.ts";
// P3 business cases (T-DG3-KBE-B): section completeness, baseline validation state (incl. Stale) and totals, for
// KBE-C's G4 fact loader.
export {
  baselineSha256,
  baselineValidationState,
  includedCaseIds,
  loadCaseTotals,
  missingSections,
  presentCases,
} from "./business-cases.ts";
export { activeLinesOf, toBusinessCaseLine } from "./business-case-lines.ts";
export { computeTotals, type TotalsInput, type TotalsLine } from "./totals.ts";

/** Freshness of a KPI or benefit value. Missing data is "unknown" and outdated data "stale", never zero or green. */
export const VALUE_FRESHNESS = ["unknown", "stale", "current"] as const;
export type ValueFreshness = (typeof VALUE_FRESHNESS)[number];

/** Wiring hook called by the composition root (server.ts). P2: registers the 24 kpi operations. */
export function registerKpiModule(app: FastifyInstance, deps: ModuleDeps): ModuleRegistration {
  const routes = registerKpiRoutes(app, deps);
  return Object.freeze({ module: "kpi", status: "active", deliversIn: "P2", routes: Object.freeze([...routes]) });
}

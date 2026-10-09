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
import { KPI_VERSION_APPROVAL_TYPE, KPI_VERSION_SUBJECT_PROVIDER, type KpiApprovalPort } from "./kpi-versions.ts";
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
// P3 T09 benefit formulas (T-DG3-KBE-C): the kpi half of the G4 GateFactsProvider (business cases, section
// completeness, baseline validation incl. Stale, formula version validation per financial benefit line). server.ts
// wires it (BE-E).
export {
  buildKpiP3GateFacts,
  loadKpiP3GateFacts,
  type FormulaValidationFact,
  type KpiBenefitLineFact,
  type KpiCaseFact,
  type KpiP3GateFactsData,
} from "./p3-gate-facts.ts";

/** Freshness of a KPI or benefit value. Missing data is "unknown" and outdated data "stale", never zero or green. */
export const VALUE_FRESHNESS = ["unknown", "stale", "current"] as const;
export type ValueFreshness = (typeof VALUE_FRESHNESS)[number];

// P4 (T-DG4-KBE-C, D-095): the approval-service port the composition root passes in (kpi cannot import workflows).
export type { KpiApprovalPort, KpiApprovalRequestInput, KpiApprovalSubjectProvider } from "./kpi-versions.ts";
// P4 (T-DG4-KBE-C; ADR-0027 §6): the seam through which slice B (KBE-E) reports the benefit impact of a KPI value and
// whether a Finance review follows; until it registers, a submission's financeReview is "unknown".
export {
  registerDownstreamImpactProvider,
  type DownstreamImpact,
  type DownstreamImpactProvider,
  type FinanceReview,
} from "./downstream.ts";

/**
 * Wiring hook called by the composition root (server.ts). P2: registers the 24 kpi operations; P4 adds slice A. The
 * composition root passes workflows' approval service as `approvals` (T-DG4-KBE-C): the hook registers the
 * kpi_version_activation subject provider with it, and requestKpiVersionApproval requests through it. Without it,
 * that one operation fails closed (500).
 */
export function registerKpiModule(
  app: FastifyInstance,
  deps: ModuleDeps,
  options: { readonly approvals?: KpiApprovalPort } = {},
): ModuleRegistration {
  const approvals = options.approvals ?? null;
  if (approvals !== null) approvals.registerSubject(KPI_VERSION_APPROVAL_TYPE, KPI_VERSION_SUBJECT_PROVIDER);
  const routes = registerKpiRoutes(app, deps, approvals);
  return Object.freeze({ module: "kpi", status: "active", deliversIn: "P2", routes: Object.freeze([...routes]) });
}

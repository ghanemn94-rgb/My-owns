// portfolio (ADR-0002, ADR-0021 §1; master prompt §16 entity group, P3 "Mobilization and portfolio"): initiatives (T05)
// and their links, waves, deliverables, milestones, prioritization (ADR-0022), capacity and resource demand, selection
// and funding (ADR-0023), the readiness view, the outcome hierarchy and gate dispensations (ADR-0021 §4-§9).
//
// Selection, funding, weight-set approval, ranking overrides and dispensation decisions are BUSINESS approvals inside
// the product, recorded as a named person's decision; nothing here approves by itself, and nothing touches the
// engineering delivery gates DG0-DG7 (product gate G4 never implies a DG gate).
//
// Module graph: portfolio depends on transformations, kpi, evidence, access, audit, platform and workflows. workflows
// never imports portfolio; it reads portfolio facts through its GateFactsProvider, wired by server.ts with
// loadPortfolioGateFacts (no cycle).
//
// Public interface:
//  - registerPortfolioModule: wiring hook called by the composition root (server.ts);
//  - loadPortfolioGateFacts: the portfolio part of workflows' GateFactsProvider (BE-E);
//  - loadInheritedApprovalFacts: the provider's inherited-approval loader for the gate annotation (F-DG3-120);
//  - the sequencing rules and their fact loader (initiative transitions, web), latestFundingState (BE-E).
import type { FastifyInstance } from "fastify";
import type { ModuleDeps, ModuleRegistration } from "../platform/index.ts";
import { registerCapacityRoutes } from "./capacity.ts";
import { registerDeliverableRoutes } from "./deliverables.ts";
import { registerDispensationRoutes } from "./dispensations.ts";
import { registerFundingRoutes } from "./funding.ts";
import { registerHierarchyRoutes } from "./hierarchy.ts";
import { registerInitiativeRoutes } from "./initiatives.ts";
import { registerInitiativeLinkRoutes } from "./links.ts";
import { registerMilestoneRoutes } from "./milestones.ts";
import { registerOverrideRoutes } from "./overrides.ts";
import { registerPrioritizationRoutes } from "./prioritization.ts";
import { registerRankingRoutes } from "./rankings.ts";
import { registerReadinessRoutes } from "./readiness.ts";
import { registerResourceDemandRoutes } from "./resource-demands.ts";
import { registerRoadmapRoutes } from "./roadmap.ts";
import { registerScoreRoutes } from "./scores.ts";
import { registerSelectionRoutes } from "./selections.ts";
import { registerInitiativeTransitionRoutes } from "./transitions.ts";
import { registerWaveRoutes } from "./waves.ts";
// P4 route files (T-DG4-BE-A stubs; p4-plan §5.1 BE-E).
import { registerBudgetRoutes } from "./budget.ts";
import { registerScheduleNetworkRoutes } from "./schedule-network.ts";

export { loadPortfolioGateFacts } from "./gate-facts.ts";
// The gate annotation's inherited approvals (ADR-0021 §5; F-DG3-120): the third member of the GateFactsProvider.
export { loadInheritedApprovalFacts } from "./dispensations.ts";
export { t08ScheduleFlags } from "./roadmap.ts";
export { latestFundingState } from "./funding.ts";
export { loadDispensations, loadSequencingFacts } from "./dispensations.ts";
export {
  checkDirectionForLaunch,
  checkG1,
  checkLaunch,
  checkSubmit,
  SEQUENCING_REASONS,
  sequencingState,
  type SequencingFacts,
  type SequencingResult,
} from "./sequencing.ts";

/** Wiring hook called by the composition root (server.ts). Every portfolio route file registers here. */
export function registerPortfolioModule(app: FastifyInstance, deps: ModuleDeps): ModuleRegistration {
  const routes = [
    // BE-A: readiness, outcome hierarchy, gate dispensations.
    ...registerReadinessRoutes(app, deps),
    ...registerHierarchyRoutes(app, deps),
    ...registerDispensationRoutes(app, deps),
    // BE-B: initiatives, links, lifecycle, selection.
    ...registerInitiativeRoutes(app, deps),
    ...registerInitiativeLinkRoutes(app, deps),
    ...registerInitiativeTransitionRoutes(app, deps),
    ...registerSelectionRoutes(app, deps),
    // BE-C: waves, deliverables, milestones, roadmap.
    ...registerWaveRoutes(app, deps),
    ...registerDeliverableRoutes(app, deps),
    ...registerMilestoneRoutes(app, deps),
    ...registerRoadmapRoutes(app, deps),
    // BE-D: prioritization.
    ...registerPrioritizationRoutes(app, deps),
    ...registerScoreRoutes(app, deps),
    ...registerRankingRoutes(app, deps),
    ...registerOverrideRoutes(app, deps),
    // BE-E: capacity, resource demand, funding.
    ...registerCapacityRoutes(app, deps),
    ...registerResourceDemandRoutes(app, deps),
    ...registerFundingRoutes(app, deps),
    // P4 BE-E: budget lines, schedule network and critical path.
    ...registerBudgetRoutes(app, deps),
    ...registerScheduleNetworkRoutes(app, deps),
  ];
  return Object.freeze({ module: "portfolio", status: "active", deliversIn: "P3", routes: Object.freeze(routes) });
}

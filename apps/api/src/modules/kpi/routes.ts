// kpi module route registration (P2): kpi-definitions (+ activate), baselines (+ validation), outcome-kpis
// (+ trajectory-approval) and value-pools (+ validation) - the 24 kpi operations of docs/api/openapi.yaml. Every route declares its access in
// `config.access` (the platform refuses to start otherwise) and its handler calls the policy function.
import type { Permission } from "@mth/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ModuleDeps } from "../platform/index.ts";
import { registerBaselineRoutes } from "./baselines.ts";
import { registerBusinessCaseLineRoutes } from "./business-case-lines.ts";
import { registerBenefitFormulaRoutes } from "./benefit-formulas.ts";
import { registerBusinessCaseRoutes } from "./business-cases.ts";
import { registerCalculationRoutes } from "./calculations.ts";
import { registerFormulaVersionRoutes } from "./formula-versions.ts";
import { registerKpiDefinitionRoutes } from "./kpi-definitions.ts";
import { registerOutcomeKpiRoutes } from "./outcome-kpis.ts";
import { registerValuePoolRoutes } from "./value-pools.ts";
// P4 route files (T-DG4-BE-A stubs; p4-plan §5.1): KBE-B's, then KBE-C's.
import { registerAcceptPipelineRoutes } from "./accept-pipeline.ts";
import { registerKpiActualRoutes } from "./actuals.ts";
import { registerCalculationRunRoutes } from "./calculation-runs.ts";
import { registerDataQualityRoutes } from "./data-quality.ts";
import { registerKpiFormulaRoutes } from "./kpi-formulas.ts";
import { registerKpiStatusRoutes } from "./kpi-status.ts";
import { registerKpiVersionRoutes } from "./kpi-versions.ts";
import { registerRagOverrideRoutes } from "./rag-overrides.ts";
import { registerReportingPeriodRoutes } from "./reporting-periods.ts";
import { registerTrajectoryRoutes } from "./trajectories.ts";

export type RouteAdder = (
  app: FastifyInstance,
  method: "GET" | "POST" | "PATCH",
  url: string,
  permission: Permission,
  handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>,
) => void;

/** Registers every kpi route and returns them as "METHOD /path" (Fastify path syntax). */
export function registerKpiRoutes(app: FastifyInstance, deps: ModuleDeps): readonly string[] {
  const routes: string[] = [];
  const add: RouteAdder = (instance, method, url, permission, handler) => {
    instance.route({ method, url, config: { access: { permission } }, handler });
    routes.push(`${method} ${url}`);
  };
  registerKpiDefinitionRoutes(app, deps, add);
  registerBaselineRoutes(app, deps, add);
  registerOutcomeKpiRoutes(app, deps, add);
  registerValuePoolRoutes(app, deps, add);
  // P3 business cases and lines (T-DG3-KBE-B; ADR-0024 §1-§5): 11 operations, each with its own config.consumes.
  routes.push(...registerBusinessCaseRoutes(app, deps), ...registerBusinessCaseLineRoutes(app, deps));
  // P3 T09 benefit formulas, versions, calculations and Finance validation (T-DG3-KBE-C; ADR-0024 §5-§6): 13 operations.
  // The check route (POST /benefit-formulas/validate) is registered before the item routes it could shadow.
  routes.push(
    ...registerCalculationRoutes(app, deps),
    ...registerBenefitFormulaRoutes(app, deps),
    ...registerFormulaVersionRoutes(app, deps),
  );
  // P4 KBE-B: KPI versions, trajectories, data quality, KPI formulas.
  routes.push(
    ...registerKpiVersionRoutes(app, deps),
    ...registerTrajectoryRoutes(app, deps),
    ...registerDataQualityRoutes(app, deps),
    ...registerKpiFormulaRoutes(app, deps),
  );
  // P4 KBE-C: actuals, reporting periods, the accept pipeline, calculation runs, RAG overrides, KPI status.
  routes.push(
    ...registerKpiActualRoutes(app, deps),
    ...registerReportingPeriodRoutes(app, deps),
    ...registerAcceptPipelineRoutes(app, deps),
    ...registerCalculationRunRoutes(app, deps),
    ...registerRagOverrideRoutes(app, deps),
    ...registerKpiStatusRoutes(app, deps),
  );
  return routes;
}

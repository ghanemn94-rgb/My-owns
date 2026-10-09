// P4 slice J dashboards (T-DG4-KBE-G; ADR-0037; p4-work-split §J+K JK.4): the transformation and workstream dashboards,
// the drill-down and the dashboard RAG policy. The Executive Overview is registered by ../executive-overview.ts; the
// Finance and adoption dashboards (KBE-G2) add their registration lines here after this task. Read models only: the
// one write is the RAG policy.
import type { FastifyInstance } from "fastify";
import type { ModuleDeps } from "../../platform/index.ts";
import { registerDrilldownRoutes } from "./drilldown.ts";
import { registerRagPolicyRoutes } from "./rag-policy.ts";
import { registerTransformationDashboardRoutes } from "./transformation.ts";
import { registerWorkstreamDashboardRoutes } from "./workstream.ts";

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerDashboardRoutes(app: FastifyInstance, deps: ModuleDeps): string[] {
  return [
    ...registerTransformationDashboardRoutes(app, deps),
    ...registerWorkstreamDashboardRoutes(app, deps),
    ...registerDrilldownRoutes(app, deps),
    ...registerRagPolicyRoutes(app, deps),
  ];
}

// kpi module route registration (P2): kpi-definitions, baselines (+ validation), outcome-kpis (+ trajectory-approval)
// and value-pools (+ validation) - the 23 kpi operations of docs/api/openapi.yaml. Every route declares its access in
// `config.access` (the platform refuses to start otherwise) and its handler calls the policy function.
import type { Permission } from "@mth/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ModuleDeps } from "../platform/index.ts";
import { registerBaselineRoutes } from "./baselines.ts";
import { registerKpiDefinitionRoutes } from "./kpi-definitions.ts";
import { registerOutcomeKpiRoutes } from "./outcome-kpis.ts";
import { registerValuePoolRoutes } from "./value-pools.ts";

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
  return routes;
}

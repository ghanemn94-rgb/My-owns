// The workstream dashboard (ADR-0037 §2; ADR-0038 §9; REQ-S13-001 "workstream", REQ-S13-002):
//   GET /transformations/{t}/workstreams/{w}/dashboard[?ownerUserId=&periodId=]   transformation.read
// Scope: the active initiatives of one workstream. Outcomes = the outcomes those initiatives contribute to, Value = the
// benefits allocated to them (each counted once), Portfolio = those initiatives, Dependencies = dependencies to or
// from them. Decisions and People & adoption are transformation-level: not_applicable with rule key
// dashboard.rag.workstream_not_applicable. A workstream outside the readable transformation is 404; an archived one
// 422 dashboard.workstream_archived (exact ADR-0037 §13 text). A read model: nothing stored.
import type { WorkstreamDashboard } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { principalOf } from "../../access/index.ts";
import { parse, parseQuery, problems, type ModuleDeps } from "../../platform/index.ts";
import { loadWorkstreamFacts } from "../../portfolio/index.ts";
import {
  computeAreas,
  factsOfWorkstream,
  loadAreaDefinitions,
  loadDashboardContext,
  presentAreas,
  readOnly,
} from "./engine.ts";
import { appliedFilters, dashboardRefusal, resolveFilters, transformationFilterQuery } from "./filters.ts";
import { readableTransformation } from "./scope.ts";

export const WORKSTREAM_DASHBOARD = "/api/v1/transformations/:transformationId/workstreams/:workstreamId/dashboard";
const wsParams = z.strictObject({ transformationId: z.uuid(), workstreamId: z.uuid() });

export function registerWorkstreamDashboardRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  app.get(
    WORKSTREAM_DASHBOARD,
    { config: { access: { permission: "transformation.read" } } },
    async (request): Promise<WorkstreamDashboard> => {
      const { transformationId, workstreamId } = parse(wsParams, request.params, "params");
      const query = parseQuery(transformationFilterQuery, request.query);
      return readOnly(db, async (tx) => {
        const t = await readableTransformation(tx, principalOf(request), transformationId);
        const ws = await loadWorkstreamFacts(tx, t.id, workstreamId);
        if (!ws) throw problems.notFound();
        if (ws.status === "archived") throw dashboardRefusal("dashboard.workstream_archived", "");
        const filters = await resolveFilters(tx, {
          organizationId: t.organizationId,
          transformationIds: [t.id],
          ownerUserId: query.ownerUserId,
          periodId: query.periodId,
        });
        const ctx = await loadDashboardContext(tx, [t], filters);
        const narrowed = { ...ctx, facts: factsOfWorkstream(ctx.facts, ws.initiativeIds) };
        const areas = presentAreas(
          narrowed,
          computeAreas(narrowed.facts, ctx.clock, ctx.policy),
          await loadAreaDefinitions(tx),
          { drillTransformationIds: [t.id], workstream: true },
        );
        return {
          workstreamId: ws.workstreamId,
          transformationId: t.id,
          code: ws.code,
          name: ws.name,
          generatedAt: ctx.generatedAt,
          businessDate: filters.businessDate,
          appliedFilters: appliedFilters(filters),
          areas,
        };
      });
    },
  );
  return [`GET ${WORKSTREAM_DASHBOARD}`];
}

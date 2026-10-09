// The Template 10 Executive Transformation Dashboard of one transformation (ADR-0037 §2-§5; REQ-PB-062, REQ-PB-063,
// REQ-PB-064, REQ-S13-001 "transformation", REQ-S13-002):
//   GET /transformations/{t}/dashboard[?ownerUserId=&periodId=]   transformation.read; 404 outside the scope
// The six areas, each with its own status rule, headlines that drill to their contributing records, and items. A read
// model: computed in the request, nothing stored.
import type { TransformationDashboard } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { principalOf } from "../../access/index.ts";
import { parse, parseQuery, type ModuleDeps } from "../../platform/index.ts";
import { computeAreas, loadAreaDefinitions, loadDashboardContext, presentAreas, readOnly } from "./engine.ts";
import { appliedFilters, resolveFilters, transformationFilterQuery } from "./filters.ts";
import { readableTransformation } from "./scope.ts";

export const TRANSFORMATION_DASHBOARD = "/api/v1/transformations/:transformationId/dashboard";
const tParams = z.strictObject({ transformationId: z.uuid() });

export function registerTransformationDashboardRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  app.get(
    TRANSFORMATION_DASHBOARD,
    { config: { access: { permission: "transformation.read" } } },
    async (request): Promise<TransformationDashboard> => {
      const { transformationId } = parse(tParams, request.params, "params");
      const query = parseQuery(transformationFilterQuery, request.query);
      return readOnly(db, async (tx) => {
        const t = await readableTransformation(tx, principalOf(request), transformationId);
        const filters = await resolveFilters(tx, {
          organizationId: t.organizationId,
          transformationIds: [t.id],
          ownerUserId: query.ownerUserId,
          periodId: query.periodId,
        });
        const ctx = await loadDashboardContext(tx, [t], filters);
        const areas = presentAreas(ctx, computeAreas(ctx.facts, ctx.clock, ctx.policy), await loadAreaDefinitions(tx), {
          drillTransformationIds: [t.id],
          workstream: false,
        });
        return {
          transformationId: t.id,
          generatedAt: ctx.generatedAt,
          businessDate: filters.businessDate,
          timezone: filters.timezone,
          appliedFilters: appliedFilters(filters),
          areas,
        };
      });
    },
  );
  return [`GET ${TRANSFORMATION_DASHBOARD}`];
}

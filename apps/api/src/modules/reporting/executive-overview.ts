// The Executive Overview = the executive dashboard (ADR-0037 §2, §8; D-106 (c): one read model and one operation;
// REQ-S03-009, REQ-S13-001 "executive", REQ-S13-002; M0101):
//   GET /overview?organizationId=&transformationId=&ownerUserId=&periodId=&phase=&status=
// The six T10 areas over the transformations of the organization the caller may read, narrowed by the filters (M0101's
// tiles map one-to-one: outcomes -> Outcomes, value -> Value, critical initiatives -> Portfolio, adoption -> People &
// adoption, blockers -> Dependencies, decisions -> Decisions), plus one row per transformation with its six area
// statuses. 404 when the caller holds no transformation.read grant in the organization or names a transformation it
// may not read; 422 dashboard.period_not_found / dashboard.owner_not_found. A read model: nothing stored.
import type { ExecutiveOverview } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { principalOf } from "../access/index.ts";
import { parseQuery, type ModuleDeps } from "../platform/index.ts";
import {
  areaStatuses,
  computeAreas,
  factsOfTransformation,
  loadAreaDefinitions,
  loadDashboardContext,
  presentAreas,
  readOnly,
} from "./dashboards/engine.ts";
import { appliedFilters, asIdList, organizationFilterShape, resolveFilters } from "./dashboards/filters.ts";
import { readableTransformations } from "./dashboards/scope.ts";

export const EXECUTIVE_OVERVIEW = "/api/v1/overview";
const overviewQuery = z.strictObject(organizationFilterShape);

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerExecutiveOverviewRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  app.get(
    EXECUTIVE_OVERVIEW,
    { config: { access: { permission: "transformation.read" } } },
    async (request): Promise<ExecutiveOverview> => {
      const query = parseQuery(overviewQuery, request.query);
      const transformationIds = asIdList(query.transformationId);
      return readOnly(db, async (tx) => {
        const scope = await readableTransformations(tx, principalOf(request), query.organizationId, {
          transformationIds,
          phase: query.phase ?? null,
          status: query.status ?? null,
        });
        const filters = await resolveFilters(tx, {
          organizationId: query.organizationId,
          transformationIds,
          ownerUserId: query.ownerUserId,
          periodId: query.periodId,
          phase: query.phase,
          status: query.status,
        });
        const ctx = await loadDashboardContext(tx, scope, filters);
        const areas = presentAreas(ctx, computeAreas(ctx.facts, ctx.clock, ctx.policy), await loadAreaDefinitions(tx), {
          drillTransformationIds: transformationIds,
          workstream: false,
        });
        return {
          organizationId: query.organizationId,
          generatedAt: ctx.generatedAt,
          businessDate: filters.businessDate,
          appliedFilters: appliedFilters(filters),
          transformationCount: scope.length,
          areas,
          transformations: scope.map((t) => ({
            transformationId: t.id,
            code: t.code,
            name: t.name,
            areaStatuses: areaStatuses(computeAreas(factsOfTransformation(ctx.facts, t.id), ctx.clock, ctx.policy)),
          })),
        };
      });
    },
  );
  return [`GET ${EXECUTIVE_OVERVIEW}`];
}

// The adoption dashboard (T-DG4-KBE-G2; ADR-0037 §2-§6; ADR-0033; REQ-S13-001 "adoption"; M0244):
//   GET /dashboards/adoption?organizationId=&transformationId=&ownerUserId=&periodId=&phase=&status=
// Over the transformations of the organization the caller may read (scope.ts; 404 outside it), narrowed by the
// filters:
//  - `area`: the T10 People & adoption area (RAG vs the adoption curve: the slice A status of each active adoption
//    metric link's KPI against its approved trajectory, overrides in force applied; no indicator -> unknown). It is
//    the same area the transformation dashboard and the Executive Overview show (engine.ts presentAreas).
//  - `indicators`: each linked indicator with its KPI status and value (Unknown and Stale stay distinct, never 0 or
//    green), drilling to `adoption.indicators` of its transformation with the same filters.
//  - `openInterventionCount`: the open (planned or in progress) adoption interventions of the scope; with an owner
//    filter, those owned by that user; with a period filter, those due inside the window. Training completion alone is
//    never an input (REQ-PB-072).
//  - one row per transformation with its six area statuses.
// A read model: computed in the request's READ ONLY transaction; nothing is stored.
import type { DbOrTx } from "@mth/db";
import type { AdoptionDashboard } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { principalOf } from "../../access/index.ts";
import { loadAdoptionDashboardIndicators } from "../../adoption/index.ts";
import { parseQuery, type ModuleDeps } from "../../platform/index.ts";
import { kpiActualValue } from "./areas.ts";
import {
  areaStatuses,
  computeAreas,
  factsOfTransformation,
  loadAreaDefinitions,
  loadDashboardContext,
  presentAreas,
  readOnly,
} from "./engine.ts";
import {
  appliedFilters,
  asIdList,
  drilldownHref,
  organizationFilterShape,
  resolveFilters,
  type ResolvedFilters,
} from "./filters.ts";
import { readableTransformations } from "./scope.ts";

export const ADOPTION_DASHBOARD = "/api/v1/dashboards/adoption";
const adoptionQuery = z.strictObject(organizationFilterShape);

/** The open interventions of the scope (ADR-0033; planned or in progress), narrowed by owner and window. */
export async function countOpenInterventions(
  db: DbOrTx,
  transformationIds: readonly string[],
  f: Pick<ResolvedFilters, "ownerUserId" | "windowStart" | "windowEnd">,
): Promise<number> {
  if (transformationIds.length === 0) return 0;
  let q = db
    .selectFrom("adoption_intervention")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where("transformation_id", "in", [...transformationIds])
    .where("status", "in", ["planned", "in_progress"]);
  if (f.ownerUserId !== null) q = q.where("owner_user_id", "=", f.ownerUserId);
  if (f.windowStart !== null && f.windowEnd !== null)
    q = q.where("due_date", ">=", f.windowStart).where("due_date", "<=", f.windowEnd);
  const r = await q.executeTakeFirstOrThrow();
  return Number(r.n);
}

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerAdoptionDashboardRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  app.get(
    ADOPTION_DASHBOARD,
    { config: { access: { permission: "transformation.read" } } },
    async (request): Promise<AdoptionDashboard> => {
      const query = parseQuery(adoptionQuery, request.query);
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
        const ids = scope.map((t) => t.id);
        const ctx = await loadDashboardContext(tx, scope, filters);
        const results = computeAreas(ctx.facts, ctx.clock, ctx.policy);
        const areas = presentAreas(ctx, results, await loadAreaDefinitions(tx), {
          drillTransformationIds: transformationIds,
          workstream: false,
        });
        const targetOf = new Map(
          (await loadAdoptionDashboardIndicators(tx, ids)).map((i) => [i.metricLinkId, i.targetId]),
        );
        return {
          organizationId: query.organizationId,
          generatedAt: ctx.generatedAt,
          businessDate: filters.businessDate,
          appliedFilters: appliedFilters(filters),
          area: areas.find((a) => a.code === "people_adoption")!,
          indicators: results.adoption.indicators.map((row) => ({
            kpiDefinitionId: row.fact.status.kpiDefinitionId,
            templateKey: row.fact.templateKey,
            targetKind: row.fact.targetKind,
            targetId: targetOf.get(row.fact.metricLinkId) ?? null,
            rag: row.status,
            value: kpiActualValue(row.fact.status),
            drilldownHref: drilldownHref("adoption.indicators", filters, {
              transformationIds: [row.fact.transformationId],
            }),
          })),
          openInterventionCount: await countOpenInterventions(tx, ids, filters),
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
  return [`GET ${ADOPTION_DASHBOARD}`];
}

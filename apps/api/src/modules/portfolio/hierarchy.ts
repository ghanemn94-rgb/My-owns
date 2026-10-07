// Outcome hierarchy (REQ-PB-032, B0048; ADR-0021 §2; T-DG3-BE-A):
//   GET /transformations/{id}/outcome-hierarchy    the five levels as one tree (transformation.read; read only)
// North Star (current) -> strategic outcomes (not archived) -> KPIs (T02 outcome_kpi rows, not archived) -> targets
// (outcome_kpi.target_value/target_date) -> initiative contributions (active initiative_outcome_contribution rows).
// A contribution without a KPI hangs under its outcome; a contribution always has an outcome (NOT NULL, ADR-0021 §2).
// A missing target value is Unknown (null), never 0.
import type { DbOrTx, InitiativeOutcomeContributionRow } from "@mth/db";
import type { InitiativeOutcomeContribution, OutcomeHierarchy } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { principalOf, requireTransformationRead } from "../access/index.ts";
import { iso, isoOrNull, parse, type ModuleDeps } from "../platform/index.ts";
import { findCurrentNorthStar, presentOutcomes, toNorthStar } from "../transformations/index.ts";

const PATH = "/api/v1/transformations/:transformationId/outcome-hierarchy";
const tParams = z.strictObject({ transformationId: z.uuid() });

/** API representation of an initiative outcome contribution (also used by the contribution routes, BE-B). */
export function toInitiativeOutcomeContribution(r: InitiativeOutcomeContributionRow): InitiativeOutcomeContribution {
  return {
    id: r.id,
    organizationId: r.organization_id,
    transformationId: r.transformation_id,
    initiativeId: r.initiative_id,
    outcomeId: r.outcome_id,
    outcomeKpiId: r.outcome_kpi_id,
    contributionStatement: r.contribution_statement,
    expectedKpiMovement: r.expected_kpi_movement,
    status: r.status as InitiativeOutcomeContribution["status"],
    removedAt: isoOrNull(r.removed_at),
    removedBy: r.removed_by,
    removeReason: r.remove_reason,
    version: r.version,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
    updatedAt: iso(r.updated_at),
    updatedBy: r.updated_by,
  };
}

/** The five-level tree of a transformation (the caller has checked read access). */
export async function loadOutcomeHierarchy(db: DbOrTx, transformationId: string): Promise<OutcomeHierarchy> {
  const ns = await findCurrentNorthStar(db, transformationId);
  const outcomeRows = await db
    .selectFrom("outcome")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .where("status", "<>", "archived")
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  const outcomes = await presentOutcomes(db, outcomeRows);
  const kpis = await db
    .selectFrom("outcome_kpi")
    .select(["id", "outcome_id", "kpi_definition_id", "target_value", "target_date"])
    .where("transformation_id", "=", transformationId)
    .where("status", "<>", "archived")
    .orderBy("ordinal")
    .orderBy("id")
    .execute();
  const contributions = (
    await db
      .selectFrom("initiative_outcome_contribution")
      .selectAll()
      .where("transformation_id", "=", transformationId)
      .where("status", "=", "active")
      .orderBy("created_at")
      .orderBy("id")
      .execute()
  ).map(toInitiativeOutcomeContribution);
  return {
    northStar: ns ? toNorthStar(ns) : null,
    outcomes: outcomes.map((outcome) => {
      const own = kpis.filter((k) => k.outcome_id === outcome.id);
      return {
        outcome,
        kpis: own.map((k) => ({
          outcomeKpiId: k.id,
          kpiDefinitionId: k.kpi_definition_id,
          targetValue: k.target_value,
          targetDate: String(k.target_date).slice(0, 10),
          contributions: contributions.filter((c) => c.outcomeKpiId === k.id),
        })),
        // Contributions linked to the outcome without a KPI (or to a KPI row that is archived).
        contributions: contributions.filter(
          (c) => c.outcomeId === outcome.id && (c.outcomeKpiId === null || !own.some((k) => k.id === c.outcomeKpiId)),
        ),
      };
    }),
  };
}

export function registerHierarchyRoutes(app: FastifyInstance, { db }: ModuleDeps): readonly string[] {
  app.get(PATH, { config: { access: { permission: "transformation.read" } } }, async (request) => {
    const { transformationId } = parse(tParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    return loadOutcomeHierarchy(db, transformationId);
  });
  return [`GET ${PATH}`];
}

// The roadmap read model (ADR-0023 §3; REQ-S09-006; T-DG3-BE-C):
//   GET /transformations/{id}/roadmap   waves, initiatives, milestones, deliverables and initiative-to-initiative
//                                       dependencies, each with its `version`, and the schedule flags
//
// ONE read model behind the timeline, the initiative table and the work board: the web renders all three from the
// same TanStack Query cache entry (["roadmap", transformationId]). Every part is read in ONE read-only REPEATABLE READ
// transaction (one snapshot), so the three views never mix states. Moving a milestone is PATCH /milestones/{id} with
// If-Match (milestones.ts); a stale version is 409 with currentVersion.
//
// Schedule flags come from schedule.ts (ADR-0023 §5): on dependencies and on the successor initiatives. This file also
// supplies them to the T08 dependency routes of the workflows module (which cannot import portfolio) by decorating
// the Fastify instance with the T08ScheduleFlagsProvider. No critical-path claim (ADR-0023 §5).
import type { DbOrTx, DependencyTable, InitiativeTable } from "@mth/db";
import type { FundingState, Initiative, ScheduleFlag, Warning } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import type { Selectable } from "kysely";
import { z } from "zod";
import { principalOf, requireTransformationRead } from "../access/index.ts";
import { iso, isoOrNull, parse, parseQuery, problems, type ModuleDeps } from "../platform/index.ts";
import type { T08Dependency, T08ScheduleFlagsProvider } from "../workflows/index.ts";
import { deliverableCountWarning, loadDeliverables, toDeliverable } from "./deliverables.ts";
import { latestFundingState } from "./funding.ts";
import { loadMilestones, toMilestone } from "./milestones.ts";
import { computeScheduleFlags, type ScheduleDependency, type ScheduleFacts } from "./schedule.ts";
import { dateText, loadWaves, toRoadmapWave } from "./waves.ts";

type InitiativeRow = Selectable<InitiativeTable>;

// ------------------------------------------------------------------------------------------------ schedule facts

/** The facts schedule.ts reads, for one transformation (non-archived dependencies only). */
export async function loadScheduleFacts(db: DbOrTx, transformationId: string): Promise<ScheduleFacts> {
  const initiatives = await db
    .selectFrom("initiative")
    .leftJoin("roadmap_wave", "roadmap_wave.id", "initiative.wave_id")
    .select([
      "initiative.id",
      "initiative.code",
      "initiative.planned_start",
      "initiative.planned_end",
      "roadmap_wave.ordinal as wave_ordinal",
    ])
    .where("initiative.transformation_id", "=", transformationId)
    .execute();
  const milestones = await db
    .selectFrom("milestone")
    .select(["initiative_id", "status", "approved_date", "forecast_date"])
    .where("transformation_id", "=", transformationId)
    .execute();
  const dependencies = await db
    .selectFrom("dependency")
    .select(["id", "from_kind", "from_label", "from_initiative_id", "to_initiative_id", "needed_by", "status"])
    .where("transformation_id", "=", transformationId)
    .where("status", "<>", "archived")
    .execute();
  return {
    initiatives: initiatives.map((i) => ({
      id: i.id,
      code: i.code,
      plannedStart: dateText(i.planned_start),
      plannedEnd: dateText(i.planned_end),
      waveOrdinal: i.wave_ordinal,
    })),
    milestones: milestones.map((m) => ({
      initiativeId: m.initiative_id,
      status: m.status,
      approvedDate: dateText(m.approved_date),
      forecastDate: dateText(m.forecast_date),
    })),
    dependencies: dependencies.map(
      (d): ScheduleDependency => ({
        id: d.id,
        fromKind: d.from_kind,
        fromLabel: d.from_label,
        fromInitiativeId: d.from_initiative_id,
        toInitiativeId: d.to_initiative_id,
        neededBy: dateText(d.needed_by),
        status: d.status,
      }),
    ),
  };
}

/** The T08 provider (workflows reads it through the Fastify decorator): flags by dependency id. */
export const t08ScheduleFlags: T08ScheduleFlagsProvider = async (db, transformationId) =>
  computeScheduleFlags(await loadScheduleFacts(db, transformationId)).byDependency;

// ------------------------------------------------------------------------------------------------ dependencies

type DependencyRow = Selectable<DependencyTable>;

/**
 * The T08Dependency representation of an initiative-to-initiative dependency. The same shape as the T08 routes'
 * presenter (workflows/t08-dependencies.ts): the object literal is checked against workflows' exported
 * T08Dependency type, and the contract test validates both against the one OpenAPI schema.
 */
export const toRoadmapDependency = (r: DependencyRow, flags: readonly ScheduleFlag[]): T08Dependency => ({
  id: r.id,
  organizationId: r.organization_id,
  transformationId: r.transformation_id,
  code: r.code,
  description: r.description,
  fromKind: r.from_kind as T08Dependency["fromKind"],
  fromLabel: r.from_label,
  fromInitiativeId: r.from_initiative_id,
  toKind: r.to_kind as T08Dependency["toKind"],
  toLabel: r.to_label,
  toInitiativeId: r.to_initiative_id,
  dependencyType: r.dependency_type,
  neededBy: dateText(r.needed_by),
  ownerUserId: r.owner_user_id,
  status: r.status as T08Dependency["status"],
  mitigation: r.mitigation,
  decisionId: r.decision_id,
  flags: [...flags],
  archivedAt: isoOrNull(r.archived_at),
  archivedBy: r.archived_by,
  archiveReason: r.archive_reason,
  version: r.version,
  createdAt: iso(r.created_at),
  createdBy: r.created_by,
  updatedAt: iso(r.updated_at),
  updatedBy: r.updated_by,
});

// ------------------------------------------------------------------------------------------------ initiatives

const FUNDING_RELEVANT = new Set(["selected", "funded", "launched", "completed"]);

/**
 * The Initiative representation for the read model: the T05 fields, funding state (latestFundingState), the display
 * status ('Selected - unfunded'), the readiness warnings (ADR-0021 §2) and the schedule flags. Warnings and flags are
 * hints, never rejections.
 */
async function presentInitiatives(
  db: DbOrTx,
  rows: readonly InitiativeRow[],
  activeDeliverables: ReadonlyMap<string, number>,
  gapLinked: ReadonlySet<string>,
  flags: ReadonlyMap<string, readonly ScheduleFlag[]>,
): Promise<Initiative[]> {
  const out: Initiative[] = [];
  for (const r of rows) {
    const fundingState: FundingState = FUNDING_RELEVANT.has(r.status)
      ? await latestFundingState(db, r.id)
      : "not_applicable";
    const warnings: Warning[] = [];
    const count = deliverableCountWarning(activeDeliverables.get(r.id) ?? 0);
    if (count !== null) warnings.push(count);
    if (!gapLinked.has(r.id))
      warnings.push({ code: "initiative.no_gap_link", message: "The initiative is not linked to a gap or finding." });
    if (r.executive_owner_user_id === null)
      warnings.push({ code: "initiative.no_owner", message: "The initiative has no executive owner." });
    out.push({
      id: r.id,
      organizationId: r.organization_id,
      transformationId: r.transformation_id,
      code: r.code,
      name: r.name,
      executiveOwnerUserId: r.executive_owner_user_id,
      workstreamLeadUserId: r.workstream_lead_user_id,
      problemStatement: r.problem_statement,
      objective: r.objective,
      scopeIn: r.scope_in,
      scopeOut: r.scope_out,
      financialBenefitSummary: r.financial_benefit_summary,
      customerBenefitSummary: r.customer_benefit_summary,
      risksSummary: r.risks_summary,
      waveId: r.wave_id,
      plannedStart: dateText(r.planned_start),
      plannedEnd: dateText(r.planned_end),
      status: r.status as Initiative["status"],
      fundingState,
      displayStatus:
        r.status === "selected" && fundingState !== "funded"
          ? "initiative.status.selected_unfunded"
          : `initiative.status.${r.status}`,
      launchedAt: isoOrNull(r.launched_at),
      launchedBy: r.launched_by,
      cancelledAt: isoOrNull(r.cancelled_at),
      cancelledBy: r.cancelled_by,
      cancelReason: r.cancel_reason,
      warnings,
      flags: [...(flags.get(r.id) ?? [])],
      version: r.version,
      createdAt: iso(r.created_at),
      createdBy: r.created_by,
      updatedAt: iso(r.updated_at),
      updatedBy: r.updated_by,
    });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ the read model

async function loadRoadmap(db: DbOrTx, transformationId: string) {
  const waves = await loadWaves(db, transformationId);
  const initiatives = await db
    .selectFrom("initiative")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .orderBy("code")
    .execute();
  const milestones = await loadMilestones(db, transformationId, null);
  const deliverables = await loadDeliverables(db, transformationId, null);
  const dependencies = await db
    .selectFrom("dependency")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .where("status", "<>", "archived")
    .where("from_initiative_id", "is not", null)
    .where("to_initiative_id", "is not", null)
    .orderBy("code")
    .execute();
  const gapLinks = await db
    .selectFrom("initiative_gap_link")
    .select("initiative_id")
    .where("transformation_id", "=", transformationId)
    .where("status", "=", "active")
    .execute();
  const schedule = computeScheduleFlags(await loadScheduleFacts(db, transformationId));
  const activeDeliverables = new Map<string, number>();
  for (const d of deliverables)
    activeDeliverables.set(d.initiative_id, (activeDeliverables.get(d.initiative_id) ?? 0) + 1);
  return {
    transformationId,
    waves: waves.map(toRoadmapWave),
    initiatives: await presentInitiatives(
      db,
      initiatives,
      activeDeliverables,
      new Set(gapLinks.map((g) => g.initiative_id)),
      schedule.byInitiative,
    ),
    milestones: milestones.map(toMilestone),
    deliverables: deliverables.map(toDeliverable),
    dependencies: dependencies.map((d) => toRoadmapDependency(d, schedule.byDependency.get(d.id) ?? [])),
  };
}

// ------------------------------------------------------------------------------------------------ routes

const tParams = z.strictObject({ transformationId: z.uuid() });
const PATH = "/api/v1/transformations/:transformationId/roadmap";

/** Registers the roadmap route, supplies the T08 schedule flags, and returns the routes as "METHOD /path". */
export function registerRoadmapRoutes(app: FastifyInstance, { db }: ModuleDeps): readonly string[] {
  // The T08 routes (workflows) read their schedule flags through this decorator (declared in workflows'
  // t08-dependencies.ts); workflows never imports portfolio, so the module graph stays acyclic.
  if (!app.hasDecorator("t08ScheduleFlags")) app.decorate("t08ScheduleFlags", t08ScheduleFlags);

  app.get(PATH, { config: { access: { permission: "transformation.read" } } }, async (request) => {
    const { transformationId } = parse(tParams, request.params, "params");
    parseQuery(z.strictObject({}), request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const view = await db
      .transaction()
      .setIsolationLevel("repeatable read")
      .setAccessMode("read only")
      .execute(async (tx) => {
        const t = await tx
          .selectFrom("transformation")
          .select("id")
          .where("id", "=", transformationId)
          .executeTakeFirst();
        if (!t) throw problems.notFound();
        return loadRoadmap(tx, transformationId);
      });
    return view;
  });

  return [`GET ${PATH}`];
}

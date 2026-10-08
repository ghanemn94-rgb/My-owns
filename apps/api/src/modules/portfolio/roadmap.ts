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
// supplies them to the T08 dependency routes of the workflows module (which cannot import portfolio) as the
// T08ScheduleFlagsProvider `t08ScheduleFlags`, which server.ts passes in explicitly. No critical-path claim (ADR-0023 §5).
import type { DbOrTx, DependencyTable } from "@mth/db";
import type { ScheduleFlag } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import type { Selectable } from "kysely";
import { z } from "zod";
import { principalOf, requireTransformationRead } from "../access/index.ts";
import { iso, isoOrNull, parse, parseQuery, problems, type ModuleDeps } from "../platform/index.ts";
import type { T08Dependency, T08ScheduleFlagsProvider } from "../workflows/index.ts";
import { loadDeliverables, toDeliverable } from "./deliverables.ts";
import { loadMilestones, toMilestone } from "./milestones.ts";
import { presentInitiatives } from "./repository.ts";
import { computeScheduleFlags, type ScheduleDependency, type ScheduleFacts } from "./schedule.ts";
import { dateText, loadWaves, toRoadmapWave } from "./waves.ts";

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

/**
 * The T08 provider: flags by dependency id. Exported on the portfolio public interface; server.ts passes it to
 * registerWorkflowsModule (explicit injection, T-DG3-ARCH-03), so workflows never imports portfolio.
 */
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
  const schedule = computeScheduleFlags(await loadScheduleFacts(db, transformationId));
  return {
    transformationId,
    waves: waves.map(toRoadmapWave),
    // The one initiative presenter (repository.ts; p3-work-split §9 item 13): warnings, funding state, the i18n display
    // status and the schedule and capacity flags.
    initiatives: await presentInitiatives(db, initiatives),
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

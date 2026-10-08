// The portfolio half of workflows' GateFactsProvider (ADR-0021 §1, §7; T-DG3-BE-E). server.ts wires
// `portfolio: loadPortfolioGateFacts`; the G4 evaluators (workflows/g4.ts) decide completeness from these FACTS.
//
// G4 scope: the initiatives with status selected, funded or launched (the approved portfolio selection). Facts only,
// read-only, on the caller's connection or transaction (the G4 submission reads them inside its own transaction):
//  - the T05 card fields, active gap links, KPI contributions, wave, planned dates, approved milestones and owners;
//  - the funding state through latestFundingState() (the deselect rule included) and the counted decision id;
//  - committed resource demand, and every (role, month) where COMMITTED demand exceeds the active capacity or no
//    capacity row exists (Unknown is a conflict, never "no conflict"; ADR-0023 §6 "G4 uses committed demand only");
//  - the current proposed ranking and the active weight set;
//  - needed-by conflicts (BE-C schedule.ts) of unresolved dependencies into in-scope initiatives without a mitigation.
// G4 is a business approval decided by a person; nothing here approves anything, and nothing touches DG0-DG7.
import { sql, type DbOrTx } from "@mth/db";
import { hasText } from "@mth/shared/schemas";
import { Decimal } from "decimal.js";
import type { PortfolioGateFacts } from "../workflows/index.ts";
import { fteText } from "./capacity.ts";
import { latestFundingState } from "./funding.ts";
import { loadScheduleFacts } from "./roadmap.ts";
import { computeScheduleFlags, SCHEDULE_FLAG_CODES } from "./schedule.ts";
import { dateText } from "./waves.ts";

type G4InitiativeFact = NonNullable<PortfolioGateFacts["initiatives"]>[number];
type G4CapacityConflictFact = NonNullable<PortfolioGateFacts["capacityConflicts"]>[number];

/** ADR-0021 §7: the approved portfolio selection. */
export const G4_SCOPE_STATUSES = ["selected", "funded", "launched"] as const;

async function countBy(db: DbOrTx, table: "initiative_gap_link", ids: readonly string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .selectFrom(table)
    .select(["initiative_id", (eb) => eb.fn.countAll<string>().as("n")])
    .where("initiative_id", "in", [...ids])
    .where("status", "=", "active")
    .groupBy("initiative_id")
    .execute();
  return new Map(rows.map((r) => [r.initiative_id, Number.parseInt(String(r.n), 10)]));
}

/** The counted (latest, after the latest selection) funding decision id of an initiative, if any. */
async function countedFundingDecision(db: DbOrTx, initiativeId: string): Promise<string | null> {
  const row = await db
    .selectFrom("funding_decision")
    .select("id")
    .where("initiative_id", "=", initiativeId)
    .where(
      "decided_at",
      ">",
      sql<Date>`COALESCE((SELECT max(s.decided_at) FROM portfolio_selection s
                           WHERE s.initiative_id = ${initiativeId}::uuid AND s.action = 'selected'), '-infinity')`,
    )
    .orderBy("decided_at", "desc")
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();
  return row?.id ?? null;
}

/** Portfolio facts for the G4 criteria. */
export async function loadPortfolioGateFacts(db: DbOrTx, transformationId: string): Promise<PortfolioGateFacts> {
  const rows = await db
    .selectFrom("initiative")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .where("status", "in", [...G4_SCOPE_STATUSES])
    .orderBy("code")
    .execute();
  const ids = rows.map((r) => r.id);
  const gapLinks = await countBy(db, "initiative_gap_link", ids);
  const contributions =
    ids.length === 0
      ? []
      : await db
          .selectFrom("initiative_outcome_contribution")
          .select(["initiative_id", (eb) => eb.fn.countAll<string>().as("n")])
          .where("initiative_id", "in", ids)
          .where("status", "=", "active")
          .where("outcome_kpi_id", "is not", null)
          .groupBy("initiative_id")
          .execute();
  const kpiLinks = new Map(contributions.map((r) => [r.initiative_id, Number.parseInt(String(r.n), 10)]));
  const milestones =
    ids.length === 0
      ? []
      : await db
          .selectFrom("milestone")
          .select(["initiative_id", (eb) => eb.fn.countAll<string>().as("n")])
          .where("initiative_id", "in", ids)
          .where("status", "<>", "cancelled")
          .where("approved_date", "is not", null)
          .groupBy("initiative_id")
          .execute();
  const approved = new Map(milestones.map((r) => [r.initiative_id, Number.parseInt(String(r.n), 10)]));
  const demands =
    ids.length === 0
      ? []
      : await db
          .selectFrom("resource_demand")
          .select(["id", "initiative_id"])
          .where("initiative_id", "in", ids)
          .where("status", "=", "committed")
          .orderBy("id")
          .execute();

  const initiatives: G4InitiativeFact[] = [];
  for (const r of rows) {
    const cardMissing = [
      ...(hasText(r.name) ? [] : ["name"]),
      ...(r.objective !== null && hasText(r.objective) ? [] : ["objective"]),
      ...(r.scope_in !== null && hasText(r.scope_in) ? [] : ["scopeIn"]),
    ];
    initiatives.push({
      id: r.id,
      code: r.code,
      name: r.name,
      version: r.version,
      status: r.status,
      cardMissing,
      activeGapLinks: gapLinks.get(r.id) ?? 0,
      kpiContributions: kpiLinks.get(r.id) ?? 0,
      waveId: r.wave_id,
      plannedStart: dateText(r.planned_start as unknown as string | null),
      plannedEnd: dateText(r.planned_end as unknown as string | null),
      approvedMilestones: approved.get(r.id) ?? 0,
      executiveOwnerUserId: r.executive_owner_user_id,
      workstreamLeadUserId: r.workstream_lead_user_id,
      fundingState: await latestFundingState(db, r.id),
      fundingDecisionId: await countedFundingDecision(db, r.id),
      committedDemandIds: demands.filter((d) => d.initiative_id === r.id).map((d) => d.id),
    });
  }

  const ranking = await db
    .selectFrom("ranking_snapshot")
    .select(["id", "weight_set_id"])
    .where("transformation_id", "=", transformationId)
    .where("status", "=", "current")
    .executeTakeFirst();
  const entries = ranking
    ? await db
        .selectFrom("ranking_entry")
        .select(["initiative_id", "completeness"])
        .where("snapshot_id", "=", ranking.id)
        .execute()
    : [];
  const weightSet = await db
    .selectFrom("scoring_weight_set")
    .select(["id", "version_no"])
    .where("transformation_id", "=", transformationId)
    .where("status", "=", "active")
    .executeTakeFirst();

  return {
    transformationId,
    initiatives,
    ranking: ranking
      ? {
          snapshotId: ranking.id,
          weightSetId: ranking.weight_set_id,
          entries: entries.map((e) => ({ initiativeId: e.initiative_id, completeness: e.completeness })),
        }
      : null,
    activeWeightSet: weightSet ? { id: weightSet.id, versionNo: weightSet.version_no } : null,
    scheduleConflicts: await scheduleConflicts(db, transformationId, new Set(ids)),
    capacityConflicts: await committedCapacityConflicts(db, transformationId),
  };
}

/** Needed-by conflicts (schedule.ts) of unresolved dependencies into in-scope initiatives that have no mitigation. */
async function scheduleConflicts(db: DbOrTx, transformationId: string, scope: ReadonlySet<string>) {
  const { byDependency } = computeScheduleFlags(await loadScheduleFacts(db, transformationId));
  const conflicting = [...byDependency.entries()]
    .filter(([, flags]) => flags.some((f) => f.code === SCHEDULE_FLAG_CODES.neededByConflict))
    .map(([id]) => id);
  if (conflicting.length === 0) return [];
  const deps = await db
    .selectFrom("dependency")
    .select(["id", "code", "mitigation", "to_initiative_id"])
    .where("id", "in", conflicting)
    .orderBy("code")
    .execute();
  return deps
    .filter((d) => d.to_initiative_id !== null && scope.has(d.to_initiative_id))
    .filter((d) => d.mitigation === null || !hasText(d.mitigation))
    .map((d) => ({ dependencyId: d.id, code: d.code }));
}

/**
 * Every (role, month) whose COMMITTED demand (initiatives not cancelled/completed) exceeds the active capacity, or that
 * has no active capacity row at all (Unknown -> a conflict). Sums in SQL numeric, comparison in decimal.js.
 */
async function committedCapacityConflicts(db: DbOrTx, transformationId: string): Promise<G4CapacityConflictFact[]> {
  const rows = await sql<{
    resource_role_id: string;
    label_en: string;
    period_month: string;
    committed: string;
    available: string | null;
  }>`
    SELECT d.resource_role_id, r.label_en, to_char(d.period_month, 'YYYY-MM-DD') AS period_month,
           sum(d.demand_fte)::text AS committed,
           (SELECT c.available_fte::text FROM capacity c
             WHERE c.resource_role_id = d.resource_role_id AND c.period_month = d.period_month AND c.status = 'active')
             AS available
      FROM resource_demand d
      JOIN initiative i ON i.id = d.initiative_id
      JOIN resource_role r ON r.id = d.resource_role_id
     WHERE d.transformation_id = ${transformationId}::uuid
       AND d.status = 'committed'
       AND i.status NOT IN ('cancelled', 'completed')
     GROUP BY d.resource_role_id, r.label_en, d.period_month
     ORDER BY r.label_en, d.period_month`.execute(db);
  return rows.rows
    .filter((r) => r.available === null || new Decimal(r.committed).greaterThan(new Decimal(r.available)))
    .map((r) => ({
      resourceRoleId: r.resource_role_id,
      roleLabel: r.label_en,
      periodMonth: r.period_month,
      committedFte: fteText(r.committed),
      availableFte: r.available === null ? null : fteText(r.available),
    }));
}

// Critical dependency slip detection (ADR-0044 §7; REQ-S12-012 "a 5-day slip notifies each affected owner once and
// moves dependent forecasts per the logic"; M0232; p5-work-split §E.1; T-DG5-BE-J).
//
// Called once, in the SAME transaction, by the DG4 milestone writes that can move a predecessor's finish (PATCH
// /milestones/{id} and POST /milestones/{id}/approve-date), after the row is written and audited. For each dependency
// whose predecessor (`from_initiative_id`) is the changed milestone's initiative:
//  - the predecessor finish before and after is computed with the DG4 function `predecessorFinish` UNCHANGED
//    (ADR-0023 §5: latest forecast, else approved, date of its non-cancelled milestones; else its planned end);
//    "before" is the same milestone set with this row's previous values. Either side Unknown -> no slip (never 0);
//  - a SLIP is a move later by at least `minimumSlipDays` calendar days (starter 9's effective version, default 1);
//  - it is CRITICAL when the dependency is on the computed critical path (`loadScheduleNetwork`, ADR-0031, unchanged;
//    `critical_path`) or the new finish is after its `needed_by` (`needed_by_breached`). A non-critical slip records
//    nothing;
//  - one `dependency_slip` row per (dependency, slip key `<predecessor initiative id>:<milestone id>.<milestone
//    version>`: the schedule version the write produced; 0075 dependency_slip_once_key), with `affected` = every
//    initiative reachable from the dependency's successor through the dependency graph, with its owner (executive
//    owner, else workstream lead; null = Unknown) and its forecast finish before and after by the D-166 Rule B forward
//    pass (`forwardFinishes` in schedule.ts, over the before and the after milestone sets, which differ only in this
//    milestone: a dependent with enough slack does not move, one with none moves by the slip; null = Unknown); its
//    audit event; and the outbox event `dependency.slipped` (consumer portfolio.dependency_slip, starter 9, which
//    notifies each distinct affected owner once).
// Nothing here stores or overwrites a forecast: only the slip's own `affected` evidence is written (ADR-0044 §7).
// No remote I/O.
import { sql, type Tx } from "@mth/db";
import { v7 as uuidv7 } from "uuid";
import { record, type AuditContext } from "../audit/index.ts";
import { dependencySlippedV1 } from "@mth/shared/schemas";
import { forwardFinishes, predecessorFinish, type ForwardFacts, type ScheduleMilestone } from "./schedule.ts";
import { loadScheduleNetwork } from "./schedule-network.ts";

export const DEPENDENCY_SLIPPED_EVENT = "dependency.slipped";
export const DEPENDENCY_SLIP_STARTER = "starter.dependency_slip";
const DEFAULT_MINIMUM_SLIP_DAYS = 1;
const MAX_AFFECTED = 200;
const DAY_MS = 86_400_000;

/** The milestone columns that move a finish (a subset of the DG4 row). */
export interface SlipMilestoneState {
  readonly id: string;
  readonly initiative_id: string;
  readonly version: number;
  readonly status: string;
  readonly approved_date: string | Date | null;
  readonly forecast_date: string | Date | null;
}

export interface SlipScope {
  readonly organizationId: string;
  readonly transformationId: string;
  readonly audit: AuditContext;
}

export interface RecordedSlip {
  readonly slipId: string;
  readonly dependencyId: string;
  readonly slipDays: number;
}

const text = (d: string | Date | null): string | null =>
  d === null ? null : d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

/** Starter 9's `minimumSlipDays` (integer 1-90) from its effective version; the default when absent. */
export async function minimumSlipDays(tx: Tx): Promise<number> {
  const v = await tx
    .selectFrom("automation_rule as r")
    .innerJoin("automation_rule_version as v", "v.id", "r.effective_version_id")
    .select("v.parameters")
    .where("r.code", "=", DEPENDENCY_SLIP_STARTER)
    .executeTakeFirst();
  const n = new Map(Object.entries((v?.parameters ?? {}) as Record<string, unknown>)).get("minimumSlipDays");
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 90 ? n : DEFAULT_MINIMUM_SLIP_DAYS;
}

/** Detect and record the critical slips caused by one milestone write (see the file comment). */
export async function recordDependencySlips(
  tx: Tx,
  scope: SlipScope,
  before: SlipMilestoneState,
  after: SlipMilestoneState,
): Promise<RecordedSlip[]> {
  if (
    before.status === after.status &&
    text(before.approved_date) === text(after.approved_date) &&
    text(before.forecast_date) === text(after.forecast_date)
  )
    return [];
  const deps = await tx
    .selectFrom("dependency")
    .select([
      "id",
      "code",
      "from_initiative_id",
      "to_initiative_id",
      "status",
      sql<string | null>`needed_by::text`.as("neededBy"),
    ])
    .where("transformation_id", "=", scope.transformationId)
    .where("status", "not in", ["archived", "resolved"])
    .where("from_initiative_id", "is not", null)
    .where("to_initiative_id", "is not", null)
    .execute();
  const outgoing = deps.filter((d) => d.from_initiative_id === after.initiative_id);
  if (outgoing.length === 0) return [];

  const rows = await tx
    .selectFrom("milestone")
    .select([
      "id",
      "initiative_id",
      "status",
      sql<string | null>`approved_date::text`.as("approved"),
      sql<string | null>`forecast_date::text`.as("forecast"),
    ])
    .where("transformation_id", "=", scope.transformationId)
    .execute();
  const toSchedule = (r: { initiative_id: string; status: string; approved: string | null; forecast: string | null }) =>
    ({
      initiativeId: r.initiative_id,
      status: r.status,
      approvedDate: r.approved,
      forecastDate: r.forecast,
    }) satisfies ScheduleMilestone;
  const afterSet: ScheduleMilestone[] = rows.map(toSchedule);
  const beforeSet: ScheduleMilestone[] = rows.map((r) =>
    r.id === after.id
      ? toSchedule({
          initiative_id: before.initiative_id,
          status: before.status,
          approved: text(before.approved_date),
          forecast: text(before.forecast_date),
        })
      : toSchedule(r),
  );
  const initiatives = await tx
    .selectFrom("initiative")
    .select([
      "id",
      "code",
      "executive_owner_user_id",
      "workstream_lead_user_id",
      sql<string | null>`planned_start::text`.as("plannedStart"),
      sql<string | null>`planned_end::text`.as("plannedEnd"),
    ])
    .where("transformation_id", "=", scope.transformationId)
    .execute();
  const byId = new Map(initiatives.map((i) => [i.id, i]));
  // D-166 Rule B: the forward pass over the scheduled initiative-to-initiative dependencies (the `deps` above).
  const links: ForwardFacts["dependencies"] = deps.map((d) => ({
    fromInitiativeId: d.from_initiative_id,
    toInitiativeId: d.to_initiative_id,
    status: d.status,
  }));
  const forwardBefore = forwardFinishes({ initiatives, milestones: beforeSet, dependencies: links });
  const forwardAfter = forwardFinishes({ initiatives, milestones: afterSet, dependencies: links });
  const predecessor = byId.get(after.initiative_id);
  if (predecessor === undefined) return [];
  const finishBefore = predecessorFinish(predecessor, beforeSet);
  const finishAfter = predecessorFinish(predecessor, afterSet);
  if (finishBefore === null || finishAfter === null) return [];
  const slipDays = daysBetween(finishBefore, finishAfter);
  if (slipDays < (await minimumSlipDays(tx)) || slipDays > 3650) return [];

  const network = await loadScheduleNetwork(tx, scope.transformationId);
  const criticalEdges = new Set(
    network.status === "computed" ? network.edges.filter((e) => e.critical).map((e) => e.dependencyId) : [],
  );
  const recorded: RecordedSlip[] = [];
  for (const dep of outgoing) {
    const reason = criticalEdges.has(dep.id)
      ? "critical_path"
      : dep.neededBy !== null && finishAfter > dep.neededBy
        ? "needed_by_breached"
        : null;
    if (reason === null) continue;
    // Every initiative reachable from the successor (breadth first, each once, at most MAX_AFFECTED).
    const seen = new Set<string>();
    const queue = [dep.to_initiative_id!];
    while (queue.length > 0 && seen.size < MAX_AFFECTED) {
      const id = queue.shift()!;
      if (seen.has(id) || id === after.initiative_id) continue;
      seen.add(id);
      for (const d of deps)
        if (d.from_initiative_id === id && !seen.has(d.to_initiative_id!)) queue.push(d.to_initiative_id!);
    }
    const affected = [...seen].flatMap((id) => {
      const i = byId.get(id);
      return i === undefined
        ? []
        : [
            {
              initiativeId: i.id,
              initiativeCode: i.code,
              ownerUserId: i.executive_owner_user_id ?? i.workstream_lead_user_id ?? null,
              forecastFinishBefore: forwardBefore(i.id),
              forecastFinishAfter: forwardAfter(i.id),
            },
          ];
    });
    const slipId = uuidv7();
    const slipKey = `${after.initiative_id}:${after.id}.${after.version}`;
    const inserted = await tx
      .insertInto("dependency_slip")
      .values({
        id: slipId,
        organization_id: scope.organizationId,
        transformation_id: scope.transformationId,
        dependency_id: dep.id,
        slip_key: slipKey,
        predecessor_finish_before: finishBefore,
        predecessor_finish_after: finishAfter,
        slip_days: slipDays,
        needed_by: dep.neededBy,
        critical_reason: reason,
        affected: JSON.stringify(affected),
        created_by: scope.audit.actorUserId,
      })
      .onConflict((oc) => oc.constraint("dependency_slip_once_key").doNothing())
      .returning("id")
      .executeTakeFirst();
    if (!inserted) continue;
    await record(tx, scope.audit, {
      action: "dependency_slip.create",
      recordType: "dependency_slip",
      recordId: slipId,
      organizationId: scope.organizationId,
      transformationId: scope.transformationId,
      newVersion: 1,
      changes: {
        dependency_id: { from: null, to: dep.id },
        slip_days: { from: null, to: slipDays },
        predecessor_finish_before: { from: null, to: finishBefore },
        predecessor_finish_after: { from: null, to: finishAfter },
        critical_reason: { from: null, to: reason },
      },
    });
    // The transactional outbox row (ADR-0008), written as jobs/outbox.ts enqueueOutboxEvent writes it (schema-checked):
    // portfolio may not import the jobs module (its dependencies are pinned by ADR-0021 §1, architecture.test.ts).
    const payload = dependencySlippedV1.parse({
      slipId,
      dependencyId: dep.id,
      transformationId: scope.transformationId,
      slipDays,
    }) as Record<string, unknown>;
    await tx
      .insertInto("outbox_event")
      .values({
        id: uuidv7(),
        organization_id: scope.organizationId,
        aggregate_type: "dependency_slip",
        aggregate_id: slipId,
        event_type: DEPENDENCY_SLIPPED_EVENT,
        schema_version: 1,
        payload: JSON.stringify(payload),
        idempotency_key: `${DEPENDENCY_SLIPPED_EVENT}:${slipId}`,
      })
      .execute();
    recorded.push({ slipId, dependencyId: dep.id, slipDays });
  }
  return recorded;
}

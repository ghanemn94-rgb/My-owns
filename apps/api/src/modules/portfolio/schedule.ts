// Schedule flags (ADR-0023 §5; REQ-S09-008, REQ-S09-004; T-DG3-BE-C): pure functions over the initiative graph.
// Warnings, never rejections. Computed on read for the T08 dependencies, the initiatives and the roadmap read model.
//
//  - Predecessor finish = the latest forecast date (else the approved date) of the predecessor's non-cancelled
//    milestones; else its planned end; Unknown when none exists.
//  - schedule.needed_by_conflict: predecessor finish > needed by ('{from} finishes after {to} needs it ({date})').
//  - schedule.before_predecessor ("sequenced before its predecessor"): the successor's planned start < predecessor
//    finish, OR the successor's wave ordinal < the predecessor's wave ordinal.
//  - schedule.unknown: a date needed for either check is missing. Unknown is NEVER reported as "no conflict".
//
// No critical-path claim and no duration model (ADR-0023 §5): only precedence and date comparison. Dates are calendar
// dates `YYYY-MM-DD` (the transformation's time zone), compared as text, which orders them correctly.
import type { ScheduleFlag } from "@mth/shared/schemas";

export const SCHEDULE_FLAG_CODES = {
  neededByConflict: "schedule.needed_by_conflict",
  beforePredecessor: "schedule.before_predecessor",
  unknown: "schedule.unknown",
} as const;

export interface ScheduleInitiative {
  readonly id: string;
  readonly code: string;
  readonly plannedStart: string | null;
  readonly plannedEnd: string | null;
  /** Ordinal of the initiative's wave; null when it has no wave. */
  readonly waveOrdinal: number | null;
}

export interface ScheduleMilestone {
  readonly initiativeId: string;
  readonly status: string;
  readonly approvedDate: string | null;
  readonly forecastDate: string | null;
}

export interface ScheduleDependency {
  readonly id: string;
  readonly fromKind: string;
  readonly fromLabel: string | null;
  readonly fromInitiativeId: string | null;
  readonly toInitiativeId: string | null;
  readonly neededBy: string | null;
  readonly status: string;
}

export interface ScheduleFacts {
  readonly initiatives: readonly ScheduleInitiative[];
  readonly milestones: readonly ScheduleMilestone[];
  readonly dependencies: readonly ScheduleDependency[];
}

export interface ScheduleFlags {
  /** Flags of each dependency (every non-archived, unresolved dependency with an initiative successor has an entry). */
  readonly byDependency: ReadonlyMap<string, readonly ScheduleFlag[]>;
  /** Flags of each initiative as a SUCCESSOR (the dependency that raised it is named). */
  readonly byInitiative: ReadonlyMap<string, readonly ScheduleFlag[]>;
}

const later = (a: string | null, b: string | null): string | null => (a === null ? b : b === null || a >= b ? a : b);

/**
 * The predecessor's finish (ADR-0023 §5): the latest forecast (else approved) date of its non-cancelled milestones;
 * else its planned end; null (Unknown) when none exists.
 */
export function predecessorFinish(
  initiative: Pick<ScheduleInitiative, "id" | "plannedEnd">,
  milestones: readonly ScheduleMilestone[],
): string | null {
  let latest: string | null = null;
  for (const m of milestones) {
    if (m.initiativeId !== initiative.id || m.status === "cancelled") continue;
    latest = later(latest, m.forecastDate ?? m.approvedDate);
  }
  return latest ?? initiative.plannedEnd;
}

/** Does this dependency take part in the schedule checks? Archived and resolved dependencies do not. */
export function isScheduled(dep: ScheduleDependency): boolean {
  return dep.status !== "archived" && dep.status !== "resolved" && dep.toInitiativeId !== null;
}

/**
 * The flags of one dependency. `from`/`to` are the predecessor and successor initiatives (`from` is undefined for an
 * external predecessor, whose finish the product does not hold: Unknown). Missing dates give schedule.unknown, never
 * an empty list that would read as "no conflict".
 */
export function dependencyFlags(
  dep: ScheduleDependency,
  from: ScheduleInitiative | undefined,
  to: ScheduleInitiative,
  milestones: readonly ScheduleMilestone[],
): ScheduleFlag[] {
  const flags: ScheduleFlag[] = [];
  const at = { dependencyId: dep.id, initiativeId: to.id };
  const fromName = from?.code ?? dep.fromLabel ?? "external";
  const finish = from ? predecessorFinish(from, milestones) : null;
  const missing: string[] = [];

  // Needed-by conflict.
  if (dep.neededBy === null) missing.push("needed-by date");
  if (finish === null) missing.push(from ? `${from.code} finish date` : `${fromName} finish date (external)`);
  if (dep.neededBy !== null && finish !== null && finish > dep.neededBy)
    flags.push({
      code: SCHEDULE_FLAG_CODES.neededByConflict,
      message: `${fromName} finishes after ${to.code} needs it (${dep.neededBy})`,
      ...at,
    });

  // Sequenced before the predecessor: by date, or by wave order.
  const byWave =
    from !== undefined && from.waveOrdinal !== null && to.waveOrdinal !== null && to.waveOrdinal < from.waveOrdinal;
  const byDate = to.plannedStart !== null && finish !== null && to.plannedStart < finish;
  if (byWave || byDate)
    flags.push({
      code: SCHEDULE_FLAG_CODES.beforePredecessor,
      message: `${to.code} is sequenced before its predecessor ${fromName}`,
      ...at,
    });
  else if (to.plannedStart === null) missing.push(`${to.code} planned start`);

  if (missing.length > 0)
    flags.push({
      code: SCHEDULE_FLAG_CODES.unknown,
      message: `Schedule unknown for ${fromName} → ${to.code}: ${[...new Set(missing)].join(", ")} missing`,
      ...at,
    });
  return flags;
}

/** Every schedule flag of a transformation's graph, by dependency and by successor initiative. */
export function computeScheduleFlags(facts: ScheduleFacts): ScheduleFlags {
  const initiatives = new Map(facts.initiatives.map((i) => [i.id, i]));
  const byDependency = new Map<string, ScheduleFlag[]>();
  const byInitiative = new Map<string, ScheduleFlag[]>();
  for (const dep of facts.dependencies) {
    if (!isScheduled(dep)) continue;
    const to = initiatives.get(dep.toInitiativeId!);
    if (to === undefined) continue;
    const from = dep.fromInitiativeId === null ? undefined : initiatives.get(dep.fromInitiativeId);
    const flags = dependencyFlags(dep, from, to, facts.milestones);
    byDependency.set(dep.id, flags);
    byInitiative.set(to.id, [...(byInitiative.get(to.id) ?? []), ...flags]);
  }
  return { byDependency, byInitiative };
}

// Read-only portfolio facts for the slice J dashboards (T-DG4-KBE-G; ADR-0037 §1 item 2, §2 workstream, §3 Portfolio
// and Dependencies; ADR-0031 schedule network; ADR-0038 §9 workstreams; p4-work-split §J+K JK.4): initiatives with
// their milestones and outcome contributions, workstreams and their active initiatives, the computed critical-path flag
// (true / false / null = not computable, never a guessed false), and the organization's default working calendar
// (ADR-0025 §1; null when none is active, so working-day rules are Unknown). Nothing is written.
import type { DbOrTx } from "@mth/db";
import type { WorkingCalendar } from "@mth/shared/time";
import { loadScheduleNetwork, onCriticalPath } from "./schedule-network.ts";

export interface PortfolioDashboardMilestone {
  readonly milestoneId: string;
  readonly initiativeId: string;
  readonly title: string;
  readonly status: string;
  readonly approvedDate: string | null;
  readonly forecastDate: string | null;
}

export interface PortfolioDashboardInitiative {
  readonly initiativeId: string;
  readonly transformationId: string;
  readonly code: string;
  readonly name: string;
  readonly status: string;
  readonly executiveOwnerUserId: string | null;
  readonly workstreamLeadUserId: string | null;
  readonly milestones: PortfolioDashboardMilestone[];
  /** The outcomes the initiative contributes to (active, not removed contributions). */
  readonly outcomeIds: string[];
}

const dateText = (d: unknown): string | null =>
  d === null || d === undefined ? null : d instanceof Date ? d.toISOString().slice(0, 10) : String(d);

/** The initiatives of the transformations with their milestones and outcome contributions. */
export async function loadPortfolioDashboardInitiatives(
  db: DbOrTx,
  transformationIds: readonly string[],
): Promise<PortfolioDashboardInitiative[]> {
  if (transformationIds.length === 0) return [];
  const ids = [...transformationIds];
  const initiatives = await db
    .selectFrom("initiative")
    .select(["id", "transformation_id", "code", "name", "status", "executive_owner_user_id", "workstream_lead_user_id"])
    .where("transformation_id", "in", ids)
    .orderBy("code")
    .orderBy("id")
    .execute();
  if (initiatives.length === 0) return [];
  const milestones = await db
    .selectFrom("milestone")
    .select(["id", "initiative_id", "title", "status", "approved_date", "forecast_date"])
    .where("transformation_id", "in", ids)
    .orderBy("id")
    .execute();
  const contributions = await db
    .selectFrom("initiative_outcome_contribution")
    .select(["initiative_id", "outcome_id"])
    .where("transformation_id", "in", ids)
    .where("status", "=", "active")
    .where("removed_at", "is", null)
    .execute();
  return initiatives.map((i) => ({
    initiativeId: i.id,
    transformationId: i.transformation_id,
    code: i.code,
    name: i.name,
    status: i.status,
    executiveOwnerUserId: i.executive_owner_user_id,
    workstreamLeadUserId: i.workstream_lead_user_id,
    milestones: milestones
      .filter((m) => m.initiative_id === i.id)
      .map((m) => ({
        milestoneId: m.id,
        initiativeId: m.initiative_id,
        title: m.title,
        status: m.status,
        approvedDate: dateText(m.approved_date),
        forecastDate: dateText(m.forecast_date),
      })),
    outcomeIds: [...new Set(contributions.filter((c) => c.initiative_id === i.id).map((c) => c.outcome_id))],
  }));
}

/** One workstream of a transformation with its active initiative ids (null when it does not exist there). */
export async function loadWorkstreamFacts(db: DbOrTx, transformationId: string, workstreamId: string) {
  const ws = await db
    .selectFrom("workstream")
    .select(["id", "transformation_id", "code", "name", "status", "lead_user_id"])
    .where("transformation_id", "=", transformationId)
    .where("id", "=", workstreamId)
    .executeTakeFirst();
  if (!ws) return null;
  const members = await db
    .selectFrom("workstream_initiative")
    .select("initiative_id")
    .where("workstream_id", "=", workstreamId)
    .where("status", "=", "active")
    .where("removed_at", "is", null)
    .orderBy("initiative_id")
    .execute();
  return {
    workstreamId: ws.id,
    transformationId: ws.transformation_id,
    code: ws.code,
    name: ws.name,
    status: ws.status,
    leadUserId: ws.lead_user_id,
    initiativeIds: members.map((m) => m.initiative_id),
  };
}

/**
 * Whether each initiative is on its transformation's computed critical path (one schedule network per
 * transformation asked for; null = not computable).
 */
export async function loadCriticalPathFlags(
  db: DbOrTx,
  initiatives: readonly { initiativeId: string; transformationId: string }[],
): Promise<Map<string, boolean | null>> {
  const out = new Map<string, boolean | null>();
  const byTransformation = new Map<string, string[]>();
  for (const i of initiatives)
    byTransformation.set(i.transformationId, [...(byTransformation.get(i.transformationId) ?? []), i.initiativeId]);
  for (const [transformationId, initiativeIds] of byTransformation) {
    const network = await loadScheduleNetwork(db, transformationId);
    for (const id of initiativeIds) out.set(id, onCriticalPath(network, id));
  }
  return out;
}

/** The organization's active default business calendar with its active holidays, or null (ADR-0025 §1). */
export async function loadDefaultWorkingCalendar(db: DbOrTx, organizationId: string): Promise<WorkingCalendar | null> {
  const calendar = await db
    .selectFrom("business_calendar")
    .select(["id", "workweek"])
    .where("organization_id", "=", organizationId)
    .where("is_default", "=", true)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (!calendar) return null;
  const holidays = await db
    .selectFrom("business_calendar_holiday")
    .select(["id", "date_from", "date_to"])
    .where("calendar_id", "=", calendar.id)
    .where("status", "=", "active")
    .orderBy("date_from")
    .execute();
  return {
    workweek: calendar.workweek.map(Number),
    holidays: holidays.map((h) => ({ id: h.id, dateFrom: dateText(h.date_from)!, dateTo: dateText(h.date_to)! })),
  };
}

// The dashboard filters, window and as-of date (ADR-0037 §4; REQ-S13-002): organization, transformation (repeatable,
// at most 50), owner, period, phase and status, applied SERVER-SIDE to every headline, row and drill-down of a response
// and echoed in `appliedFilters` (the web's chips). The business date is today in the organization's default calendar
// timezone (Asia/Riyadh unless configured, ADR-0025 §2); with a period filter the window is [period start, period end]
// and the as-of date is the earlier of the period's end and the business date. Refusals are the exact ADR-0037 §13
// texts: 422 dashboard.period_not_found (at /periodId) and dashboard.owner_not_found (at /ownerUserId).
import { sql, type DbOrTx } from "@mth/db";
import { PHASES, PROBLEM_TYPES, TRANSFORMATION_STATUSES } from "@mth/shared";
import { DASHBOARD_REFUSALS, type DashboardFilters, type DashboardRefusalCode } from "@mth/shared/schemas";
import { z } from "zod";
import { HttpProblem } from "../../platform/index.ts";
import type { DashboardClock } from "./areas.ts";

/** A 422 with the exact ADR-0037 §13 text and the field pointer. */
export function dashboardRefusal(code: DashboardRefusalCode, pointer: string): HttpProblem {
  const detail = new Map<string, string>(Object.entries(DASHBOARD_REFUSALS)).get(code)!;
  return new HttpProblem({
    status: 422,
    type: PROBLEM_TYPES.validation,
    code,
    title: "Business rule violated",
    detail,
    errors: [{ pointer, code, message: detail }],
  });
}

/** A repeatable uuid query parameter (one value or an array of at most 50). */
const transformationIds = z.union([z.uuid(), z.array(z.uuid()).max(50)]).optional();

/** The filters of the organization-wide reads (getExecutiveOverview, getDashboardDrilldown). */
export const organizationFilterShape = {
  organizationId: z.uuid(),
  transformationId: transformationIds,
  ownerUserId: z.uuid().optional(),
  periodId: z.uuid().optional(),
  phase: z.enum(PHASES).optional(),
  status: z.enum(TRANSFORMATION_STATUSES).optional(),
};

/** The filters of the one-transformation reads (getTransformationDashboard, getWorkstreamDashboard). */
export const transformationFilterQuery = z.strictObject({
  ownerUserId: z.uuid().optional(),
  periodId: z.uuid().optional(),
});

export const asIdList = (v: string | string[] | undefined): string[] =>
  v === undefined ? [] : [...new Set(Array.isArray(v) ? v : [v])];

export interface ResolvedPeriod {
  readonly id: string;
  readonly label: string;
  readonly frequency: string;
  readonly start: string;
  readonly end: string;
}

export interface ResolvedFilters {
  readonly organizationId: string;
  readonly transformationIds: readonly string[];
  readonly ownerUserId: string | null;
  readonly period: ResolvedPeriod | null;
  readonly phase: string | null;
  readonly status: string | null;
  readonly businessDate: string;
  readonly timezone: string;
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
  readonly asOf: string;
}

/** The organization's default calendar timezone (Asia/Riyadh by default) and today's business date in it. */
export async function businessClockOf(db: DbOrTx, organizationId: string): Promise<{ timezone: string; date: string }> {
  const r = await sql<{ tz: string; d: string }>`
    SELECT x.tz, p4_business_date(now(), x.tz)::text AS d
    FROM (SELECT coalesce(
      (SELECT c.timezone FROM business_calendar c
        WHERE c.organization_id = ${organizationId}::uuid AND c.is_default AND c.status = 'active' LIMIT 1),
      (SELECT o.default_timezone FROM organization o WHERE o.id = ${organizationId}::uuid)) AS tz) x`.execute(db);
  return { timezone: r.rows[0]!.tz, date: r.rows[0]!.d };
}

/** Validates the owner and the period against the organization (422s) and computes the window and as-of date. */
export async function resolveFilters(
  db: DbOrTx,
  input: {
    organizationId: string;
    transformationIds: readonly string[];
    ownerUserId?: string | undefined;
    periodId?: string | undefined;
    phase?: string | undefined;
    status?: string | undefined;
  },
): Promise<ResolvedFilters> {
  const clock = await businessClockOf(db, input.organizationId);
  let period: ResolvedPeriod | null = null;
  if (input.periodId !== undefined) {
    const p = await db
      .selectFrom("reporting_period")
      .select(["id", "period_label", "frequency", "period_start", "period_end"])
      .where("organization_id", "=", input.organizationId)
      .where("id", "=", input.periodId)
      .executeTakeFirst();
    if (!p) throw dashboardRefusal("dashboard.period_not_found", "/periodId");
    period = { id: p.id, label: p.period_label, frequency: p.frequency, start: p.period_start, end: p.period_end };
  }
  if (input.ownerUserId !== undefined) {
    const u = await db
      .selectFrom("app_user")
      .select("id")
      .where("organization_id", "=", input.organizationId)
      .where("id", "=", input.ownerUserId)
      .executeTakeFirst();
    if (!u) throw dashboardRefusal("dashboard.owner_not_found", "/ownerUserId");
  }
  const asOf = period !== null && period.end < clock.date ? period.end : clock.date;
  return {
    organizationId: input.organizationId,
    transformationIds: input.transformationIds,
    ownerUserId: input.ownerUserId ?? null,
    period,
    phase: input.phase ?? null,
    status: input.status ?? null,
    businessDate: clock.date,
    timezone: clock.timezone,
    windowStart: period?.start ?? null,
    windowEnd: period?.end ?? null,
    asOf,
  };
}

/** `appliedFilters` of a response (REQ-S13-002 chips). */
export function appliedFilters(f: ResolvedFilters): DashboardFilters {
  return {
    organizationId: f.organizationId,
    transformationIds: [...f.transformationIds],
    ownerUserId: f.ownerUserId,
    periodId: f.period?.id ?? null,
    periodLabel: f.period?.label ?? null,
    phase: (f.phase ?? null) as DashboardFilters["phase"],
    status: (f.status ?? null) as DashboardFilters["status"],
    windowStart: f.windowStart,
    windowEnd: f.windowEnd,
    asOf: f.asOf,
  };
}

/** The pure clock of the area rules. */
export function clockOf(f: ResolvedFilters, calendar: DashboardClock["calendar"]): DashboardClock {
  return { businessDate: f.businessDate, asOf: f.asOf, windowStart: f.windowStart, windowEnd: f.windowEnd, calendar };
}

/**
 * The drill-down query string carrying the same filters (headline `drilldownHref`). `valueClass` (ADR-0037 amendment
 * K1) is appended last, and only when given, so every href without it is unchanged.
 */
export function drilldownHref(
  metric: string,
  f: ResolvedFilters,
  extra: { transformationIds?: readonly string[]; subjectId?: string; valueClass?: string } = {},
): string {
  const q = new URLSearchParams();
  q.set("metric", metric);
  q.set("organizationId", f.organizationId);
  for (const id of extra.transformationIds ?? f.transformationIds) q.append("transformationId", id);
  if (f.ownerUserId) q.set("ownerUserId", f.ownerUserId);
  if (f.period) q.set("periodId", f.period.id);
  if (f.phase) q.set("phase", f.phase);
  if (f.status) q.set("status", f.status);
  if (extra.subjectId) q.set("subjectId", extra.subjectId);
  if (extra.valueClass) q.set("valueClass", extra.valueClass);
  return `/api/v1/dashboard-drilldown?${q.toString()}`;
}

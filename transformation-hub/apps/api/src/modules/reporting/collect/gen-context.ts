import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { schema } from '@hub/db';
import type { Classification, WorkingCalendar } from '@hub/domain';
import type { DbService } from '../../../platform/db.service';
import type { RequestContext } from '../../../platform/context';
import type { ReportAccess } from '../report-access';

export type ProjectRow = typeof schema.project.$inferSelect;

/**
 * Everything a collector needs to read records AS THE GENERATOR: the request transaction (RLS scope of the caller), the
 * policy helpers, the project, the as-of business date and the optional workstream limit of the report.
 */
export interface Gen {
  db: DbService;
  access: ReportAccess;
  ctx: RequestContext;
  projectId: string;
  project: ProjectRow;
  today: string;
  calendar: WorkingCalendar;
  /** Report limited to one workstream (weekly / look-ahead), or null for the whole project within the caller's reach. */
  workstreamId: string | null;
  /** Classification records without their own classification take (planning uses the project's classification). */
  baseClassification: Classification;
}

/** WHERE predicate for workstream-structured records: visibility + reach of `permission` (+ the report's workstream). */
export function reachWhere(g: Gen, permission: string, wsCol: PgColumn): SQL {
  return and(
    g.access.policy.visibilitySql(g.ctx, g.projectId, {}),
    g.access.policy.reachSql(g.ctx, permission, g.projectId, wsCol),
    g.workstreamId ? eq(wsCol, g.workstreamId) : undefined,
  )!;
}

/** Display names of users referenced by a report (org directory, RLS-scoped). */
export async function displayNames(g: Gen, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map();
  const rows = await g.db.tx().select({ id: schema.appUser.id, name: schema.appUser.displayName }).from(schema.appUser).where(inArray(schema.appUser.id, list));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Workstream codes by id (for "workstream" columns). */
export async function workstreamCodes(g: Gen): Promise<Map<string, { code: string; name: string; nameAr: string | null }>> {
  const rows = await g.db
    .tx()
    .select({ id: schema.workstream.id, code: schema.workstream.code, name: schema.workstream.name, nameAr: schema.workstream.nameAr })
    .from(schema.workstream)
    .where(eq(schema.workstream.projectId, g.projectId));
  return new Map(rows.map((r) => [r.id, { code: r.code, name: r.name, nameAr: r.nameAr }]));
}

export const nn = <T>(x: T | null | undefined): x is T => x !== null && x !== undefined;
export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
export const num = (x: string | number | null | undefined): number | null => (x === null || x === undefined ? null : Number(x));
export const sqlTrue = sql`true`;

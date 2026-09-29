import { Injectable } from '@nestjs/common';
import { and, eq, sql, SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { schema } from '@hub/db';
import { conflict, notFound } from '@hub/domain';
import { DbService } from './db.service';
import { newId } from './ids';

/** Standard paginated response. Totals are computed inside the caller's scope only. */
export function pageOf<T>(items: T[], total: number, q: { page: number; pageSize: number }) {
  return { items, page: q.page, pageSize: q.pageSize, total };
}

export const offsetOf = (q: { page: number; pageSize: number }) => (q.page - 1) * q.pageSize;

/** Throws 409 unless the row's version matches (optimistic concurrency, AT-16). */
export function assertVersion(current: { version: number }, expected: number, what = 'record') {
  if (current.version !== expected) {
    throw conflict('concurrency.version_mismatch', `The ${what} was changed by someone else — reload and review before retrying`, {
      expectedVersion: expected,
      currentVersion: current.version,
    });
  }
}

/** SQL fragment incrementing the version column. */
export const bump = (col: PgColumn) => sql`${col} + 1`;

/**
 * Versioned update: `UPDATE ... SET ..., version = version + 1 WHERE id = ? AND project_id = ? AND version = expected`.
 * Returns the updated row or throws 409 (concurrent change) — never a silent lost update.
 */
export async function updateVersioned<T extends PgTable & { id: PgColumn; projectId: PgColumn; version: PgColumn; updatedAt?: PgColumn }>(
  db: DbService,
  table: T,
  where: { id: string; projectId: string; expectedVersion: number },
  values: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const t = table as unknown as { id: PgColumn; projectId: PgColumn; version: PgColumn; updatedAt?: PgColumn };
  const set: Record<string, unknown> = { ...values, version: sql`${t.version} + 1` };
  if (t.updatedAt) set['updatedAt'] = new Date();
  const res = await db
    .tx()
    .update(table)
    .set(set as never)
    .where(and(eq(t.id, where.id), eq(t.projectId, where.projectId), eq(t.version, where.expectedVersion)) as SQL)
    .returning();
  const row = (res as Record<string, unknown>[])[0];
  if (!row) {
    const exists = await db.tx().select({ v: t.version }).from(table as PgTable).where(and(eq(t.id, where.id), eq(t.projectId, where.projectId)) as SQL);
    if (!exists[0]) throw notFound();
    throw conflict('concurrency.version_mismatch', 'The record was changed by someone else — reload and review before retrying', {
      expectedVersion: where.expectedVersion,
      currentVersion: (exists[0] as { v: number }).v,
    });
  }
  return row;
}

/** Load a row by id within a project or throw 404 (never reveals rows of other projects). */
export async function loadInProject<T extends PgTable & { id: PgColumn; projectId: PgColumn }>(db: DbService, table: T, projectId: string, id: string) {
  const t = table as unknown as { id: PgColumn; projectId: PgColumn };
  const rows = await db.tx().select().from(table as PgTable).where(and(eq(t.id, id), eq(t.projectId, projectId)) as SQL);
  const row = rows[0] as T['$inferSelect'] | undefined;
  if (!row) throw notFound();
  return row;
}

/** Immutable version history for versioned records (perimeter items, charters, agreements, baselines…). */
@Injectable()
export class RecordVersionService {
  constructor(private readonly db: DbService) {}

  async snapshot(input: { projectId: string | null; entityType: string; entityId: string; versionNo: number; snapshot: Record<string, unknown>; reason?: string }) {
    const ctx = this.db.ctx();
    await this.db
      .tx()
      .insert(schema.recordVersion)
      .values({
        id: newId(),
        orgId: ctx.principal.orgId,
        projectId: input.projectId,
        entityType: input.entityType,
        entityId: input.entityId,
        versionNo: input.versionNo,
        snapshot: JSON.parse(JSON.stringify(input.snapshot)),
        reason: input.reason ?? null,
        changedBy: ctx.principal.userId,
      })
      .onConflictDoNothing();
  }

  async history(entityType: string, entityId: string) {
    return this.db
      .tx()
      .select()
      .from(schema.recordVersion)
      .where(and(eq(schema.recordVersion.entityType, entityType), eq(schema.recordVersion.entityId, entityId)))
      .orderBy(schema.recordVersion.versionNo);
  }
}

/** Sequential human-readable codes per project and prefix (e.g. DEC-001). */
export async function nextCode(db: DbService, table: PgTable & { projectId: PgColumn; code: PgColumn }, projectId: string, prefix: string): Promise<string> {
  const t = table as unknown as { projectId: PgColumn; code: PgColumn };
  const r = await db
    .tx()
    .select({ n: sql<number>`count(*)::int` })
    .from(table as PgTable)
    .where(and(eq(t.projectId, projectId), sql`${t.code} like ${prefix + '-%'}`) as SQL);
  return `${prefix}-${String((r[0]?.n ?? 0) + 1).padStart(3, '0')}`;
}

/** Count active evidence links for a target (shared read used by gates, CPs, readiness, transfers…). */
export async function activeEvidenceCount(db: DbService, projectId: string, targetType: string, targetId: string): Promise<{ active: number; conflicting: number }> {
  const r = await db.tx().execute<{ active: number; conflicting: number }>(sql`
    select count(*) filter (where status = 'active')::int as active, count(*) filter (where status = 'conflicting')::int as conflicting
      from evidence_link where project_id = ${projectId} and target_type = ${targetType} and target_id = ${targetId}`);
  return r.rows[0] ?? { active: 0, conflicting: 0 };
}

/**
 * ILIKE "contains" pattern with the user's text matched LITERALLY: `%`, `_` and `\` are escaped (PostgreSQL's default LIKE
 * escape character is backslash), so a search for "%" does not enumerate every row (QA-P1-06).
 */
export function likeContains(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

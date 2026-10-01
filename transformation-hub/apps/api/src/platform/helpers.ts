import { Injectable } from '@nestjs/common';
import { and, eq, sql, SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { schema } from '@hub/db';
import { conflict, notFound } from '@hub/domain';
import { DbService } from './db.service';
import { newId } from './ids';
import type { PolicyService } from './policy.service';
import type { RequestContext } from './context';

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

/**
 * Evidence links the caller may see (SEC-P1R-05): the link's own (document-derived) room and, when a document is linked,
 * the document's classification and room — the same predicate as the evidence list (`documents.listEvidence`). Expects the
 * query to alias `evidence_link` as `e` and LEFT JOIN `document` as `d` on `d.id = e.document_id`.
 */
export function evidenceLinkVisibleSql(policy: PolicyService, ctx: RequestContext, projectId: string): SQL {
  const col = (s: string) => sql.raw(s) as unknown as PgColumn;
  return sql`(${policy.visibilitySql(ctx, projectId, { room: col('e.room_id') })} and (e.document_id is null or ${policy.visibilitySql(ctx, projectId, { classification: col('d.classification'), room: col('d.room_id') })}))`;
}

/**
 * Evidence COUNTERS FOR DISPLAY (register rows, detail views): counted with the same visibility as the evidence list, so a
 * counter never reveals that restricted / clean-team evidence exists on a record (SEC-P1R-05). Rule evaluation (gates,
 * sign-off, verification) keeps using the unfiltered `activeEvidenceCount` — every piece of evidence counts for a rule.
 */
export async function visibleEvidenceCounts(
  db: DbService,
  policy: PolicyService,
  ctx: RequestContext,
  projectId: string,
  targetType: string,
  ids: string[],
): Promise<Map<string, { active: number; conflicting: number }>> {
  if (!ids.length) return new Map();
  const r = await db.tx().execute<{ target_id: string; active: number; conflicting: number }>(sql`
    select e.target_id, count(*) filter (where e.status = 'active')::int as active, count(*) filter (where e.status = 'conflicting')::int as conflicting
      from evidence_link e left join document d on d.id = e.document_id and d.project_id = e.project_id
     where e.project_id = ${projectId} and e.target_type = ${targetType}
       and e.target_id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})
       and ${evidenceLinkVisibleSql(policy, ctx, projectId)}
     group by e.target_id`);
  return new Map(r.rows.map((x) => [x.target_id, { active: Number(x.active), conflicting: Number(x.conflicting) }]));
}

/**
 * "The person who recorded the evidence" of a record (access-matrix §5.1) — ONE definition for every verification
 * (SEC-P34-01, SEC-P34R-03, SEC-P34R-09): every person who linked the record's CURRENT evidence (active or conflicting
 * links; rejected / superseded ones are no longer relied on) and every uploader of a document version those links rely on
 * — the same "self" as `documents.evidence.verify`. FOR RULES: read under the request's RLS, where a full project member
 * (every verifier is one) sees every link and version of the project, whatever the caller may open.
 */
export async function evidenceSelfIds(db: DbService, projectId: string, targetType: string, targetId: string): Promise<string[]> {
  const r = await db.tx().execute<{ who: string }>(sql`
    select distinct who::text as who from (
      select e.added_by as who from evidence_link e
       where e.project_id = ${projectId} and e.target_type = ${targetType} and e.target_id = ${targetId} and e.status in ('active', 'conflicting')
      union
      select v.uploaded_by as who from evidence_link e
        join document_version v on v.id = e.document_version_id and v.project_id = e.project_id
       where e.project_id = ${projectId} and e.target_type = ${targetType} and e.target_id = ${targetId} and e.status in ('active', 'conflicting')
    ) s where who is not null`);
  return r.rows.map((x) => x.who);
}

/**
 * SQL form of {@link evidenceSelfIds} for lists (e.g. My Work, SEC-P34R-04): TRUE when `userId` linked the target's current
 * evidence or uploaded a linked version — the verification command would refuse that person.
 */
export function evidenceSelfSql(projectId: PgColumn | SQL, targetType: string, targetId: PgColumn | SQL, userId: string): SQL {
  return sql`exists (select 1 from evidence_link hub_es
      left join document_version hub_esv on hub_esv.id = hub_es.document_version_id and hub_esv.project_id = hub_es.project_id
     where hub_es.project_id = ${projectId} and hub_es.target_type = ${targetType} and hub_es.target_id = ${targetId}
       and hub_es.status in ('active', 'conflicting') and (hub_es.added_by = ${userId}::uuid or hub_esv.uploaded_by = ${userId}::uuid))`;
}

/** Count active evidence links for a target — FOR RULES (shared read used by gates, CPs, readiness, transfers…). */
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

/** RFC 6266 / 5987 attachment header with an ASCII fallback (the filename is already sanitised at upload). */
export function attachmentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

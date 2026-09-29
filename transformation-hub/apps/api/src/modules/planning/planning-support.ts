import { Injectable } from '@nestjs/common';
import { and, eq, inArray, sql, SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { createHash } from 'node:crypto';
import { schema } from '@hub/db';
import { Classification, WorkingCalendar, canonicalJson, conflict, forbidden, invalid, notFound, ruleViolation } from '@hub/domain';
import { DbService } from '../../platform/db.service';
import { PolicyService } from '../../platform/policy.service';
import { Clock } from '../../platform/clock';
import type { RequestContext } from '../../platform/context';

export interface ProjectInfo {
  id: string;
  code: string;
  classification: Classification;
  timezone: string;
  workingDays: number[];
  plannedStart: string | null;
  isDemo: boolean;
}

export interface ActAttrs {
  workstreamId?: string | null;
  /** Owner / assignee / creator ids (access-matrix `own_workstream`); pass [actor] for a create. */
  ownerUserIds?: (string | null | undefined)[];
  requesterUserId?: string | null;
  withinAuthority?: boolean;
}

const projectCache = new WeakMap<RequestContext, Map<string, ProjectInfo>>();

/**
 * Shared helpers for the planning services: project facts (calendar, classification, "today" in the project timezone),
 * authorization shorthands with the project's classification, workstream read scoping, membership checks, evidence
 * counts and snapshot hashing. Never trusts submitted ids: everything is loaded inside the project.
 */
@Injectable()
export class PlanningSupport {
  constructor(
    readonly db: DbService,
    readonly policy: PolicyService,
    readonly clock: Clock,
  ) {}

  async project(ctx: RequestContext, projectId: string): Promise<ProjectInfo> {
    let m = projectCache.get(ctx);
    if (!m) projectCache.set(ctx, (m = new Map()));
    const hit = m.get(projectId);
    if (hit) return hit;
    const [p] = await this.db
      .tx()
      .select({
        id: schema.project.id,
        code: schema.project.code,
        classification: schema.project.classification,
        timezone: schema.project.timezone,
        workingDays: schema.project.workingDays,
        plannedStart: schema.project.plannedStart,
        isDemo: schema.project.isDemo,
      })
      .from(schema.project)
      .where(eq(schema.project.id, projectId));
    if (!p) throw notFound();
    const info: ProjectInfo = { ...p, classification: p.classification as Classification, workingDays: p.workingDays ?? [0, 1, 2, 3, 4] };
    m.set(projectId, info);
    return info;
  }

  today(p: ProjectInfo): string {
    return this.clock.today(p.timezone);
  }

  async calendar(p: ProjectInfo): Promise<WorkingCalendar> {
    const rows = await this.db.tx().select({ date: schema.calendarHoliday.date }).from(schema.calendarHoliday).where(eq(schema.calendarHoliday.projectId, p.id));
    return { timezone: p.timezone, workingDays: p.workingDays, holidays: rows.map((r) => r.date).sort() };
  }

  /** RBAC + ABAC with the project's classification. */
  assert(ctx: RequestContext, permission: string, p: ProjectInfo, attrs: ActAttrs = {}) {
    this.policy.assert(ctx, permission, { projectId: p.id, classification: p.classification, ...attrs });
  }

  can(ctx: RequestContext, permission: string, p: ProjectInfo, attrs: ActAttrs = {}): boolean {
    return this.policy.can(ctx, permission, { projectId: p.id, classification: p.classification, ...attrs });
  }

  /**
   * Read scope for planning records: `null` = whole project (project-wide read grant); otherwise the set of workstreams
   * where a workstream-scoped role grants planning.plan.read (workstream-scoped grants apply only to those workstreams).
   */
  readScope(ctx: RequestContext, p: ProjectInfo): Set<string> | null {
    if (!this.policy.canSee(ctx, { projectId: p.id, classification: p.classification })) throw notFound();
    const reach = this.policy.permissionReach(ctx, 'planning.plan.read', p.id);
    if (reach.all) return null;
    if (reach.workstreamIds.length === 0) throw notFound();
    return new Set(reach.workstreamIds);
  }

  /** SQL filter for lists AND counts: visibility + workstream reach of planning.plan.read (ARCH-14). */
  scopeSql(ctx: RequestContext, p: ProjectInfo, wsCol: PgColumn): SQL {
    this.readScope(ctx, p);
    return and(this.policy.visibilitySql(ctx, p.id, {}), this.policy.reachSql(ctx, 'planning.plan.read', p.id, wsCol))!;
  }

  /** 404 unless a record of this workstream is readable by the caller. */
  assertReadable(ctx: RequestContext, p: ProjectInfo, workstreamId: string | null) {
    const scope = this.readScope(ctx, p);
    if (scope && (!workstreamId || !scope.has(workstreamId))) throw notFound();
  }

  /** Project-level aggregates (schedule, baselines, change requests, progress) need a project-wide read grant. */
  assertProjectRead(ctx: RequestContext, p: ProjectInfo) {
    this.assert(ctx, 'planning.plan.read', p);
  }

  /** The user must be an active member of the project (owners/assignees are never outsiders). */
  async assertMember(projectId: string, userId: string) {
    const r = await this.db.tx().execute<{ ok: boolean }>(sql`
      select exists (
        select 1 from project_membership m join app_user u on u.id = m.user_id
         where m.project_id = ${projectId} and m.user_id = ${userId} and m.revoked_at is null
           and (m.valid_to is null or m.valid_to > now()) and u.is_active
      ) as ok`);
    if (!r.rows[0]?.ok) throw invalid('planning.user_not_member', 'The selected person is not an active member of this project');
  }

  async userNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
    const uniq = [...new Set(ids.filter((x): x is string => !!x))];
    if (uniq.length === 0) return new Map();
    const rows = await this.db.tx().select({ id: schema.appUser.id, n: schema.appUser.displayName }).from(schema.appUser).where(inArray(schema.appUser.id, uniq));
    return new Map(rows.map((r) => [r.id, r.n]));
  }

  async workstreamCodes(projectId: string): Promise<Map<string, { code: string; name: string; leadUserId: string | null }>> {
    const rows = await this.db
      .tx()
      .select({ id: schema.workstream.id, code: schema.workstream.code, name: schema.workstream.name, leadUserId: schema.workstream.leadUserId })
      .from(schema.workstream)
      .where(eq(schema.workstream.projectId, projectId));
    return new Map(rows.map((r) => [r.id, { code: r.code, name: r.name, leadUserId: r.leadUserId }]));
  }

  /** Active/conflicting evidence counts for many targets of one type. */
  async evidenceCounts(projectId: string, targetType: string, ids: string[]): Promise<Map<string, { active: number; conflicting: number }>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .tx()
      .select({
        id: schema.evidenceLink.targetId,
        active: sql<number>`count(*) filter (where ${schema.evidenceLink.status} = 'active')::int`,
        conflicting: sql<number>`count(*) filter (where ${schema.evidenceLink.status} = 'conflicting')::int`,
      })
      .from(schema.evidenceLink)
      .where(and(eq(schema.evidenceLink.projectId, projectId), eq(schema.evidenceLink.targetType, targetType), inArray(schema.evidenceLink.targetId, ids)))
      .groupBy(schema.evidenceLink.targetId);
    return new Map(rows.map((r) => [r.id, { active: Number(r.active), conflicting: Number(r.conflicting) }]));
  }

  /** Evidence gate for acceptance/verification: ≥1 active link and no unresolved conflicting evidence. */
  async assertEvidence(projectId: string, targetType: string, targetId: string) {
    const c = (await this.evidenceCounts(projectId, targetType, [targetId])).get(targetId) ?? { active: 0, conflicting: 0 };
    if (c.active < 1) throw ruleViolation(`${targetType}.evidence_required`, 'At least one active evidence link is required before acceptance/verification');
    if (c.conflicting > 0) throw ruleViolation(`${targetType}.evidence_conflict`, 'Conflicting evidence must be resolved before acceptance/verification');
  }

  /** Lock a row (SELECT … FOR UPDATE) inside the project so concurrent commands serialize; 404 when absent. */
  async lockInProject<T extends PgTable>(table: T, projectId: string, id: string): Promise<T['$inferSelect']> {
    const t = table as unknown as { id: PgColumn; projectId: PgColumn };
    const rows = await this.db
      .tx()
      .select()
      .from(table as PgTable)
      .where(and(eq(t.id, id), eq(t.projectId, projectId)) as SQL)
      .for('update');
    const row = rows[0] as T['$inferSelect'] | undefined;
    if (!row) throw notFound();
    return row;
  }

  /** Serialize graph mutations per project (cycle checks must see a stable edge set). */
  async lockProjectGraph(projectId: string) {
    await this.db.tx().execute(sql`select pg_advisory_xact_lock(hashtextextended(${'planning.graph:' + projectId}, 0))`);
  }

  hash(v: unknown): string {
    return createHash('sha256').update(canonicalJson(v)).digest('hex');
  }

  assertVersion(row: { version: number }, expected: number, what = 'record') {
    if (row.version !== expected) {
      throw conflict('concurrency.version_mismatch', `The ${what} was changed by someone else — reload and review before retrying`, { expectedVersion: expected, currentVersion: row.version });
    }
  }

  /** Validates a date range (start ≤ finish) when both are present. */
  assertRange(start: string | null | undefined, finish: string | null | undefined, what: string) {
    if (start && finish && start > finish) throw ruleViolation('planning.invalid_date_range', `${what}: start must be on or before finish`, { start, finish });
  }

  async activeRaci(projectId: string, entityType: string, entityId: string, userId: string, raci: 'R' | 'C' | 'I'): Promise<boolean> {
    const r = await this.db
      .tx()
      .select({ id: schema.raciAssignment.id })
      .from(schema.raciAssignment)
      .where(and(eq(schema.raciAssignment.projectId, projectId), eq(schema.raciAssignment.entityType, entityType), eq(schema.raciAssignment.entityId, entityId), eq(schema.raciAssignment.userId, userId), eq(schema.raciAssignment.raci, raci)))
      .limit(1);
    return r.length > 0;
  }

  /**
   * "Update progress on items the actor owns or is assigned" (planning.task.update_progress): managers of the item's
   * workstream (planning.task.manage) may act for anyone; others must be the accountable owner or a Responsible assignee.
   */
  async assertOwnerOrAssigned(ctx: RequestContext, p: ProjectInfo, entity: { type: 'task' | 'milestone' | 'deliverable'; id: string; workstreamId: string | null; ownerUserId: string | null }) {
    const me = ctx.principal.userId;
    const assigned = !!me && (await this.activeRaci(p.id, entity.type, entity.id, me, 'R'));
    const attrs = { workstreamId: entity.workstreamId, ownerUserIds: [entity.ownerUserId, assigned ? me : null] };
    const notAssigned = () => forbidden('planning.not_assigned', 'Only the accountable owner, a Responsible (R) assignee or the workstream/project manager can do this');
    if (!this.can(ctx, 'planning.task.update_progress', p, attrs)) {
      // RBAC and visibility hold, only ownership fails (access-matrix own_workstream) → the specific error.
      if (this.can(ctx, 'planning.task.update_progress', p, { workstreamId: entity.workstreamId, ownerUserIds: [me] })) throw notAssigned();
      this.assert(ctx, 'planning.task.update_progress', p, attrs); // throws the generic 404/403
    }
    if (this.can(ctx, 'planning.task.manage', p, { workstreamId: entity.workstreamId })) return;
    if (me && entity.ownerUserId === me) return;
    if (assigned) return;
    throw notAssigned();
  }

  /** Current approved baseline row (or null). */
  async currentBaselineRow(projectId: string) {
    const [b] = await this.db
      .tx()
      .select()
      .from(schema.baselineVersion)
      .where(and(eq(schema.baselineVersion.projectId, projectId), eq(schema.baselineVersion.status, 'approved')))
      .limit(1);
    return b ?? null;
  }
}

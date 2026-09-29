import { Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@hub/db';
import { Classification, clearanceAllows, forbidden, invalid, notFound } from '@hub/domain';
import { DbService } from '../../platform/db.service';
import { PolicyService } from '../../platform/policy.service';
import { Clock } from '../../platform/clock';
import type { RequestContext } from '../../platform/context';

export interface NewcoProject {
  id: string;
  orgId: string;
  classification: Classification;
  timezone: string;
  isDemo: boolean;
}

const cache = new WeakMap<RequestContext, Map<string, NewcoProject>>();

/**
 * Helpers for the NewCo services. The NewCo registers are project-level (no workstream): reads and writes need a
 * project-wide grant; read denials are 404 so existence does not leak.
 */
@Injectable()
export class NewcoSupport {
  constructor(
    readonly db: DbService,
    readonly policy: PolicyService,
    readonly clock: Clock,
  ) {}

  async project(ctx: RequestContext, projectId: string): Promise<NewcoProject> {
    let m = cache.get(ctx);
    if (!m) cache.set(ctx, (m = new Map()));
    const hit = m.get(projectId);
    if (hit) return hit;
    const [p] = await this.db
      .tx()
      .select({ id: schema.project.id, orgId: schema.project.orgId, classification: schema.project.classification, timezone: schema.project.timezone, isDemo: schema.project.isDemo })
      .from(schema.project)
      .where(eq(schema.project.id, projectId));
    if (!p) throw notFound();
    if (!this.policy.canSee(ctx, { projectId, classification: p.classification as Classification })) throw notFound();
    const info = { ...p, classification: p.classification as Classification };
    m.set(projectId, info);
    return info;
  }

  today(p: NewcoProject) {
    return this.clock.today(p.timezone);
  }

  assertProjectRead(ctx: RequestContext, p: NewcoProject, permission: string) {
    if (!this.policy.permissionReach(ctx, permission, p.id).all || !this.policy.can(ctx, permission, { projectId: p.id, classification: p.classification })) throw notFound();
  }

  /** Mutations: project-wide grant + RBAC/ABAC (403 when visible but not allowed). */
  assertManage(ctx: RequestContext, p: NewcoProject, permission: string, attrs: { classification?: Classification; requesterUserId?: string | null } = {}) {
    if (!this.policy.permissionReach(ctx, permission, p.id).all) throw forbidden('policy.forbidden', `Missing project-wide permission ${permission}`);
    this.policy.assert(ctx, permission, { projectId: p.id, classification: attrs.classification ?? p.classification, requesterUserId: attrs.requesterUserId ?? null });
  }

  assertClassificationAllowed(ctx: RequestContext, c: Classification) {
    if (ctx.principal.kind !== 'service' && !clearanceAllows(ctx.principal.clearance, c)) {
      throw forbidden('newco.classification_above_clearance', 'You cannot classify a record above your own clearance');
    }
  }

  async assertMember(projectId: string, userId: string, field = 'user') {
    const r = await this.db.tx().execute<{ ok: boolean }>(sql`
      select exists (
        select 1 from project_membership m join app_user u on u.id = m.user_id
         where m.project_id = ${projectId} and m.user_id = ${userId} and m.revoked_at is null
           and (m.valid_to is null or m.valid_to > now()) and u.is_active
      ) as ok`);
    if (!r.rows[0]?.ok) throw invalid('newco.user_not_member', `The selected ${field} is not an active member of this project`);
  }

  async assertEntityInProject(projectId: string, legalEntityId: string) {
    const [pe] = await this.db
      .tx()
      .select({ id: schema.projectEntity.id })
      .from(schema.projectEntity)
      .where(and(eq(schema.projectEntity.projectId, projectId), eq(schema.projectEntity.legalEntityId, legalEntityId)))
      .limit(1);
    if (!pe) throw invalid('newco.entity_not_in_project', 'The legal entity is not linked to this project');
  }

  async userNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
    const uniq = [...new Set(ids.filter((x): x is string => !!x))];
    if (uniq.length === 0) return new Map();
    const rows = await this.db.tx().select({ id: schema.appUser.id, n: schema.appUser.displayName }).from(schema.appUser).where(inArray(schema.appUser.id, uniq));
    return new Map(rows.map((r) => [r.id, r.n]));
  }

  person(names: Map<string, string>, id: string | null | undefined) {
    return id ? { userId: id, name: names.get(id) ?? null } : null;
  }

  async evidenceCounts(projectId: string, targetType: string, ids: string[]): Promise<Map<string, { active: number; conflicting: number }>> {
    if (ids.length === 0) return new Map();
    const E = schema.evidenceLink;
    const rows = await this.db
      .tx()
      .select({
        id: E.targetId,
        active: sql<number>`count(*) filter (where ${E.status} = 'active')::int`,
        conflicting: sql<number>`count(*) filter (where ${E.status} = 'conflicting')::int`,
      })
      .from(E)
      .where(and(eq(E.projectId, projectId), eq(E.targetType, targetType), inArray(E.targetId, ids)))
      .groupBy(E.targetId);
    return new Map(rows.map((r) => [r.id, { active: Number(r.active), conflicting: Number(r.conflicting) }]));
  }
}

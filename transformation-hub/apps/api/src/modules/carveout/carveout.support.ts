import { Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@hub/db';
import { Classification, clearanceAllows, forbidden, invalid, notFound } from '@hub/domain';
import { DbService } from '../../platform/db.service';
import { PolicyService, ResourceAttrs } from '../../platform/policy.service';
import { Clock } from '../../platform/clock';
import type { RequestContext } from '../../platform/context';

export interface CarveoutProject {
  id: string;
  orgId: string;
  classification: Classification;
  timezone: string;
  isDemo: boolean;
}

export interface BaselineScope {
  /** Current approved planning baseline (its snapshot lists the in-scope perimeter item ids). */
  planning: { id: string; versionNo: number; itemIds: Set<string> } | null;
  /** Current approved perimeter version (REQ-SET-012) and its in-scope item ids. */
  perimeterVersion: { id: string; versionNo: number; itemIds: Set<string> } | null;
}

export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

const projectCache = new WeakMap<RequestContext, Map<string, CarveoutProject>>();

/**
 * Shared helpers for the carve-out services: project facts, read/visibility checks (read denials are 404 so existence
 * is not leaked), membership checks for named owners, evidence counts, and the approved baseline scope.
 * Never trusts a submitted id: everything is loaded inside the project.
 */
@Injectable()
export class CarveoutSupport {
  constructor(
    readonly db: DbService,
    readonly policy: PolicyService,
    readonly clock: Clock,
  ) {}

  async project(ctx: RequestContext, projectId: string): Promise<CarveoutProject> {
    let m = projectCache.get(ctx);
    if (!m) projectCache.set(ctx, (m = new Map()));
    const hit = m.get(projectId);
    if (hit) return hit;
    const [p] = await this.db
      .tx()
      .select({ id: schema.project.id, orgId: schema.project.orgId, classification: schema.project.classification, timezone: schema.project.timezone, isDemo: schema.project.isDemo })
      .from(schema.project)
      .where(eq(schema.project.id, projectId));
    if (!p) throw notFound();
    // The project itself must be visible to the caller (classification vs clearance).
    if (!this.policy.canSee(ctx, { projectId, classification: p.classification as Classification })) throw notFound();
    const info: CarveoutProject = { ...p, classification: p.classification as Classification };
    m.set(projectId, info);
    return info;
  }

  today(p: CarveoutProject): string {
    return this.clock.today(p.timezone);
  }

  /** Read check on a record: any denial (classification, workstream reach, missing grant) is a 404. */
  assertRead(ctx: RequestContext, permission: string, attrs: ResourceAttrs) {
    if (!this.policy.can(ctx, permission, attrs)) throw notFound();
  }

  /** Project-level registers (agreements, consents, versions): need a project-wide grant, not a workstream one (ARCH-14). */
  assertProjectWide(ctx: RequestContext, permission: string, projectId: string) {
    if (!this.policy.permissionReach(ctx, permission, projectId).all) throw notFound();
  }

  /** A caller may only create records at a classification it is cleared for. */
  assertClassificationAllowed(ctx: RequestContext, c: Classification) {
    if (ctx.principal.kind !== 'service' && !clearanceAllows(ctx.principal.clearance, c)) {
      throw forbidden('carveout.classification_above_clearance', 'You cannot classify a record above your own clearance');
    }
  }

  /** Named owners / accountable users must be active, internal, full members of the project (never outsiders, partners or other orgs). */
  async assertMember(projectId: string, userId: string, field = 'user') {
    const r = await this.db.tx().execute<{ ok: boolean }>(sql`
      select exists (
        select 1 from project_membership m join app_user u on u.id = m.user_id
         where m.project_id = ${projectId} and m.user_id = ${userId} and m.revoked_at is null
           and (m.valid_to is null or m.valid_to > now()) and u.is_active
           -- accountable people are internal full members, never room-only (clean team / external partner) accounts
           and u.account_type = 'internal' and m.role not in ('clean_team', 'external_partner_limited')
      ) as ok`);
    if (!r.rows[0]?.ok) throw invalid('carveout.user_not_member', `The selected ${field} is not an active member of this project`);
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

  /** Active / conflicting evidence counts for many targets of one type. */
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

  /** Legal entities are organization-level: only entities linked to THIS project may be referenced (else 422). */
  async assertEntityInProject(projectId: string, legalEntityId: string, field = 'legal entity') {
    const [pe] = await this.db
      .tx()
      .select({ id: schema.projectEntity.id })
      .from(schema.projectEntity)
      .where(and(eq(schema.projectEntity.projectId, projectId), eq(schema.projectEntity.legalEntityId, legalEntityId)))
      .limit(1);
    if (!pe) throw invalid('carveout.entity_not_in_project', `The ${field} is not linked to this project`);
  }

  async entityNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
    const uniq = [...new Set(ids.filter((x): x is string => !!x))];
    if (uniq.length === 0) return new Map();
    const rows = await this.db.tx().select({ id: schema.legalEntity.id, n: schema.legalEntity.name }).from(schema.legalEntity).where(inArray(schema.legalEntity.id, uniq));
    return new Map(rows.map((r) => [r.id, r.n]));
  }

  /**
   * Read-only view of the approved scope used for display flags (the planning baseline row is read, never written;
   * commands go through ChangeControlService.isInApprovedBaseline for the authoritative check).
   */
  async baselineScope(projectId: string): Promise<BaselineScope> {
    const b = await this.db.tx().execute<{ id: string; version_no: number; ids: string[] | null }>(sql`
      select id, version_no, coalesce((select array_agg(e) from jsonb_array_elements_text(snapshot->'perimeterItemIds') e), '{}') as ids
        from baseline_version where project_id = ${projectId} and status = 'approved' limit 1`);
    const v = await this.db.tx().execute<{ id: string; version_no: number; ids: string[] | null }>(sql`
      select id, version_no, coalesce((select array_agg(i->>'id') from jsonb_array_elements(snapshot->'items') i where i->>'disposition' in ('included', 'shared')), '{}') as ids
        from perimeter_version where project_id = ${projectId} and status = 'approved' limit 1`);
    const b0 = b.rows[0];
    const v0 = v.rows[0];
    return {
      planning: b0 ? { id: b0.id, versionNo: b0.version_no, itemIds: new Set(b0.ids ?? []) } : null,
      perimeterVersion: v0 ? { id: v0.id, versionNo: v0.version_no, itemIds: new Set(v0.ids ?? []) } : null,
    };
  }
}

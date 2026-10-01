import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { schema } from '@hub/db';
import { clearanceAllows, conflict, NO_HUMAN_REQUESTER, notFound, ruleViolation, type Classification } from '@hub/domain';
import { BI_VIEWS, type RouteInput, type reportingRoutes } from '@hub/contracts';
import { DbService } from '../../platform/db.service';
import { AuditService } from '../../platform/audit.service';
import { loadInProject } from '../../platform/helpers';
import { newId } from '../../platform/ids';
import type { RequestContext } from '../../platform/context';
import { ReportAccess } from './report-access';

type R = typeof reportingRoutes;
type Row = typeof schema.biAccessGrant.$inferSelect;

/**
 * BI exposure (REQ-RPT-011, access-matrix §9 `bi_reader`): the read-only `bi` views are read by the database role `hub_bi`
 * (post-migrate §25). A project is readable there only while its sponsor keeps an active grant (`admin.clearance.grant`),
 * up to the grant's classification — never above the sponsor's own clearance — and never when the project is demo data.
 * The platform does not see the BI tool, so it never reports a BI connection as working (`connection: not_verified`).
 */
@Injectable()
export class BiAccessService {
  constructor(
    private readonly db: DbService,
    private readonly access: ReportAccess,
    private readonly audit: AuditService,
  ) {}

  private async project(ctx: RequestContext, projectId: string) {
    this.access.assertProjectReader(ctx, projectId, 'admin.clearance.grant');
    const [p] = await this.db.tx().select().from(schema.project).where(eq(schema.project.id, projectId));
    if (!p) throw notFound();
    // admin.clearance.grant carries not_self and authority (I-R3). The subject of a BI grant is the BI database role, never a
    // person (NO_HUMAN_REQUESTER: nobody's own clearance is raised), and the authority is the sponsor's role grant itself.
    this.access.policy.assert(ctx, 'admin.clearance.grant', { projectId, classification: p.classification, requesterUserId: NO_HUMAN_REQUESTER, withinAuthority: true });
    return p;
  }

  private async dto(rows: Row[]) {
    const ids = [...new Set(rows.map((r) => r.grantedBy))];
    const names = ids.length ? new Map((await this.db.tx().select({ id: schema.appUser.id, n: schema.appUser.displayName }).from(schema.appUser).where(inArray(schema.appUser.id, ids))).map((u) => [u.id, u.n])) : new Map<string, string>();
    return rows.map((r) => ({
      id: r.id,
      maxClassification: r.maxClassification,
      reason: r.reason,
      grantedBy: r.grantedBy,
      grantedByName: names.get(r.grantedBy) ?? null,
      createdAt: r.createdAt.toISOString(),
      active: !r.revokedAt,
      revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
      revokedBy: r.revokedBy,
      revokeReason: r.revokeReason,
      version: r.version,
    }));
  }

  async get(ctx: RequestContext, projectId: string) {
    const p = await this.project(ctx, projectId);
    const rows = await this.db.tx().select().from(schema.biAccessGrant).where(eq(schema.biAccessGrant.projectId, projectId)).orderBy(desc(schema.biAccessGrant.createdAt), desc(schema.biAccessGrant.id));
    return { projectIsDemo: p.isDemo, exposed: !p.isDemo && rows.some((r) => !r.revokedAt), views: [...BI_VIEWS], connection: 'not_verified' as const, items: await this.dto(rows) };
  }

  async grant(ctx: RequestContext, projectId: string, body: RouteInput<R['grantBiAccess']>['body']) {
    const p = await this.project(ctx, projectId);
    if (!clearanceAllows(ctx.principal.clearance, body.maxClassification as Classification)) {
      throw ruleViolation('report.bi_above_clearance', 'A BI grant cannot exceed your own clearance', { maxClassification: body.maxClassification });
    }
    const [active] = await this.db.tx().select({ id: schema.biAccessGrant.id }).from(schema.biAccessGrant).where(and(eq(schema.biAccessGrant.projectId, projectId), isNull(schema.biAccessGrant.revokedAt)));
    if (active) throw conflict('report.bi_grant_active', 'The project already has an active BI grant; revoke it first');
    const id = newId();
    await this.db.tx().insert(schema.biAccessGrant).values({ id, orgId: p.orgId, projectId, maxClassification: body.maxClassification, reason: body.reason, grantedBy: ctx.principal.userId! });
    await this.audit.record({ action: 'reports.bi_access.grant', entityType: 'bi_access_grant', entityId: id, projectId, after: { maxClassification: body.maxClassification, projectIsDemo: p.isDemo }, reason: body.reason });
    const row = await loadInProject(this.db, schema.biAccessGrant, projectId, id);
    return (await this.dto([row]))[0]!;
  }

  async revoke(ctx: RequestContext, projectId: string, grantId: string, body: RouteInput<R['revokeBiAccess']>['body']) {
    await this.project(ctx, projectId);
    const g = await loadInProject(this.db, schema.biAccessGrant, projectId, grantId);
    if (g.version !== body.expectedVersion) throw conflict('version_conflict', 'The grant was changed by someone else; reload');
    if (g.revokedAt) throw ruleViolation('report.bi_grant_revoked', 'The grant is already revoked');
    const T = schema.biAccessGrant;
    await this.db
      .tx()
      .update(T)
      .set({ revokedAt: new Date(), revokedBy: ctx.principal.userId!, revokeReason: body.reason, version: sql`${T.version} + 1` })
      .where(and(eq(T.id, grantId), eq(T.projectId, projectId), eq(T.version, body.expectedVersion)));
    await this.audit.record({ action: 'reports.bi_access.revoke', entityType: 'bi_access_grant', entityId: grantId, projectId, before: { maxClassification: g.maxClassification }, reason: body.reason });
    return (await this.dto([await loadInProject(this.db, schema.biAccessGrant, projectId, grantId)]))[0]!;
  }
}

import { Injectable } from '@nestjs/common';
import { financeDomainClearance, maxClassification, notFound, type Classification } from '@hub/domain';
import type { ReportSectionAccess } from '@hub/db';
import { PolicyService } from '../../platform/policy.service';
import type { RequestContext } from '../../platform/context';

/**
 * Access rules of report snapshots (REQ-RPT-017, access-matrix §2.6; ADR-0011 amendment).
 *
 *  - Generation: every collector reads with the GENERATOR's visibility (classification, workstream reach, finance-domain
 *    clearance) inside SQL, and records per section the permission(s), the highest classification and the reach it used.
 *  - Reading / exporting: the snapshot itself needs project scope (full member, not room-only) and the route permission;
 *    each section is then re-checked against the viewer's CURRENT access with {@link canSee}. A viewer for whom no section
 *    remains gets 404 (nothing to show, existence not confirmed).
 */
@Injectable()
export class ReportAccess {
  constructor(readonly policy: PolicyService) {}

  /** Finance-domain clearance (access-matrix §2.3) for finance sections; other attributes unchanged. */
  fx(ctx: RequestContext, projectId: string): RequestContext {
    const p = ctx.principal;
    if (p.kind === 'service') return ctx;
    const scope = p.projects.get(projectId);
    if (!scope) return ctx;
    const clearance = financeDomainClearance(p.clearance, scope.roles);
    return clearance === p.clearance ? ctx : { ...ctx, principal: { ...p, clearance } };
  }

  /** 404 unless the caller is a full member of the project holding `permission` there (any grant). */
  assertProjectReader(ctx: RequestContext, projectId: string, permission: string) {
    if (!this.policy.inScope(ctx, projectId) || this.policy.isRoomOnly(ctx.principal, projectId)) throw notFound();
    if (!this.policy.canInProject(ctx, permission, projectId)) throw notFound();
  }

  /** Does the caller's CURRENT access cover this section of a snapshot? */
  canSee(ctx: RequestContext, projectId: string, a: ReportSectionAccess): boolean {
    if (!this.policy.inScope(ctx, projectId) || this.policy.isRoomOnly(ctx.principal, projectId)) return false;
    const c = a.domain === 'finance' ? this.fx(ctx, projectId) : ctx;
    if (!this.policy.canSee(c, { projectId, classification: a.classification })) return false;
    for (const perm of a.permissions) {
      if (a.workstreamIds === 'none') {
        // Records without a workstream: the permission's own rule (project-wide grant, or a §2.2.1 project-level read).
        if (!this.policy.can(c, perm, { projectId, classification: a.classification })) return false;
        continue;
      }
      const reach = this.policy.permissionReach(ctx, perm, projectId);
      if (reach.all) continue;
      if (a.workstreamIds === 'all') return false;
      if (!a.workstreamIds.every((w) => reach.workstreamIds.includes(w))) return false;
    }
    return true;
  }

  /**
   * Section access for workstream-structured records collected with the generator's reach of `permissions` (or limited
   * to one workstream). `all` when every permission is project-wide; otherwise the workstreams common to all of them.
   */
  structured(ctx: RequestContext, projectId: string, key: string, permissions: string[], classifications: (Classification | null | undefined)[], opts: { domain?: 'finance'; workstreamId?: string | null } = {}): ReportSectionAccess {
    let ws: 'all' | string[] = 'all';
    if (opts.workstreamId) ws = [opts.workstreamId];
    else {
      for (const perm of permissions) {
        const r = this.policy.permissionReach(ctx, perm, projectId);
        if (r.all) continue;
        ws = ws === 'all' ? [...r.workstreamIds] : ws.filter((w) => r.workstreamIds.includes(w));
      }
    }
    return { key, permissions, classification: maxClassification(classifications), domain: opts.domain ?? null, workstreamIds: ws === 'all' ? 'all' : [...ws].sort() };
  }

  /** Section access for records without a workstream dimension (decisions, gates, deals, documents, the project header). */
  flat(key: string, permissions: string[], classifications: (Classification | null | undefined)[], domain: 'finance' | null = null): ReportSectionAccess {
    return { key, permissions, classification: maxClassification(classifications), domain, workstreamIds: 'none' };
  }

  /** Can the generator read this kind of record at all (project-wide or through a workstream grant)? */
  canCollect(ctx: RequestContext, projectId: string, permission: string): boolean {
    return this.policy.canInProject(ctx, permission, projectId);
  }
}

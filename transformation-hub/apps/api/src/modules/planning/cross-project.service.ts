import { Injectable } from '@nestjs/common';
import { and, eq, inArray, or, SQL } from 'drizzle-orm';
import { schema } from '@hub/db';
import { RaidStatus, ScheduleNodeType, invalid, notFound, ruleViolation, isOverdue } from '@hub/domain';
import type { z } from 'zod';
import type { CreateCrossProjectDependencyBody, CrossProjectDependencyListQuery } from '@hub/contracts';
import { AuditService } from '../../platform/audit.service';
import { loadInProject, updateVersioned } from '../../platform/helpers';
import type { RequestContext } from '../../platform/context';
import { isFullScope } from '../../platform/context';
import { newId } from '../../platform/ids';
import { PlanningSupport, ProjectInfo } from './planning-support';

type Row = typeof schema.crossProjectDependency.$inferSelect;
interface ItemInfo {
  type: ScheduleNodeType;
  id: string;
  code: string;
  title: string;
  titleAr: string | null;
  status: string;
  workstreamId: string | null;
  /** Forecast / actual finish (task) or date (milestone) — the date the dependent project relies on. */
  finish: string | null;
}

/**
 * Cross-project dependencies (spec §5 "Support cross-project dependencies while exposing only the minimum authorized
 * information where access differs"; REQ-ENT-010; DOM-P2-17).
 *
 * A dependency is owned by the DEPENDENT project (row `project_id`) and points at a task / milestone of another project of
 * the same organization. Minimum disclosure: a dependency — and anything about the other project's item — is visible ONLY
 * to users who can read BOTH records (project membership, classification, workstream reach of `planning.plan.read`).
 * Everyone else gets nothing: it is not listed, not counted, and its id answers 404. PostgreSQL RLS (`project_id` in the
 * caller's projects) is the defense in depth; the other end is checked here explicitly.
 */
@Injectable()
export class CrossProjectDependencyService {
  constructor(
    private readonly s: PlanningSupport,
    private readonly audit: AuditService,
  ) {}

  private get tx() {
    return this.s.db.tx();
  }

  /** The other project, only when the caller is a full member who can read its plan (404 otherwise — existence not revealed). */
  private async readableProject(ctx: RequestContext, projectId: string): Promise<ProjectInfo> {
    const scope = ctx.principal.projects.get(projectId);
    if (!scope || !isFullScope(scope)) throw notFound();
    const p = await this.s.project(ctx, projectId);
    this.s.readScope(ctx, p); // visibility + read reach (404)
    return p;
  }

  private canRead(ctx: RequestContext, p: ProjectInfo, workstreamId: string | null): boolean {
    try {
      this.s.assertReadable(ctx, p, workstreamId);
      return true;
    } catch {
      return false;
    }
  }

  private async item(projectId: string, type: ScheduleNodeType, id: string): Promise<ItemInfo> {
    if (type === 'task') {
      const t = await loadInProject(this.s.db, schema.task, projectId, id);
      return { type, id, code: t.wbsCode, title: t.title, titleAr: t.titleAr, status: t.status, workstreamId: t.workstreamId, finish: t.actualFinish ?? t.forecastFinish ?? t.plannedFinish };
    }
    const m = await loadInProject(this.s.db, schema.milestone, projectId, id);
    return { type, id, code: m.code, title: m.title, titleAr: m.titleAr, status: m.status, workstreamId: m.workstreamId, finish: m.actualDate ?? m.forecastDate ?? m.plannedDate };
  }

  async create(ctx: RequestContext, projectId: string, body: z.infer<typeof CreateCrossProjectDependencyBody>) {
    const p = await this.s.project(ctx, projectId);
    if (body.otherProjectId === projectId) throw ruleViolation('xproj.same_project', 'Use an ordinary dependency within the same project');
    if (!!body.localItemType !== !!body.localItemId) throw invalid('xproj.local_item_incomplete', 'localItemType and localItemId go together');
    const local = body.localItemId ? await this.item(projectId, body.localItemType!, body.localItemId) : null;
    this.s.assert(ctx, 'planning.dependency.manage', p, { workstreamId: local?.workstreamId ?? null });
    // The other end: a project the caller may read, and an item of it inside the caller's read reach (404 otherwise).
    const other = await this.readableProject(ctx, body.otherProjectId);
    const target = await this.item(other.id, body.otherItemType, body.otherItemId);
    this.s.assertReadable(ctx, other, target.workstreamId);
    const id = newId();
    await this.tx.insert(schema.crossProjectDependency).values({
      id,
      orgId: ctx.principal.orgId,
      projectId,
      otherProjectId: other.id,
      localItemType: local?.type ?? null,
      localItemId: local?.id ?? null,
      otherItemType: target.type,
      otherItemId: target.id,
      description: body.description,
      neededBy: body.neededBy ?? null,
      createdBy: ctx.principal.userId,
    });
    // Audited in the dependent project only (the other project's activity must not reveal this project to its readers).
    await this.audit.record({
      action: 'planning.cross_project_dependency.create',
      entityType: 'cross_project_dependency',
      entityId: id,
      projectId,
      after: { otherProjectId: other.id, otherItemType: target.type, otherItemId: target.id, localItemType: local?.type ?? null, localItemId: local?.id ?? null, neededBy: body.neededBy ?? null },
    });
    return { id };
  }

  async close(ctx: RequestContext, projectId: string, dependencyId: string, body: { expectedVersion: number; reason: string }) {
    const p = await this.s.project(ctx, projectId);
    const d = await loadInProject(this.s.db, schema.crossProjectDependency, projectId, dependencyId);
    // Visible only to readers of both ends (404 otherwise), then the manage permission on the dependent side.
    const other = await this.readableProject(ctx, d.otherProjectId);
    const target = await this.item(other.id, d.otherItemType as ScheduleNodeType, d.otherItemId);
    this.s.assertReadable(ctx, other, target.workstreamId);
    const local = d.localItemId ? await this.item(projectId, d.localItemType as ScheduleNodeType, d.localItemId) : null;
    this.s.assert(ctx, 'planning.dependency.manage', p, { workstreamId: local?.workstreamId ?? null });
    if (d.status === 'closed') throw ruleViolation('xproj.already_closed', 'The cross-project dependency is already closed');
    const row = await updateVersioned(this.s.db, schema.crossProjectDependency, { id: d.id, projectId, expectedVersion: body.expectedVersion }, {
      status: 'closed',
      closedReason: body.reason,
      closedBy: ctx.principal.userId,
      closedAt: new Date(),
    });
    await this.audit.record({ action: 'planning.cross_project_dependency.close', entityType: 'cross_project_dependency', entityId: d.id, projectId, before: { status: d.status }, after: { status: 'closed' }, reason: body.reason });
    return { id: d.id, version: row['version'] as number };
  }

  /**
   * Outgoing (this project depends on another) and incoming (another project depends on this one) dependencies whose BOTH
   * ends the caller can read. Filtering happens before paging, so totals never count hidden rows.
   */
  async list(ctx: RequestContext, projectId: string, q: z.infer<typeof CrossProjectDependencyListQuery>) {
    const p = await this.s.project(ctx, projectId);
    this.s.readScope(ctx, p);
    // Projects whose plan the caller may read (full members; visibility and reach are checked per item below).
    const readable = new Map<string, ProjectInfo>();
    for (const [pid, scope] of ctx.principal.projects) {
      if (pid === projectId || !isFullScope(scope) || !this.s.policy.canInProject(ctx, 'planning.plan.read', pid)) continue;
      const other = await this.s.project(ctx, pid).catch(() => null);
      if (other && this.s.policy.canSee(ctx, { projectId: pid, classification: other.classification })) readable.set(pid, other);
    }
    readable.set(projectId, p);
    const others = [...readable.keys()].filter((x) => x !== projectId);
    if (!others.length) return { items: [], page: q.page, pageSize: q.pageSize, total: 0 };
    const X = schema.crossProjectDependency;
    const conds: SQL[] = [or(and(eq(X.projectId, projectId), inArray(X.otherProjectId, others)), and(eq(X.otherProjectId, projectId), inArray(X.projectId, others)))!];
    if (q.status) conds.push(eq(X.status, q.status));
    const rows = await this.tx.select().from(X).where(and(...conds));
    const visible: { r: Row; local: ItemInfo | null; other: ItemInfo; direction: 'outgoing' | 'incoming' }[] = [];
    for (const r of rows) {
      const depP = readable.get(r.projectId)!;
      const othP = readable.get(r.otherProjectId)!;
      const other = await this.item(othP.id, r.otherItemType as ScheduleNodeType, r.otherItemId).catch(() => null);
      const local = r.localItemId ? await this.item(depP.id, r.localItemType as ScheduleNodeType, r.localItemId).catch(() => null) : null;
      if (!other || (r.localItemId && !local)) continue;
      if (!this.canRead(ctx, othP, other.workstreamId)) continue;
      if (local && !this.canRead(ctx, depP, local.workstreamId)) continue;
      visible.push({ r, local, other, direction: r.projectId === projectId ? 'outgoing' : 'incoming' });
    }
    const key = q.sort?.replace(/^-/, '') ?? 'neededBy';
    const dir = q.sort?.startsWith('-') ? -1 : 1;
    const val = (x: (typeof visible)[number]) => (key === 'createdAt' ? x.r.createdAt.toISOString() : (x.r.neededBy ?? null));
    visible.sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va === vb) return a.r.id.localeCompare(b.r.id) * dir;
      if (va === null) return 1; // NULLs last
      if (vb === null) return -1;
      return va.localeCompare(vb) * dir;
    });
    const start = (q.page - 1) * q.pageSize;
    const page = visible.slice(start, start + q.pageSize);
    const code = (id: string) => readable.get(id)!.code;
    const ref = (i: ItemInfo | null) => (i ? { type: i.type, id: i.id, code: i.code, title: i.title, titleAr: i.titleAr, status: i.status, finish: i.finish } : null);
    return {
      items: page.map(({ r, local, other, direction }) => ({
        id: r.id,
        direction,
        projectId: r.projectId,
        projectCode: code(r.projectId),
        otherProjectId: r.otherProjectId,
        otherProjectCode: code(r.otherProjectId),
        local: ref(local),
        other: ref(other)!,
        description: r.description,
        neededBy: r.neededBy,
        status: r.status as RaidStatus,
        // Schedule-based: the depended-upon item finishes after the date it is needed by (never a probability).
        atRisk: r.status !== 'closed' && !!r.neededBy && ((other.finish !== null && other.finish > r.neededBy) || (other.finish === null && isOverdue(r.neededBy, this.s.today(p), true))),
        closedReason: r.closedReason,
        createdAt: r.createdAt.toISOString(),
        version: r.version,
      })),
      page: q.page,
      pageSize: q.pageSize,
      total: visible.length,
    };
  }
}

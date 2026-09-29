import { Injectable } from '@nestjs/common';
import { and, asc, eq, or } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  computeSchedule,
  delayImpact,
  drivingNetwork,
  wouldCreateCycle,
  lookAheadWindow,
  inWindow,
  isOverdue,
  ruleViolation,
  notFound,
  ScheduleNode,
  ScheduleEdge,
  ScheduleResult,
  DependencyType,
  SUPPORTED_DEPENDENCY_TYPES,
} from '@hub/domain';
import { PLANNING_SCHEDULE_LABEL } from '@hub/contracts';
import { AuditService } from '../../platform/audit.service';
import { loadInProject } from '../../platform/helpers';
import type { RequestContext } from '../../platform/context';
import { newId } from '../../platform/ids';
import { PlanningSupport, ProjectInfo } from './planning-support';

type NodeType = 'task' | 'milestone';
interface GraphNode {
  id: string;
  type: NodeType;
  code: string;
  title: string;
  workstreamId: string | null;
  status: string;
  durationDays: number | null;
  plannedStart: string | null;
  plannedFinish: string | null;
  forecastFinish: string | null;
  actualStart: string | null;
  actualFinish: string | null;
  gateKey: string | null;
  isCritical: boolean;
  ownerUserId: string | null;
}

/** Dependencies, critical path / float (schedule-based forecasts), delay impact (AT-15), calendar and look-ahead. */
@Injectable()
export class ScheduleService {
  constructor(
    private readonly s: PlanningSupport,
    private readonly audit: AuditService,
  ) {}

  private get tx() {
    return this.s.db.tx();
  }

  /** All tasks and milestones of the project as schedule nodes, plus every dependency. */
  async graph(projectId: string) {
    const T = schema.task;
    const M = schema.milestone;
    const tasks = await this.tx
      .select({
        id: T.id,
        code: T.wbsCode,
        title: T.title,
        workstreamId: T.workstreamId,
        status: T.status,
        durationDays: T.durationDays,
        plannedStart: T.plannedStart,
        plannedFinish: T.plannedFinish,
        forecastFinish: T.forecastFinish,
        actualStart: T.actualStart,
        actualFinish: T.actualFinish,
        gateKey: T.gateKey,
        ownerUserId: T.accountableUserId,
      })
      .from(T)
      .where(eq(T.projectId, projectId))
      .orderBy(asc(T.sortOrder), asc(T.wbsCode));
    const ms = await this.tx
      .select({
        id: M.id,
        code: M.code,
        title: M.title,
        workstreamId: M.workstreamId,
        status: M.status,
        plannedDate: M.plannedDate,
        forecastDate: M.forecastDate,
        actualDate: M.actualDate,
        gateKey: M.gateKey,
        isCritical: M.isCritical,
        ownerUserId: M.ownerUserId,
      })
      .from(M)
      .where(eq(M.projectId, projectId))
      .orderBy(asc(M.code));
    const nodes: GraphNode[] = [
      ...tasks.map((t) => ({ ...t, type: 'task' as const, isCritical: false })),
      ...ms.map((m) => ({
        id: m.id,
        type: 'milestone' as const,
        code: m.code,
        title: m.title,
        workstreamId: m.workstreamId,
        status: m.status,
        durationDays: 0,
        plannedStart: null,
        plannedFinish: m.plannedDate,
        forecastFinish: m.forecastDate,
        actualStart: null,
        actualFinish: m.status === 'achieved_pending_evidence' || m.status === 'achieved_verified' ? m.actualDate : null,
        gateKey: m.gateKey,
        isCritical: m.isCritical,
        ownerUserId: m.ownerUserId,
      })),
    ];
    const deps = await this.tx.select().from(schema.dependency).where(eq(schema.dependency.projectId, projectId));
    return { nodes, deps };
  }

  private toScheduleNode(n: GraphNode): ScheduleNode {
    return {
      id: n.id,
      label: `${n.code} ${n.title}`,
      durationDays: n.durationDays,
      // Planned start acts as a start-no-earlier-than constraint (documented assumption).
      earliestStart: n.type === 'task' ? n.plannedStart : null,
      actualStart: n.actualStart,
      actualFinish: n.actualFinish,
      forecastFinish: n.actualFinish ? null : n.forecastFinish,
      cancelled: n.status === 'cancelled',
    };
  }

  /** Nodes/edges in scope: whole project, or the driving network (target + all transitive predecessors). */
  private scope(g: Awaited<ReturnType<ScheduleService['graph']>>, targetNodeId?: string) {
    const edges: ScheduleEdge[] = g.deps.map((d) => ({ predecessorId: d.predecessorId, successorId: d.successorId, type: d.type as DependencyType, lagDays: d.lagDays }));
    if (!targetNodeId) return { nodes: g.nodes, edges, kind: 'project' as const };
    if (!g.nodes.some((n) => n.id === targetNodeId)) throw notFound();
    const keep = drivingNetwork(targetNodeId, edges);
    return { nodes: g.nodes.filter((n) => keep.has(n.id)), edges: edges.filter((e) => keep.has(e.predecessorId) && keep.has(e.successorId)), kind: 'driving_network' as const };
  }

  private serviceAssumptions(nodes: GraphNode[], kind: 'project' | 'driving_network') {
    const drafts = nodes.filter((n) => n.type === 'task' && n.status === 'draft').length;
    const out = [
      'Planned start dates act as start-no-earlier-than constraints.',
      'Owner-entered forecast finish dates can only extend an activity; actual dates replace plan dates.',
      'Cancelled activities and their links are ignored.',
      'Milestones have zero duration.',
    ];
    if (drafts > 0) out.push(`${drafts} activit${drafts === 1 ? 'y is' : 'ies are'} still Draft (proposed, not yet confirmed into the plan) and included as proposed.`);
    if (kind === 'driving_network') out.push('Scope: the selected activity and every activity that drives it (transitive predecessors) — other activities are not shown.');
    return out;
  }

  private async baselineFinishes(projectId: string): Promise<Map<string, string | null>> {
    const b = await this.s.currentBaselineRow(projectId);
    const m = new Map<string, string | null>();
    if (!b) return m;
    const snap = b.snapshot as { tasks?: { id: string; plannedFinish: string | null }[]; milestones?: { id: string; plannedDate: string | null }[] };
    for (const t of snap.tasks ?? []) m.set(t.id, t.plannedFinish);
    for (const x of snap.milestones ?? []) m.set(x.id, x.plannedDate);
    return m;
  }

  /** Computes the schedule for a project (used by the schedule endpoint, look-ahead and health). */
  async compute(p: ProjectInfo, targetNodeId?: string) {
    const g = await this.graph(p.id);
    const sc = this.scope(g, targetNodeId);
    const cal = await this.s.calendar(p);
    let result: ScheduleResult;
    if (!p.plannedStart) {
      result = {
        status: 'incomplete',
        issues: [{ code: 'missing_project_start', nodeIds: [], message: 'The project has no planned start date' }],
        assumptions: [],
        projectStart: '',
        projectFinish: null,
        nodes: {},
        criticalPath: null,
      };
    } else {
      result = computeSchedule(sc.nodes.map((n) => this.toScheduleNode(n)), sc.edges, p.plannedStart, cal);
    }
    return { g, sc, cal, result };
  }

  async getSchedule(ctx: RequestContext, projectId: string, targetNodeId?: string) {
    const p = await this.s.project(ctx, projectId);
    this.s.assertProjectRead(ctx, p);
    const { g, sc, cal, result } = await this.compute(p, targetNodeId);
    const ws = await this.s.workstreamCodes(projectId);
    const bl = await this.baselineFinishes(projectId);
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    return {
      label: PLANNING_SCHEDULE_LABEL,
      status: result.status,
      scope: { kind: sc.kind, targetNodeId: targetNodeId ?? null, nodeCount: sc.nodes.filter((n) => n.status !== 'cancelled').length, edgeCount: sc.edges.length },
      calendar: { timezone: cal.timezone, workingDays: cal.workingDays, holidays: cal.holidays.length },
      projectStart: result.projectStart || null,
      projectFinish: result.projectFinish,
      issues: result.issues,
      assumptions: [...result.assumptions, ...this.serviceAssumptions(sc.nodes, sc.kind)],
      criticalPath: result.criticalPath ? result.criticalPath.map((id) => ({ id, type: byId.get(id)!.type, code: byId.get(id)!.code, title: byId.get(id)!.title })) : null,
      nodes: sc.nodes
        .filter((n) => n.status !== 'cancelled')
        .map((n) => {
          const r = result.nodes[n.id];
          return {
            id: n.id,
            type: n.type,
            code: n.code,
            title: n.title,
            workstreamCode: n.workstreamId ? (ws.get(n.workstreamId)?.code ?? null) : null,
            status: n.status,
            proposed: n.type === 'task' && n.status === 'draft',
            durationDays: n.durationDays,
            plannedStart: n.plannedStart,
            plannedFinish: n.plannedFinish,
            baselineFinish: bl.get(n.id) ?? null,
            earlyStart: r?.earlyStart ?? null,
            earlyFinish: r?.earlyFinish ?? null,
            lateStart: r?.lateStart ?? null,
            lateFinish: r?.lateFinish ?? null,
            totalFloatDays: r?.totalFloatDays ?? null,
            critical: r ? r.critical : null,
          };
        }),
    };
  }

  /** AT-15: reproducible, calendar-based delay impact; labelled a schedule-based forecast; no probabilities. */
  async delayImpact(ctx: RequestContext, projectId: string, body: { nodeId: string; delayWorkingDays: number; targetNodeId?: string }) {
    const p = await this.s.project(ctx, projectId);
    this.s.assertProjectRead(ctx, p);
    const g = await this.graph(projectId);
    const node = g.nodes.find((n) => n.id === body.nodeId);
    if (!node) throw notFound();
    const sc = this.scope(g, body.targetNodeId);
    if (!sc.nodes.some((n) => n.id === body.nodeId)) throw ruleViolation('schedule.node_outside_scope', 'The delayed activity does not drive the selected target');
    if (node.status === 'cancelled') throw ruleViolation('schedule.node_cancelled', 'A cancelled activity cannot be delayed');
    const cal = await this.s.calendar(p);
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    const base = {
      label: PLANNING_SCHEDULE_LABEL,
      delayedNode: { id: node.id, type: node.type, code: node.code, title: node.title },
      delayWorkingDays: body.delayWorkingDays,
      scope: { kind: sc.kind, targetNodeId: body.targetNodeId ?? null, nodeCount: sc.nodes.filter((n) => n.status !== 'cancelled').length },
    };
    if (!p.plannedStart) {
      return { ...base, status: 'incomplete' as const, finishBeforeDelay: null, forecastFinish: null, projectSlipWorkingDays: null, affected: [], affectedGateKeys: [], issues: [{ code: 'missing_project_start', nodeIds: [], message: 'The project has no planned start date' }], assumptions: [] };
    }
    const r = delayImpact(sc.nodes.map((n) => this.toScheduleNode(n)), sc.edges, p.plannedStart, body.nodeId, body.delayWorkingDays, cal);
    const affected = r.affected.map((a) => {
      const n = byId.get(a.id)!;
      return { id: a.id, type: n.type, code: n.code, title: n.title, earlyFinishBefore: a.earlyFinishBefore, earlyFinishAfter: a.earlyFinishAfter, slipWorkingDays: a.slipWorkingDays, critical: a.critical, gateKey: n.gateKey };
    });
    return {
      ...base,
      status: r.status,
      finishBeforeDelay: r.baselineFinish,
      forecastFinish: r.forecastFinish,
      projectSlipWorkingDays: r.projectSlipWorkingDays,
      affected,
      affectedGateKeys: [...new Set(affected.map((a) => a.gateKey).filter((k): k is string => !!k))].sort(),
      issues: r.issues,
      assumptions: [...r.assumptions, ...this.serviceAssumptions(sc.nodes, sc.kind), 'Deterministic: the same plan, calendar and inputs always give the same result. No probability is estimated.'],
    };
  }

  // =========================================================================================================
  // Dependencies

  async listDependencies(ctx: RequestContext, projectId: string, nodeId?: string) {
    const p = await this.s.project(ctx, projectId);
    this.s.assertProjectRead(ctx, p);
    const g = await this.graph(projectId);
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    const deps = nodeId ? g.deps.filter((d) => d.predecessorId === nodeId || d.successorId === nodeId) : g.deps;
    return {
      items: deps.map((d) => ({
        id: d.id,
        predecessorType: d.predecessorType as NodeType,
        predecessorId: d.predecessorId,
        predecessorCode: byId.get(d.predecessorId)?.code ?? '?',
        predecessorTitle: byId.get(d.predecessorId)?.title ?? '?',
        successorType: d.successorType as NodeType,
        successorId: d.successorId,
        successorCode: byId.get(d.successorId)?.code ?? '?',
        successorTitle: byId.get(d.successorId)?.title ?? '?',
        type: d.type as DependencyType,
        lagDays: d.lagDays,
        note: d.note,
        createdAt: d.createdAt.toISOString(),
      })),
    };
  }

  private async loadNode(projectId: string, type: NodeType, id: string) {
    if (type === 'task') {
      const t = await loadInProject(this.s.db, schema.task, projectId, id);
      return { workstreamId: t.workstreamId, code: t.wbsCode };
    }
    const m = await loadInProject(this.s.db, schema.milestone, projectId, id);
    return { workstreamId: m.workstreamId, code: m.code };
  }

  async createDependency(
    ctx: RequestContext,
    projectId: string,
    body: { predecessorType: NodeType; predecessorId: string; successorType: NodeType; successorId: string; type: DependencyType; lagDays: number; note?: string },
  ) {
    const p = await this.s.project(ctx, projectId);
    // Every submitted id is loaded inside THIS project (cross-project ids → 404, existence not revealed).
    const pred = await this.loadNode(projectId, body.predecessorType, body.predecessorId);
    const succ = await this.loadNode(projectId, body.successorType, body.successorId);
    this.s.assert(ctx, 'planning.dependency.manage', p, { workstreamId: succ.workstreamId });
    if (!(SUPPORTED_DEPENDENCY_TYPES as readonly string[]).includes(body.type)) {
      throw ruleViolation('dependency.type_not_supported', `Dependency type ${body.type} is not yet supported — only Finish-to-Start (FS) is enabled until SS/FF/SF are tested`, { supported: [...SUPPORTED_DEPENDENCY_TYPES] });
    }
    if (body.predecessorId === body.successorId) throw ruleViolation('dependency.self', 'An activity cannot depend on itself');
    await this.s.lockProjectGraph(projectId);
    const existing = await this.tx.select({ predecessorId: schema.dependency.predecessorId, successorId: schema.dependency.successorId }).from(schema.dependency).where(eq(schema.dependency.projectId, projectId));
    if (existing.some((e) => e.predecessorId === body.predecessorId && e.successorId === body.successorId)) {
      throw ruleViolation('dependency.duplicate', 'This dependency already exists');
    }
    if (wouldCreateCycle(existing, { predecessorId: body.predecessorId, successorId: body.successorId })) {
      throw ruleViolation('dependency.cycle', `Adding ${pred.code} → ${succ.code} would create a cycle in the dependency graph`);
    }
    const id = newId();
    await this.tx.insert(schema.dependency).values({
      id,
      orgId: ctx.principal.orgId,
      projectId,
      predecessorType: body.predecessorType,
      predecessorId: body.predecessorId,
      successorType: body.successorType,
      successorId: body.successorId,
      type: body.type,
      lagDays: body.lagDays,
      note: body.note ?? null,
      createdBy: ctx.principal.userId,
    });
    await this.audit.record({ action: 'planning.dependency.create', entityType: 'dependency', entityId: id, projectId, after: { predecessor: pred.code, successor: succ.code, type: body.type, lagDays: body.lagDays } });
    return { id };
  }

  async removeDependency(ctx: RequestContext, projectId: string, dependencyId: string, reason?: string) {
    const p = await this.s.project(ctx, projectId);
    const d = await loadInProject(this.s.db, schema.dependency, projectId, dependencyId);
    const succ = await this.loadNode(projectId, d.successorType as NodeType, d.successorId);
    this.s.assert(ctx, 'planning.dependency.manage', p, { workstreamId: succ.workstreamId });
    await this.tx.delete(schema.dependency).where(and(eq(schema.dependency.id, dependencyId), eq(schema.dependency.projectId, projectId)));
    await this.audit.record({ action: 'planning.dependency.remove', entityType: 'dependency', entityId: dependencyId, projectId, before: { predecessorId: d.predecessorId, successorId: d.successorId, type: d.type, lagDays: d.lagDays }, reason: reason ?? null });
    return { ok: true as const };
  }

  // =========================================================================================================
  // Calendar

  async listHolidays(ctx: RequestContext, projectId: string) {
    const p = await this.s.project(ctx, projectId);
    this.s.readScope(ctx, p);
    const rows = await this.tx.select().from(schema.calendarHoliday).where(eq(schema.calendarHoliday.projectId, projectId)).orderBy(asc(schema.calendarHoliday.date));
    return { timezone: p.timezone, workingDays: p.workingDays, items: rows.map((r) => ({ id: r.id, date: r.date, name: r.name, isProposed: r.isProposed })) };
  }

  async addHoliday(ctx: RequestContext, projectId: string, body: { date: string; name: string; isProposed: boolean }) {
    const p = await this.s.project(ctx, projectId);
    this.s.assert(ctx, 'planning.wbs.manage', p);
    const id = newId();
    await this.tx.insert(schema.calendarHoliday).values({ id, orgId: ctx.principal.orgId, projectId, date: body.date, name: body.name, isProposed: body.isProposed, createdBy: ctx.principal.userId });
    await this.audit.record({ action: 'planning.calendar.add_holiday', entityType: 'project', entityId: projectId, projectId, after: { date: body.date, name: body.name, isProposed: body.isProposed } });
    return { id };
  }

  async removeHoliday(ctx: RequestContext, projectId: string, holidayId: string, reason?: string) {
    const p = await this.s.project(ctx, projectId);
    this.s.assert(ctx, 'planning.wbs.manage', p);
    const h = await loadInProject(this.s.db, schema.calendarHoliday, projectId, holidayId);
    await this.tx.delete(schema.calendarHoliday).where(and(eq(schema.calendarHoliday.id, holidayId), eq(schema.calendarHoliday.projectId, projectId)));
    await this.audit.record({ action: 'planning.calendar.remove_holiday', entityType: 'project', entityId: projectId, projectId, before: { date: h.date, name: h.name }, reason: reason ?? null });
    return { ok: true as const };
  }

  // =========================================================================================================
  // Look-ahead

  async lookAhead(ctx: RequestContext, projectId: string, q: { weeks: number; workstreamId?: string }) {
    const p = await this.s.project(ctx, projectId);
    const scope = this.s.readScope(ctx, p);
    const today = this.s.today(p);
    const w = lookAheadWindow(today, q.weeks);
    const { g, result } = await this.compute(p);
    const critical = new Set(result.status === 'complete' ? Object.values(result.nodes).filter((n) => n.critical).map((n) => n.id) : []);
    const ws = await this.s.workstreamCodes(projectId);
    const inScope = (wsId: string | null) => (!q.workstreamId || wsId === q.workstreamId) && (!scope || (!!wsId && scope.has(wsId)));
    const names = await this.s.userNames(g.nodes.map((n) => n.ownerUserId));
    type Item = { id: string; type: 'task' | 'milestone' | 'deliverable'; code: string; title: string; workstreamCode: string | null; date: string; dateKind: 'start' | 'finish' | 'due'; status: string; ownerName: string | null; critical: boolean };
    const starting: Item[] = [];
    const due: Item[] = [];
    const overdue: Item[] = [];
    const wsCode = (id: string | null) => (id ? (ws.get(id)?.code ?? null) : null);
    for (const n of g.nodes) {
      if (!inScope(n.workstreamId)) continue;
      const owner = n.ownerUserId ? (names.get(n.ownerUserId) ?? null) : null;
      const base = { id: n.id, type: n.type, code: n.code, title: n.title, workstreamCode: wsCode(n.workstreamId), status: n.status, ownerName: owner, critical: critical.has(n.id) || n.isCritical };
      if (n.type === 'task') {
        if (n.status === 'draft' || n.status === 'cancelled') continue;
        const open = ['not_started', 'in_progress', 'blocked'].includes(n.status);
        if (n.status === 'not_started' && inWindow(n.plannedStart, w)) starting.push({ ...base, date: n.plannedStart!, dateKind: 'start' });
        const finish = n.forecastFinish ?? n.plannedFinish;
        if (open && inWindow(finish, w)) due.push({ ...base, date: finish!, dateKind: 'finish' });
        const dueDate = n.plannedFinish ?? n.forecastFinish;
        if (isOverdue(dueDate, today, open)) overdue.push({ ...base, date: dueDate!, dateKind: 'finish' });
      } else {
        const open = ['planned', 'at_risk'].includes(n.status);
        const date = n.forecastFinish ?? n.plannedFinish;
        if (open && inWindow(date, w)) due.push({ ...base, date: date!, dateKind: 'due' });
        if (isOverdue(n.plannedFinish, today, open)) overdue.push({ ...base, date: n.plannedFinish!, dateKind: 'due' });
      }
    }
    const dels = await this.tx
      .select({ id: schema.deliverable.id, code: schema.deliverable.code, title: schema.deliverable.title, workstreamId: schema.deliverable.workstreamId, status: schema.deliverable.status, dueDate: schema.deliverable.dueDate, ownerUserId: schema.deliverable.ownerUserId })
      .from(schema.deliverable)
      .where(and(eq(schema.deliverable.projectId, projectId), or(eq(schema.deliverable.status, 'planned'), eq(schema.deliverable.status, 'in_progress'), eq(schema.deliverable.status, 'rejected'), eq(schema.deliverable.status, 'submitted'))));
    const dNames = await this.s.userNames(dels.map((d) => d.ownerUserId));
    for (const d of dels) {
      if (!inScope(d.workstreamId) || !d.dueDate) continue;
      const base = { id: d.id, type: 'deliverable' as const, code: d.code, title: d.title, workstreamCode: wsCode(d.workstreamId), status: d.status, ownerName: d.ownerUserId ? (dNames.get(d.ownerUserId) ?? null) : null, critical: false, date: d.dueDate, dateKind: 'due' as const };
      if (inWindow(d.dueDate, w)) due.push(base);
      if (isOverdue(d.dueDate, today, d.status !== 'submitted')) overdue.push(base);
    }
    const byDate = (a: Item, b: Item) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.code.localeCompare(b.code));
    return { today, window: { ...w, weeks: q.weeks }, starting: starting.sort(byDate), due: due.sort(byDate), overdue: overdue.sort(byDate) };
  }
}

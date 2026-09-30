import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, SQL } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  TASK_MACHINE,
  MILESTONE_MACHINE,
  DELIVERABLE_MACHINE,
  TaskStatus,
  MilestoneStatus,
  DeliverableStatus,
  allowedCommands,
  transition,
  ruleViolation,
  conflict,
  invalid,
  notFound,
  isOverdue,
  assertDesignatedApprover,
} from '@hub/domain';
import type { z } from 'zod';
import type {
  TaskListQuery,
  CreateTaskBody,
  UpdateTaskBody,
  ProgressBody,
  OwnerBody,
  MilestoneListQuery,
  CreateMilestoneBody,
  UpdateMilestoneBody,
  DeliverableListQuery,
  CreateDeliverableBody,
  UpdateDeliverableBody,
} from '@hub/contracts';
import { AuditService } from '../../platform/audit.service';
import { OutboxService } from '../../platform/outbox.service';
import { RecordVersionService, updateVersioned, loadInProject, nextCode, pageOf, offsetOf } from '../../platform/helpers';
import { orderBySort } from '../../platform/sort';
import type { RequestContext } from '../../platform/context';
import { newId } from '../../platform/ids';
import { PlanningSupport, ProjectInfo } from './planning-support';
import { PrerequisiteService } from './prerequisites.service';
import { likeContains } from '../../platform/helpers';

type Task = typeof schema.task.$inferSelect;
type Milestone = typeof schema.milestone.$inferSelect;
type Deliverable = typeof schema.deliverable.$inferSelect;

const OPEN_FOR_OVERDUE: TaskStatus[] = ['not_started', 'in_progress', 'blocked'];
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const taskDue = (t: Pick<Task, 'plannedFinish' | 'forecastFinish'>) => t.plannedFinish ?? t.forecastFinish;

/** Tasks, milestones, deliverables, accountable owners, RACI and the responsibility matrix (spec §6, §9). */
@Injectable()
export class WbsService {
  constructor(
    private readonly s: PlanningSupport,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly versions: RecordVersionService,
    private readonly prerequisites: PrerequisiteService,
  ) {}

  private get tx() {
    return this.s.db.tx();
  }

  // =========================================================================================================
  // Tasks

  private taskAllowed(t: Task): string[] {
    return allowedCommands(TASK_MACHINE, t.status as TaskStatus).filter((c) => (c === 'complete' ? !t.requiresAcceptance : c === 'submit_for_acceptance' ? t.requiresAcceptance : true));
  }

  private async taskDtos(ctx: RequestContext, p: ProjectInfo, rows: Task[]) {
    const ws = await this.s.workstreamCodes(p.id);
    const names = await this.s.userNames(rows.map((r) => r.accountableUserId));
    const ev = await this.s.visibleEvidenceCounts(ctx, p.id, 'task', rows.map((r) => r.id)); // display: SEC-P1R-05
    const today = this.s.today(p);
    return rows.map((t) => ({
      id: t.id,
      workstreamId: t.workstreamId,
      workstreamCode: t.workstreamId ? (ws.get(t.workstreamId)?.code ?? null) : null,
      parentId: t.parentId,
      wbsCode: t.wbsCode,
      title: t.title,
      titleAr: t.titleAr,
      description: t.description,
      status: t.status as TaskStatus,
      accountableUserId: t.accountableUserId,
      accountableName: t.accountableUserId ? (names.get(t.accountableUserId) ?? null) : null,
      proposedOwnerFunction: t.proposedOwnerFunction,
      output: t.output,
      acceptanceCriteria: t.acceptanceCriteria,
      approverRole: t.approverRole,
      evidenceType: t.evidenceType,
      effort: t.effort,
      durationDays: t.durationDays,
      durationBasis: t.durationBasis,
      plannedStart: t.plannedStart,
      plannedFinish: t.plannedFinish,
      forecastStart: t.forecastStart,
      forecastFinish: t.forecastFinish,
      actualStart: t.actualStart,
      actualFinish: t.actualFinish,
      reportedProgress: t.reportedProgress,
      verifiedProgress: t.status === 'accepted' ? 100 : 0,
      requiresAcceptance: t.requiresAcceptance,
      submittedBy: t.submittedBy,
      acceptedBy: t.acceptedBy,
      acceptedAt: iso(t.acceptedAt),
      blockedReason: t.blockedReason,
      gateKey: t.gateKey,
      isDeliverable: t.isDeliverable,
      weight: t.weight,
      templateActivityId: t.templateActivityId,
      verificationStatus: t.verificationStatus,
      overdue: isOverdue(taskDue(t), today, OPEN_FOR_OVERDUE.includes(t.status as TaskStatus)),
      evidenceCount: ev.get(t.id)?.active ?? 0,
      allowedCommands: this.taskAllowed(t),
      isDemo: t.isDemo,
      version: t.version,
      updatedAt: t.updatedAt.toISOString(),
    }));
  }

  async listTasks(ctx: RequestContext, projectId: string, q: z.infer<typeof TaskListQuery>) {
    const p = await this.s.project(ctx, projectId);
    const T = schema.task;
    const today = this.s.today(p);
    const conds: SQL[] = [eq(T.projectId, projectId), this.s.scopeSql(ctx, p, T.workstreamId)];
    if (q.workstreamId) conds.push(eq(T.workstreamId, q.workstreamId));
    if (q.status) conds.push(inArray(T.status, q.status));
    if (q.ownerUserId) conds.push(eq(T.accountableUserId, q.ownerUserId === 'me' ? (ctx.principal.userId ?? '00000000-0000-0000-0000-000000000000') : q.ownerUserId));
    if (q.gateKey) conds.push(eq(T.gateKey, q.gateKey));
    if (q.q) conds.push(or(ilike(T.title, likeContains(q.q)), ilike(T.wbsCode, likeContains(q.q)))!);
    const overdueSql = sql`(${T.status} in ('not_started','in_progress','blocked') and coalesce(${T.plannedFinish}, ${T.forecastFinish}) < ${today})`;
    if (q.overdue === 'true') conds.push(overdueSql);
    if (q.overdue === 'false') conds.push(sql`not ${overdueSql}`);
    const where = and(...conds);
    const order = orderBySort(
      q.sort,
      { wbs: [T.sortOrder, T.wbsCode], title: T.title, status: [T.status, T.sortOrder, T.wbsCode], plannedFinish: [T.plannedFinish, T.wbsCode], updatedAt: T.updatedAt },
      T.id,
      [asc(T.sortOrder), asc(T.wbsCode), asc(T.id)],
    );
    const [{ n }] = (await this.tx.select({ n: count() }).from(T).where(where)) as [{ n: number }];
    const rows = await this.tx.select().from(T).where(where).orderBy(...order).limit(q.pageSize).offset(offsetOf(q));
    return pageOf(await this.taskDtos(ctx, p, rows), Number(n), q);
  }

  async getTask(ctx: RequestContext, projectId: string, taskId: string) {
    const p = await this.s.project(ctx, projectId);
    const t = await loadInProject(this.s.db, schema.task, projectId, taskId);
    this.s.assertReadable(ctx, p, t.workstreamId);
    return (await this.taskDtos(ctx, p, [t]))[0]!;
  }

  async createTask(ctx: RequestContext, projectId: string, body: z.infer<typeof CreateTaskBody>) {
    const p = await this.s.project(ctx, projectId);
    const ws = await loadInProject(this.s.db, schema.workstream, projectId, body.workstreamId);
    this.s.assert(ctx, 'planning.task.manage', p, { workstreamId: ws.id });
    if (body.parentId) await loadInProject(this.s.db, schema.task, projectId, body.parentId);
    if (body.accountableUserId) await this.s.assertMember(projectId, body.accountableUserId);
    this.s.assertRange(body.plannedStart, body.plannedFinish, 'Planned dates');
    let wbsCode = body.wbsCode;
    if (!wbsCode) {
      const prefix = `${ws.code}-N`;
      const r = await this.tx.select({ n: count() }).from(schema.task).where(and(eq(schema.task.projectId, projectId), sql`${schema.task.wbsCode} like ${prefix + '%'}`));
      wbsCode = `${prefix}${String(Number(r[0]!.n) + 1).padStart(2, '0')}`;
    }
    const id = newId();
    const [maxSort] = await this.tx.select({ m: sql<number>`coalesce(max(${schema.task.sortOrder}), 0)::int` }).from(schema.task).where(eq(schema.task.projectId, projectId));
    const values: typeof schema.task.$inferInsert = {
      id,
      orgId: ctx.principal.orgId,
      projectId,
      workstreamId: ws.id,
      parentId: body.parentId ?? null,
      wbsCode,
      title: body.title,
      titleAr: body.titleAr ?? null,
      description: body.description ?? null,
      // Created deliberately by a planner → confirmed into the plan (template activities start as Draft instead).
      status: 'not_started',
      accountableUserId: body.accountableUserId ?? null,
      output: body.output ?? null,
      acceptanceCriteria: body.acceptanceCriteria ?? null,
      approverRole: body.approverRole ?? null,
      evidenceType: body.evidenceType ?? null,
      effort: body.effort ?? null,
      durationDays: body.durationDays ?? null,
      durationBasis: body.durationBasis ?? (body.durationDays !== undefined ? 'estimated' : 'tbd'),
      plannedStart: body.plannedStart ?? null,
      plannedFinish: body.plannedFinish ?? null,
      requiresAcceptance: body.requiresAcceptance,
      gateKey: body.gateKey ?? null,
      weight: body.weight ?? 1,
      verificationStatus: 'confirmed',
      sortOrder: Number(maxSort?.m ?? 0) + 1,
      isDemo: p.isDemo,
      createdBy: ctx.principal.userId,
    };
    await this.tx.insert(schema.task).values(values);
    await this.audit.record({ action: 'planning.task.create', entityType: 'task', entityId: id, projectId, after: { wbsCode, title: body.title, workstreamId: ws.id } });
    await this.versions.snapshot({ projectId, entityType: 'task', entityId: id, versionNo: 1, snapshot: values as Record<string, unknown>, reason: 'created' });
    return { id, code: wbsCode, version: 1 };
  }

  async updateTask(ctx: RequestContext, projectId: string, taskId: string, body: z.infer<typeof UpdateTaskBody>) {
    const p = await this.s.project(ctx, projectId);
    const t = await loadInProject(this.s.db, schema.task, projectId, taskId);
    this.s.assert(ctx, 'planning.task.manage', p, { workstreamId: t.workstreamId });
    this.s.assertVersion(t, body.expectedVersion, 'task');
    if (['accepted', 'done', 'cancelled'].includes(t.status)) throw ruleViolation('task.not_editable', `A ${t.status} task cannot be edited — reopen it first`);
    // DOM-P2-07: the approver role cannot be swapped while the task awaits acceptance (return it to the owner first).
    if (body.approverRole !== undefined && body.approverRole !== t.approverRole && t.status === 'submitted_for_acceptance') {
      throw ruleViolation('task.approver_role_locked', 'The approver role cannot change while the task awaits acceptance — return it first');
    }
    // Explicit field mapping — never spread the request body (status/owner/actuals are commands).
    const c: Partial<typeof schema.task.$inferInsert> = {};
    if (body.title !== undefined) c.title = body.title;
    if (body.titleAr !== undefined) c.titleAr = body.titleAr;
    if (body.description !== undefined) c.description = body.description;
    if (body.output !== undefined) c.output = body.output;
    if (body.acceptanceCriteria !== undefined) c.acceptanceCriteria = body.acceptanceCriteria;
    if (body.approverRole !== undefined) c.approverRole = body.approverRole;
    if (body.evidenceType !== undefined) c.evidenceType = body.evidenceType;
    if (body.effort !== undefined) c.effort = body.effort;
    if (body.durationDays !== undefined) c.durationDays = body.durationDays;
    if (body.durationBasis !== undefined) c.durationBasis = body.durationBasis;
    if (body.plannedStart !== undefined) c.plannedStart = body.plannedStart;
    if (body.plannedFinish !== undefined) c.plannedFinish = body.plannedFinish;
    if (body.gateKey !== undefined) c.gateKey = body.gateKey;
    if (body.weight !== undefined) c.weight = body.weight;
    if (body.parentId !== undefined) {
      if (body.parentId === taskId) throw ruleViolation('task.parent_self', 'A task cannot be its own parent');
      if (body.parentId) await loadInProject(this.s.db, schema.task, projectId, body.parentId);
      c.parentId = body.parentId;
    }
    if (body.requiresAcceptance !== undefined && body.requiresAcceptance !== t.requiresAcceptance) {
      // Removing the acceptance requirement once work started would bypass verification.
      if (!body.requiresAcceptance && !['draft', 'not_started'].includes(t.status)) {
        throw ruleViolation('task.acceptance_requirement_locked', 'The acceptance requirement cannot be removed after work has started');
      }
      c.requiresAcceptance = body.requiresAcceptance;
    }
    this.s.assertRange(c.plannedStart !== undefined ? c.plannedStart : t.plannedStart, c.plannedFinish !== undefined ? c.plannedFinish : t.plannedFinish, 'Planned dates');
    if (Object.keys(c).length === 0) throw invalid('planning.no_changes', 'No changes supplied');
    const row = (await updateVersioned(this.s.db, schema.task, { id: taskId, projectId, expectedVersion: body.expectedVersion }, c)) as Task;
    const before = Object.fromEntries(Object.keys(c).map((k) => [k, (t as Record<string, unknown>)[k]]));
    await this.audit.record({ action: 'planning.task.update', entityType: 'task', entityId: taskId, projectId, before, after: c as Record<string, unknown> });
    await this.versions.snapshot({ projectId, entityType: 'task', entityId: taskId, versionNo: row.version, snapshot: row as unknown as Record<string, unknown>, reason: 'updated' });
    return { id: taskId, version: row.version };
  }

  /** Applies a TASK_MACHINE command with optimistic concurrency, audit and extra column changes. */
  private async applyTask(ctx: RequestContext, p: ProjectInfo, t: Task, command: Parameters<typeof transition<TaskStatus, keyof typeof TASK_MACHINE>>[3], expectedVersion: number, extra: Partial<typeof schema.task.$inferInsert>, audit: { reason?: string | null; after?: Record<string, unknown> } = {}) {
    this.s.assertVersion(t, expectedVersion, 'task');
    const to = transition('task', TASK_MACHINE, t.status as TaskStatus, command);
    const row = (await updateVersioned(this.s.db, schema.task, { id: t.id, projectId: p.id, expectedVersion }, { ...extra, status: to })) as Task;
    await this.audit.record({ action: `planning.task.${command}`, entityType: 'task', entityId: t.id, projectId: p.id, before: { status: t.status }, after: { status: to, ...(audit.after ?? {}) }, reason: audit.reason ?? null });
    return { id: t.id, status: to as string, version: row.version };
  }

  private async loadTask(ctx: RequestContext, projectId: string, taskId: string) {
    const p = await this.s.project(ctx, projectId);
    const t = await this.s.lockInProject(schema.task, projectId, taskId);
    return { p, t };
  }

  async activateTask(ctx: RequestContext, projectId: string, taskId: string, body: { expectedVersion: number; note?: string }) {
    const { p, t } = await this.loadTask(ctx, projectId, taskId);
    this.s.assert(ctx, 'planning.task.manage', p, { workstreamId: t.workstreamId });
    return this.applyTask(ctx, p, t, 'activate', body.expectedVersion, { verificationStatus: 'confirmed' }, { reason: body.note });
  }

  async activateWorkstreamTasks(ctx: RequestContext, projectId: string, workstreamId: string, note?: string) {
    const p = await this.s.project(ctx, projectId);
    const ws = await loadInProject(this.s.db, schema.workstream, projectId, workstreamId);
    this.s.assert(ctx, 'planning.task.manage', p, { workstreamId: ws.id });
    const rows = await this.tx
      .update(schema.task)
      .set({ status: 'not_started', verificationStatus: 'confirmed', updatedAt: new Date(), version: sql`${schema.task.version} + 1` })
      .where(and(eq(schema.task.projectId, projectId), eq(schema.task.workstreamId, ws.id), eq(schema.task.status, 'draft')))
      .returning({ id: schema.task.id, wbsCode: schema.task.wbsCode });
    await this.audit.record({ action: 'planning.task.activate_bulk', entityType: 'workstream', entityId: ws.id, projectId, after: { activated: rows.length, wbsCodes: rows.map((r) => r.wbsCode) }, reason: note ?? null });
    return { activated: rows.length };
  }

  async startTask(ctx: RequestContext, projectId: string, taskId: string, body: { expectedVersion: number; actualStart?: string; note?: string }) {
    const { p, t } = await this.loadTask(ctx, projectId, taskId);
    await this.s.assertOwnerOrAssigned(ctx, p, { type: 'task', id: t.id, workstreamId: t.workstreamId, ownerUserId: t.accountableUserId });
    const today = this.s.today(p);
    const actualStart = body.actualStart ?? today;
    if (actualStart > today) throw ruleViolation('task.actual_in_future', 'An actual start cannot be in the future');
    // DOM-P2-18 / REQ-PLN-006: a pending decision / gate / agreement / approval / evidence prerequisite blocks the start.
    await this.prerequisites.assertNonePending(projectId, 'task', t.id, `Task ${t.wbsCode}`);
    return this.applyTask(ctx, p, t, 'start', body.expectedVersion, { actualStart }, { reason: body.note, after: { actualStart } });
  }

  async blockTask(ctx: RequestContext, projectId: string, taskId: string, body: { expectedVersion: number; reason: string }) {
    const { p, t } = await this.loadTask(ctx, projectId, taskId);
    await this.s.assertOwnerOrAssigned(ctx, p, { type: 'task', id: t.id, workstreamId: t.workstreamId, ownerUserId: t.accountableUserId });
    return this.applyTask(ctx, p, t, 'block', body.expectedVersion, { blockedReason: body.reason }, { reason: body.reason });
  }

  async unblockTask(ctx: RequestContext, projectId: string, taskId: string, body: { expectedVersion: number; note?: string }) {
    const { p, t } = await this.loadTask(ctx, projectId, taskId);
    await this.s.assertOwnerOrAssigned(ctx, p, { type: 'task', id: t.id, workstreamId: t.workstreamId, ownerUserId: t.accountableUserId });
    return this.applyTask(ctx, p, t, 'unblock', body.expectedVersion, { blockedReason: null }, { reason: body.note });
  }

  async submitTaskForAcceptance(ctx: RequestContext, projectId: string, taskId: string, body: { expectedVersion: number; note?: string }) {
    const { p, t } = await this.loadTask(ctx, projectId, taskId);
    await this.s.assertOwnerOrAssigned(ctx, p, { type: 'task', id: t.id, workstreamId: t.workstreamId, ownerUserId: t.accountableUserId });
    if (!t.requiresAcceptance) throw ruleViolation('task.acceptance_not_required', 'This task does not require acceptance — use complete');
    const r = await this.applyTask(ctx, p, t, 'submit_for_acceptance', body.expectedVersion, { submittedBy: ctx.principal.userId, submittedAt: new Date(), reportedProgress: 100 }, { reason: body.note });
    await this.outbox.emit({ type: 'approval.pending', projectId, aggregateType: 'task', aggregateId: t.id, payload: { kind: 'task_acceptance', workstreamId: t.workstreamId } });
    return r;
  }

  async acceptTask(ctx: RequestContext, projectId: string, taskId: string, body: { expectedVersion: number; note?: string }) {
    const { p, t } = await this.loadTask(ctx, projectId, taskId);
    // Separation of duties: the acceptor must not be the submitter (policy condition not_self) — after the state check.
    this.s.assertApproval(ctx, 'planning.deliverable.accept', p, { workstreamId: t.workstreamId, requesterUserId: t.submittedBy }, () => transition('task', TASK_MACHINE, t.status as TaskStatus, 'accept'));
    // DOM-P2-07: the task's designated approver role (spec §6) — not any holder of the acceptance permission.
    assertDesignatedApprover({ subject: `task ${t.wbsCode}`, approverRole: t.approverRole, actorRoles: this.s.rolesFor(ctx, projectId, t.workstreamId) });
    this.s.assertVersion(t, body.expectedVersion, 'task');
    if (t.status === 'submitted_for_acceptance') await this.s.assertEvidence(projectId, 'task', t.id);
    const today = this.s.today(p);
    return this.applyTask(ctx, p, t, 'accept', body.expectedVersion, { acceptedBy: ctx.principal.userId, acceptedAt: new Date(), actualFinish: t.actualFinish ?? today }, { reason: body.note });
  }

  async rejectTaskAcceptance(ctx: RequestContext, projectId: string, taskId: string, body: { expectedVersion: number; reason: string }) {
    const { p, t } = await this.loadTask(ctx, projectId, taskId);
    this.s.assertApproval(ctx, 'planning.deliverable.accept', p, { workstreamId: t.workstreamId, requesterUserId: t.submittedBy }, () => transition('task', TASK_MACHINE, t.status as TaskStatus, 'reject_acceptance'));
    assertDesignatedApprover({ subject: `task ${t.wbsCode}`, approverRole: t.approverRole, actorRoles: this.s.rolesFor(ctx, projectId, t.workstreamId) });
    return this.applyTask(ctx, p, t, 'reject_acceptance', body.expectedVersion, { submittedBy: null, submittedAt: null }, { reason: body.reason });
  }

  async completeTask(ctx: RequestContext, projectId: string, taskId: string, body: { expectedVersion: number; actualFinish?: string; note?: string }) {
    const { p, t } = await this.loadTask(ctx, projectId, taskId);
    await this.s.assertOwnerOrAssigned(ctx, p, { type: 'task', id: t.id, workstreamId: t.workstreamId, ownerUserId: t.accountableUserId });
    if (t.requiresAcceptance) throw ruleViolation('task.acceptance_required', 'This task requires acceptance — submit it for acceptance instead');
    const today = this.s.today(p);
    const actualFinish = body.actualFinish ?? today;
    if (actualFinish > today) throw ruleViolation('task.actual_in_future', 'An actual finish cannot be in the future');
    if (t.actualStart && actualFinish < t.actualStart) throw ruleViolation('planning.invalid_date_range', 'Actual finish is before actual start');
    return this.applyTask(ctx, p, t, 'complete', body.expectedVersion, { actualFinish, reportedProgress: 100 }, { reason: body.note, after: { actualFinish } });
  }

  async cancelTask(ctx: RequestContext, projectId: string, taskId: string, body: { expectedVersion: number; reason: string }) {
    const { p, t } = await this.loadTask(ctx, projectId, taskId);
    this.s.assert(ctx, 'planning.task.manage', p, { workstreamId: t.workstreamId });
    return this.applyTask(ctx, p, t, 'cancel', body.expectedVersion, {}, { reason: body.reason });
  }

  async reopenTask(ctx: RequestContext, projectId: string, taskId: string, body: { expectedVersion: number; reason: string }) {
    const { p, t } = await this.loadTask(ctx, projectId, taskId);
    this.s.assert(ctx, 'planning.task.manage', p, { workstreamId: t.workstreamId });
    return this.applyTask(ctx, p, t, 'reopen', body.expectedVersion, { acceptedBy: null, acceptedAt: null, submittedBy: null, submittedAt: null, actualFinish: null }, { reason: body.reason });
  }

  async updateTaskProgress(ctx: RequestContext, projectId: string, taskId: string, body: z.infer<typeof ProgressBody>) {
    const { p, t } = await this.loadTask(ctx, projectId, taskId);
    await this.s.assertOwnerOrAssigned(ctx, p, { type: 'task', id: t.id, workstreamId: t.workstreamId, ownerUserId: t.accountableUserId });
    this.s.assertVersion(t, body.expectedVersion, 'task');
    if (!['not_started', 'in_progress', 'blocked', 'submitted_for_acceptance'].includes(t.status)) {
      throw ruleViolation('task.progress_not_allowed', `Progress cannot be reported on a ${t.status} task`);
    }
    const c: Partial<typeof schema.task.$inferInsert> = { reportedProgress: body.reportedProgress };
    if (body.forecastStart !== undefined) c.forecastStart = body.forecastStart;
    if (body.forecastFinish !== undefined) c.forecastFinish = body.forecastFinish;
    this.s.assertRange(c.forecastStart !== undefined ? c.forecastStart : t.forecastStart, c.forecastFinish !== undefined ? c.forecastFinish : t.forecastFinish, 'Forecast dates');
    const row = (await updateVersioned(this.s.db, schema.task, { id: t.id, projectId, expectedVersion: body.expectedVersion }, c)) as Task;
    await this.audit.record({
      action: 'planning.task.update_progress',
      entityType: 'task',
      entityId: t.id,
      projectId,
      before: { reportedProgress: t.reportedProgress, forecastStart: t.forecastStart, forecastFinish: t.forecastFinish },
      after: c as Record<string, unknown>,
      reason: body.note ?? null,
    });
    return { id: t.id, version: row.version };
  }

  // =========================================================================================================
  // Accountable owners (exactly one per task/milestone/deliverable)

  async assignOwner(ctx: RequestContext, projectId: string, kind: 'task' | 'milestone' | 'deliverable', id: string, body: z.infer<typeof OwnerBody>) {
    const p = await this.s.project(ctx, projectId);
    const table = kind === 'task' ? schema.task : kind === 'milestone' ? schema.milestone : schema.deliverable;
    const row = (await this.s.lockInProject(table, projectId, id)) as Task | Milestone | Deliverable;
    const current = kind === 'task' ? (row as Task).accountableUserId : (row as Milestone).ownerUserId;
    const firstPerm = kind === 'task' ? 'planning.task.manage' : 'planning.wbs.manage';
    // Setting a first owner is planning; CHANGING an existing accountable owner needs planning.ownership.reassign.
    this.s.assert(ctx, current ? 'planning.ownership.reassign' : firstPerm, p, { workstreamId: row.workstreamId });
    this.s.assertVersion(row, body.expectedVersion, kind);
    if (current === body.userId) throw ruleViolation('planning.owner_unchanged', 'This person is already the accountable owner');
    await this.s.assertMember(projectId, body.userId);
    const col = kind === 'task' ? { accountableUserId: body.userId } : { ownerUserId: body.userId };
    const updated = await updateVersioned(this.s.db, table, { id, projectId, expectedVersion: body.expectedVersion }, col);
    await this.audit.record({ action: current ? 'planning.ownership.reassign' : 'planning.ownership.assign', entityType: kind, entityId: id, projectId, before: { owner: current }, after: { owner: body.userId }, reason: body.reason ?? null });
    return { id, version: updated['version'] as number };
  }

  // =========================================================================================================
  // RACI

  private async raciEntity(projectId: string, entityType: string, entityId: string) {
    switch (entityType) {
      case 'task': {
        const t = await loadInProject(this.s.db, schema.task, projectId, entityId);
        return { workstreamId: t.workstreamId, owner: t.accountableUserId };
      }
      case 'milestone': {
        const m = await loadInProject(this.s.db, schema.milestone, projectId, entityId);
        return { workstreamId: m.workstreamId, owner: m.ownerUserId };
      }
      case 'deliverable': {
        const d = await loadInProject(this.s.db, schema.deliverable, projectId, entityId);
        return { workstreamId: d.workstreamId, owner: d.ownerUserId };
      }
      case 'workstream': {
        const w = await loadInProject(this.s.db, schema.workstream, projectId, entityId);
        return { workstreamId: w.id, owner: w.leadUserId };
      }
      default:
        throw invalid('raci.entity_type', 'Unsupported RACI entity type');
    }
  }

  async listRaci(ctx: RequestContext, projectId: string, q: { entityType: 'task' | 'milestone' | 'deliverable' | 'workstream'; entityId: string }) {
    const p = await this.s.project(ctx, projectId);
    const e = await this.raciEntity(projectId, q.entityType, q.entityId);
    this.s.assertReadable(ctx, p, e.workstreamId);
    const rows = await this.tx
      .select()
      .from(schema.raciAssignment)
      .where(and(eq(schema.raciAssignment.projectId, projectId), eq(schema.raciAssignment.entityType, q.entityType), eq(schema.raciAssignment.entityId, q.entityId)))
      .orderBy(asc(schema.raciAssignment.raci), asc(schema.raciAssignment.createdAt));
    const names = await this.s.userNames([e.owner, ...rows.map((r) => r.userId)]);
    const items = [
      ...(e.owner ? [{ id: null, entityType: q.entityType, entityId: q.entityId, userId: e.owner, displayName: names.get(e.owner) ?? null, functionLabel: null, raci: 'A' as const, derived: true }] : []),
      ...rows.map((r) => ({ id: r.id, entityType: q.entityType, entityId: q.entityId, userId: r.userId, displayName: r.userId ? (names.get(r.userId) ?? null) : null, functionLabel: r.functionLabel, raci: r.raci as 'R' | 'A' | 'C' | 'I', derived: false })),
    ];
    return { items };
  }

  async addRaci(ctx: RequestContext, projectId: string, body: { entityType: 'task' | 'milestone' | 'deliverable' | 'workstream'; entityId: string; userId?: string; functionLabel?: string; raci: 'R' | 'A' | 'C' | 'I' }) {
    const p = await this.s.project(ctx, projectId);
    const e = await this.raciEntity(projectId, body.entityType, body.entityId);
    this.s.assert(ctx, 'planning.task.manage', p, { workstreamId: e.workstreamId });
    if (body.raci === 'A') throw ruleViolation('raci.accountable_via_owner', 'Exactly one accountable owner per record — set it with the owner command, not as a RACI entry');
    if (body.userId) {
      await this.s.assertMember(projectId, body.userId);
      if (await this.s.activeRaci(projectId, body.entityType, body.entityId, body.userId, body.raci)) throw conflict('raci.duplicate', 'This assignment already exists');
    }
    const id = newId();
    await this.tx.insert(schema.raciAssignment).values({ id, orgId: ctx.principal.orgId, projectId, entityType: body.entityType, entityId: body.entityId, userId: body.userId ?? null, functionLabel: body.functionLabel ?? null, raci: body.raci, createdBy: ctx.principal.userId });
    await this.audit.record({ action: 'planning.raci.add', entityType: body.entityType, entityId: body.entityId, projectId, after: { raciId: id, userId: body.userId ?? null, functionLabel: body.functionLabel ?? null, raci: body.raci } });
    return { id };
  }

  async removeRaci(ctx: RequestContext, projectId: string, raciId: string, reason?: string) {
    const p = await this.s.project(ctx, projectId);
    const r = await loadInProject(this.s.db, schema.raciAssignment, projectId, raciId);
    const e = await this.raciEntity(projectId, r.entityType, r.entityId);
    this.s.assert(ctx, 'planning.task.manage', p, { workstreamId: e.workstreamId });
    await this.tx.delete(schema.raciAssignment).where(and(eq(schema.raciAssignment.id, raciId), eq(schema.raciAssignment.projectId, projectId)));
    await this.audit.record({ action: 'planning.raci.remove', entityType: r.entityType, entityId: r.entityId, projectId, before: { raciId, userId: r.userId, raci: r.raci }, reason: reason ?? null });
    return { ok: true as const };
  }

  /** REQ-PLN-014: owner-level load and conflicts. Deliberately simple counts — no resource optimisation is claimed. */
  async responsibility(ctx: RequestContext, projectId: string) {
    const p = await this.s.project(ctx, projectId);
    this.s.assertProjectRead(ctx, p);
    const today = this.s.today(p);
    const thresholds = { maxOpenAccountable: 12, maxOverdue: 3 };
    const r = await this.tx.execute<{ user_id: string; display_name: string; acc_open: number; overdue: number; ms: number; dl: number; risks: number; r_cnt: number; c_cnt: number; i_cnt: number; member: boolean }>(sql`
      with owners as (
        select accountable_user_id as uid from task where project_id = ${projectId} and accountable_user_id is not null
        union select owner_user_id from milestone where project_id = ${projectId} and owner_user_id is not null
        union select owner_user_id from deliverable where project_id = ${projectId} and owner_user_id is not null
        union select owner_user_id from risk where project_id = ${projectId} and owner_user_id is not null
        union select user_id from raci_assignment where project_id = ${projectId} and user_id is not null
      )
      select u.id as user_id, u.display_name,
        (select count(*) from task t where t.project_id = ${projectId} and t.accountable_user_id = u.id and t.status in ('not_started','in_progress','blocked','submitted_for_acceptance'))::int as acc_open,
        (select count(*) from task t where t.project_id = ${projectId} and t.accountable_user_id = u.id and t.status in ('not_started','in_progress','blocked') and coalesce(t.planned_finish, t.forecast_finish) < ${today})::int as overdue,
        (select count(*) from milestone m where m.project_id = ${projectId} and m.owner_user_id = u.id and m.status in ('planned','at_risk','achieved_pending_evidence','missed'))::int as ms,
        (select count(*) from deliverable d where d.project_id = ${projectId} and d.owner_user_id = u.id and d.status in ('planned','in_progress','submitted','rejected'))::int as dl,
        (select count(*) from risk r where r.project_id = ${projectId} and r.owner_user_id = u.id and r.status in ('open','monitoring','escalated'))::int as risks,
        (select count(*) from raci_assignment a where a.project_id = ${projectId} and a.user_id = u.id and a.raci = 'R')::int as r_cnt,
        (select count(*) from raci_assignment a where a.project_id = ${projectId} and a.user_id = u.id and a.raci = 'C')::int as c_cnt,
        (select count(*) from raci_assignment a where a.project_id = ${projectId} and a.user_id = u.id and a.raci = 'I')::int as i_cnt,
        exists (select 1 from project_membership m where m.project_id = ${projectId} and m.user_id = u.id and m.revoked_at is null and (m.valid_to is null or m.valid_to > now())) as member
      from owners o join app_user u on u.id = o.uid
      order by u.display_name`);
    const owners = r.rows.map((x) => ({
      userId: x.user_id,
      displayName: x.display_name,
      accountableOpenTasks: Number(x.acc_open),
      overdueTasks: Number(x.overdue),
      milestones: Number(x.ms),
      deliverables: Number(x.dl),
      openRisks: Number(x.risks),
      responsible: Number(x.r_cnt),
      consulted: Number(x.c_cnt),
      informed: Number(x.i_cnt),
      overloaded: Number(x.acc_open) > thresholds.maxOpenAccountable,
      hasProjectRole: !!x.member,
    }));
    const conflicts: { kind: 'overloaded_owner' | 'overdue_concentration' | 'owner_without_project_role' | 'missing_owner'; userId: string | null; detail: string; count: number }[] = [];
    for (const o of owners) {
      if (o.overloaded) conflicts.push({ kind: 'overloaded_owner', userId: o.userId, detail: `${o.displayName} is accountable for ${o.accountableOpenTasks} open tasks (proposed limit ${thresholds.maxOpenAccountable})`, count: o.accountableOpenTasks });
      if (o.overdueTasks >= thresholds.maxOverdue) conflicts.push({ kind: 'overdue_concentration', userId: o.userId, detail: `${o.displayName} owns ${o.overdueTasks} overdue tasks`, count: o.overdueTasks });
      if (!o.hasProjectRole) conflicts.push({ kind: 'owner_without_project_role', userId: o.userId, detail: `${o.displayName} owns items but holds no active role in this project`, count: 1 });
    }
    const [missing] = await this.tx
      .select({ n: count() })
      .from(schema.task)
      .where(and(eq(schema.task.projectId, projectId), inArray(schema.task.status, ['not_started', 'in_progress', 'blocked', 'submitted_for_acceptance']), isNull(schema.task.accountableUserId)));
    if (Number(missing!.n) > 0) conflicts.push({ kind: 'missing_owner', userId: null, detail: `${Number(missing!.n)} active task(s) have no accountable owner`, count: Number(missing!.n) });
    return { thresholds, owners, conflicts, explanation: 'Counts of accountable/assigned items per person with proposed thresholds. This is a responsibility view, not resource levelling or capacity optimisation.' };
  }

  // =========================================================================================================
  // Milestones

  private msAllowed(m: Milestone) {
    return allowedCommands(MILESTONE_MACHINE, m.status as MilestoneStatus);
  }

  private async milestoneDtos(ctx: RequestContext, p: ProjectInfo, rows: Milestone[]) {
    const ws = await this.s.workstreamCodes(p.id);
    const names = await this.s.userNames(rows.map((r) => r.ownerUserId));
    const ev = await this.s.visibleEvidenceCounts(ctx, p.id, 'milestone', rows.map((r) => r.id)); // display: SEC-P1R-05
    const today = this.s.today(p);
    return rows.map((m) => ({
      id: m.id,
      workstreamId: m.workstreamId,
      workstreamCode: m.workstreamId ? (ws.get(m.workstreamId)?.code ?? null) : null,
      code: m.code,
      title: m.title,
      titleAr: m.titleAr,
      status: m.status as MilestoneStatus,
      plannedDate: m.plannedDate,
      forecastDate: m.forecastDate,
      actualDate: m.actualDate,
      gateKey: m.gateKey,
      isCritical: m.isCritical,
      weight: m.weight,
      ownerUserId: m.ownerUserId,
      ownerName: m.ownerUserId ? (names.get(m.ownerUserId) ?? null) : null,
      verificationStatus: m.verificationStatus,
      reportedBy: m.reportedBy,
      verifiedBy: m.verifiedBy,
      evidenceCount: ev.get(m.id)?.active ?? 0,
      overdue: isOverdue(m.plannedDate, today, ['planned', 'at_risk'].includes(m.status)),
      allowedCommands: this.msAllowed(m),
      isDemo: m.isDemo,
      version: m.version,
    }));
  }

  async listMilestones(ctx: RequestContext, projectId: string, q: z.infer<typeof MilestoneListQuery>) {
    const p = await this.s.project(ctx, projectId);
    const M = schema.milestone;
    const today = this.s.today(p);
    const conds: SQL[] = [eq(M.projectId, projectId), this.s.scopeSql(ctx, p, M.workstreamId)];
    if (q.workstreamId) conds.push(eq(M.workstreamId, q.workstreamId));
    if (q.status) conds.push(inArray(M.status, q.status));
    if (q.gateKey) conds.push(eq(M.gateKey, q.gateKey));
    if (q.critical) conds.push(eq(M.isCritical, q.critical === 'true'));
    if (q.q) conds.push(or(ilike(M.title, likeContains(q.q)), ilike(M.code, likeContains(q.q)))!);
    const od = sql`(${M.status} in ('planned','at_risk') and ${M.plannedDate} < ${today})`;
    if (q.overdue === 'true') conds.push(od);
    if (q.overdue === 'false') conds.push(sql`not coalesce(${od}, false)`);
    const where = and(...conds);
    const [{ n }] = (await this.tx.select({ n: count() }).from(M).where(where)) as [{ n: number }];
    const order = orderBySort(
      q.sort,
      { code: M.code, title: M.title, status: M.status, plannedDate: M.plannedDate, forecastDate: M.forecastDate, updatedAt: M.updatedAt },
      M.id,
      [sql`${M.plannedDate} asc nulls last`, asc(M.code), asc(M.id)],
    );
    const rows = await this.tx.select().from(M).where(where).orderBy(...order).limit(q.pageSize).offset(offsetOf(q));
    return pageOf(await this.milestoneDtos(ctx, p, rows), Number(n), q);
  }

  async getMilestone(ctx: RequestContext, projectId: string, id: string) {
    const p = await this.s.project(ctx, projectId);
    const m = await loadInProject(this.s.db, schema.milestone, projectId, id);
    this.s.assertReadable(ctx, p, m.workstreamId);
    return (await this.milestoneDtos(ctx, p, [m]))[0]!;
  }

  async createMilestone(ctx: RequestContext, projectId: string, body: z.infer<typeof CreateMilestoneBody>) {
    const p = await this.s.project(ctx, projectId);
    if (body.workstreamId) await loadInProject(this.s.db, schema.workstream, projectId, body.workstreamId);
    this.s.assert(ctx, 'planning.wbs.manage', p, { workstreamId: body.workstreamId ?? null });
    if (body.ownerUserId) await this.s.assertMember(projectId, body.ownerUserId);
    const code = body.code ?? (await nextCode(this.s.db, schema.milestone, projectId, 'MS'));
    const id = newId();
    await this.tx.insert(schema.milestone).values({
      id,
      orgId: ctx.principal.orgId,
      projectId,
      workstreamId: body.workstreamId ?? null,
      code,
      title: body.title,
      titleAr: body.titleAr ?? null,
      plannedDate: body.plannedDate ?? null,
      gateKey: body.gateKey ?? null,
      isCritical: body.isCritical,
      weight: body.weight,
      ownerUserId: body.ownerUserId ?? null,
      verificationStatus: 'proposed',
      isDemo: p.isDemo,
      createdBy: ctx.principal.userId,
    });
    await this.audit.record({ action: 'planning.milestone.create', entityType: 'milestone', entityId: id, projectId, after: { code, title: body.title, plannedDate: body.plannedDate ?? null } });
    return { id, code, version: 1 };
  }

  async updateMilestone(ctx: RequestContext, projectId: string, id: string, body: z.infer<typeof UpdateMilestoneBody>) {
    const p = await this.s.project(ctx, projectId);
    const m = await loadInProject(this.s.db, schema.milestone, projectId, id);
    this.s.assert(ctx, 'planning.wbs.manage', p, { workstreamId: m.workstreamId });
    this.s.assertVersion(m, body.expectedVersion, 'milestone');
    if (['achieved_verified', 'cancelled'].includes(m.status)) throw ruleViolation('milestone.not_editable', `A ${m.status} milestone cannot be edited`);
    const c: Partial<typeof schema.milestone.$inferInsert> = {};
    if (body.title !== undefined) c.title = body.title;
    if (body.titleAr !== undefined) c.titleAr = body.titleAr;
    if (body.plannedDate !== undefined) c.plannedDate = body.plannedDate;
    if (body.forecastDate !== undefined) c.forecastDate = body.forecastDate;
    if (body.gateKey !== undefined) c.gateKey = body.gateKey;
    if (body.isCritical !== undefined) c.isCritical = body.isCritical;
    if (body.weight !== undefined) c.weight = body.weight;
    if (Object.keys(c).length === 0) throw invalid('planning.no_changes', 'No changes supplied');
    const row = await updateVersioned(this.s.db, schema.milestone, { id, projectId, expectedVersion: body.expectedVersion }, c);
    await this.audit.record({ action: 'planning.milestone.update', entityType: 'milestone', entityId: id, projectId, before: Object.fromEntries(Object.keys(c).map((k) => [k, (m as Record<string, unknown>)[k]])), after: c as Record<string, unknown> });
    await this.versions.snapshot({ projectId, entityType: 'milestone', entityId: id, versionNo: row['version'] as number, snapshot: row, reason: 'updated' });
    return { id, version: row['version'] as number };
  }

  private async applyMilestone(ctx: RequestContext, p: ProjectInfo, m: Milestone, command: keyof typeof MILESTONE_MACHINE, expectedVersion: number, extra: Partial<typeof schema.milestone.$inferInsert>, reason?: string | null) {
    this.s.assertVersion(m, expectedVersion, 'milestone');
    const to = transition('milestone', MILESTONE_MACHINE, m.status as MilestoneStatus, command);
    const row = await updateVersioned(this.s.db, schema.milestone, { id: m.id, projectId: p.id, expectedVersion }, { ...extra, status: to });
    await this.audit.record({ action: `planning.milestone.${command}`, entityType: 'milestone', entityId: m.id, projectId: p.id, before: { status: m.status }, after: { status: to, ...extra }, reason: reason ?? null });
    return { id: m.id, status: to as string, version: row['version'] as number };
  }

  async milestoneCommand(
    ctx: RequestContext,
    projectId: string,
    id: string,
    command: 'flag_at_risk' | 'clear_risk' | 'report_achieved' | 'verify_achieved' | 'reject_evidence' | 'mark_missed' | 'cancel',
    body: { expectedVersion: number; note?: string; reason?: string; actualDate?: string },
  ) {
    const p = await this.s.project(ctx, projectId);
    const m = await this.s.lockInProject(schema.milestone, projectId, id);
    const owner = { type: 'milestone' as const, id: m.id, workstreamId: m.workstreamId, ownerUserId: m.ownerUserId };
    const reason = body.reason ?? body.note ?? null;
    switch (command) {
      case 'flag_at_risk':
      case 'clear_risk':
        await this.s.assertOwnerOrAssigned(ctx, p, owner);
        return this.applyMilestone(ctx, p, m, command, body.expectedVersion, {}, reason);
      case 'report_achieved': {
        await this.s.assertOwnerOrAssigned(ctx, p, owner);
        const today = this.s.today(p);
        if (!body.actualDate || body.actualDate > today) throw ruleViolation('milestone.actual_in_future', 'The achievement date cannot be in the future');
        await this.prerequisites.assertNonePending(projectId, 'milestone', m.id, `Milestone ${m.code}`); // DOM-P2-18
        return this.applyMilestone(ctx, p, m, command, body.expectedVersion, { actualDate: body.actualDate, reportedBy: ctx.principal.userId, reportedAt: new Date(), verifiedBy: null, verifiedAt: null }, reason);
      }
      case 'verify_achieved':
        // Evidence-verified by someone other than the reporter (not_self), with ≥1 active evidence link.
        this.s.assertApproval(ctx, 'planning.deliverable.accept', p, { workstreamId: m.workstreamId, requesterUserId: m.reportedBy }, () => transition('milestone', MILESTONE_MACHINE, m.status as MilestoneStatus, command));
        this.s.assertVersion(m, body.expectedVersion, 'milestone');
        if (m.status === 'achieved_pending_evidence') await this.s.assertEvidence(projectId, 'milestone', m.id);
        return this.applyMilestone(ctx, p, m, command, body.expectedVersion, { verifiedBy: ctx.principal.userId, verifiedAt: new Date(), verificationStatus: 'confirmed' }, reason);
      case 'reject_evidence':
        this.s.assertApproval(ctx, 'planning.deliverable.accept', p, { workstreamId: m.workstreamId, requesterUserId: m.reportedBy }, () => transition('milestone', MILESTONE_MACHINE, m.status as MilestoneStatus, command));
        return this.applyMilestone(ctx, p, m, command, body.expectedVersion, { verifiedBy: null, verifiedAt: null, verificationStatus: 'proposed' }, reason);
      case 'mark_missed':
      case 'cancel':
        this.s.assert(ctx, 'planning.wbs.manage', p, { workstreamId: m.workstreamId });
        return this.applyMilestone(ctx, p, m, command, body.expectedVersion, {}, reason);
    }
  }

  // =========================================================================================================
  // Deliverables

  private async deliverableDtos(ctx: RequestContext, p: ProjectInfo, rows: Deliverable[]) {
    const ws = await this.s.workstreamCodes(p.id);
    const names = await this.s.userNames(rows.map((r) => r.ownerUserId));
    const ev = await this.s.visibleEvidenceCounts(ctx, p.id, 'deliverable', rows.map((r) => r.id)); // display: SEC-P1R-05
    const today = this.s.today(p);
    return rows.map((d) => ({
      id: d.id,
      workstreamId: d.workstreamId,
      workstreamCode: d.workstreamId ? (ws.get(d.workstreamId)?.code ?? null) : null,
      taskId: d.taskId,
      code: d.code,
      title: d.title,
      titleAr: d.titleAr,
      status: d.status as DeliverableStatus,
      weight: d.weight,
      weightApproved: d.weightApproved,
      weightSetBy: d.weightSetBy,
      weightApprovedBy: d.weightApprovedBy,
      acceptanceCriteria: d.acceptanceCriteria,
      dueDate: d.dueDate,
      ownerUserId: d.ownerUserId,
      ownerName: d.ownerUserId ? (names.get(d.ownerUserId) ?? null) : null,
      submittedBy: d.submittedBy,
      acceptedBy: d.acceptedBy,
      acceptedAt: iso(d.acceptedAt),
      gateKey: d.gateKey,
      evidenceCount: ev.get(d.id)?.active ?? 0,
      overdue: isOverdue(d.dueDate, today, ['planned', 'in_progress', 'rejected'].includes(d.status)),
      allowedCommands: allowedCommands(DELIVERABLE_MACHINE, d.status as DeliverableStatus),
      isDemo: d.isDemo,
      version: d.version,
    }));
  }

  async listDeliverables(ctx: RequestContext, projectId: string, q: z.infer<typeof DeliverableListQuery>) {
    const p = await this.s.project(ctx, projectId);
    const D = schema.deliverable;
    const today = this.s.today(p);
    const conds: SQL[] = [eq(D.projectId, projectId), this.s.scopeSql(ctx, p, D.workstreamId)];
    if (q.workstreamId) conds.push(eq(D.workstreamId, q.workstreamId));
    if (q.status) conds.push(inArray(D.status, q.status));
    if (q.gateKey) conds.push(eq(D.gateKey, q.gateKey));
    if (q.weightApproved) conds.push(eq(D.weightApproved, q.weightApproved === 'true'));
    if (q.q) conds.push(or(ilike(D.title, likeContains(q.q)), ilike(D.code, likeContains(q.q)))!);
    const od = sql`(${D.status} in ('planned','in_progress','rejected') and ${D.dueDate} < ${today})`;
    if (q.overdue === 'true') conds.push(od);
    if (q.overdue === 'false') conds.push(sql`not coalesce(${od}, false)`);
    const where = and(...conds);
    const [{ n }] = (await this.tx.select({ n: count() }).from(D).where(where)) as [{ n: number }];
    const order = orderBySort(q.sort, { code: D.code, title: D.title, status: D.status, dueDate: D.dueDate, updatedAt: D.updatedAt }, D.id, [asc(D.code), asc(D.id)]);
    const rows = await this.tx.select().from(D).where(where).orderBy(...order).limit(q.pageSize).offset(offsetOf(q));
    return pageOf(await this.deliverableDtos(ctx, p, rows), Number(n), q);
  }

  async getDeliverable(ctx: RequestContext, projectId: string, id: string) {
    const p = await this.s.project(ctx, projectId);
    const d = await loadInProject(this.s.db, schema.deliverable, projectId, id);
    this.s.assertReadable(ctx, p, d.workstreamId);
    return (await this.deliverableDtos(ctx, p, [d]))[0]!;
  }

  async createDeliverable(ctx: RequestContext, projectId: string, body: z.infer<typeof CreateDeliverableBody>) {
    const p = await this.s.project(ctx, projectId);
    if (body.workstreamId) await loadInProject(this.s.db, schema.workstream, projectId, body.workstreamId);
    if (body.taskId) await loadInProject(this.s.db, schema.task, projectId, body.taskId);
    this.s.assert(ctx, 'planning.wbs.manage', p, { workstreamId: body.workstreamId ?? null });
    if (body.ownerUserId) await this.s.assertMember(projectId, body.ownerUserId);
    const code = body.code ?? (await nextCode(this.s.db, schema.deliverable, projectId, 'DLV'));
    const id = newId();
    await this.tx.insert(schema.deliverable).values({
      id,
      orgId: ctx.principal.orgId,
      projectId,
      workstreamId: body.workstreamId ?? null,
      taskId: body.taskId ?? null,
      code,
      title: body.title,
      titleAr: body.titleAr ?? null,
      weight: body.weight,
      weightApproved: false,
      weightSetBy: ctx.principal.userId,
      acceptanceCriteria: body.acceptanceCriteria ?? null,
      dueDate: body.dueDate ?? null,
      gateKey: body.gateKey ?? null,
      ownerUserId: body.ownerUserId ?? null,
      isDemo: p.isDemo,
      createdBy: ctx.principal.userId,
    });
    await this.audit.record({ action: 'planning.deliverable.create', entityType: 'deliverable', entityId: id, projectId, after: { code, title: body.title, weight: body.weight } });
    return { id, code, version: 1 };
  }

  async updateDeliverable(ctx: RequestContext, projectId: string, id: string, body: z.infer<typeof UpdateDeliverableBody>) {
    const p = await this.s.project(ctx, projectId);
    const d = await loadInProject(this.s.db, schema.deliverable, projectId, id);
    this.s.assert(ctx, 'planning.wbs.manage', p, { workstreamId: d.workstreamId });
    this.s.assertVersion(d, body.expectedVersion, 'deliverable');
    if (['accepted', 'cancelled'].includes(d.status)) throw ruleViolation('deliverable.not_editable', `A ${d.status} deliverable cannot be edited — reopen it first`);
    const c: Partial<typeof schema.deliverable.$inferInsert> = {};
    if (body.title !== undefined) c.title = body.title;
    if (body.titleAr !== undefined) c.titleAr = body.titleAr;
    if (body.acceptanceCriteria !== undefined) c.acceptanceCriteria = body.acceptanceCriteria;
    if (body.dueDate !== undefined) c.dueDate = body.dueDate;
    if (body.gateKey !== undefined) c.gateKey = body.gateKey;
    if (body.taskId !== undefined) {
      if (body.taskId) await loadInProject(this.s.db, schema.task, projectId, body.taskId);
      c.taskId = body.taskId;
    }
    if (body.weight !== undefined && body.weight !== d.weight) {
      // A changed weight must be approved again (measurement rule 1: approved weights only).
      c.weight = body.weight;
      c.weightApproved = false;
      c.weightSetBy = ctx.principal.userId;
      c.weightApprovedBy = null;
      c.weightApprovedAt = null;
    }
    if (Object.keys(c).length === 0) throw invalid('planning.no_changes', 'No changes supplied');
    const row = await updateVersioned(this.s.db, schema.deliverable, { id, projectId, expectedVersion: body.expectedVersion }, c);
    await this.audit.record({ action: 'planning.deliverable.update', entityType: 'deliverable', entityId: id, projectId, before: Object.fromEntries(Object.keys(c).map((k) => [k, (d as Record<string, unknown>)[k]])), after: c as Record<string, unknown> });
    await this.versions.snapshot({ projectId, entityType: 'deliverable', entityId: id, versionNo: row['version'] as number, snapshot: row, reason: 'updated' });
    return { id, version: row['version'] as number };
  }

  /**
   * Weight approval uses baseline-approval authority (planning.baseline.approve — the Sponsor in the default matrix): weights
   * drive reported progress, so they are approved at the same level as the baseline, never by the person who set them.
   */
  async approveDeliverableWeights(ctx: RequestContext, projectId: string, body: { items: { id: string; expectedVersion: number }[]; note?: string }) {
    const p = await this.s.project(ctx, projectId);
    // Role-level pre-check (also covers an empty list); separation of duties + authority are checked per deliverable below.
    this.s.policy.assertGranted(ctx, 'planning.baseline.approve', { projectId: p.id, classification: p.classification });
    let approved = 0;
    for (const it of body.items) {
      const d = await this.s.lockInProject(schema.deliverable, projectId, it.id);
      // not_self against whoever set the weight (unknown → fail closed); authority: explicit role authority (I-R3).
      this.s.assert(ctx, 'planning.baseline.approve', p, { requesterUserId: d.weightSetBy, withinAuthority: true });
      this.s.assertVersion(d, it.expectedVersion, `deliverable ${d.code}`);
      if (d.status === 'cancelled') throw ruleViolation('deliverable.cancelled', `Deliverable ${d.code} is cancelled`);
      if (d.weightApproved) continue;
      await updateVersioned(this.s.db, schema.deliverable, { id: d.id, projectId, expectedVersion: it.expectedVersion }, { weightApproved: true, weightApprovedBy: ctx.principal.userId, weightApprovedAt: new Date() });
      approved++;
      await this.audit.record({ action: 'planning.deliverable.approve_weight', entityType: 'deliverable', entityId: d.id, projectId, after: { weight: d.weight, weightApproved: true }, reason: body.note ?? null });
    }
    return { approved };
  }

  async deliverableCommand(ctx: RequestContext, projectId: string, id: string, command: 'start' | 'submit' | 'accept' | 'reject' | 'cancel' | 'reopen', body: { expectedVersion: number; note?: string; reason?: string }) {
    const p = await this.s.project(ctx, projectId);
    const d = await this.s.lockInProject(schema.deliverable, projectId, id);
    const reason = body.reason ?? body.note ?? null;
    let extra: Partial<typeof schema.deliverable.$inferInsert> = {};
    switch (command) {
      case 'start':
      case 'submit':
        await this.s.assertOwnerOrAssigned(ctx, p, { type: 'deliverable', id: d.id, workstreamId: d.workstreamId, ownerUserId: d.ownerUserId });
        if (command === 'submit') extra = { submittedBy: ctx.principal.userId, submittedAt: new Date() };
        break;
      case 'accept':
        this.s.assertApproval(ctx, 'planning.deliverable.accept', p, { workstreamId: d.workstreamId, requesterUserId: d.submittedBy }, () => transition('deliverable', DELIVERABLE_MACHINE, d.status as DeliverableStatus, command));
        await this.assertDeliverableApprover(ctx, projectId, d);
        this.s.assertVersion(d, body.expectedVersion, 'deliverable');
        if (d.status === 'submitted') await this.s.assertEvidence(projectId, 'deliverable', d.id);
        extra = { acceptedBy: ctx.principal.userId, acceptedAt: new Date() };
        break;
      case 'reject':
        this.s.assertApproval(ctx, 'planning.deliverable.accept', p, { workstreamId: d.workstreamId, requesterUserId: d.submittedBy }, () => transition('deliverable', DELIVERABLE_MACHINE, d.status as DeliverableStatus, command));
        await this.assertDeliverableApprover(ctx, projectId, d);
        break;
      case 'cancel':
        this.s.assert(ctx, 'planning.wbs.manage', p, { workstreamId: d.workstreamId });
        break;
      case 'reopen':
        this.s.assert(ctx, 'planning.wbs.manage', p, { workstreamId: d.workstreamId });
        extra = { acceptedBy: null, acceptedAt: null, submittedBy: null, submittedAt: null };
        break;
    }
    this.s.assertVersion(d, body.expectedVersion, 'deliverable');
    const to = transition('deliverable', DELIVERABLE_MACHINE, d.status as DeliverableStatus, command);
    const row = await updateVersioned(this.s.db, schema.deliverable, { id, projectId, expectedVersion: body.expectedVersion }, { ...extra, status: to });
    await this.audit.record({ action: `planning.deliverable.${command}`, entityType: 'deliverable', entityId: id, projectId, before: { status: d.status }, after: { status: to }, reason });
    if (command === 'submit') await this.outbox.emit({ type: 'approval.pending', projectId, aggregateType: 'deliverable', aggregateId: id, payload: { kind: 'deliverable_acceptance', workstreamId: d.workstreamId } });
    return { id, status: to as string, version: row['version'] as number };
  }

  /** DOM-P2-07: a deliverable produced by a task carries that task's designated approver role. */
  private async assertDeliverableApprover(ctx: RequestContext, projectId: string, d: Deliverable) {
    if (!d.taskId) return;
    const t = await loadInProject(this.s.db, schema.task, projectId, d.taskId);
    assertDesignatedApprover({ subject: `deliverable ${d.code}`, approverRole: t.approverRole, actorRoles: this.s.rolesFor(ctx, projectId, d.workstreamId) });
  }

  // Used by the seed and other planning services.
  async findTaskByWbs(projectId: string, wbsCode: string) {
    const [t] = await this.tx.select().from(schema.task).where(and(eq(schema.task.projectId, projectId), eq(schema.task.wbsCode, wbsCode)));
    if (!t) throw notFound();
    return t;
  }
}

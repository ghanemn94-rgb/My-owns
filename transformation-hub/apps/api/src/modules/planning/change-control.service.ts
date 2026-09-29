import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, notInArray, or, sql, SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { schema } from '@hub/db';
import {
  BASELINE_MACHINE,
  CHANGE_REQUEST_MACHINE,
  BaselineStatus,
  ChangeRequestStatus,
  allowedCommands,
  transition,
  ruleViolation,
  conflict,
  invalid,
  clearanceAllows,
  Classification,
} from '@hub/domain';
import type { z } from 'zod';
import type { ChangeRequestListQuery, CreateChangeRequestBody, UpdateChangeRequestBody, ImpactsSchema } from '@hub/contracts';
import { AuditService } from '../../platform/audit.service';
import { OutboxService } from '../../platform/outbox.service';
import { RecordVersionService, updateVersioned, loadInProject, nextCode, pageOf, offsetOf } from '../../platform/helpers';
import type { RequestContext } from '../../platform/context';
import { newId } from '../../platform/ids';
import { PlanningSupport, ProjectInfo } from './planning-support';
import { ScheduleService } from './schedule.service';

type Impacts = z.infer<typeof ImpactsSchema>;
type Baseline = typeof schema.baselineVersion.$inferSelect;
type ChangeRequest = typeof schema.changeRequest.$inferSelect;

export interface BaselineSnapshot {
  schemaVersion: number;
  projectStart: string | null;
  calendar: { timezone: string; workingDays: number[]; holidays: string[] };
  schedule: { status: string; projectFinish: string | null };
  tasks: { id: string; wbsCode: string; workstreamId: string | null; status: string; durationDays: number | null; plannedStart: string | null; plannedFinish: string | null }[];
  milestones: { id: string; code: string; workstreamId: string | null; plannedDate: string | null; isCritical: boolean }[];
  deliverables: { id: string; code: string; workstreamId: string | null; weight: number; weightApproved: boolean }[];
  perimeterItemIds: string[];
  budgetLines: { id: string; code: string; name: string; approvedAmount: string | null; currency: string; unitScale: number; approvalState: string; classification: string }[];
}

/** Record types a change request may refer to (validated inside the project; the DB trigger enforces the same). */
const SUBJECT_TABLES: Record<string, PgTable> = {
  task: schema.task,
  milestone: schema.milestone,
  deliverable: schema.deliverable,
  workstream: schema.workstream,
  risk: schema.risk,
  issue: schema.issue,
  assumption: schema.assumption,
  raid_dependency: schema.raidDependency,
  perimeter_item: schema.perimeterItem,
  site: schema.site,
  agreement: schema.agreement,
  tsa_service: schema.tsaService,
  readiness_check: schema.readinessCheck,
  budget_line: schema.budgetLine,
  baseline_version: schema.baselineVersion,
  decision: schema.decision,
  gate_definition: schema.gateDefinition,
};

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/**
 * Change control (spec §9, §14 `proposeBaselineChange`, AT-07, AT-16): baseline versions (frozen snapshot + hash,
 * propose/approve/reject with separation of duties and optimistic concurrency) and change requests (rationale,
 * alternatives, impacts, review, approval, re-baselining).
 */
@Injectable()
export class ChangeControlService {
  constructor(
    private readonly s: PlanningSupport,
    private readonly schedule: ScheduleService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly versions: RecordVersionService,
  ) {}

  private get tx() {
    return this.s.db.tx();
  }

  // =========================================================================================================
  // Baselines

  /** Snapshot of the committed plan: tasks/milestones dates & durations, deliverable weights, budget, perimeter scope. */
  async buildSnapshot(p: ProjectInfo): Promise<BaselineSnapshot> {
    const T = schema.task;
    const tasks = await this.tx
      .select({ id: T.id, wbsCode: T.wbsCode, workstreamId: T.workstreamId, status: T.status, durationDays: T.durationDays, plannedStart: T.plannedStart, plannedFinish: T.plannedFinish })
      .from(T)
      .where(and(eq(T.projectId, p.id), notInArray(T.status, ['draft', 'cancelled'])))
      .orderBy(asc(T.wbsCode));
    const M = schema.milestone;
    const milestones = await this.tx
      .select({ id: M.id, code: M.code, workstreamId: M.workstreamId, plannedDate: M.plannedDate, isCritical: M.isCritical })
      .from(M)
      .where(and(eq(M.projectId, p.id), notInArray(M.status, ['cancelled'])))
      .orderBy(asc(M.code));
    const D = schema.deliverable;
    const deliverables = await this.tx
      .select({ id: D.id, code: D.code, workstreamId: D.workstreamId, weight: D.weight, weightApproved: D.weightApproved })
      .from(D)
      .where(and(eq(D.projectId, p.id), notInArray(D.status, ['cancelled'])))
      .orderBy(asc(D.code));
    const B = schema.budgetLine;
    const budgetLines = await this.tx
      .select({ id: B.id, code: B.code, name: B.name, approvedAmount: B.approvedAmount, currency: B.currency, unitScale: B.unitScale, approvalState: B.approvalState, classification: B.classification })
      .from(B)
      .where(and(eq(B.projectId, p.id), notInArray(B.approvalState, ['rejected', 'superseded'])))
      .orderBy(asc(B.code));
    const P = schema.perimeterItem;
    const perimeter = await this.tx
      .select({ id: P.id })
      .from(P)
      .where(and(eq(P.projectId, p.id), inArray(P.disposition, ['included', 'shared'])))
      .orderBy(asc(P.id));
    const cal = await this.s.calendar(p);
    const { result } = await this.schedule.compute(p);
    return {
      schemaVersion: 1,
      projectStart: p.plannedStart,
      calendar: { timezone: cal.timezone, workingDays: cal.workingDays, holidays: cal.holidays },
      schedule: { status: result.status, projectFinish: result.projectFinish },
      tasks,
      milestones,
      deliverables,
      perimeterItemIds: perimeter.map((x) => x.id),
      budgetLines: budgetLines.map((b) => ({ ...b, classification: b.classification as string })),
    };
  }

  private async baselineDto(b: Baseline) {
    const names = await this.s.userNames([b.proposedBy]);
    const snap = b.snapshot as unknown as BaselineSnapshot;
    return {
      id: b.id,
      versionNo: b.versionNo,
      status: b.status as BaselineStatus,
      snapshotHash: b.snapshotHash,
      changeRequestId: b.changeRequestId,
      proposedBy: b.proposedBy,
      proposedByName: b.proposedBy ? (names.get(b.proposedBy) ?? null) : null,
      approvedBy: b.approvedBy,
      approvedAt: iso(b.approvedAt),
      rejectedBy: b.rejectedBy,
      rejectedAt: iso(b.rejectedAt),
      supersededAt: iso(b.supersededAt),
      note: b.note,
      decisionNote: b.decisionNote,
      createdAt: b.createdAt.toISOString(),
      version: b.version,
      counts: {
        tasks: snap.tasks?.length ?? 0,
        milestones: snap.milestones?.length ?? 0,
        deliverables: snap.deliverables?.length ?? 0,
        budgetLines: snap.budgetLines?.length ?? 0,
        perimeterItems: snap.perimeterItemIds?.length ?? 0,
      },
    };
  }

  async listBaselines(ctx: RequestContext, projectId: string) {
    const p = await this.s.project(ctx, projectId);
    this.s.assertProjectRead(ctx, p);
    const rows = await this.tx.select().from(schema.baselineVersion).where(eq(schema.baselineVersion.projectId, projectId)).orderBy(desc(schema.baselineVersion.versionNo));
    const items = [];
    for (const b of rows) items.push(await this.baselineDto(b));
    return { items };
  }

  async getBaseline(ctx: RequestContext, projectId: string, baselineId: string) {
    const p = await this.s.project(ctx, projectId);
    this.s.assertProjectRead(ctx, p);
    const b = await loadInProject(this.s.db, schema.baselineVersion, projectId, baselineId);
    const snap = b.snapshot as unknown as BaselineSnapshot;
    // Budget figures stay restricted: shown only with finance read access and sufficient clearance for every line.
    const lines = snap.budgetLines ?? [];
    const canBudget =
      this.s.policy.canInProject(ctx, 'finance.record.read', projectId) && lines.every((l) => clearanceAllows(ctx.principal.clearance, l.classification as Classification));
    return {
      ...(await this.baselineDto(b)),
      snapshot: {
        schemaVersion: snap.schemaVersion,
        projectStart: snap.projectStart,
        calendar: snap.calendar,
        schedule: snap.schedule,
        tasks: snap.tasks,
        milestones: snap.milestones,
        deliverables: snap.deliverables,
        perimeterItemIds: snap.perimeterItemIds,
        budget: canBudget
          ? { restricted: false as const, lines: lines.map((l) => ({ id: l.id, code: l.code, name: l.name, approvedAmount: l.approvedAmount, currency: l.currency, unitScale: l.unitScale, approvalState: l.approvalState })) }
          : { restricted: true as const, lineCount: lines.length },
      },
    };
  }

  /**
   * Current approved baseline for other modules (AT-07: the carve-out module calls this to decide whether adding or
   * changing a perimeter item needs a change request). Authorization: planning.plan.read in the project.
   */
  async currentBaseline(ctx: RequestContext, projectId: string) {
    const p = await this.s.project(ctx, projectId);
    this.s.assertProjectRead(ctx, p);
    const b = await this.s.currentBaselineRow(projectId);
    if (!b) return { baseline: null, perimeterItemIds: [] as string[] };
    return { baseline: await this.baselineDto(b), perimeterItemIds: (b.snapshot as unknown as BaselineSnapshot).perimeterItemIds ?? [] };
  }

  /** Cross-module helper: is a record frozen into the current approved baseline? */
  async isInApprovedBaseline(ctx: RequestContext, projectId: string, subjectType: 'perimeter_item' | 'task' | 'milestone' | 'deliverable', subjectId: string): Promise<{ baselineExists: boolean; inBaseline: boolean; baselineId: string | null }> {
    const cur = await this.currentBaseline(ctx, projectId);
    if (!cur.baseline) return { baselineExists: false, inBaseline: false, baselineId: null };
    const b = await this.s.currentBaselineRow(projectId);
    const snap = b!.snapshot as unknown as BaselineSnapshot;
    const ids =
      subjectType === 'perimeter_item' ? snap.perimeterItemIds : subjectType === 'task' ? snap.tasks.map((t) => t.id) : subjectType === 'milestone' ? snap.milestones.map((m) => m.id) : snap.deliverables.map((d) => d.id);
    return { baselineExists: true, inBaseline: ids.includes(subjectId), baselineId: cur.baseline.id };
  }

  /** Domain command proposeBaselineChange: freeze the plan as a proposed baseline (re-baseline needs an approved CR). */
  async proposeBaseline(ctx: RequestContext, projectId: string, body: { note?: string; changeRequestId?: string }) {
    const p = await this.s.project(ctx, projectId);
    this.s.assert(ctx, 'planning.baseline.propose', p);
    await this.s.lockProjectGraph(projectId);
    const [pending] = await this.tx.select({ id: schema.baselineVersion.id }).from(schema.baselineVersion).where(and(eq(schema.baselineVersion.projectId, projectId), eq(schema.baselineVersion.status, 'proposed')));
    if (pending) throw conflict('baseline.proposal_pending', 'Another baseline proposal is awaiting decision — approve or reject it first');
    const current = await this.s.currentBaselineRow(projectId);
    let changeRequestId: string | null = null;
    if (body.changeRequestId) {
      const cr = await loadInProject(this.s.db, schema.changeRequest, projectId, body.changeRequestId);
      if (cr.status !== 'approved' || !cr.rebaseline) throw ruleViolation('baseline.change_request_not_approved', 'The change request must be approved and flagged for re-baselining');
      const [used] = await this.tx
        .select({ id: schema.baselineVersion.id })
        .from(schema.baselineVersion)
        .where(and(eq(schema.baselineVersion.projectId, projectId), eq(schema.baselineVersion.changeRequestId, cr.id), inArray(schema.baselineVersion.status, ['proposed', 'approved', 'superseded'])));
      if (used) throw ruleViolation('baseline.change_request_used', 'This change request already produced a baseline');
      changeRequestId = cr.id;
    }
    if (current && !changeRequestId) {
      throw ruleViolation('baseline.change_request_required', 'An approved baseline exists — re-baselining requires an approved change request (rebaseline = true)');
    }
    const snapshot = await this.buildSnapshot(p);
    if (snapshot.tasks.length + snapshot.milestones.length === 0) throw ruleViolation('baseline.empty_plan', 'Nothing to baseline — activate the plan first');
    const snapshotHash = this.s.hash(snapshot);
    const [mx] = await this.tx.select({ m: sql<number>`coalesce(max(${schema.baselineVersion.versionNo}), 0)::int` }).from(schema.baselineVersion).where(eq(schema.baselineVersion.projectId, projectId));
    const versionNo = Number(mx?.m ?? 0) + 1;
    const id = newId();
    const status = transition('baseline', BASELINE_MACHINE, 'draft', 'propose');
    await this.tx.insert(schema.baselineVersion).values({
      id,
      orgId: ctx.principal.orgId,
      projectId,
      versionNo,
      status,
      snapshot: snapshot as unknown as Record<string, unknown>,
      snapshotHash,
      changeRequestId,
      proposedBy: ctx.principal.userId,
      note: body.note ?? null,
    });
    await this.audit.record({ action: 'planning.baseline.propose', entityType: 'baseline_version', entityId: id, projectId, after: { versionNo, snapshotHash, changeRequestId, tasks: snapshot.tasks.length, milestones: snapshot.milestones.length } , reason: body.note ?? null });
    await this.outbox.emit({ type: 'approval.pending', projectId, aggregateType: 'baseline_version', aggregateId: id, payload: { kind: 'baseline_approval', versionNo } });
    return { id, versionNo, status: status as string, snapshotHash, version: 1 };
  }

  /** AT-16: row lock + expectedVersion → the second of two concurrent approvals gets 409 and must reload. */
  async approveBaseline(ctx: RequestContext, projectId: string, baselineId: string, body: { expectedVersion: number; note?: string }) {
    const p = await this.s.project(ctx, projectId);
    const b = await this.s.lockInProject(schema.baselineVersion, projectId, baselineId);
    this.s.assert(ctx, 'planning.baseline.approve', p, { requesterUserId: b.proposedBy });
    this.s.assertVersion(b, body.expectedVersion, 'baseline');
    const to = transition('baseline', BASELINE_MACHINE, b.status as BaselineStatus, 'approve');
    const previous = await this.s.currentBaselineRow(projectId);
    if (previous) {
      transition('baseline', BASELINE_MACHINE, previous.status as BaselineStatus, 'supersede');
      await updateVersioned(this.s.db, schema.baselineVersion, { id: previous.id, projectId, expectedVersion: previous.version }, { status: 'superseded', supersededAt: new Date() });
      await this.audit.record({ action: 'planning.baseline.supersede', entityType: 'baseline_version', entityId: previous.id, projectId, before: { status: 'approved' }, after: { status: 'superseded', supersededBy: baselineId } });
    }
    const row = await updateVersioned(this.s.db, schema.baselineVersion, { id: baselineId, projectId, expectedVersion: body.expectedVersion }, { status: to, approvedBy: ctx.principal.userId, approvedAt: new Date(), decisionNote: body.note ?? null });
    // The approver approved the frozen weights too: mark them approved where unchanged since the snapshot and not set by the approver.
    const snap = b.snapshot as unknown as BaselineSnapshot;
    let weightsApproved = 0;
    for (const d of snap.deliverables ?? []) {
      if (d.weightApproved) continue;
      const r = await this.tx
        .update(schema.deliverable)
        .set({ weightApproved: true, weightApprovedBy: ctx.principal.userId, weightApprovedAt: new Date(), updatedAt: new Date(), version: sql`${schema.deliverable.version} + 1` })
        .where(
          and(
            eq(schema.deliverable.id, d.id),
            eq(schema.deliverable.projectId, projectId),
            eq(schema.deliverable.weight, d.weight),
            eq(schema.deliverable.weightApproved, false),
            sql`${schema.deliverable.weightSetBy} is distinct from ${ctx.principal.userId}::uuid`,
          ),
        )
        .returning({ id: schema.deliverable.id });
      weightsApproved += r.length;
    }
    await this.audit.record({ action: 'planning.baseline.approve', entityType: 'baseline_version', entityId: baselineId, projectId, before: { status: b.status }, after: { status: to, versionNo: b.versionNo, snapshotHash: b.snapshotHash, supersedes: previous?.id ?? null, weightsApproved }, reason: body.note ?? null });
    await this.versions.snapshot({ projectId, entityType: 'baseline_version', entityId: baselineId, versionNo: row['version'] as number, snapshot: { status: to, snapshotHash: b.snapshotHash, approvedBy: ctx.principal.userId }, reason: 'approved' });
    // Other modules react (carve-out: perimeter items' baseline membership; gates: dimension recompute).
    await this.outbox.emit({ type: 'baseline.approved', projectId, aggregateType: 'baseline_version', aggregateId: baselineId, payload: { versionNo: b.versionNo, supersedes: previous?.id ?? null, changeRequestId: b.changeRequestId }, dedupeKey: `baseline-approved:${baselineId}` });
    return { id: baselineId, status: to as string, version: row['version'] as number };
  }

  async rejectBaseline(ctx: RequestContext, projectId: string, baselineId: string, body: { expectedVersion: number; reason: string }) {
    const p = await this.s.project(ctx, projectId);
    const b = await this.s.lockInProject(schema.baselineVersion, projectId, baselineId);
    this.s.assert(ctx, 'planning.baseline.approve', p, { requesterUserId: b.proposedBy });
    this.s.assertVersion(b, body.expectedVersion, 'baseline');
    const to = transition('baseline', BASELINE_MACHINE, b.status as BaselineStatus, 'reject');
    const row = await updateVersioned(this.s.db, schema.baselineVersion, { id: baselineId, projectId, expectedVersion: body.expectedVersion }, { status: to, rejectedBy: ctx.principal.userId, rejectedAt: new Date(), decisionNote: body.reason });
    await this.audit.record({ action: 'planning.baseline.reject', entityType: 'baseline_version', entityId: baselineId, projectId, before: { status: b.status }, after: { status: to }, reason: body.reason });
    return { id: baselineId, status: to as string, version: row['version'] as number };
  }

  // =========================================================================================================
  // Change requests

  private async crDtos(rows: ChangeRequest[], projectId: string) {
    const names = await this.s.userNames(rows.map((r) => r.requestedBy));
    const ids = rows.map((r) => r.id);
    const bls = ids.length
      ? await this.tx
          .select({ id: schema.baselineVersion.id, cr: schema.baselineVersion.changeRequestId, status: schema.baselineVersion.status })
          .from(schema.baselineVersion)
          .where(and(eq(schema.baselineVersion.projectId, projectId), isNotNull(schema.baselineVersion.changeRequestId), inArray(schema.baselineVersion.changeRequestId, ids)))
          .orderBy(desc(schema.baselineVersion.versionNo))
      : [];
    return rows.map((c) => ({
      id: c.id,
      code: c.code,
      title: c.title,
      rationale: c.rationale,
      alternatives: c.alternatives ?? [],
      impacts: (c.impacts ?? {}) as Impacts,
      status: c.status as ChangeRequestStatus,
      subjectType: c.subjectType,
      subjectId: c.subjectId,
      proposedChange: (c.proposedChange as Record<string, unknown> | null) ?? null,
      rebaseline: c.rebaseline,
      requestedBy: c.requestedBy,
      requestedByName: c.requestedBy ? (names.get(c.requestedBy) ?? null) : null,
      reviewedBy: c.reviewedBy,
      decidedBy: c.decidedBy,
      decidedAt: iso(c.decidedAt),
      decisionNote: c.decisionNote,
      decisionId: c.decisionId,
      linkedBaselineId: bls.find((b) => b.cr === c.id && b.status !== 'rejected')?.id ?? null,
      allowedCommands: allowedCommands(CHANGE_REQUEST_MACHINE, c.status as ChangeRequestStatus),
      isDemo: c.isDemo,
      createdAt: c.createdAt.toISOString(),
      version: c.version,
    }));
  }

  async listChangeRequests(ctx: RequestContext, projectId: string, q: z.infer<typeof ChangeRequestListQuery>) {
    const p = await this.s.project(ctx, projectId);
    this.s.assertProjectRead(ctx, p);
    const C = schema.changeRequest;
    const conds: SQL[] = [eq(C.projectId, projectId), this.s.policy.visibilitySql(ctx, projectId, {})];
    if (q.status) conds.push(inArray(C.status, q.status));
    if (q.subjectType) conds.push(eq(C.subjectType, q.subjectType));
    if (q.subjectId) conds.push(eq(C.subjectId, q.subjectId));
    if (q.q) conds.push(or(ilike(C.title, `%${q.q}%`), ilike(C.code, `%${q.q}%`))!);
    const where = and(...conds);
    const [{ n }] = (await this.tx.select({ n: count() }).from(C).where(where)) as [{ n: number }];
    const rows = await this.tx.select().from(C).where(where).orderBy(desc(C.createdAt)).limit(q.pageSize).offset(offsetOf(q));
    return pageOf(await this.crDtos(rows, projectId), Number(n), q);
  }

  async getChangeRequest(ctx: RequestContext, projectId: string, id: string) {
    const p = await this.s.project(ctx, projectId);
    this.s.assertProjectRead(ctx, p);
    const c = await loadInProject(this.s.db, schema.changeRequest, projectId, id);
    return (await this.crDtos([c], projectId))[0]!;
  }

  private async assertSubject(projectId: string, subjectType?: string | null, subjectId?: string | null) {
    if (!subjectType && !subjectId) return;
    if (!subjectType || !subjectId) throw invalid('change_request.subject_incomplete', 'subjectType and subjectId must be given together');
    const table = SUBJECT_TABLES[subjectType];
    if (!table) throw invalid('change_request.subject_type', `Unsupported subject type ${subjectType}`, { supported: Object.keys(SUBJECT_TABLES) });
    await loadInProject(this.s.db, table as PgTable & { id: never; projectId: never }, projectId, subjectId);
  }

  private async insertChangeRequest(ctx: RequestContext, p: ProjectInfo, body: z.infer<typeof CreateChangeRequestBody>) {
    await this.assertSubject(p.id, body.subjectType, body.subjectId);
    const code = await nextCode(this.s.db, schema.changeRequest, p.id, 'CR');
    const id = newId();
    const impacts = pickImpacts(body.impacts ?? {});
    await this.tx.insert(schema.changeRequest).values({
      id,
      orgId: ctx.principal.orgId,
      projectId: p.id,
      code,
      title: body.title,
      rationale: body.rationale,
      alternatives: body.alternatives ?? [],
      impacts,
      status: 'draft',
      subjectType: body.subjectType ?? null,
      subjectId: body.subjectId ?? null,
      proposedChange: body.proposedChange ?? null,
      requestedBy: ctx.principal.userId,
      rebaseline: body.rebaseline ?? false,
      isDemo: p.isDemo,
    });
    await this.audit.record({ action: 'planning.change_request.create', entityType: 'change_request', entityId: id, projectId: p.id, after: { code, title: body.title, subjectType: body.subjectType ?? null, subjectId: body.subjectId ?? null, rebaseline: body.rebaseline ?? false } });
    return { id, code, version: 1 };
  }

  async createChangeRequest(ctx: RequestContext, projectId: string, body: z.infer<typeof CreateChangeRequestBody>) {
    const p = await this.s.project(ctx, projectId);
    this.s.assert(ctx, 'planning.change_request.create', p);
    return this.insertChangeRequest(ctx, p, body);
  }

  /**
   * Cross-module entry point (AT-07): e.g. the carve-out module calls this when a site/shared asset is added or changed
   * after baseline approval. Runs in the caller's transaction with the caller's authority (planning.change_request.create);
   * the previous baseline is preserved. With `submit: true` the request is also submitted for review.
   */
  async createChangeRequestFor(
    ctx: RequestContext,
    input: {
      projectId: string;
      subjectType: string;
      subjectId: string;
      proposedChange: Record<string, unknown>;
      impacts: Impacts;
      rationale: string;
      title?: string;
      alternatives?: string[];
      rebaseline?: boolean;
      submit?: boolean;
    },
  ): Promise<{ id: string; code: string; status: ChangeRequestStatus; version: number }> {
    const p = await this.s.project(ctx, input.projectId);
    this.s.assert(ctx, 'planning.change_request.create', p);
    const created = await this.insertChangeRequest(ctx, p, {
      title: input.title ?? `Change to ${input.subjectType.replace(/_/g, ' ')} after baseline`,
      rationale: input.rationale,
      alternatives: input.alternatives ?? [],
      impacts: input.impacts,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      proposedChange: input.proposedChange,
      rebaseline: input.rebaseline ?? false,
    });
    if (!input.submit) return { id: created.id, code: created.code, status: 'draft', version: 1 };
    const r = await this.crCommand(ctx, input.projectId, created.id, 'submit', { expectedVersion: 1 });
    return { id: created.id, code: created.code, status: r.status as ChangeRequestStatus, version: r.version };
  }

  async updateChangeRequest(ctx: RequestContext, projectId: string, id: string, body: z.infer<typeof UpdateChangeRequestBody>) {
    const p = await this.s.project(ctx, projectId);
    const c = await loadInProject(this.s.db, schema.changeRequest, projectId, id);
    this.s.assert(ctx, 'planning.change_request.create', p);
    this.assertRequesterOrAssessor(ctx, p, c);
    this.s.assertVersion(c, body.expectedVersion, 'change request');
    if (c.status !== 'draft') throw ruleViolation('change_request.not_editable', 'Only draft change requests can be edited — impacts are recorded through the assessment during review');
    const u: Partial<typeof schema.changeRequest.$inferInsert> = {};
    if (body.title !== undefined) u.title = body.title;
    if (body.rationale !== undefined) u.rationale = body.rationale;
    if (body.alternatives !== undefined) u.alternatives = body.alternatives;
    if (body.impacts !== undefined) u.impacts = pickImpacts(body.impacts);
    if (body.proposedChange !== undefined) u.proposedChange = body.proposedChange;
    if (body.rebaseline !== undefined) u.rebaseline = body.rebaseline;
    if (Object.keys(u).length === 0) throw invalid('planning.no_changes', 'No changes supplied');
    const row = await updateVersioned(this.s.db, schema.changeRequest, { id, projectId, expectedVersion: body.expectedVersion }, u);
    await this.audit.record({ action: 'planning.change_request.update', entityType: 'change_request', entityId: id, projectId, after: u as Record<string, unknown> });
    await this.versions.snapshot({ projectId, entityType: 'change_request', entityId: id, versionNo: row['version'] as number, snapshot: row, reason: 'updated' });
    return { id, version: row['version'] as number };
  }

  private assertRequesterOrAssessor(ctx: RequestContext, p: ProjectInfo, c: ChangeRequest) {
    if (c.requestedBy === ctx.principal.userId) return;
    if (this.s.can(ctx, 'planning.change_request.assess', p)) return;
    throw ruleViolation('change_request.not_requester', 'Only the requester (or an assessor) can change or withdraw this request');
  }

  async crCommand(
    ctx: RequestContext,
    projectId: string,
    id: string,
    command: 'submit' | 'start_review' | 'approve' | 'reject' | 'withdraw' | 'mark_implemented',
    body: { expectedVersion: number; note?: string; reason?: string },
  ) {
    const p = await this.s.project(ctx, projectId);
    const c = await this.s.lockInProject(schema.changeRequest, projectId, id);
    const extra: Partial<typeof schema.changeRequest.$inferInsert> = {};
    switch (command) {
      case 'submit':
        this.s.assert(ctx, 'planning.change_request.create', p);
        this.assertRequesterOrAssessor(ctx, p, c);
        break;
      case 'withdraw':
        this.s.assert(ctx, 'planning.change_request.create', p);
        this.assertRequesterOrAssessor(ctx, p, c);
        extra.decisionNote = body.reason ?? null;
        break;
      case 'start_review':
        this.s.assert(ctx, 'planning.change_request.assess', p);
        extra.reviewedBy = ctx.principal.userId;
        break;
      case 'approve':
      case 'reject':
        // Separation of duties: the approver cannot be the requester (not_self).
        this.s.assert(ctx, 'planning.change_request.approve', p, { requesterUserId: c.requestedBy });
        extra.decidedBy = ctx.principal.userId;
        extra.decidedAt = new Date();
        extra.decisionNote = body.reason ?? body.note ?? null;
        break;
      case 'mark_implemented':
        this.s.assert(ctx, 'planning.change_request.assess', p);
        break;
    }
    this.s.assertVersion(c, body.expectedVersion, 'change request');
    const to = transition('change_request', CHANGE_REQUEST_MACHINE, c.status as ChangeRequestStatus, command);
    if (command === 'approve') {
      const impacts = (c.impacts ?? {}) as Impacts;
      if (!Object.values(impacts).some((v) => typeof v === 'string' && v.trim().length > 0)) {
        throw ruleViolation('change_request.impacts_missing', 'Record the impact assessment (time, cost, scope, readiness, transaction…) before approval');
      }
    }
    if (command === 'mark_implemented' && c.rebaseline) {
      const [bl] = await this.tx
        .select({ id: schema.baselineVersion.id })
        .from(schema.baselineVersion)
        .where(and(eq(schema.baselineVersion.projectId, projectId), eq(schema.baselineVersion.changeRequestId, c.id), inArray(schema.baselineVersion.status, ['approved', 'superseded'])));
      if (!bl) throw ruleViolation('change_request.rebaseline_missing', 'This change requires a re-baseline: propose and approve the new baseline (linked to this request) first');
    }
    const row = await updateVersioned(this.s.db, schema.changeRequest, { id, projectId, expectedVersion: body.expectedVersion }, { ...extra, status: to });
    await this.audit.record({ action: `planning.change_request.${command}`, entityType: 'change_request', entityId: id, projectId, before: { status: c.status }, after: { status: to }, reason: body.reason ?? body.note ?? null });
    if (command === 'submit') await this.outbox.emit({ type: 'approval.pending', projectId, aggregateType: 'change_request', aggregateId: id, payload: { kind: 'change_request_review' } });
    if (command === 'approve' || command === 'reject') {
      await this.outbox.emit({ type: 'change_request.decided', projectId, aggregateType: 'change_request', aggregateId: id, payload: { status: to, subjectType: c.subjectType, subjectId: c.subjectId, rebaseline: c.rebaseline } });
    }
    return { id, status: to as string, version: row['version'] as number };
  }

  async assessChangeRequest(ctx: RequestContext, projectId: string, id: string, body: { expectedVersion: number; impacts: Impacts; note?: string }) {
    const p = await this.s.project(ctx, projectId);
    const c = await this.s.lockInProject(schema.changeRequest, projectId, id);
    this.s.assert(ctx, 'planning.change_request.assess', p);
    this.s.assertVersion(c, body.expectedVersion, 'change request');
    if (c.status !== 'under_review') throw ruleViolation('change_request.not_under_review', 'Impacts are assessed while the request is under review');
    const merged = { ...((c.impacts ?? {}) as Impacts), ...pickImpacts(body.impacts) };
    const row = await updateVersioned(this.s.db, schema.changeRequest, { id, projectId, expectedVersion: body.expectedVersion }, { impacts: merged, reviewedBy: ctx.principal.userId });
    await this.audit.record({ action: 'planning.change_request.assess', entityType: 'change_request', entityId: id, projectId, before: { impacts: c.impacts }, after: { impacts: merged }, reason: body.note ?? null });
    return { id, status: c.status as string, version: row['version'] as number };
  }
}

function pickImpacts(i: Impacts): Impacts {
  const out: Impacts = {};
  for (const k of ['time', 'cost', 'scope', 'readiness', 'transaction', 'financial', 'tsa'] as const) if (i[k] !== undefined) out[k] = i[k];
  return out;
}


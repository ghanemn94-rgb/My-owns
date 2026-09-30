import { Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  EVIDENCE_TARGET_READ_PERMISSION,
  PrerequisiteState,
  PrerequisiteType,
  ScheduleNodeType,
  assertPrerequisitesSatisfied,
  conflict,
  notFound,
  prerequisiteSatisfied,
} from '@hub/domain';
import { AuditService } from '../../platform/audit.service';
import { loadInProject } from '../../platform/helpers';
import type { RequestContext } from '../../platform/context';
import { newId } from '../../platform/ids';
import { RecordVisibility } from '../../platform/record-visibility';
import { PlanningSupport } from './planning-support';

type Row = typeof schema.recordDependency.$inferSelect;

/**
 * Non-schedule prerequisites of a task / milestone (spec §9 "Dependency graph … linking approvals, agreements, evidence,
 * decisions, and gates"; REQ-PLN-006; DOM-P2-18). A prerequisite is satisfied when:
 *  decision → final (approved within the mandate, or approved by the authorized body with its reference);
 *  gate → current cycle approved (with or without exceptions) and not flagged for reassessment;
 *  agreement → signed or effective; approval request → approved; evidence link → active and verified.
 * An unsatisfied prerequisite blocks STARTING the task (Finish-to-Start semantics) and reporting the milestone achieved
 * (422 `planning.prerequisite_pending`). The rule counts every prerequisite; lists show only those whose record the
 * caller can see (the refusal gives a count, never titles).
 */
@Injectable()
export class PrerequisiteService {
  constructor(
    private readonly s: PlanningSupport,
    private readonly audit: AuditService,
  ) {}

  private get tx() {
    return this.s.db.tx();
  }

  private async successor(projectId: string, type: ScheduleNodeType, id: string) {
    if (type === 'task') {
      const t = await loadInProject(this.s.db, schema.task, projectId, id);
      return { type, id, code: t.wbsCode, title: t.title, workstreamId: t.workstreamId };
    }
    const m = await loadInProject(this.s.db, schema.milestone, projectId, id);
    return { type, id, code: m.code, title: m.title, workstreamId: m.workstreamId };
  }

  /** Record visibility of a prerequisite record for the caller (decision / agreement classification, gate read, …). */
  private visibility(ctx: RequestContext, projectId: string) {
    return new RecordVisibility(this.s.policy, ctx, projectId, { reach: true, readPermission: (t) => (EVIDENCE_TARGET_READ_PERMISSION as Record<string, string>)[t] });
  }

  private async canSeePrerequisite(ctx: RequestContext, projectId: string, type: PrerequisiteType, id: string): Promise<boolean> {
    if (type === 'gate') return this.s.policy.canInProject(ctx, 'gates.gate.read', projectId);
    const r = await this.tx.execute<{ ok: boolean }>(sql`select ${this.visibility(ctx, projectId).exists(type, sql`${id}::uuid`)} as ok`);
    return r.rows[0]?.ok === true;
  }

  /** Loads the prerequisite record in THIS project (404 otherwise) with its state and a display label. */
  private async state(projectId: string, type: PrerequisiteType, id: string): Promise<{ state: PrerequisiteState; label: string }> {
    switch (type) {
      case 'decision': {
        const d = await loadInProject(this.s.db, schema.decision, projectId, id);
        return { state: { type, status: d.status, authorityOutcome: d.authorityOutcome, externalAuthorityReference: d.externalAuthorityReference }, label: `${d.code} ${d.title}` };
      }
      case 'gate': {
        const g = await loadInProject(this.s.db, schema.gateDefinition, projectId, id);
        const [a] = await this.tx.select().from(schema.gateAssessment).where(and(eq(schema.gateAssessment.gateId, g.id), eq(schema.gateAssessment.projectId, projectId), eq(schema.gateAssessment.isCurrent, true)));
        const needs = (a?.evaluation as { needsReassessment?: boolean } | null)?.needsReassessment === true;
        return { state: { type, status: a?.status ?? 'not_started', needsReassessment: needs }, label: `${g.key} ${g.name}` };
      }
      case 'agreement': {
        const ag = await loadInProject(this.s.db, schema.agreement, projectId, id);
        return { state: { type, stage: ag.stage }, label: `${ag.code} ${ag.title}` };
      }
      case 'approval_request': {
        const r = await loadInProject(this.s.db, schema.approvalRequest, projectId, id);
        return { state: { type, status: r.status }, label: r.action };
      }
      case 'evidence_link': {
        const e = await loadInProject(this.s.db, schema.evidenceLink, projectId, id);
        return { state: { type, status: e.status, verified: !!e.reviewedBy }, label: (e.note ?? e.purpose ?? e.targetType).slice(0, 200) };
      }
    }
  }

  async create(ctx: RequestContext, projectId: string, body: { successorType: ScheduleNodeType; successorId: string; predecessorType: PrerequisiteType; predecessorId: string; note?: string }) {
    const p = await this.s.project(ctx, projectId);
    const succ = await this.successor(projectId, body.successorType, body.successorId);
    this.s.assert(ctx, 'planning.dependency.manage', p, { workstreamId: succ.workstreamId });
    const pre = await this.state(projectId, body.predecessorType, body.predecessorId); // 404 when not in this project
    if (!(await this.canSeePrerequisite(ctx, projectId, body.predecessorType, body.predecessorId))) throw notFound();
    const R = schema.recordDependency;
    const [dup] = await this.tx.select({ id: R.id }).from(R).where(and(eq(R.projectId, projectId), eq(R.successorId, succ.id), eq(R.predecessorId, body.predecessorId)));
    if (dup) throw conflict('prerequisite.duplicate', 'This prerequisite already exists');
    const id = newId();
    await this.tx.insert(R).values({ id, orgId: ctx.principal.orgId, projectId, successorType: succ.type, successorId: succ.id, predecessorType: body.predecessorType, predecessorId: body.predecessorId, note: body.note ?? null, createdBy: ctx.principal.userId });
    await this.audit.record({
      action: 'planning.prerequisite.create',
      entityType: 'record_dependency',
      entityId: id,
      projectId,
      after: { successor: succ.code, successorType: succ.type, predecessorType: body.predecessorType, predecessorId: body.predecessorId, satisfied: prerequisiteSatisfied(pre.state) },
    });
    return { id };
  }

  async remove(ctx: RequestContext, projectId: string, prerequisiteId: string, reason?: string) {
    const p = await this.s.project(ctx, projectId);
    const r = await loadInProject(this.s.db, schema.recordDependency, projectId, prerequisiteId);
    const succ = await this.successor(projectId, r.successorType as ScheduleNodeType, r.successorId);
    this.s.assert(ctx, 'planning.dependency.manage', p, { workstreamId: succ.workstreamId });
    await this.tx.delete(schema.recordDependency).where(and(eq(schema.recordDependency.id, r.id), eq(schema.recordDependency.projectId, projectId)));
    await this.audit.record({ action: 'planning.prerequisite.remove', entityType: 'record_dependency', entityId: r.id, projectId, before: { successorId: r.successorId, predecessorType: r.predecessorType, predecessorId: r.predecessorId }, reason: reason ?? null });
    return { ok: true as const };
  }

  async list(ctx: RequestContext, projectId: string, q: { successorType?: ScheduleNodeType; successorId?: string }) {
    const p = await this.s.project(ctx, projectId);
    const scope = this.s.readScope(ctx, p);
    const R = schema.recordDependency;
    const conds = [eq(R.projectId, projectId)];
    if (q.successorId) conds.push(eq(R.successorId, q.successorId));
    if (q.successorType) conds.push(eq(R.successorType, q.successorType));
    const rows = await this.tx.select().from(R).where(and(...conds)).orderBy(asc(R.createdAt), asc(R.id));
    const items = [];
    for (const r of rows) {
      const succ = await this.successor(projectId, r.successorType as ScheduleNodeType, r.successorId);
      if (scope && (!succ.workstreamId || !scope.has(succ.workstreamId))) continue;
      if (!(await this.canSeePrerequisite(ctx, projectId, r.predecessorType as PrerequisiteType, r.predecessorId))) continue;
      const pre = await this.state(projectId, r.predecessorType as PrerequisiteType, r.predecessorId);
      items.push(this.dto(r, succ, pre));
    }
    return { items };
  }

  private dto(r: Row, succ: { type: ScheduleNodeType; id: string; code: string; title: string }, pre: { state: PrerequisiteState; label: string }) {
    return {
      id: r.id,
      successorType: succ.type,
      successorId: succ.id,
      successorCode: succ.code,
      successorTitle: succ.title,
      predecessorType: r.predecessorType as PrerequisiteType,
      predecessorId: r.predecessorId,
      predecessorLabel: pre.label,
      satisfied: prerequisiteSatisfied(pre.state),
      note: r.note,
      createdAt: r.createdAt.toISOString(),
    };
  }

  /** Rule (all prerequisites, whatever the caller can see): refuse when any is not yet satisfied. */
  async assertNonePending(projectId: string, successorType: ScheduleNodeType, successorId: string, subject: string) {
    const R = schema.recordDependency;
    const rows = await this.tx.select().from(R).where(and(eq(R.projectId, projectId), eq(R.successorType, successorType), eq(R.successorId, successorId)));
    const states = [];
    for (const r of rows) states.push(await this.state(projectId, r.predecessorType as PrerequisiteType, r.predecessorId));
    assertPrerequisitesSatisfied(subject, states.map((x) => x.state));
  }
}

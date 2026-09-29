import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, ilike, inArray, lt, or, sql } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  ACTION_ITEM_MACHINE,
  ACTION_ITEM_STATUSES,
  ActionCommand,
  ESCALATION_STATUSES,
  Classification,
  forbidden,
  isActionOverdue,
  ruleViolation,
  transition,
} from '@hub/domain';
import { DbService } from '../../platform/db.service';
import { PolicyService } from '../../platform/policy.service';
import { AuditService } from '../../platform/audit.service';
import { RecordVersionService, assertVersion, loadInProject, nextCode, offsetOf, pageOf, updateVersioned } from '../../platform/helpers';
import { newId } from '../../platform/ids';
import type { RequestContext } from '../../platform/context';
import { ActionRow, GovernanceSupport, iso } from './governance.support';

type ActionStatus = (typeof ACTION_ITEM_STATUSES)[number];
type EscalationStatus = (typeof ESCALATION_STATUSES)[number];
type EscalationRow = typeof schema.escalation.$inferSelect;
type EscalationSource = 'decision' | 'issue' | 'risk' | 'action_item' | 'meeting' | 'gate_definition' | 'other';

/** Committee actions (owner + due date → report done with evidence → verified closure) and escalations (spec §4.2). */
@Injectable()
export class ActionsService {
  constructor(
    private readonly db: DbService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly versions: RecordVersionService,
    private readonly sup: GovernanceSupport,
  ) {}

  // ---------------------------------------------------------------------------------------------------------
  // Actions — reads

  /**
   * Actions linked to a decision inherit its classification; unlinked ones are visible to all readers of the
   * project's governance data.
   */
  async list(
    ctx: RequestContext,
    projectId: string,
    q: { page: number; pageSize: number; q?: string; status?: ActionStatus; decisionId?: string; meetingId?: string; ownerUserId?: string; overdue?: 'true' | 'false' },
  ) {
    const a = schema.actionItem;
    const d = schema.decision;
    const p = await this.sup.project(projectId);
    const today = this.sup.today(p);
    const overdueSql = and(inArray(a.status, ['open', 'in_progress']), lt(a.dueDate, today));
    const where = and(
      eq(a.projectId, projectId),
      this.policy.visibilitySql(ctx, projectId, {}),
      or(sql`${a.decisionId} is null`, this.policy.visibilitySql(ctx, projectId, { classification: d.classification })),
      q.status ? eq(a.status, q.status) : undefined,
      q.decisionId ? eq(a.decisionId, q.decisionId) : undefined,
      q.meetingId ? eq(a.meetingId, q.meetingId) : undefined,
      q.ownerUserId ? eq(a.ownerUserId, q.ownerUserId) : undefined,
      q.overdue === 'true' ? overdueSql : q.overdue === 'false' ? sql`not coalesce((${overdueSql}), false)` : undefined,
      q.q ? or(ilike(a.title, `%${q.q}%`), ilike(a.code, `%${q.q}%`)) : undefined,
    );
    const tx = this.db.tx();
    const [{ total }] = (await tx.select({ total: count() }).from(a).leftJoin(d, eq(d.id, a.decisionId)).where(where)) as [{ total: number }];
    const rows = await tx.select({ a }).from(a).leftJoin(d, eq(d.id, a.decisionId)).where(where).orderBy(desc(a.createdAt)).limit(q.pageSize).offset(offsetOf(q));
    const names = await this.sup.displayNames(rows.map((r) => r.a.ownerUserId));
    return pageOf(
      rows.map((r) => this.actionDto(r.a, names, today)),
      Number(total),
      q,
    );
  }

  async get(ctx: RequestContext, projectId: string, actionId: string) {
    const a = await this.loadAction(ctx, projectId, actionId, 'governance.decision.read');
    const p = await this.sup.project(projectId);
    const names = await this.sup.displayNames([a.ownerUserId]);
    return this.actionDto(a, names, this.sup.today(p));
  }

  // ---------------------------------------------------------------------------------------------------------
  // Actions — commands

  async create(ctx: RequestContext, projectId: string, body: { title: string; decisionId?: string; meetingId?: string; issueId?: string; ownerUserId: string; dueDate: string }) {
    let classification: Classification | null = null;
    if (body.decisionId) classification = (await this.sup.decision(ctx, projectId, body.decisionId)).classification;
    if (body.meetingId) {
      const { committee } = await this.sup.meeting(ctx, projectId, body.meetingId);
      classification = classification ?? committee.classification;
    }
    if (body.issueId) await loadInProject(this.db, schema.issue, projectId, body.issueId);
    this.policy.assert(ctx, 'governance.action.manage', { projectId, classification });
    if (!(await this.sup.isActiveProjectMember(projectId, body.ownerUserId))) {
      throw ruleViolation('governance.action.owner_not_member', 'The action owner must be an active member of the project');
    }
    const p = await this.sup.project(projectId);
    const id = newId();
    const code = await nextCode(this.db, schema.actionItem, projectId, 'ACT');
    const values = {
      id,
      orgId: ctx.principal.orgId,
      projectId,
      code,
      title: body.title,
      decisionId: body.decisionId ?? null,
      meetingId: body.meetingId ?? null,
      issueId: body.issueId ?? null,
      ownerUserId: body.ownerUserId,
      dueDate: body.dueDate,
      status: 'open' as const,
      isDemo: p.isDemo,
      createdBy: ctx.principal.userId,
    };
    await this.db.tx().insert(schema.actionItem).values(values);
    await this.versions.snapshot({ projectId, entityType: 'action_item', entityId: id, versionNo: 1, snapshot: { title: body.title, ownerUserId: body.ownerUserId, dueDate: body.dueDate }, reason: 'created' });
    await this.audit.record({
      action: 'governance.action.create',
      entityType: 'action_item',
      entityId: id,
      projectId,
      after: { code, title: body.title, ownerUserId: body.ownerUserId, dueDate: body.dueDate, decisionId: values.decisionId, meetingId: values.meetingId, issueId: values.issueId },
    });
    return { id, code, version: 1 };
  }

  async update(ctx: RequestContext, projectId: string, actionId: string, body: { expectedVersion: number; title?: string; ownerUserId?: string; dueDate?: string; reason?: string }) {
    const a = await this.loadAction(ctx, projectId, actionId, 'governance.action.manage');
    assertVersion(a, body.expectedVersion, 'action');
    if (a.status !== 'open' && a.status !== 'in_progress') throw ruleViolation('governance.action.closed', `A ${a.status} action cannot be edited`);
    const values: Record<string, unknown> = {};
    if (body.title !== undefined) values['title'] = body.title;
    if (body.dueDate !== undefined) values['dueDate'] = body.dueDate;
    if (body.ownerUserId !== undefined) {
      if (!(await this.sup.isActiveProjectMember(projectId, body.ownerUserId))) throw ruleViolation('governance.action.owner_not_member', 'The action owner must be an active member of the project');
      values['ownerUserId'] = body.ownerUserId;
    }
    const row = (await updateVersioned(this.db, schema.actionItem, { id: a.id, projectId, expectedVersion: body.expectedVersion }, values)) as unknown as ActionRow;
    await this.versions.snapshot({ projectId, entityType: 'action_item', entityId: a.id, versionNo: row.version, snapshot: { title: row.title, ownerUserId: row.ownerUserId, dueDate: row.dueDate }, reason: body.reason ?? 'updated' });
    await this.audit.record({
      action: 'governance.action.update',
      entityType: 'action_item',
      entityId: a.id,
      projectId,
      before: { title: a.title, ownerUserId: a.ownerUserId, dueDate: a.dueDate },
      after: values,
      reason: body.reason ?? null,
    });
    return { id: a.id, version: row.version };
  }

  async start(ctx: RequestContext, projectId: string, actionId: string, body: { expectedVersion: number; note?: string }) {
    const a = await this.loadAction(ctx, projectId, actionId, 'governance.action.update');
    this.assertOwner(ctx, a);
    return this.apply(ctx, a, 'start', body.expectedVersion, {}, body.note);
  }

  async reportDone(ctx: RequestContext, projectId: string, actionId: string, body: { expectedVersion: number; closureEvidenceNote?: string }) {
    const a = await this.loadAction(ctx, projectId, actionId, 'governance.action.update');
    this.assertOwner(ctx, a);
    assertVersion(a, body.expectedVersion, 'action');
    transition('action', ACTION_ITEM_MACHINE, a.status as ActionStatus, 'report_done');
    const note = body.closureEvidenceNote?.trim();
    if (!note) throw ruleViolation('governance.action.closure_evidence_required', 'Closure evidence is required to report an action done');
    return this.apply(ctx, a, 'report_done', body.expectedVersion, { closureEvidenceNote: note, reportedDoneBy: ctx.principal.userId, reportedDoneAt: new Date(), verifiedBy: null, verifiedAt: null }, note);
  }

  async verifyClosure(ctx: RequestContext, projectId: string, actionId: string, body: { expectedVersion: number; note?: string }) {
    const a = await this.loadAction(ctx, projectId, actionId, 'governance.action.verify_closure', a0 => ({ requesterUserId: a0.reportedDoneBy }));
    if (a.ownerUserId === ctx.principal.userId) throw ruleViolation('governance.action.self_verification', 'The owner of an action cannot verify its closure');
    return this.apply(ctx, a, 'verify_closure', body.expectedVersion, { verifiedBy: ctx.principal.userId, verifiedAt: new Date() }, body.note);
  }

  async rejectClosure(ctx: RequestContext, projectId: string, actionId: string, body: { expectedVersion: number; note: string }) {
    const a = await this.loadAction(ctx, projectId, actionId, 'governance.action.verify_closure', a0 => ({ requesterUserId: a0.reportedDoneBy }));
    if (a.ownerUserId === ctx.principal.userId) throw ruleViolation('governance.action.self_verification', 'The owner of an action cannot review its own closure');
    return this.apply(ctx, a, 'reject_closure', body.expectedVersion, {}, body.note);
  }

  async cancel(ctx: RequestContext, projectId: string, actionId: string, body: { expectedVersion: number; note: string }) {
    const a = await this.loadAction(ctx, projectId, actionId, 'governance.action.manage');
    return this.apply(ctx, a, 'cancel', body.expectedVersion, {}, body.note);
  }

  // ---------------------------------------------------------------------------------------------------------
  // Escalations

  async listEscalations(ctx: RequestContext, projectId: string, q: { page: number; pageSize: number; q?: string; status?: EscalationStatus; sourceType?: EscalationSource; sourceId?: string }) {
    const e = schema.escalation;
    const d = schema.decision;
    const where = and(
      eq(e.projectId, projectId),
      this.policy.visibilitySql(ctx, projectId, {}),
      // Escalations about a decision are visible only to readers cleared for that decision.
      or(sql`${e.sourceType} <> 'decision'`, this.policy.visibilitySql(ctx, projectId, { classification: d.classification })),
      q.status ? eq(e.status, q.status) : undefined,
      q.sourceType ? eq(e.sourceType, q.sourceType) : undefined,
      q.sourceId ? eq(e.sourceId, q.sourceId) : undefined,
      q.q ? or(ilike(e.title, `%${q.q}%`), ilike(e.code, `%${q.q}%`)) : undefined,
    );
    const join = and(eq(e.sourceType, 'decision'), eq(d.id, e.sourceId));
    const tx = this.db.tx();
    const [{ total }] = (await tx.select({ total: count() }).from(e).leftJoin(d, join).where(where)) as [{ total: number }];
    const rows = await tx.select({ e }).from(e).leftJoin(d, join).where(where).orderBy(desc(e.createdAt)).limit(q.pageSize).offset(offsetOf(q));
    return pageOf(
      rows.map((r) => this.escalationDto(r.e)),
      Number(total),
      q,
    );
  }

  async getEscalation(ctx: RequestContext, projectId: string, escalationId: string) {
    return this.escalationDto(await this.loadEscalation(ctx, projectId, escalationId, 'governance.decision.read'));
  }

  async raise(
    ctx: RequestContext,
    projectId: string,
    body: { title: string; sourceType: EscalationSource; sourceId?: string; requestedAction: string; decisionDeadline: string; options: { title: string; impact?: string }[]; target?: string; raisedToCommitteeId?: string },
  ) {
    let classification: Classification | null = null;
    if (body.sourceType === 'other') {
      if (body.sourceId) throw ruleViolation('governance.escalation.source_id_not_allowed', 'An escalation of type "other" has no source record');
    } else {
      if (!body.sourceId) throw ruleViolation('governance.escalation.source_required', `Name the ${body.sourceType} being escalated`);
      classification = await this.sourceClassification(ctx, projectId, body.sourceType, body.sourceId);
    }
    if (body.raisedToCommitteeId) await this.sup.committee(ctx, projectId, body.raisedToCommitteeId);
    this.policy.assert(ctx, 'governance.escalation.raise', { projectId, classification });
    const p = await this.sup.project(projectId);
    const id = newId();
    const code = await nextCode(this.db, schema.escalation, projectId, 'ESC');
    await this.db
      .tx()
      .insert(schema.escalation)
      .values({
        id,
        orgId: ctx.principal.orgId,
        projectId,
        code,
        title: body.title,
        sourceType: body.sourceType,
        sourceId: body.sourceId ?? null,
        requestedAction: body.requestedAction,
        decisionDeadline: body.decisionDeadline,
        options: body.options.map((o) => (o.impact ? { title: o.title, impact: o.impact } : { title: o.title })),
        target: body.target ?? null,
        raisedToCommitteeId: body.raisedToCommitteeId ?? null,
        status: 'open',
        raisedBy: ctx.principal.userId,
        isSystemGenerated: false,
        isDemo: p.isDemo,
      });
    await this.audit.record({
      action: 'governance.escalation.raise',
      entityType: 'escalation',
      entityId: id,
      projectId,
      after: { code, sourceType: body.sourceType, sourceId: body.sourceId ?? null, decisionDeadline: body.decisionDeadline, options: body.options.length },
    });
    return { id, code, version: 1 };
  }

  async resolve(ctx: RequestContext, projectId: string, escalationId: string, body: { expectedVersion: number; resolutionDecisionId?: string; note: string }) {
    const e = await this.loadEscalation(ctx, projectId, escalationId, 'governance.decision.record_outcome', (x) => ({ requesterUserId: x.raisedBy }));
    assertVersion(e, body.expectedVersion, 'escalation');
    if (e.status !== 'open' && e.status !== 'decision_requested') throw ruleViolation('governance.escalation.closed', `The escalation is already ${e.status}`);
    if (body.resolutionDecisionId) await this.sup.decision(ctx, projectId, body.resolutionDecisionId);
    const row = (await updateVersioned(this.db, schema.escalation, { id: e.id, projectId, expectedVersion: body.expectedVersion }, {
      status: 'resolved',
      resolutionDecisionId: body.resolutionDecisionId ?? null,
      resolutionNote: body.note,
      resolvedBy: ctx.principal.userId,
      resolvedAt: new Date(),
    })) as unknown as EscalationRow;
    await this.audit.record({ action: 'governance.escalation.resolve', entityType: 'escalation', entityId: e.id, projectId, before: { status: e.status }, after: { status: 'resolved', resolutionDecisionId: body.resolutionDecisionId ?? null }, reason: body.note });
    return { id: e.id, version: row.version };
  }

  // ---------------------------------------------------------------------------------------------------------
  // Helpers

  private async loadAction(ctx: RequestContext, projectId: string, actionId: string, permission: string, extra: (a: ActionRow) => { requesterUserId?: string | null } = () => ({})) {
    const a = await loadInProject(this.db, schema.actionItem, projectId, actionId);
    let classification: Classification | null = null;
    if (a.decisionId) {
      const [d] = await this.db.tx().select({ c: schema.decision.classification }).from(schema.decision).where(eq(schema.decision.id, a.decisionId));
      classification = d?.c ?? null;
    }
    this.policy.assert(ctx, permission, { projectId, classification, ownerUserIds: [a.ownerUserId, a.createdBy], ...extra(a) });
    return a;
  }

  private async loadEscalation(ctx: RequestContext, projectId: string, id: string, permission: string, extra: (e: EscalationRow) => { requesterUserId?: string | null } = () => ({})) {
    const e = await loadInProject(this.db, schema.escalation, projectId, id);
    let classification: Classification | null = null;
    if (e.sourceType === 'decision' && e.sourceId) {
      const [d] = await this.db.tx().select({ c: schema.decision.classification }).from(schema.decision).where(eq(schema.decision.id, e.sourceId));
      classification = d?.c ?? null;
    }
    this.policy.assert(ctx, permission, { projectId, classification, ...extra(e) });
    return e;
  }

  private async sourceClassification(ctx: RequestContext, projectId: string, type: Exclude<EscalationSource, 'other'>, id: string): Promise<Classification | null> {
    switch (type) {
      case 'decision':
        return (await this.sup.decision(ctx, projectId, id)).classification;
      case 'meeting':
        return (await this.sup.meeting(ctx, projectId, id)).committee.classification;
      case 'action_item':
        await loadInProject(this.db, schema.actionItem, projectId, id);
        return null;
      case 'issue':
        await loadInProject(this.db, schema.issue, projectId, id);
        return null;
      case 'risk':
        await loadInProject(this.db, schema.risk, projectId, id);
        return null;
      case 'gate_definition':
        await loadInProject(this.db, schema.gateDefinition, projectId, id);
        return null;
    }
  }

  private assertOwner(ctx: RequestContext, a: ActionRow) {
    if (a.ownerUserId !== ctx.principal.userId) throw forbidden('governance.action.not_owner', 'Only the action owner can update its progress');
  }

  private async apply(ctx: RequestContext, a: ActionRow, cmd: ActionCommand, expectedVersion: number, extra: Record<string, unknown>, note?: string | null) {
    assertVersion(a, expectedVersion, 'action');
    const to = transition('action', ACTION_ITEM_MACHINE, a.status as ActionStatus, cmd);
    const row = (await updateVersioned(this.db, schema.actionItem, { id: a.id, projectId: a.projectId, expectedVersion }, { status: to, ...extra })) as unknown as ActionRow;
    await this.audit.record({
      action: `governance.action.${cmd}`,
      entityType: 'action_item',
      entityId: a.id,
      projectId: a.projectId,
      before: { status: a.status },
      after: { status: to },
      reason: note ?? null,
    });
    return { id: a.id, version: row.version };
  }

  private actionDto(a: ActionRow, names: Map<string, string>, today: string) {
    return {
      id: a.id,
      code: a.code,
      title: a.title,
      decisionId: a.decisionId,
      meetingId: a.meetingId,
      issueId: a.issueId,
      ownerUserId: a.ownerUserId,
      ownerName: a.ownerUserId ? (names.get(a.ownerUserId) ?? null) : null,
      dueDate: a.dueDate,
      status: a.status as ActionStatus,
      overdue: isActionOverdue({ status: a.status as ActionStatus, dueDate: a.dueDate }, today),
      closureEvidenceNote: a.closureEvidenceNote,
      reportedDoneBy: a.reportedDoneBy,
      reportedDoneAt: iso(a.reportedDoneAt),
      verifiedBy: a.verifiedBy,
      verifiedAt: iso(a.verifiedAt),
      isDemo: a.isDemo,
      version: a.version,
      createdAt: a.createdAt.toISOString(),
    };
  }

  private escalationDto(e: EscalationRow) {
    return {
      id: e.id,
      code: e.code,
      title: e.title,
      sourceType: e.sourceType,
      sourceId: e.sourceId,
      requestedAction: e.requestedAction,
      decisionDeadline: e.decisionDeadline,
      options: e.options,
      target: e.target,
      raisedToCommitteeId: e.raisedToCommitteeId,
      status: e.status as EscalationStatus,
      resolutionDecisionId: e.resolutionDecisionId,
      resolutionNote: e.resolutionNote,
      resolvedBy: e.resolvedBy,
      resolvedAt: iso(e.resolvedAt),
      raisedBy: e.raisedBy,
      isSystemGenerated: e.isSystemGenerated,
      isDemo: e.isDemo,
      version: e.version,
      createdAt: e.createdAt.toISOString(),
    };
  }
}

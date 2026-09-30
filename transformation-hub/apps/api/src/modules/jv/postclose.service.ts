import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, ilike, inArray, isNull, or } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  POST_CLOSE_MACHINE,
  addCalendarDays,
  allowedCommands,
  assertG7Passed,
  assertObligationVerifiable,
  assertProgramClosureAllowed,
  assessObligationOverdue,
  conflict,
  forbidden,
  notFound,
  ruleViolation,
  transition,
  DomainError,
  GateAssessmentStatus,
  ObligationCommand,
} from '@hub/domain';
import type { RouteInput, jvRoutes } from '@hub/contracts';
import type { RequestContext } from '../../platform/context';
import { assertVersion, likeContains, loadInProject, nextCode, offsetOf, pageOf, updateVersioned } from '../../platform/helpers';
import { orderBySort } from '../../platform/sort';
import { newId } from '../../platform/ids';
import { nextCronRun } from '../../platform/jobs/worker.service';
import { JvSupport, ProjectRow, iso } from './jv.support';

type Q<K extends keyof typeof jvRoutes> = RouteInput<(typeof jvRoutes)[K]>;
type ObligationRow = typeof schema.postCloseObligation.$inferSelect;

export const OBLIGATION_OVERDUE_JOB = 'jv.obligation_overdue_scan';
export const OBLIGATION_OVERDUE_CRON = '0 6 * * *';
const LIVE_STATUSES = ['open', 'in_progress', 'overdue'] as const;

/**
 * Conditions subsequent / post-close obligations (REQ-JV-016) with the durable daily overdue scan (worker job, per-project
 * schedule in the project timezone; overdue obligations escalate), and program closure (REQ-JV-019) — separate from
 * transaction closing, allowed only after gate G7 passes, confirmed by an authorized second person.
 */
@Injectable()
export class PostCloseService {
  constructor(private readonly s: JvSupport) {}

  private dto(o: ObligationRow, today: string, evidence: { active: number; conflicting: number }) {
    const a = assessObligationOverdue({ status: o.status, dueDate: o.dueDate, today });
    return {
      id: o.id,
      code: o.code,
      kind: o.kind,
      title: o.title,
      description: o.description,
      responsibleParty: o.responsibleParty,
      ownerUserId: o.ownerUserId,
      dueDate: o.dueDate,
      status: o.status,
      overdue: o.status === 'overdue' || a.overdue,
      daysOverdue: a.daysOverdue,
      overdueSince: o.overdueSince,
      escalationId: o.escalationId,
      completionReportedBy: o.completionReportedBy,
      verifiedBy: o.verifiedBy,
      verifiedAt: iso(o.verifiedAt),
      closingId: o.closingId,
      statusNote: o.statusNote,
      evidence,
      allowedCommands: allowedCommands(POST_CLOSE_MACHINE, o.status).filter((c) => c !== 'mark_overdue'),
      isDemo: o.isDemo,
      updatedAt: o.updatedAt.toISOString(),
      version: o.version,
    };
  }

  private async load(ctx: RequestContext, projectId: string, id: string, permission: string) {
    if (this.s.policy.isRoomOnly(ctx.principal, projectId)) throw notFound();
    const o = await loadInProject(this.s.db, schema.postCloseObligation, projectId, id);
    // Role-level pre-check (I-R3): verification asserts not_self with the completion reporter.
    this.s.policy.assertGranted(ctx, permission, { projectId });
    return o;
  }

  async list(ctx: RequestContext, projectId: string, q: Q<'listObligations'>['query']) {
    const p = await this.s.project(projectId);
    this.s.assertListable(ctx, projectId, 'jv.deal.read');
    const t = schema.postCloseObligation;
    const where = and(
      eq(t.projectId, projectId),
      q.status ? eq(t.status, q.status) : undefined,
      q.kind ? eq(t.kind, q.kind) : undefined,
      q.q ? or(ilike(t.title, likeContains(q.q)), ilike(t.code, likeContains(q.q))) : undefined,
    );
    const tx = this.s.db.tx();
    const [{ total }] = (await tx.select({ total: count() }).from(t).where(where)) as [{ total: number }];
    const order = orderBySort(q.sort, { code: t.code, dueDate: t.dueDate, status: t.status, updatedAt: t.updatedAt }, t.id, [asc(t.dueDate), asc(t.code), asc(t.id)]);
    const rows = await tx.select().from(t).where(where).orderBy(...order).limit(q.pageSize).offset(offsetOf(q));
    const ev = await this.s.visibleEvidenceMap(ctx, projectId, 'post_close_obligation', rows.map((r) => r.id));
    const today = this.s.today(p);
    return {
      ...pageOf(rows.map((o) => this.dto(o, today, ev.get(o.id) ?? { active: 0, conflicting: 0 })), Number(total), q),
      people: await this.s.people(rows.flatMap((o) => [o.ownerUserId, o.completionReportedBy, o.verifiedBy])),
    };
  }

  async create(ctx: RequestContext, projectId: string, body: Q<'createObligation'>['body']) {
    const p = await this.s.project(projectId);
    this.s.assertListable(ctx, projectId, 'jv.closing_checklist.manage');
    this.s.policy.assert(ctx, 'jv.closing_checklist.manage', { projectId });
    if (body.ownerUserId) await this.s.assertMember(projectId, body.ownerUserId, 'ownerUserId');
    if (body.closingId) {
      const e = await loadInProject(this.s.db, schema.closing, projectId, body.closingId);
      if (e.kind !== 'closing') throw ruleViolation('jv.obligation.closing_only', 'A post-close obligation follows a closing (not a signing)');
    }
    const code = await this.s.nextCode('post_close_obligation', 'code', projectId, 'PCO');
    const id = newId();
    await this.s.db.tx().insert(schema.postCloseObligation).values({
      id,
      orgId: ctx.principal.orgId,
      projectId,
      code,
      kind: body.kind,
      title: body.title,
      description: body.description ?? null,
      responsibleParty: body.responsibleParty ?? null,
      ownerUserId: body.ownerUserId ?? null,
      dueDate: body.dueDate ?? null,
      closingId: body.closingId ?? null,
      isDemo: p.isDemo,
      createdBy: ctx.principal.userId,
    });
    await this.ensureOverdueSchedule(ctx, p);
    await this.s.audit.record({ action: 'jv.obligation.create', entityType: 'post_close_obligation', entityId: id, projectId, after: { code, kind: body.kind, dueDate: body.dueDate ?? null } });
    return { id, code, version: 1 };
  }

  async transition(ctx: RequestContext, projectId: string, id: string, body: Q<'transitionObligation'>['body']) {
    const o = await this.load(ctx, projectId, id, 'jv.closing_checklist.manage');
    const cmd = body.command as ObligationCommand;
    if (cmd === 'cancel' && !body.note?.trim()) throw ruleViolation('jv.obligation.reason_required', 'A reason is required to cancel');
    const to = transition('post_close_obligation', POST_CLOSE_MACHINE, o.status, cmd);
    const values: Record<string, unknown> = { status: to, statusNote: body.note ?? null };
    if (cmd === 'report_complete') Object.assign(values, { completionReportedBy: ctx.principal.userId, completionReportedAt: this.s.clock.now(), evidenceNote: body.note ?? null });
    const row = (await updateVersioned(this.s.db, schema.postCloseObligation, { id, projectId, expectedVersion: body.expectedVersion }, values)) as ObligationRow;
    await this.s.audit.record({ action: `jv.obligation.${cmd}`, entityType: 'post_close_obligation', entityId: id, projectId, before: { status: o.status }, after: { status: to }, reason: body.note ?? null });
    return { id, status: row.status, version: row.version };
  }

  async verify(ctx: RequestContext, projectId: string, id: string, body: Q<'verifyObligation'>['body']) {
    this.s.assertHuman(ctx, 'Verifying an obligation');
    const o = await this.load(ctx, projectId, id, 'jv.cp.verify');
    const cmd: ObligationCommand = body.outcome === 'verify' ? 'verify' : 'reject_completion';
    const ev = body.outcome === 'verify' ? await this.s.evidence(projectId, 'post_close_obligation', o.id) : null;
    // Role → state (evidence, completion reported: 422) → separation from the completion reporter (I-R3).
    let to = o.status;
    this.s.policy.assertApproval(ctx, 'jv.cp.verify', { projectId, requesterUserId: o.completionReportedBy }, () => {
      if (ev) assertObligationVerifiable({ activeEvidence: ev.active, verifierUserId: ctx.principal.userId!, ownerUserId: o.ownerUserId, reportedBy: o.completionReportedBy });
      to = transition('post_close_obligation', POST_CLOSE_MACHINE, o.status, cmd);
    });
    const values: Record<string, unknown> = { status: to, statusNote: body.note ?? null };
    if (cmd === 'verify') Object.assign(values, { verifiedBy: ctx.principal.userId, verifiedAt: this.s.clock.now() });
    const row = (await updateVersioned(this.s.db, schema.postCloseObligation, { id, projectId, expectedVersion: body.expectedVersion }, values)) as ObligationRow;
    await this.s.audit.record({ action: `jv.obligation.${cmd}`, entityType: 'post_close_obligation', entityId: id, projectId, before: { status: o.status }, after: { status: to }, reason: body.note ?? null });
    return { id, status: row.status, version: row.version };
  }

  // ---------------------------------------------------------------------------------------------------------
  // Overdue scan (worker job) — durable per-project schedule in the project timezone

  async ensureOverdueSchedule(ctx: RequestContext, p: ProjectRow) {
    await this.s.db.query(`select pg_advisory_xact_lock(hashtextextended('hub_jv_overdue_schedule:' || $1, 0))`, [p.id]);
    await this.s.db.query(
      `insert into scheduled_job (id, org_id, project_id, kind, name, cron, timezone, payload, enabled, next_run_at, created_by)
       select gen_random_uuid(), $1::uuid, $2::uuid, $3::varchar, $4::text, $5::varchar, $6::text, '{}'::jsonb, true, $7::timestamptz, $8::uuid
        where not exists (select 1 from scheduled_job where org_id = $1::uuid and project_id = $2::uuid and kind = $3::varchar)`,
      [p.orgId, p.id, OBLIGATION_OVERDUE_JOB, `Post-close obligation overdue scan (${p.code})`, OBLIGATION_OVERDUE_CRON, p.timezone, nextCronRun(OBLIGATION_OVERDUE_CRON, p.timezone, this.s.clock.now()), ctx.principal.userId],
    );
  }

  /**
   * Marks live obligations past their business due date (project timezone) overdue and escalates each once (system-
   * generated escalation to the steering body). Idempotent: a re-run changes nothing; nothing is sent externally.
   */
  async scanOverdue(ctx: RequestContext, projectId: string) {
    this.s.policy.assert(ctx, 'jv.closing_checklist.manage', { projectId });
    const p = await this.s.project(projectId);
    const today = this.s.today(p);
    const rows = await this.s.db
      .tx()
      .select()
      .from(schema.postCloseObligation)
      .where(and(eq(schema.postCloseObligation.projectId, projectId), inArray(schema.postCloseObligation.status, [...LIVE_STATUSES])))
      .orderBy(asc(schema.postCloseObligation.code));
    const out = { scanned: rows.length, markedOverdue: 0, escalations: 0 };
    for (const o of rows) {
      const a = assessObligationOverdue({ status: o.status, dueDate: o.dueDate, today });
      if (!a.overdue) continue;
      let cur = o;
      if (o.status !== 'overdue') {
        const to = transition('post_close_obligation', POST_CLOSE_MACHINE, o.status, 'mark_overdue');
        cur = (await updateVersioned(this.s.db, schema.postCloseObligation, { id: o.id, projectId, expectedVersion: o.version }, { status: to, overdueSince: addCalendarDays(o.dueDate!, 1) })) as ObligationRow;
        await this.s.audit.record({ action: 'jv.obligation.mark_overdue', entityType: 'post_close_obligation', entityId: o.id, projectId, before: { status: o.status }, after: { status: to, dueDate: o.dueDate, daysOverdue: a.daysOverdue } });
        out.markedOverdue++;
      }
      if (!cur.escalationId) {
        const escalationId = await this.raiseEscalation(ctx, p, cur, a.daysOverdue);
        await this.s.db.tx().update(schema.postCloseObligation).set({ escalationId }).where(and(eq(schema.postCloseObligation.id, o.id), eq(schema.postCloseObligation.projectId, projectId), isNull(schema.postCloseObligation.escalationId)));
        out.escalations++;
      }
    }
    return out;
  }

  private async raiseEscalation(ctx: RequestContext, p: ProjectRow, o: ObligationRow, daysOverdue: number): Promise<string> {
    const [open] = await this.s.db
      .tx()
      .select({ id: schema.escalation.id })
      .from(schema.escalation)
      .where(and(eq(schema.escalation.projectId, p.id), eq(schema.escalation.sourceType, 'post_close_obligation'), eq(schema.escalation.sourceId, o.id), inArray(schema.escalation.status, ['open', 'decision_requested'])));
    if (open) return open.id;
    const id = newId();
    const code = await nextCode(this.s.db, schema.escalation, p.id, 'ESC');
    await this.s.db
      .tx()
      .insert(schema.escalation)
      .values({
        id,
        orgId: p.orgId,
        projectId: p.id,
        code,
        title: `Post-close ${o.kind.replace('_', ' ')} ${o.code} is overdue — escalation`,
        sourceType: 'post_close_obligation',
        sourceId: o.id,
        requestedAction: `${o.code} (${o.title}) passed its due date ${o.dueDate} (${daysOverdue} day(s) overdue, project timezone) without verified completion. Decide on remediation, a revised date or the consequence under the transaction documents.`,
        options: [{ title: 'Remediate and re-plan', impact: 'Owner reports a revised plan; the obligation stays overdue until verified' }, { title: 'Escalate to the counterparty / authorized body', impact: 'Per the transaction documents — to be confirmed' }],
        target: 'Steering committee / authorized body — to be confirmed',
        status: 'open',
        raisedBy: ctx.principal.userId,
        isSystemGenerated: true,
        isDemo: p.isDemo,
      });
    await this.s.audit.record({ action: 'jv.obligation.escalate', entityType: 'escalation', entityId: id, projectId: p.id, after: { code, obligationId: o.id, daysOverdue } });
    return id;
  }

  // ---------------------------------------------------------------------------------------------------------
  // Program closure (REQ-JV-019)

  /** Current G7 cycle — with its reassessment flag (DOM-P4-11: a flagged approval does not count). */
  private async g7(projectId: string): Promise<{ assessmentId: string | null; status: GateAssessmentStatus | null; underReassessment: boolean }> {
    const g = await this.s.gateCycle(projectId, 'G7');
    return { assessmentId: g.assessmentId, status: g.status, underReassessment: g.underReassessment };
  }

  private async closureRow(projectId: string) {
    const [c] = await this.s.db.tx().select().from(schema.programClosure).where(eq(schema.programClosure.projectId, projectId));
    return c ?? null;
  }

  async getClosure(ctx: RequestContext, projectId: string) {
    await this.s.project(projectId);
    this.s.assertListable(ctx, projectId, 'portfolio.project.read');
    const c = await this.closureRow(projectId);
    const g7 = await this.g7(projectId);
    let passed = true;
    try {
      assertG7Passed(g7.status, g7.underReassessment);
    } catch {
      passed = false;
    }
    return {
      closure: c
        ? { id: c.id, status: c.status as 'requested' | 'confirmed' | 'rejected', handoverNote: c.handoverNote, requestedBy: c.requestedBy, requestedAt: c.requestedAt.toISOString(), confirmedBy: c.confirmedBy, confirmedAt: iso(c.confirmedAt), statusNote: c.statusNote, version: c.version }
        : null,
      g7,
      g7Passed: passed,
    };
  }

  async requestClosure(ctx: RequestContext, projectId: string, body: Q<'requestProgramClosure'>['body']) {
    const p = await this.s.project(projectId);
    this.s.assertListable(ctx, projectId, 'jv.closing_checklist.manage');
    this.s.policy.assert(ctx, 'jv.closing_checklist.manage', { projectId });
    const g7 = await this.g7(projectId);
    try {
      assertG7Passed(g7.status, g7.underReassessment);
    } catch (e) {
      await this.s.audit.recordDetached(ctx, { action: 'jv.program_closure.request', entityType: 'project', entityId: projectId, projectId, outcome: 'rejected', reason: (e as Error).message, before: { g7Status: g7.status, g7UnderReassessment: g7.underReassessment } });
      throw e;
    }
    const existing = await this.closureRow(projectId);
    if (existing?.status === 'requested') throw conflict('jv.program_closure.already_requested', 'A program closure request is already pending');
    if (existing?.status === 'confirmed') throw ruleViolation('jv.program_closure.already_closed', 'The program is already closed');
    const reqId = await this.s.createApprovalRequest(ctx, projectId, {
      subjectType: 'project',
      subjectId: projectId,
      subjectVersion: (existing?.version ?? 0) + 1,
      action: 'portfolio.project.archive',
      requiredPermission: 'portfolio.project.archive',
      payload: { projectId, g7AssessmentId: g7.assessmentId, handoverNote: body.handoverNote },
      note: 'Program closure (administrative)',
    });
    let id: string;
    let version: number;
    if (existing) {
      const row = await updateVersioned(this.s.db, schema.programClosure, { id: existing.id, projectId, expectedVersion: existing.version }, { status: 'requested', handoverNote: body.handoverNote, g7AssessmentId: g7.assessmentId, approvalRequestId: reqId, requestedBy: ctx.principal.userId, confirmedBy: null, confirmedAt: null, statusNote: null });
      id = existing.id;
      version = row['version'] as number;
    } else {
      id = newId();
      await this.s.db.tx().insert(schema.programClosure).values({ id, orgId: ctx.principal.orgId, projectId, status: 'requested', handoverNote: body.handoverNote, g7AssessmentId: g7.assessmentId, approvalRequestId: reqId, requestedBy: ctx.principal.userId!, isDemo: p.isDemo });
      version = 1;
    }
    await this.s.audit.record({ action: 'jv.program_closure.request', entityType: 'project', entityId: projectId, projectId, after: { programClosureId: id, approvalRequestId: reqId, g7Status: g7.status } });
    return { id, status: 'requested' as const, version };
  }

  async confirmClosure(ctx: RequestContext, projectId: string, body: Q<'confirmProgramClosure'>['body']) {
    this.s.assertHuman(ctx, 'Confirming program closure');
    const p = await this.s.project(projectId);
    this.s.assertListable(ctx, projectId, 'portfolio.project.archive');
    const c = await this.closureRow(projectId);
    if (!c || c.status !== 'requested') throw ruleViolation('jv.program_closure.not_requested', 'No pending program closure request exists (a request by another person is required)');
    const req = await this.s.approvalRequest(projectId, c.approvalRequestId);
    if (!req || req.status !== 'pending') throw ruleViolation('jv.program_closure.not_requested', 'The program closure request is no longer pending');
    const authority = await this.s.matrixAuthority(p, null);
    const within = authority.within || (this.s.config.demoMode && p.isDemo);
    const basis = authority.within ? authority.basis : within ? 'Demo authority policy (synthetic, demo mode only) — not a real delegation' : authority.basis;
    const g7 = await this.g7(projectId);
    if (body.outcome === 'confirm') {
      try {
        assertProgramClosureAllowed({ g7Status: g7.status, g7UnderReassessment: g7.underReassessment, confirmerUserId: ctx.principal.userId!, requesterUserId: c.requestedBy });
      } catch (e) {
        await this.s.audit.recordDetached(ctx, { action: 'jv.program_closure.confirm', entityType: 'project', entityId: projectId, projectId, outcome: e instanceof DomainError && e.kind === 'forbidden' ? 'denied' : 'rejected', reason: (e as Error).message, before: { g7Status: g7.status, g7UnderReassessment: g7.underReassessment } });
        throw e;
      }
    } else if (ctx.principal.userId === c.requestedBy) {
      throw forbidden('jv.program_closure.self_confirmation', 'The requester cannot decide the program closure');
    }
    this.s.policy.assert(ctx, 'portfolio.project.archive', { projectId, withinAuthority: within });
    assertVersion(c, body.expectedVersion, 'program closure');
    const confirm = body.outcome === 'confirm';
    const row = await updateVersioned(this.s.db, schema.programClosure, { id: c.id, projectId, expectedVersion: body.expectedVersion }, confirm ? { status: 'confirmed', confirmedBy: ctx.principal.userId, confirmedAt: this.s.clock.now(), statusNote: body.note ?? null } : { status: 'rejected', statusNote: body.note ?? null });
    await this.s.decideApproval(ctx, projectId, req, confirm ? 'approve' : 'reject', body.note ?? null, basis);
    await this.s.audit.record({ action: confirm ? 'jv.program_closure.confirm' : 'jv.program_closure.reject', entityType: 'project', entityId: projectId, projectId, before: { status: c.status }, after: { status: confirm ? 'confirmed' : 'rejected', g7Status: g7.status, authority: basis }, reason: body.note ?? null });
    return { id: c.id, status: (confirm ? 'confirmed' : 'rejected') as 'confirmed' | 'rejected', version: row['version'] as number };
  }
}

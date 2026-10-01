import { Injectable } from '@nestjs/common';
import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import { schema } from '@hub/db';
import { Classification, CRITERION_EDITABLE_GATE_STATUSES, EVIDENCE_TARGET_READ_PERMISSION, NO_HUMAN_REQUESTER, RoleKey, ServerMessage, isOverdue, localDate, planText, separationSubject } from '@hub/domain';
import type { MY_WORK_TYPES } from '@hub/contracts';
import type { RequestContext } from '../../platform/context';
import { isFullScope } from '../../platform/context';
import { PlanningSupport, ProjectInfo } from './planning-support';
import { RecordVisibility } from '../../platform/record-visibility';
import { evidenceSelfSql } from '../../platform/helpers';
import { GatesService } from '../gates/gates.service';

type WorkType = (typeof MY_WORK_TYPES)[number];
interface Item {
  type: WorkType;
  projectId: string;
  projectCode: string;
  entityId: string;
  code: string | null;
  title: string;
  /** Only for records with a bilingual title (QA-P2-04); free text typed by a user has none. */
  titleAr?: string | null;
  /** Titles composed by the server, as codes (QA-P2-04). */
  titleI18n?: ServerMessage[];
  status: string;
  dueDate: string | null;
  overdue: boolean;
  linkPath: string;
  isDemo: boolean;
}

/**
 * "My Work / Inbox" across every project the caller belongs to: accountable tasks, items awaiting the caller's
 * acceptance/review/approval (filtered with the same policy checks as the commands, incl. separation of duties),
 * governance action items owned and decisions awaiting the caller's vote. Only full project members are considered.
 */
@Injectable()
export class MyWorkService {
  constructor(
    private readonly s: PlanningSupport,
    private readonly gates: GatesService,
  ) {}

  async myWork(ctx: RequestContext) {
    const me = ctx.principal.userId;
    const projects: ProjectInfo[] = [];
    for (const [pid, scope] of ctx.principal.projects) {
      if (!isFullScope(scope)) continue;
      const p = await this.s.project(ctx, pid).catch(() => null);
      if (p && this.s.policy.canSee(ctx, { projectId: pid, classification: p.classification })) projects.push(p);
    }
    const items: Item[] = [];
    if (!me || projects.length === 0) return { items, counts: {}, generatedAt: new Date().toISOString() };
    const byId = new Map(projects.map((p) => [p.id, p]));
    const pids = projects.map((p) => p.id);
    const tx = this.s.db.tx();
    const today = (pid: string) => this.s.today(byId.get(pid)!);
    const push = (p: ProjectInfo, i: Omit<Item, 'projectId' | 'projectCode' | 'isDemo'>, isDemo: boolean) => items.push({ ...i, projectId: p.id, projectCode: p.code, isDemo });
    // Same inputs as the approving command (I-R3): the subject's requester, and the explicit role authority the planning
    // approvals use — so the inbox never offers an item the command would refuse.
    const can = (perm: string, pid: string, attrs: { workstreamId?: string | null; requesterUserId?: string | null; classification?: Classification } = {}) =>
      this.s.policy.can(ctx, perm, { projectId: pid, classification: attrs.classification ?? byId.get(pid)!.classification, workstreamId: attrs.workstreamId ?? null, requesterUserId: attrs.requesterUserId ?? null, withinAuthority: true });

    // Tasks I am accountable for (open)
    const T = schema.task;
    const mine = await tx.select().from(T).where(and(inArray(T.projectId, pids), eq(T.accountableUserId, me), inArray(T.status, ['not_started', 'in_progress', 'blocked'])));
    for (const t of mine) {
      const due = t.plannedFinish ?? t.forecastFinish;
      push(byId.get(t.projectId)!, { type: 'task_accountable', entityId: t.id, code: t.wbsCode, title: t.title, titleAr: t.titleAr, status: t.status, dueDate: due, overdue: isOverdue(due, today(t.projectId), true), linkPath: `/projects/${t.projectId}/plan/tasks/${t.id}` }, t.isDemo);
    }
    // Tasks awaiting my acceptance
    const subT = await tx.select().from(T).where(and(inArray(T.projectId, pids), eq(T.status, 'submitted_for_acceptance')));
    for (const t of subT) {
      if (!can('planning.deliverable.accept', t.projectId, { workstreamId: t.workstreamId, requesterUserId: t.submittedBy })) continue;
      // DOM-P2-07: only the task's designated approver role is asked to accept it.
      if (t.approverRole && !this.s.rolesFor(ctx, t.projectId, t.workstreamId).includes(t.approverRole)) continue;
      push(byId.get(t.projectId)!, { type: 'task_acceptance', entityId: t.id, code: t.wbsCode, title: t.title, titleAr: t.titleAr, status: t.status, dueDate: t.plannedFinish, overdue: false, linkPath: `/projects/${t.projectId}/plan/tasks/${t.id}` }, t.isDemo);
    }
    // Deliverables awaiting my acceptance
    const D = schema.deliverable;
    const subD = await tx.select({ d: D, approverRole: T.approverRole }).from(D).leftJoin(T, and(eq(T.id, D.taskId), eq(T.projectId, D.projectId))).where(and(inArray(D.projectId, pids), eq(D.status, 'submitted')));
    for (const { d, approverRole } of subD) {
      if (!can('planning.deliverable.accept', d.projectId, { workstreamId: d.workstreamId, requesterUserId: d.submittedBy })) continue;
      if (approverRole && !this.s.rolesFor(ctx, d.projectId, d.workstreamId).includes(approverRole)) continue;
      push(byId.get(d.projectId)!, { type: 'deliverable_acceptance', entityId: d.id, code: d.code, title: d.title, titleAr: d.titleAr, status: d.status, dueDate: d.dueDate, overdue: isOverdue(d.dueDate, today(d.projectId), true), linkPath: `/projects/${d.projectId}/plan/deliverables/${d.id}` }, d.isDemo);
    }
    // Milestones awaiting evidence verification
    const M = schema.milestone;
    const pendM = await tx.select().from(M).where(and(inArray(M.projectId, pids), eq(M.status, 'achieved_pending_evidence')));
    for (const m of pendM) {
      if (!can('planning.deliverable.accept', m.projectId, { workstreamId: m.workstreamId, requesterUserId: m.reportedBy })) continue;
      push(byId.get(m.projectId)!, { type: 'milestone_verification', entityId: m.id, code: m.code, title: m.title, titleAr: m.titleAr, status: m.status, dueDate: m.plannedDate, overdue: false, linkPath: `/projects/${m.projectId}/plan/milestones/${m.id}` }, m.isDemo);
    }
    // Status updates to review
    const U = schema.statusUpdate;
    const subU = await tx.select().from(U).where(and(inArray(U.projectId, pids), eq(U.status, 'submitted')));
    const wsCodes = new Map<string, string>();
    for (const w of await tx.select({ id: schema.workstream.id, code: schema.workstream.code }).from(schema.workstream).where(inArray(schema.workstream.projectId, pids))) wsCodes.set(w.id, w.code);
    for (const u of subU) {
      if (!can('planning.status_update.review', u.projectId, { workstreamId: u.workstreamId, requesterUserId: u.submittedBy })) continue;
      const label = u.workstreamId ? (wsCodes.get(u.workstreamId) ?? 'Workstream') : 'Project';
      const title = u.workstreamId ? planText('plan.work.status_update_workstream', { workstream: label, date: u.periodEnd }) : planText('plan.work.status_update_project', { date: u.periodEnd });
      push(byId.get(u.projectId)!, { type: 'status_update_review', entityId: u.id, code: label, title: title.text, titleI18n: title.i18n, status: u.status, dueDate: null, overdue: false, linkPath: `/projects/${u.projectId}/plan/updates/${u.id}` }, u.isDemo);
    }
    // RAG overrides to review
    const O = schema.ragOverride;
    const pendO = await tx.select().from(O).where(and(inArray(O.projectId, pids), isNull(O.reviewedAt)));
    for (const o of pendO) {
      if (!can('planning.rag_override.review', o.projectId, { workstreamId: o.entityType === 'workstream' ? o.entityId : null, requesterUserId: o.requestedBy })) continue;
      const label = o.entityType === 'workstream' ? (wsCodes.get(o.entityId) ?? 'Workstream') : 'Project';
      const rag = { status: o.overrideStatus, calculated: o.calculatedStatus };
      const title = o.entityType === 'workstream' ? planText('plan.work.rag_override_workstream', { ...rag, workstream: label }) : planText('plan.work.rag_override_project', rag);
      push(byId.get(o.projectId)!, { type: 'rag_override_review', entityId: o.id, code: label, title: title.text, titleI18n: title.i18n, status: 'pending', dueDate: o.expiresOn, overdue: false, linkPath: `/projects/${o.projectId}/plan?tab=health` }, o.isDemo);
    }
    // Change requests to assess / approve
    const C = schema.changeRequest;
    const crs = await tx.select().from(C).where(and(inArray(C.projectId, pids), inArray(C.status, ['submitted', 'under_review'])));
    for (const c of crs) {
      const link = `/projects/${c.projectId}/raid/changes/${c.id}`;
      if (can('planning.change_request.assess', c.projectId)) push(byId.get(c.projectId)!, { type: 'change_request_assess', entityId: c.id, code: c.code, title: c.title, status: c.status, dueDate: null, overdue: false, linkPath: link }, c.isDemo);
      if (c.status === 'under_review' && can('planning.change_request.approve', c.projectId, { requesterUserId: c.requestedBy })) push(byId.get(c.projectId)!, { type: 'change_request_approve', entityId: c.id, code: c.code, title: c.title, status: c.status, dueDate: null, overdue: false, linkPath: link }, c.isDemo);
    }
    // Baselines awaiting approval
    const B = schema.baselineVersion;
    const bls = await tx.select({ id: B.id, projectId: B.projectId, versionNo: B.versionNo, proposedBy: B.proposedBy }).from(B).where(and(inArray(B.projectId, pids), eq(B.status, 'proposed')));
    for (const b of bls) {
      if (!can('planning.baseline.approve', b.projectId, { requesterUserId: b.proposedBy })) continue;
      const p = byId.get(b.projectId)!;
      const title = planText('plan.work.baseline', { version: b.versionNo });
      push(p, { type: 'baseline_approval', entityId: b.id, code: `BL v${b.versionNo}`, title: title.text, titleI18n: title.i18n, status: 'proposed', dueDate: null, overdue: false, linkPath: `/projects/${b.projectId}/plan/baselines/${b.id}` }, p.isDemo);
    }
    // Governance action items I own
    const A = schema.actionItem;
    const acts = await tx.select().from(A).where(and(inArray(A.projectId, pids), eq(A.ownerUserId, me), inArray(A.status, ['open', 'in_progress'])));
    for (const a of acts) {
      push(byId.get(a.projectId)!, { type: 'action_item', entityId: a.id, code: a.code, title: a.title, status: a.status, dueDate: a.dueDate, overdue: isOverdue(a.dueDate, today(a.projectId), true), linkPath: `/projects/${a.projectId}/committee/actions/${a.id}` }, a.isDemo);
    }
    // Decisions awaiting my vote: under review, I am an active voting member of the committee, not recused, not yet voted this round.
    const votes = await tx.execute<{ id: string; project_id: string; code: string; title: string; status: string; latest_safe_date: string | null; classification: Classification; requester_user_id: string | null; is_demo: boolean }>(sql`
      select d.id, d.project_id, d.code, d.title, d.status, d.latest_safe_date::text as latest_safe_date, d.classification, d.requester_user_id, d.is_demo
        from decision d
        join committee_membership cm on cm.committee_id = d.committee_id and cm.project_id = d.project_id and cm.user_id = ${me} and cm.voting
        join project p on p.id = d.project_id
       where d.project_id in (${sql.join(pids.map((x) => sql`${x}::uuid`), sql`, `)})
         and d.status = 'under_review'
         -- seat validity in the PROJECT's timezone (not the database's UTC date)
         and cm.valid_from <= (now() at time zone p.timezone)::date and (cm.valid_to is null or cm.valid_to >= (now() at time zone p.timezone)::date)
         and not exists (select 1 from recusal r where r.decision_id = d.id and r.user_id = ${me})
         and not exists (select 1 from vote v where v.decision_id = d.id and v.user_id = ${me} and v.round = d.vote_round)`);
    const seen = new Set<string>();
    for (const d of votes.rows) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      if (!can('governance.decision.vote', d.project_id, { classification: d.classification, requesterUserId: d.requester_user_id })) continue;
      push(byId.get(d.project_id)!, { type: 'decision_vote', entityId: d.id, code: d.code, title: d.title, status: d.status, dueDate: d.latest_safe_date, overdue: isOverdue(d.latest_safe_date, today(d.project_id), true), linkPath: `/projects/${d.project_id}/committee/decisions/${d.id}` }, d.is_demo);
    }

    // ---- Governance, gate and documents approvals (DOM-P2-09, REQ-UX-018): the same policy inputs as the commands — the
    // designated role / authority, and separation of duties against the subject's requester (fail closed when unknown).
    const people = (pid: string) => ctx.principal.projects.get(pid);
    const holds = (pid: string, role: string) => !!people(pid)?.roles.has(role as RoleKey);
    const inWorkstreamRole = (pid: string, role: string) => people(pid)?.workstreamRoles.find((w) => w.role === role) ?? null;

    // Gate decisions awaiting me: a cycle ready for decision whose approver role I hold, not submitted by me.
    const GD = schema.gateDefinition;
    const GA = schema.gateAssessment;
    const ready = await tx
      .select({ a: GA, g: { id: GD.id, key: GD.key, name: GD.name, nameAr: GD.nameAr, approverRole: GD.approverRole } })
      .from(GA)
      .innerJoin(GD, and(eq(GD.id, GA.gateId), eq(GD.projectId, GA.projectId)))
      .where(and(inArray(GA.projectId, pids), eq(GA.isCurrent, true), eq(GA.status, 'ready_for_decision')));
    for (const { a, g } of ready) {
      const p = byId.get(a.projectId)!;
      const withinAuthority = holds(a.projectId, g.approverRole);
      if (!withinAuthority) continue;
      // Same subjects as the decide command (SEC-P2-03): neither the submitter nor the gate reviewer.
      if (!this.s.policy.can(ctx, 'gates.assessment.decide', { projectId: p.id, classification: p.classification, requesterUserId: separationSubject(ctx.principal.userId, [a.submittedBy, a.reviewedBy]), withinAuthority })) continue;
      push(p, { type: 'gate_decision', entityId: a.id, code: g.key, title: g.name, titleAr: g.nameAr, status: a.status, dueDate: null, overdue: false, linkPath: `/projects/${p.id}/gates/${g.id}` }, p.isDemo);
    }

    // Gate assessments awaiting my gate-level review (DOM-P2-16) as the gate's DESIGNATED reviewer role: a cycle in
    // assessment whose criteria are all satisfied and whose current state is not reviewed yet, never started by me. The
    // gates module applies the same rules as the review command; it is asked only for projects with such a candidate.
    const toEndorse = await tx
      .select({ projectId: GA.projectId, reviewerRole: GD.reviewerRole })
      .from(GA)
      .innerJoin(GD, and(eq(GD.id, GA.gateId), eq(GD.projectId, GA.projectId)))
      .where(and(inArray(GA.projectId, pids), eq(GA.isCurrent, true), eq(GA.status, 'in_assessment')));
    const reviewProjects = new Set(toEndorse.filter((r) => holds(r.projectId, r.reviewerRole) || inWorkstreamRole(r.projectId, r.reviewerRole)).map((r) => r.projectId));
    for (const pid of reviewProjects) {
      const p = byId.get(pid)!;
      for (const r of await this.gates.pendingGateReviews(ctx, pid)) {
        push(p, { type: 'gate_review', entityId: r.assessmentId, code: r.key, title: r.name, titleAr: r.nameAr, status: r.state, dueDate: null, overdue: false, linkPath: `/projects/${pid}/gates/${r.gateId}` }, p.isDemo);
      }
    }

    // Gate criteria awaiting my review as their DESIGNATED reviewer: evidence submitted, or a pending not-applicable proposal.
    const GC = schema.gateCriterion;
    const CA = schema.criterionAssessment;
    const toReview = await tx
      .select({ ca: CA, c: { id: GC.id, key: GC.key, description: GC.description, descriptionAr: GC.descriptionAr, reviewerRole: GC.reviewerRole }, g: { id: GD.id }, a: { status: GA.status } })
      .from(CA)
      .innerJoin(GA, and(eq(GA.id, CA.assessmentId), eq(GA.projectId, CA.projectId)))
      .innerJoin(GC, and(eq(GC.id, CA.criterionId), eq(GC.projectId, CA.projectId)))
      .innerJoin(GD, and(eq(GD.id, GC.gateId), eq(GD.projectId, GC.projectId)))
      .where(
        and(
          inArray(CA.projectId, pids),
          eq(GA.isCurrent, true),
          inArray(GA.status, [...CRITERION_EDITABLE_GATE_STATUSES]),
          or(eq(CA.status, 'evidence_submitted'), and(eq(CA.status, 'not_applicable'), eq(CA.naApproved, false))),
        ),
      );
    const submitters = await this.gateEvidenceSubmitters(pids, toReview.map((r) => r.c.id));
    for (const { ca, c, g } of toReview) {
      const p = byId.get(ca.projectId)!;
      const viaWs = holds(p.id, c.reviewerRole) ? null : inWorkstreamRole(p.id, c.reviewerRole);
      if (!holds(p.id, c.reviewerRole) && !viaWs) continue;
      let requester: string | null;
      if (ca.status === 'not_applicable') requester = ca.naProposedBy;
      else {
        const subs = submitters.get(c.id) ?? [];
        requester = subs.length ? (me && subs.includes(me) ? me : subs[0]!) : NO_HUMAN_REQUESTER;
      }
      if (!this.s.policy.can(ctx, 'gates.assessment.review', { projectId: p.id, classification: p.classification, requesterUserId: requester, workstreamId: viaWs?.workstreamId ?? null })) continue;
      push(p, { type: 'gate_criterion_review', entityId: c.id, code: c.key, title: c.description, titleAr: c.descriptionAr, status: ca.status, dueDate: null, overdue: false, linkPath: `/projects/${p.id}/gates/${g.id}` }, p.isDemo);
    }

    // Waivers awaiting me as the waiver authority (gate criteria and readiness checks): current authority role of the target.
    const W = schema.waiver;
    const RC = schema.readinessCheck;
    const reqW = await tx
      .select({ w: W, gc: { key: GC.key, gateId: GC.gateId, waivable: GC.waivable, role: GC.waiverAuthorityRole }, rc: { code: RC.code, waivable: RC.waivable, role: RC.waiverAuthorityRole } })
      .from(W)
      .leftJoin(GC, and(eq(W.targetType, 'gate_criterion'), eq(GC.id, W.targetId), eq(GC.projectId, W.projectId)))
      .leftJoin(RC, and(eq(W.targetType, 'readiness_check'), eq(RC.id, W.targetId), eq(RC.projectId, W.projectId)))
      .where(and(inArray(W.projectId, pids), eq(W.status, 'requested')));
    for (const { w, gc, rc } of reqW) {
      const p = byId.get(w.projectId)!;
      const t = gc?.key ? { key: gc.key, waivable: gc.waivable, role: gc.role, link: `/projects/${p.id}/gates/${gc.gateId}` } : rc?.code ? { key: rc.code, waivable: rc.waivable, role: rc.role, link: `/projects/${p.id}/readiness/checks/${w.targetId}` } : null;
      if (!t || !t.waivable || !t.role || !holds(p.id, t.role)) continue;
      if (!this.s.policy.can(ctx, 'gates.waiver.approve', { projectId: p.id, classification: p.classification, requesterUserId: w.requestedBy, withinAuthority: true })) continue;
      if (!(await this.visible(ctx, p.id, 'waiver', w.id))) continue;
      push(p, { type: 'waiver_approval', entityId: w.id, code: t.key, title: w.basis, status: w.status, dueDate: w.expiresOn, overdue: isOverdue(w.expiresOn, today(p.id), true), linkPath: t.link }, w.isDemo);
    }

    // Evidence awaiting verification: active (not yet verified) or conflicting links I may verify — never evidence I linked
    // or whose document version I uploaded (not_self), and only links whose document AND target I can see.
    for (const p of projects) {
      if (!this.s.policy.canInProject(ctx, 'documents.evidence.verify', p.id)) continue;
      const vis = new RecordVisibility(this.s.policy, ctx, p.id, { reach: true, readPermission: (t) => (EVIDENCE_TARGET_READ_PERMISSION as Record<string, string>)[t] });
      const E = schema.evidenceLink;
      const rows = await tx
        .select({ e: E, title: schema.document.title, classification: schema.document.classification, uploadedBy: schema.documentVersion.uploadedBy, gateId: GC.gateId })
        .from(E)
        .leftJoin(schema.document, and(eq(schema.document.id, E.documentId), eq(schema.document.projectId, E.projectId)))
        .leftJoin(schema.documentVersion, and(eq(schema.documentVersion.id, E.documentVersionId), eq(schema.documentVersion.projectId, E.projectId)))
        .leftJoin(GC, and(eq(E.targetType, 'gate_criterion'), eq(GC.id, E.targetId), eq(GC.projectId, E.projectId)))
        .where(and(eq(E.projectId, p.id), or(and(eq(E.status, 'active'), isNull(E.reviewedBy)), eq(E.status, 'conflicting')), vis.exists('evidence_link', E.id)));
      for (const { e, title, classification, uploadedBy, gateId } of rows) {
        const attrs = { projectId: p.id, classification: (classification as Classification | null) ?? p.classification };
        if (!this.s.policy.can(ctx, 'documents.evidence.verify', { ...attrs, requesterUserId: e.addedBy })) continue;
        if (uploadedBy && !this.s.policy.can(ctx, 'documents.evidence.verify', { ...attrs, requesterUserId: uploadedBy })) continue;
        push(p, { type: 'evidence_verification', entityId: e.id, code: null, title: (title ?? e.note ?? e.purpose ?? e.targetType).slice(0, 300), status: e.status, dueDate: null, overdue: false, linkPath: evidenceLink(p.id, e, gateId) }, p.isDemo);
      }
    }

    // Committee actions reported done, awaiting my closure verification — offered only when the command would accept me
    // (SEC-P2-03 rule): not the person who reported them done (policy below), not their owner, and not a person who linked
    // their evidence or uploaded a linked version (SEC-P34R-04; the command refuses them, 403 governance.action.linker_verification).
    const acts2 = await tx
      .select({ a: A, classification: schema.decision.classification })
      .from(A)
      .leftJoin(schema.decision, and(eq(schema.decision.id, A.decisionId), eq(schema.decision.projectId, A.projectId)))
      .where(
        and(
          inArray(A.projectId, pids),
          eq(A.status, 'done_pending_verification'),
          sql`${A.ownerUserId} is distinct from ${ctx.principal.userId!}::uuid`,
          sql`not ${evidenceSelfSql(A.projectId, 'action_item', A.id, ctx.principal.userId!)}`,
        ),
      );
    for (const { a, classification } of acts2) {
      const p = byId.get(a.projectId)!;
      if (!this.s.policy.can(ctx, 'governance.action.verify_closure', { projectId: p.id, classification: (classification as Classification | null) ?? null, requesterUserId: a.reportedDoneBy, ownerUserIds: [a.ownerUserId, a.createdBy] })) continue;
      push(p, { type: 'action_closure_verification', entityId: a.id, code: a.code, title: a.title, status: a.status, dueDate: a.dueDate, overdue: false, linkPath: `/projects/${p.id}/committee/actions/${a.id}` }, a.isDemo);
    }

    // Minutes awaiting my approval (not the drafter of the current minutes version).
    const MT = schema.meeting;
    const drafts = await tx
      .select({ m: MT, classification: schema.committee.classification })
      .from(MT)
      .innerJoin(schema.committee, and(eq(schema.committee.id, MT.committeeId), eq(schema.committee.projectId, MT.projectId)))
      .where(and(inArray(MT.projectId, pids), eq(MT.status, 'minutes_draft')));
    for (const { m, classification } of drafts) {
      const p = byId.get(m.projectId)!;
      if (!this.s.policy.can(ctx, 'governance.minutes.approve', { projectId: p.id, classification: classification as Classification, requesterUserId: m.minutesDraftedBy })) continue;
      push(p, { type: 'minutes_approval', entityId: m.id, code: `#${m.number}`, title: m.title, status: m.status, dueDate: null, overdue: false, linkPath: `/projects/${p.id}/committee/meetings/${m.id}` }, m.isDemo);
    }

    // ---- REQ-UX-018 (DOM-P2-09 residual): agenda screening, external-authority recording, claim reviews. Each is offered
    // only when the command would accept the caller: the same permission, classification and separation-of-duties inputs.

    // Agenda requests awaiting screening (requested / deferred): the secretariat, never the requester (not_self).
    const AG = schema.agendaItem;
    const screening = await tx
      .select({ a: AG, classification: schema.committee.classification, meetingAt: MT.scheduledAt })
      .from(AG)
      .innerJoin(schema.committee, and(eq(schema.committee.id, AG.committeeId), eq(schema.committee.projectId, AG.projectId)))
      .leftJoin(MT, and(eq(MT.id, AG.meetingId), eq(MT.projectId, AG.projectId)))
      .where(and(inArray(AG.projectId, pids), inArray(AG.screeningStatus, ['requested', 'deferred'])));
    for (const { a, classification, meetingAt } of screening) {
      const p = byId.get(a.projectId)!;
      if (!this.s.policy.can(ctx, 'governance.agenda_request.screen', { projectId: p.id, classification: classification as Classification, requesterUserId: a.requestedBy })) continue;
      // Due by the preferred meeting's date (project timezone) when the request names one.
      const due = meetingAt ? localDate(meetingAt, p.timezone) : null;
      const link = `/projects/${p.id}/committee/meetings?aStatus=${a.screeningStatus}&aq=${encodeURIComponent(a.title.slice(0, 100))}`;
      push(p, { type: 'agenda_screening', entityId: a.id, code: null, title: a.title, status: a.screeningStatus, dueDate: due, overdue: isOverdue(due, today(p.id), true), linkPath: link }, p.isDemo);
    }

    // Recommendations whose external authority decision can be recorded: the recording role, not the requester, not the
    // recorder of the recommendation, and only once an active evidence link on the decision was verified by someone else
    // than the caller (the command refuses without it) — a link the caller can see.
    const DEC = schema.decision;
    const recommended = await tx.select().from(DEC).where(and(inArray(DEC.projectId, pids), eq(DEC.status, 'recommended')));
    const E2 = schema.evidenceLink;
    for (const d of recommended) {
      const p = byId.get(d.projectId)!;
      const attrs = { projectId: p.id, classification: d.classification as Classification };
      if (!this.s.policy.can(ctx, 'governance.decision.record_external_approval', { ...attrs, requesterUserId: d.requesterUserId })) continue;
      if (d.recommendationRecordedBy && d.recommendationRecordedBy === me) continue;
      const vis = new RecordVisibility(this.s.policy, ctx, p.id, { reach: true, readPermission: (t) => (EVIDENCE_TARGET_READ_PERMISSION as Record<string, string>)[t] });
      const links = await tx
        .select({ reviewedBy: E2.reviewedBy })
        .from(E2)
        .where(and(eq(E2.projectId, p.id), eq(E2.targetType, 'decision'), eq(E2.targetId, d.id), eq(E2.status, 'active'), isNotNull(E2.reviewedBy), vis.exists('evidence_link', E2.id)));
      if (!links.some((l) => this.s.policy.can(ctx, 'governance.decision.record_external_approval', { ...attrs, requesterUserId: l.reviewedBy }))) continue;
      push(p, { type: 'external_approval_recording', entityId: d.id, code: d.code, title: d.title, status: d.status, dueDate: d.latestSafeDate, overdue: isOverdue(d.latestSafeDate, today(p.id), true), linkPath: `/projects/${p.id}/committee/decisions/${d.id}` }, d.isDemo);
    }

    // Source claims awaiting review: never reviewed (and not confirmed), or flagged conflicting — offered to a verifier who is
    // not the claim's author (not_self; an unknown author fails closed, as in the review command).
    const SC = schema.sourceClaim;
    const SR = schema.sourceRecord;
    const claims = await tx
      .select({ c: SC, classification: SR.classification })
      .from(SC)
      .innerJoin(SR, and(eq(SR.id, SC.sourceId), eq(SR.projectId, SC.projectId)))
      .where(and(inArray(SC.projectId, pids), or(and(isNull(SC.reviewerUserId), ne(SC.verificationStatus, 'confirmed')), eq(SC.verificationStatus, 'conflicting'))));
    for (const { c, classification } of claims) {
      const p = byId.get(c.projectId)!;
      if (!this.s.policy.can(ctx, 'documents.claim.verify', { projectId: p.id, classification: classification as Classification, requesterUserId: c.createdBy })) continue;
      push(p, { type: 'claim_review', entityId: c.id, code: null, title: c.subject, status: c.verificationStatus, dueDate: null, overdue: false, linkPath: `/projects/${p.id}/documents/sources/${c.sourceId}` }, c.isDemo);
    }

    items.sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.type.localeCompare(b.type) || a.title.localeCompare(b.title));
    const counts: Record<string, number> = {};
    for (const i of items) counts[i.type] = (counts[i.type] ?? 0) + 1;
    return { items, counts, generatedAt: new Date().toISOString() };
  }

  /** Users who added the active evidence of each gate criterion (the not_self subjects of a criterion review). */
  private async gateEvidenceSubmitters(pids: string[], criterionIds: string[]): Promise<Map<string, string[]>> {
    if (!criterionIds.length) return new Map();
    const E = schema.evidenceLink;
    const rows = await this.s.db
      .tx()
      .selectDistinct({ targetId: E.targetId, addedBy: E.addedBy })
      .from(E)
      .where(and(inArray(E.projectId, pids), eq(E.targetType, 'gate_criterion'), inArray(E.targetId, criterionIds), eq(E.status, 'active')));
    const out = new Map<string, string[]>();
    for (const r of rows) out.set(r.targetId, [...(out.get(r.targetId) ?? []), r.addedBy]);
    return out;
  }

  /** Record-level visibility of one record (RecordVisibility: target / parent visibility and workstream reach). */
  private async visible(ctx: RequestContext, projectId: string, type: string, id: string): Promise<boolean> {
    const vis = new RecordVisibility(this.s.policy, ctx, projectId, { reach: true, readPermission: (t) => (EVIDENCE_TARGET_READ_PERMISSION as Record<string, string>)[t] });
    const r = await this.s.db.tx().execute<{ ok: boolean }>(sql`select ${vis.exists(type, sql`${id}::uuid`)} as ok`);
    return r.rows[0]?.ok === true;
  }
}

/** Where a verifier reviews a piece of evidence: its document, else the record it supports. */
function evidenceLink(pid: string, e: { documentId: string | null; targetType: string; targetId: string }, gateId: string | null): string {
  if (e.documentId) return `/projects/${pid}/documents/${e.documentId}`;
  switch (e.targetType) {
    case 'gate_criterion':
      return gateId ? `/projects/${pid}/gates/${gateId}` : `/projects/${pid}/gates`;
    case 'task':
      return `/projects/${pid}/plan/tasks/${e.targetId}`;
    case 'deliverable':
      return `/projects/${pid}/plan/deliverables/${e.targetId}`;
    case 'milestone':
      return `/projects/${pid}/plan/milestones/${e.targetId}`;
    case 'decision':
      return `/projects/${pid}/committee/decisions/${e.targetId}`;
    case 'action_item':
      return `/projects/${pid}/committee/actions/${e.targetId}`;
    case 'readiness_check':
      return `/projects/${pid}/readiness/checks/${e.targetId}`;
    default:
      return `/projects/${pid}/documents`;
  }
}

import { Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { schema } from '@hub/db';
import { Classification, isOverdue } from '@hub/domain';
import type { MY_WORK_TYPES } from '@hub/contracts';
import type { RequestContext } from '../../platform/context';
import { isFullScope } from '../../platform/context';
import { PlanningSupport, ProjectInfo } from './planning-support';

type WorkType = (typeof MY_WORK_TYPES)[number];
interface Item {
  type: WorkType;
  projectId: string;
  projectCode: string;
  entityId: string;
  code: string | null;
  title: string;
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
  constructor(private readonly s: PlanningSupport) {}

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
    const can = (perm: string, pid: string, attrs: { workstreamId?: string | null; requesterUserId?: string | null; classification?: Classification } = {}) =>
      this.s.policy.can(ctx, perm, { projectId: pid, classification: attrs.classification ?? byId.get(pid)!.classification, workstreamId: attrs.workstreamId ?? null, requesterUserId: attrs.requesterUserId ?? null });

    // Tasks I am accountable for (open)
    const T = schema.task;
    const mine = await tx.select().from(T).where(and(inArray(T.projectId, pids), eq(T.accountableUserId, me), inArray(T.status, ['not_started', 'in_progress', 'blocked'])));
    for (const t of mine) {
      const due = t.plannedFinish ?? t.forecastFinish;
      push(byId.get(t.projectId)!, { type: 'task_accountable', entityId: t.id, code: t.wbsCode, title: t.title, status: t.status, dueDate: due, overdue: isOverdue(due, today(t.projectId), true), linkPath: `/projects/${t.projectId}/plan/tasks/${t.id}` }, t.isDemo);
    }
    // Tasks awaiting my acceptance
    const subT = await tx.select().from(T).where(and(inArray(T.projectId, pids), eq(T.status, 'submitted_for_acceptance')));
    for (const t of subT) {
      if (!can('planning.deliverable.accept', t.projectId, { workstreamId: t.workstreamId, requesterUserId: t.submittedBy })) continue;
      push(byId.get(t.projectId)!, { type: 'task_acceptance', entityId: t.id, code: t.wbsCode, title: t.title, status: t.status, dueDate: t.plannedFinish, overdue: false, linkPath: `/projects/${t.projectId}/plan/tasks/${t.id}` }, t.isDemo);
    }
    // Deliverables awaiting my acceptance
    const D = schema.deliverable;
    const subD = await tx.select().from(D).where(and(inArray(D.projectId, pids), eq(D.status, 'submitted')));
    for (const d of subD) {
      if (!can('planning.deliverable.accept', d.projectId, { workstreamId: d.workstreamId, requesterUserId: d.submittedBy })) continue;
      push(byId.get(d.projectId)!, { type: 'deliverable_acceptance', entityId: d.id, code: d.code, title: d.title, status: d.status, dueDate: d.dueDate, overdue: isOverdue(d.dueDate, today(d.projectId), true), linkPath: `/projects/${d.projectId}/plan/deliverables/${d.id}` }, d.isDemo);
    }
    // Milestones awaiting evidence verification
    const M = schema.milestone;
    const pendM = await tx.select().from(M).where(and(inArray(M.projectId, pids), eq(M.status, 'achieved_pending_evidence')));
    for (const m of pendM) {
      if (!can('planning.deliverable.accept', m.projectId, { workstreamId: m.workstreamId, requesterUserId: m.reportedBy })) continue;
      push(byId.get(m.projectId)!, { type: 'milestone_verification', entityId: m.id, code: m.code, title: m.title, status: m.status, dueDate: m.plannedDate, overdue: false, linkPath: `/projects/${m.projectId}/plan/milestones/${m.id}` }, m.isDemo);
    }
    // Status updates to review
    const U = schema.statusUpdate;
    const subU = await tx.select().from(U).where(and(inArray(U.projectId, pids), eq(U.status, 'submitted')));
    const wsCodes = new Map<string, string>();
    for (const w of await tx.select({ id: schema.workstream.id, code: schema.workstream.code }).from(schema.workstream).where(inArray(schema.workstream.projectId, pids))) wsCodes.set(w.id, w.code);
    for (const u of subU) {
      if (!can('planning.status_update.review', u.projectId, { workstreamId: u.workstreamId, requesterUserId: u.submittedBy })) continue;
      const label = u.workstreamId ? (wsCodes.get(u.workstreamId) ?? 'Workstream') : 'Project';
      push(byId.get(u.projectId)!, { type: 'status_update_review', entityId: u.id, code: label, title: `${label} update — period ending ${u.periodEnd}`, status: u.status, dueDate: null, overdue: false, linkPath: `/projects/${u.projectId}/plan/updates/${u.id}` }, u.isDemo);
    }
    // RAG overrides to review
    const O = schema.ragOverride;
    const pendO = await tx.select().from(O).where(and(inArray(O.projectId, pids), isNull(O.reviewedAt)));
    for (const o of pendO) {
      if (!can('planning.rag_override.review', o.projectId, { workstreamId: o.entityType === 'workstream' ? o.entityId : null, requesterUserId: o.requestedBy })) continue;
      const label = o.entityType === 'workstream' ? (wsCodes.get(o.entityId) ?? 'Workstream') : 'Project';
      push(byId.get(o.projectId)!, { type: 'rag_override_review', entityId: o.id, code: label, title: `RAG override to ${o.overrideStatus} (calculated ${o.calculatedStatus}) — ${label}`, status: 'pending', dueDate: o.expiresOn, overdue: false, linkPath: `/projects/${o.projectId}/plan?tab=health` }, o.isDemo);
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
      push(p, { type: 'baseline_approval', entityId: b.id, code: `BL v${b.versionNo}`, title: `Baseline version ${b.versionNo} awaiting approval`, status: 'proposed', dueDate: null, overdue: false, linkPath: `/projects/${b.projectId}/plan/baselines/${b.id}` }, p.isDemo);
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
       where d.project_id in (${sql.join(pids.map((x) => sql`${x}::uuid`), sql`, `)})
         and d.status = 'under_review'
         and cm.valid_from <= current_date and (cm.valid_to is null or cm.valid_to >= current_date)
         and not exists (select 1 from recusal r where r.decision_id = d.id and r.user_id = ${me})
         and not exists (select 1 from vote v where v.decision_id = d.id and v.user_id = ${me} and v.round = d.vote_round)`);
    const seen = new Set<string>();
    for (const d of votes.rows) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      if (!can('governance.decision.vote', d.project_id, { classification: d.classification, requesterUserId: d.requester_user_id })) continue;
      push(byId.get(d.project_id)!, { type: 'decision_vote', entityId: d.id, code: d.code, title: d.title, status: d.status, dueDate: d.latest_safe_date, overdue: isOverdue(d.latest_safe_date, today(d.project_id), true), linkPath: `/projects/${d.project_id}/committee/decisions/${d.id}` }, d.is_demo);
    }

    items.sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.type.localeCompare(b.type) || a.title.localeCompare(b.title));
    const counts: Record<string, number> = {};
    for (const i of items) counts[i.type] = (counts[i.type] ?? 0) + 1;
    return { items, counts, generatedAt: new Date().toISOString() };
  }
}

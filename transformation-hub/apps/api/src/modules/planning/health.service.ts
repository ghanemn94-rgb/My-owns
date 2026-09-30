import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, isNull, sql, SQL } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  STATUS_UPDATE_MACHINE,
  UpdateStatus,
  RagStatus,
  DEFAULT_RAG_THRESHOLDS,
  RAG_OVERRIDE_MAX_DAYS,
  allowedCommands,
  transition,
  ruleViolation,
  conflict,
  invalid,
  weightedProgress,
  calculateRag,
  aggregateRag,
  effectiveRag,
  capOverrideAtOpenBlockers,
  deliverableProgressItem,
  latestDate,
  updateFreshnessDate,
  addCalendarDays,
  localDate,
  isBlockingIssue,
  RaidStatus,
  DeliverableStatus,
  RagResult,
} from '@hub/domain';
import type { z } from 'zod';
import type { StatusUpdateListQuery, CreateStatusUpdateBody, UpdateStatusUpdateBody, CreateRagOverrideBody } from '@hub/contracts';
import { AuditService } from '../../platform/audit.service';
import { OutboxService } from '../../platform/outbox.service';
import { RecordVersionService, updateVersioned, loadInProject, pageOf, offsetOf } from '../../platform/helpers';
import { orderBySort } from '../../platform/sort';
import type { RequestContext } from '../../platform/context';
import { newId } from '../../platform/ids';
import { PlanningSupport, ProjectInfo } from './planning-support';
import { ScheduleService } from './schedule.service';
import type { BaselineSnapshot } from './change-control.service';

type StatusUpdate = typeof schema.statusUpdate.$inferSelect;
type Override = typeof schema.ragOverride.$inferSelect;

export interface WorkstreamHealth {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  leadName: string | null;
  progress: ReturnType<typeof weightedProgress>;
  rag: { calculated: RagResult; effective: RagStatus; overridden: boolean; overrideExpired: boolean; explanation: string; reported: RagStatus | null };
  baselineFinish: string | null;
  forecastFinish: string | null;
  lastAcceptedUpdate: { id: string; periodEnd: string; acceptedAt: string } | null;
  openBlockers: { id: string; type: 'task' | 'issue'; code: string; title: string }[];
  taskCounts: Record<string, number>;
  reportedProgressAvg: number | null;
  dataQuality: string[];
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/**
 * Measurement (spec §9 rules 1–8): weighted progress on approved deliverable weights, calculated RAG (configurable
 * thresholds; unknown/stale/not-updated never green; open blockers red), worst-of aggregation that never hides a red
 * critical item, manual overrides with reason/expiry/reviewer (calculated value retained), and periodic updates whose
 * accepted versions are frozen.
 */
@Injectable()
export class HealthService {
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
  // Health computation

  private async latestApprovedOverrides(projectId: string) {
    const rows = await this.tx
      .select()
      .from(schema.ragOverride)
      .where(and(eq(schema.ragOverride.projectId, projectId), eq(schema.ragOverride.approved, true)))
      .orderBy(desc(schema.ragOverride.reviewedAt));
    const m = new Map<string, Override>();
    for (const r of rows) if (!m.has(`${r.entityType}:${r.entityId}`)) m.set(`${r.entityType}:${r.entityId}`, r);
    return m;
  }

  /**
   * Computes health for every workstream and the project. `assume` lets a status update being submitted/accepted be
   * treated as the latest accepted update (so the frozen snapshot reflects the state at acceptance).
   */
  async computeHealth(p: ProjectInfo, assume?: { workstreamId: string | null; periodEnd: string; ragReported: RagStatus | null }) {
    const today = this.s.today(p);
    const cal = await this.s.calendar(p);
    const thresholds = DEFAULT_RAG_THRESHOLDS;
    const workstreams = await this.tx.select().from(schema.workstream).where(eq(schema.workstream.projectId, p.id)).orderBy(asc(schema.workstream.sortOrder));
    const names = await this.s.userNames(workstreams.map((w) => w.leadUserId));
    const tasks = await this.tx
      .select({ id: schema.task.id, code: schema.task.wbsCode, title: schema.task.title, ws: schema.task.workstreamId, status: schema.task.status, plannedFinish: schema.task.plannedFinish, forecastFinish: schema.task.forecastFinish, actualFinish: schema.task.actualFinish, progress: schema.task.reportedProgress, owner: schema.task.accountableUserId, duration: schema.task.durationDays })
      .from(schema.task)
      .where(eq(schema.task.projectId, p.id));
    const milestones = await this.tx.select().from(schema.milestone).where(eq(schema.milestone.projectId, p.id));
    const deliverables = await this.tx.select().from(schema.deliverable).where(eq(schema.deliverable.projectId, p.id));
    const issues = await this.tx
      .select({ id: schema.issue.id, code: schema.issue.code, title: schema.issue.title, ws: schema.issue.workstreamId, status: schema.issue.status, severity: schema.issue.severity })
      .from(schema.issue)
      .where(eq(schema.issue.projectId, p.id));
    const baseline = await this.s.currentBaselineRow(p.id);
    const snap = (baseline?.snapshot ?? null) as BaselineSnapshot | null;
    const accepted = await this.tx
      .select()
      .from(schema.statusUpdate)
      .where(and(eq(schema.statusUpdate.projectId, p.id), eq(schema.statusUpdate.status, 'accepted')))
      .orderBy(desc(schema.statusUpdate.reviewedAt));
    const lastByWs = new Map<string, StatusUpdate>();
    for (const u of accepted) {
      const k = u.workstreamId ?? 'project';
      if (!lastByWs.has(k)) lastByWs.set(k, u);
    }
    const overrides = await this.latestApprovedOverrides(p.id);

    const freshness = (wsKey: string) => {
      if (assume && (assume.workstreamId ?? 'project') === wsKey) return { date: updateFreshnessDate(assume.periodEnd, today), reported: assume.ragReported, update: null as StatusUpdate | null };
      const u = lastByWs.get(wsKey);
      if (!u) return { date: null, reported: null, update: null };
      return { date: updateFreshnessDate(u.periodEnd, localDate(u.reviewedAt ?? u.updatedAt, p.timezone)), reported: (u.ragReported as RagStatus | null) ?? null, update: u };
    };

    const active = (st: string) => st !== 'draft' && st !== 'cancelled';
    const out: WorkstreamHealth[] = [];
    for (const w of workstreams) {
      const wt = tasks.filter((t) => t.ws === w.id);
      const wm = milestones.filter((m) => m.workstreamId === w.id);
      const wd = deliverables.filter((d) => d.workstreamId === w.id);
      const progress = weightedProgress(wd.map((d) => deliverableProgressItem({ id: d.id, code: d.code, title: d.title, status: d.status as DeliverableStatus, weight: d.weight, weightApproved: d.weightApproved })));
      const dq: string[] = [];
      // Baseline finish: latest planned finish among this workstream's baselined items (undated items flagged).
      let baselineFinish: string | null = null;
      if (snap) {
        const dates = [...snap.tasks.filter((t) => t.workstreamId === w.id).map((t) => t.plannedFinish), ...snap.milestones.filter((m) => m.workstreamId === w.id).map((m) => m.plannedDate)];
        baselineFinish = latestDate(dates, false);
        const undated = dates.filter((d) => !d).length;
        if (undated > 0) dq.push(`${undated} baselined item(s) have no planned finish`);
      } else dq.push('No approved baseline');
      const fDates = [
        ...wt.filter((t) => active(t.status)).map((t) => t.actualFinish ?? t.forecastFinish ?? t.plannedFinish),
        ...wm.filter((m) => m.status !== 'cancelled').map((m) => m.actualDate ?? m.forecastDate ?? m.plannedDate),
      ];
      const forecastFinish = latestDate(fDates, false);
      const blockers = [
        ...wt.filter((t) => t.status === 'blocked').map((t) => ({ id: t.id, type: 'task' as const, code: t.code, title: t.title })),
        ...issues.filter((i) => i.ws === w.id && isBlockingIssue({ status: i.status as RaidStatus, severity: i.severity })).map((i) => ({ id: i.id, type: 'issue' as const, code: i.code, title: i.title })),
      ];
      const f = freshness(w.id);
      const calc = calculateRag({ baselineFinish, forecastFinish, lastUpdatedOn: f.date, today, hasOpenBlocker: blockers.length > 0, thresholds, calendar: cal });
      const ov = overrides.get(`workstream:${w.id}`) ?? null;
      const eff = effectiveRag(calc, ov ? { overrideStatus: ov.overrideStatus as RagStatus, reason: ov.reason, expiresOn: ov.expiresOn, reviewerUserId: ov.reviewerUserId, approved: ov.approved } : null, today);
      const counts: Record<string, number> = {};
      for (const t of wt) counts[t.status] = (counts[t.status] ?? 0) + 1;
      const act = wt.filter((t) => active(t.status));
      if (!w.leadUserId) dq.push('No accountable workstream lead');
      const noOwner = act.filter((t) => !t.owner).length;
      if (noOwner) dq.push(`${noOwner} active task(s) without an accountable owner`);
      const noDur = act.filter((t) => t.duration === null).length;
      if (noDur) dq.push(`${noDur} active task(s) without a duration`);
      const undatedActive = act.filter((t) => !(t.actualFinish ?? t.forecastFinish ?? t.plannedFinish)).length;
      if (undatedActive) dq.push(`${undatedActive} active task(s) without planned/forecast finish`);
      const unapproved = wd.filter((d) => d.status !== 'cancelled' && !d.weightApproved).length;
      if (unapproved) dq.push(`${unapproved} deliverable weight(s) not approved`);
      out.push({
        id: w.id,
        code: w.code,
        name: w.name,
        nameAr: w.nameAr,
        leadName: w.leadUserId ? (names.get(w.leadUserId) ?? null) : null,
        progress,
        rag: { calculated: calc, effective: eff.effective, overridden: eff.overridden, overrideExpired: eff.overrideExpired, explanation: eff.explanation, reported: f.reported },
        baselineFinish,
        forecastFinish,
        lastAcceptedUpdate: f.update ? { id: f.update.id, periodEnd: f.update.periodEnd, acceptedAt: f.update.reviewedAt!.toISOString() } : null,
        openBlockers: blockers,
        taskCounts: counts,
        reportedProgressAvg: act.length ? Math.round((act.reduce((a, t) => a + t.progress, 0) / act.length) * 10) / 10 : null,
        dataQuality: dq,
      });
    }

    // Project level: worst-of (effective) workstreams + critical milestones; red critical items listed explicitly.
    // A manual override changes the displayed (effective) status, but an open blocker is never concealed from the
    // aggregate (measurement rule 3): workstreams with open blockers always count — and are listed — as red critical.
    const items: { id: string; status: RagStatus; critical?: boolean }[] = out.map((w) => ({ id: w.id, status: w.openBlockers.length > 0 ? 'red' : w.rag.effective, critical: w.openBlockers.length > 0 }));
    const redCritical: { id: string; type: 'workstream' | 'milestone'; label: string; reason: string }[] = [];
    for (const w of out) {
      if (w.rag.effective !== 'red' && w.openBlockers.length === 0) continue;
      const overridden = w.rag.overridden && w.rag.effective !== 'red' ? ` (manual override to ${w.rag.effective} does not hide the blocker)` : '';
      redCritical.push({ id: w.id, type: 'workstream', label: `${w.code} ${w.name}`, reason: `${w.rag.calculated.explanation}${overridden}` });
    }
    for (const m of milestones.filter((x) => x.isCritical && x.status !== 'cancelled')) {
      const overdue = ['planned', 'at_risk'].includes(m.status) && !!m.plannedDate && m.plannedDate < today;
      if (m.status === 'missed' || overdue) {
        items.push({ id: m.id, status: 'red', critical: true });
        redCritical.push({ id: m.id, type: 'milestone', label: `${m.code} ${m.title}`, reason: m.status === 'missed' ? 'Critical milestone missed' : `Critical milestone overdue (planned ${m.plannedDate})` });
      } else if (m.status === 'at_risk') items.push({ id: m.id, status: 'amber', critical: true });
    }
    const agg = aggregateRag(items);
    const projCalc: RagResult = { status: agg.status, explanation: agg.explanation, slipDays: null };
    const pov = overrides.get(`project:${p.id}`) ?? null;
    // DOM-P2-10: the project override is capped at red while a red critical item (open blocker, critical milestone) is open.
    const peff = capOverrideAtOpenBlockers(
      effectiveRag(projCalc, pov ? { overrideStatus: pov.overrideStatus as RagStatus, reason: pov.reason, expiresOn: pov.expiresOn, reviewerUserId: pov.reviewerUserId, approved: pov.approved } : null, today),
      agg.redCritical.length,
    );
    const pf = freshness('project');
    const dataQualityIssues: { id: string; label: string; issue: string }[] = [];
    for (const w of out) if (['unknown', 'stale', 'not_updated'].includes(w.rag.calculated.status)) dataQualityIssues.push({ id: w.id, label: `${w.code} ${w.name}`, issue: w.rag.calculated.explanation });
    if (!baseline) dataQualityIssues.push({ id: p.id, label: p.code, issue: 'No approved baseline — variance cannot be measured' });
    const sched = await this.schedule.compute(p);
    if (sched.result.status !== 'complete') dataQualityIssues.push({ id: p.id, label: p.code, issue: `Schedule ${sched.result.status}: ${sched.result.issues.length} issue(s) (e.g. ${sched.result.issues[0]?.message ?? 'n/a'})` });
    const projectProgress = weightedProgress(deliverables.map((d) => deliverableProgressItem({ id: d.id, code: d.code, title: d.title, status: d.status as DeliverableStatus, weight: d.weight, weightApproved: d.weightApproved })));
    return {
      today,
      thresholds,
      baseline: baseline ? { id: baseline.id, versionNo: baseline.versionNo } : null,
      project: {
        progress: projectProgress,
        rag: { calculated: projCalc, effective: peff.effective, overridden: peff.overridden, overrideExpired: peff.overrideExpired, explanation: peff.explanation, reported: pf.reported },
        aggregate: { status: agg.status, explanation: agg.explanation },
        redCritical,
        dataQualityIssues,
      },
      workstreams: out,
    };
  }

  async progress(ctx: RequestContext, projectId: string) {
    const p = await this.s.project(ctx, projectId);
    this.s.assertProjectRead(ctx, p);
    return this.computeHealth(p);
  }

  // =========================================================================================================
  // Periodic status updates

  private async updateDtos(p: ProjectInfo, rows: StatusUpdate[]) {
    const ws = await this.s.workstreamCodes(p.id);
    const names = await this.s.userNames(rows.flatMap((r) => [r.submittedBy, r.reviewedBy]));
    return rows.map((u) => ({
      id: u.id,
      workstreamId: u.workstreamId,
      workstreamCode: u.workstreamId ? (ws.get(u.workstreamId)?.code ?? null) : null,
      periodEnd: u.periodEnd,
      summary: u.summary,
      achievements: u.achievements,
      nextSteps: u.nextSteps,
      blockers: u.blockers,
      ragReported: (u.ragReported as RagStatus | null) ?? null,
      ragCalculated: (u.ragCalculated as RagStatus | null) ?? null,
      status: u.status as UpdateStatus,
      submittedBy: u.submittedBy,
      submittedByName: u.submittedBy ? (names.get(u.submittedBy) ?? null) : null,
      submittedAt: iso(u.submittedAt),
      reviewedBy: u.reviewedBy,
      reviewedByName: u.reviewedBy ? (names.get(u.reviewedBy) ?? null) : null,
      reviewedAt: iso(u.reviewedAt),
      reviewNote: u.reviewNote,
      frozenSnapshot: (u.frozenSnapshot as Record<string, unknown> | null) ?? null,
      allowedCommands: allowedCommands(STATUS_UPDATE_MACHINE, u.status as UpdateStatus),
      isDemo: u.isDemo,
      createdAt: u.createdAt.toISOString(),
      version: u.version,
    }));
  }

  async listStatusUpdates(ctx: RequestContext, projectId: string, q: z.infer<typeof StatusUpdateListQuery>) {
    const p = await this.s.project(ctx, projectId);
    const U = schema.statusUpdate;
    const conds: SQL[] = [eq(U.projectId, projectId), this.s.scopeSql(ctx, p, U.workstreamId)];
    if (q.workstreamId) conds.push(eq(U.workstreamId, q.workstreamId));
    if (q.status) conds.push(inArray(U.status, q.status));
    if (q.q) conds.push(sql`${U.summary} ilike ${'%' + q.q + '%'}`);
    const where = and(...conds);
    const [{ n }] = (await this.tx.select({ n: count() }).from(U).where(where)) as [{ n: number }];
    const order = orderBySort(q.sort, { periodEnd: U.periodEnd, status: U.status, submittedAt: U.submittedAt, createdAt: U.createdAt }, U.id, [desc(U.periodEnd), desc(U.createdAt), desc(U.id)]);
    const rows = await this.tx.select().from(U).where(where).orderBy(...order).limit(q.pageSize).offset(offsetOf(q));
    return pageOf(await this.updateDtos(p, rows), Number(n), q);
  }

  async getStatusUpdate(ctx: RequestContext, projectId: string, id: string) {
    const p = await this.s.project(ctx, projectId);
    const u = await loadInProject(this.s.db, schema.statusUpdate, projectId, id);
    this.s.assertReadable(ctx, p, u.workstreamId);
    return (await this.updateDtos(p, [u]))[0]!;
  }

  private assertPeriodEnd(p: ProjectInfo, periodEnd: string) {
    const max = addCalendarDays(this.s.today(p), 7);
    if (periodEnd > max) throw ruleViolation('status_update.period_in_future', 'The reporting period cannot end more than 7 days from today');
  }

  async createStatusUpdate(ctx: RequestContext, projectId: string, body: z.infer<typeof CreateStatusUpdateBody>) {
    const p = await this.s.project(ctx, projectId);
    if (body.workstreamId) await loadInProject(this.s.db, schema.workstream, projectId, body.workstreamId);
    this.s.assert(ctx, 'planning.status_update.submit', p, { workstreamId: body.workstreamId ?? null, ownerUserIds: [ctx.principal.userId] });
    this.assertPeriodEnd(p, body.periodEnd);
    const id = newId();
    await this.tx.insert(schema.statusUpdate).values({
      id,
      orgId: ctx.principal.orgId,
      projectId,
      workstreamId: body.workstreamId ?? null,
      periodEnd: body.periodEnd,
      summary: body.summary,
      achievements: body.achievements ?? null,
      nextSteps: body.nextSteps ?? null,
      blockers: body.blockers ?? null,
      ragReported: body.ragReported ?? null,
      status: 'draft',
      isDemo: p.isDemo,
      createdBy: ctx.principal.userId,
    });
    await this.audit.record({ action: 'planning.status_update.create', entityType: 'status_update', entityId: id, projectId, after: { workstreamId: body.workstreamId ?? null, periodEnd: body.periodEnd } });
    return { id, version: 1 };
  }

  async updateStatusUpdate(ctx: RequestContext, projectId: string, id: string, body: z.infer<typeof UpdateStatusUpdateBody>) {
    const p = await this.s.project(ctx, projectId);
    const u = await loadInProject(this.s.db, schema.statusUpdate, projectId, id);
    this.s.assert(ctx, 'planning.status_update.submit', p, { workstreamId: u.workstreamId, ownerUserIds: [u.createdBy, u.submittedBy] });
    this.s.assertVersion(u, body.expectedVersion, 'status update');
    if (!['draft', 'returned'].includes(u.status)) throw ruleViolation('status_update.frozen', 'Submitted or accepted updates cannot be edited');
    const c: Partial<typeof schema.statusUpdate.$inferInsert> = {};
    if (body.periodEnd !== undefined) {
      this.assertPeriodEnd(p, body.periodEnd);
      c.periodEnd = body.periodEnd;
    }
    if (body.summary !== undefined) c.summary = body.summary;
    if (body.achievements !== undefined) c.achievements = body.achievements;
    if (body.nextSteps !== undefined) c.nextSteps = body.nextSteps;
    if (body.blockers !== undefined) c.blockers = body.blockers;
    if (body.ragReported !== undefined) c.ragReported = body.ragReported;
    if (Object.keys(c).length === 0) throw invalid('planning.no_changes', 'No changes supplied');
    const row = await updateVersioned(this.s.db, schema.statusUpdate, { id, projectId, expectedVersion: body.expectedVersion }, c);
    await this.audit.record({ action: 'planning.status_update.update', entityType: 'status_update', entityId: id, projectId, after: c as Record<string, unknown> });
    return { id, version: row['version'] as number };
  }

  private healthFor(h: Awaited<ReturnType<HealthService['computeHealth']>>, workstreamId: string | null) {
    if (!workstreamId) return { scope: 'project', progress: h.project.progress, rag: h.project.rag, redCritical: h.project.redCritical, dataQualityIssues: h.project.dataQualityIssues };
    const w = h.workstreams.find((x) => x.id === workstreamId)!;
    return { scope: 'workstream', ...w };
  }

  async statusUpdateCommand(ctx: RequestContext, projectId: string, id: string, command: 'submit' | 'return' | 'accept', body: { expectedVersion: number; note?: string; reason?: string }) {
    const p = await this.s.project(ctx, projectId);
    const u = await this.s.lockInProject(schema.statusUpdate, projectId, id);
    if (command === 'submit') this.s.assert(ctx, 'planning.status_update.submit', p, { workstreamId: u.workstreamId, ownerUserIds: [u.createdBy, u.submittedBy] });
    // Review by someone other than the submitter (not_self) — after the state check (I-R3).
    else this.s.assertApproval(ctx, 'planning.status_update.review', p, { workstreamId: u.workstreamId, requesterUserId: u.submittedBy }, () => transition('status_update', STATUS_UPDATE_MACHINE, u.status as UpdateStatus, command));
    this.s.assertVersion(u, body.expectedVersion, 'status update');
    const to = transition('status_update', STATUS_UPDATE_MACHINE, u.status as UpdateStatus, command);
    const extra: Partial<typeof schema.statusUpdate.$inferInsert> = {};
    if (command === 'submit') {
      const h = await this.computeHealth(p, { workstreamId: u.workstreamId, periodEnd: u.periodEnd, ragReported: (u.ragReported as RagStatus | null) ?? null });
      extra.submittedBy = ctx.principal.userId;
      extra.submittedAt = new Date();
      extra.ragCalculated = (u.workstreamId ? h.workstreams.find((w) => w.id === u.workstreamId)!.rag.calculated.status : h.project.rag.calculated.status) as RagStatus;
    } else {
      extra.reviewedBy = ctx.principal.userId;
      extra.reviewedAt = new Date();
      extra.reviewNote = body.reason ?? body.note ?? null;
      if (command === 'accept') {
        // Freeze the metrics as reported at acceptance (historical reporting version, never recalculated).
        const h = await this.computeHealth(p, { workstreamId: u.workstreamId, periodEnd: u.periodEnd, ragReported: (u.ragReported as RagStatus | null) ?? null });
        const hs = this.healthFor(h, u.workstreamId);
        extra.ragCalculated = (u.workstreamId ? h.workstreams.find((w) => w.id === u.workstreamId)!.rag.calculated.status : h.project.rag.calculated.status) as RagStatus;
        extra.frozenSnapshot = JSON.parse(JSON.stringify({ computedAt: new Date().toISOString(), today: h.today, thresholds: h.thresholds, baseline: h.baseline, ...hs }));
      }
    }
    const row = await updateVersioned(this.s.db, schema.statusUpdate, { id, projectId, expectedVersion: body.expectedVersion }, { ...extra, status: to });
    await this.audit.record({ action: `planning.status_update.${command}`, entityType: 'status_update', entityId: id, projectId, before: { status: u.status }, after: { status: to, ragCalculated: extra.ragCalculated ?? u.ragCalculated }, reason: body.reason ?? body.note ?? null });
    if (command === 'submit') await this.outbox.emit({ type: 'approval.pending', projectId, aggregateType: 'status_update', aggregateId: id, payload: { kind: 'status_update_review', workstreamId: u.workstreamId } });
    if (command === 'accept') await this.versions.snapshot({ projectId, entityType: 'status_update', entityId: id, versionNo: row['version'] as number, snapshot: row, reason: 'accepted (frozen)' });
    return { id, status: to as string, version: row['version'] as number };
  }

  // =========================================================================================================
  // RAG overrides

  private overrideState(o: Override, today: string): 'pending' | 'approved' | 'rejected' | 'expired' {
    if (!o.reviewedAt) return 'pending';
    if (!o.approved) return 'rejected';
    return o.expiresOn < today ? 'expired' : 'approved';
  }

  async listRagOverrides(ctx: RequestContext, projectId: string, q: { state?: 'pending' | 'approved' | 'rejected' | 'expired' }) {
    const p = await this.s.project(ctx, projectId);
    this.s.assertProjectRead(ctx, p);
    const rows = await this.tx.select().from(schema.ragOverride).where(eq(schema.ragOverride.projectId, projectId)).orderBy(desc(schema.ragOverride.createdAt));
    const today = this.s.today(p);
    const h = rows.length ? await this.computeHealth(p) : null;
    const names = await this.s.userNames(rows.flatMap((r) => [r.requestedBy, r.reviewerUserId]));
    const items = rows
      .map((o) => {
        const w = o.entityType === 'workstream' ? h!.workstreams.find((x) => x.id === o.entityId) : null;
        const cur = o.entityType === 'workstream' ? w?.rag : h!.project.rag;
        return {
          id: o.id,
          entityType: o.entityType as 'workstream' | 'project',
          entityId: o.entityId,
          entityLabel: o.entityType === 'workstream' ? (w ? `${w.code} ${w.name}` : '?') : p.code,
          calculatedAtRequest: o.calculatedStatus as RagStatus,
          overrideStatus: o.overrideStatus as RagStatus,
          reason: o.reason,
          expiresOn: o.expiresOn,
          requestedBy: o.requestedBy,
          requestedByName: names.get(o.requestedBy) ?? null,
          reviewerUserId: o.reviewerUserId,
          reviewerName: o.reviewerUserId ? (names.get(o.reviewerUserId) ?? null) : null,
          reviewedAt: iso(o.reviewedAt),
          reviewNote: o.reviewNote,
          state: this.overrideState(o, today),
          current: { calculated: (cur?.calculated.status ?? 'unknown') as RagStatus, effective: (cur?.effective ?? 'unknown') as RagStatus, overridden: cur?.overridden ?? false, explanation: cur?.explanation ?? '' },
          isDemo: o.isDemo,
          version: o.version,
        };
      })
      .filter((x) => !q.state || x.state === q.state);
    return { items };
  }

  async requestRagOverride(ctx: RequestContext, projectId: string, body: z.infer<typeof CreateRagOverrideBody>) {
    const p = await this.s.project(ctx, projectId);
    let workstreamId: string | null = null;
    if (body.entityType === 'workstream') {
      const w = await loadInProject(this.s.db, schema.workstream, projectId, body.entityId);
      workstreamId = w.id;
    } else if (body.entityId !== projectId) {
      throw invalid('rag_override.project_mismatch', 'For a project-level override the entity must be this project');
    }
    this.s.assert(ctx, 'planning.rag_override.set', p, { workstreamId });
    const today = this.s.today(p);
    if (body.expiresOn <= today) throw ruleViolation('rag_override.expiry_in_past', 'The override must expire after today');
    if (body.expiresOn > addCalendarDays(today, RAG_OVERRIDE_MAX_DAYS)) throw ruleViolation('rag_override.expiry_too_far', `Overrides may last at most ${RAG_OVERRIDE_MAX_DAYS} days`);
    const [pending] = await this.tx
      .select({ id: schema.ragOverride.id })
      .from(schema.ragOverride)
      .where(and(eq(schema.ragOverride.projectId, projectId), eq(schema.ragOverride.entityType, body.entityType), eq(schema.ragOverride.entityId, body.entityId), isNull(schema.ragOverride.reviewedAt)));
    if (pending) throw conflict('rag_override.pending_exists', 'An override request for this item is already awaiting review');
    const h = await this.computeHealth(p);
    const calculated = body.entityType === 'workstream' ? h.workstreams.find((w) => w.id === body.entityId)!.rag.calculated.status : h.project.rag.calculated.status;
    const id = newId();
    await this.tx.insert(schema.ragOverride).values({
      id,
      orgId: ctx.principal.orgId,
      projectId,
      entityType: body.entityType,
      entityId: body.entityId,
      calculatedStatus: calculated,
      overrideStatus: body.overrideStatus,
      reason: body.reason,
      expiresOn: body.expiresOn,
      requestedBy: ctx.principal.userId!,
      isDemo: p.isDemo,
    });
    await this.audit.record({ action: 'planning.rag_override.request', entityType: body.entityType, entityId: body.entityId, projectId, after: { overrideId: id, calculated, override: body.overrideStatus, expiresOn: body.expiresOn }, reason: body.reason });
    await this.outbox.emit({ type: 'approval.pending', projectId, aggregateType: 'rag_override', aggregateId: id, payload: { kind: 'rag_override_review' } });
    return { id, version: 1 };
  }

  async reviewRagOverride(ctx: RequestContext, projectId: string, id: string, approve: boolean, body: { expectedVersion: number; note?: string; reason?: string }) {
    const p = await this.s.project(ctx, projectId);
    const o = await this.s.lockInProject(schema.ragOverride, projectId, id);
    const workstreamId = o.entityType === 'workstream' ? o.entityId : null;
    this.s.assert(ctx, 'planning.rag_override.review', p, { workstreamId, requesterUserId: o.requestedBy });
    this.s.assertVersion(o, body.expectedVersion, 'override');
    if (o.reviewedAt) throw ruleViolation('rag_override.already_reviewed', 'This override was already reviewed');
    if (approve && o.expiresOn < this.s.today(p)) throw ruleViolation('rag_override.expired', 'The override has already expired');
    const row = await updateVersioned(this.s.db, schema.ragOverride, { id, projectId, expectedVersion: body.expectedVersion }, { approved: approve, reviewerUserId: ctx.principal.userId, reviewedAt: new Date(), reviewNote: body.reason ?? body.note ?? null });
    await this.audit.record({ action: approve ? 'planning.rag_override.approve' : 'planning.rag_override.reject', entityType: o.entityType, entityId: o.entityId, projectId, after: { overrideId: id, approved: approve, override: o.overrideStatus, calculatedAtRequest: o.calculatedStatus }, reason: body.reason ?? body.note ?? null });
    return { id, status: approve ? 'approved' : 'rejected', version: row['version'] as number };
  }
}

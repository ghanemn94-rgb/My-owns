import type { ModuleSeed } from '../../cli/seed-modules';
import { addWorkingDays } from '@hub/domain';
import { PortfolioService } from '../portfolio/portfolio.service';
import { WbsService } from './wbs.service';
import { ScheduleService } from './schedule.service';
import { ChangeControlService } from './change-control.service';
import { RaidService } from './raid.service';
import { HealthService } from './health.service';
import { PlanningSupport } from './planning-support';

/** Workstreams activated in the demo and their accountable persona (synthetic personas only). */
const DEMO_WS: Record<string, string> = { WS01: 'pm', WS02: 'contributor', WS06: 'tech.lead', WS07: 'ops.lead' };
/** Targets whose driving networks have only template-assumed durations → complete schedules to date the demo plan. */
const DATED_TARGETS = ['WS02-A08', 'WS06-A04', 'WS07-A03', 'WS01-A08'];
/** Critical-path activity given a forecast slip to demonstrate AT-15 (schedule-based forecast). */
const SLIP_TASK = 'WS02-A03';
const DEMO = 'Demo';

/**
 * Planning demo scenario (idempotent; everything goes through the planning services so authorization, validation,
 * audit and outbox apply). All content is synthetic and labelled "Demo"; dates are derived from the template's
 * ASSUMED durations and the demo project's planned start — they are not real commitments.
 */
export const planningSeed: ModuleSeed = {
  name: 'planning',
  run: async ({ app, dcProjectId: pid, asUser, userId, log }) => {
    const wbs = app.get(WbsService);
    const sched = app.get(ScheduleService);
    const cc = app.get(ChangeControlService);
    const raid = app.get(RaidService);
    const health = app.get(HealthService);
    const support = app.get(PlanningSupport);
    const portfolio = app.get(PortfolioService);
    const uid: Record<string, string> = {};
    for (const k of ['pm', 'sponsor', 'secretary', 'contributor', 'tech.lead', 'ops.lead', 'approver']) uid[k] = await userId(k);

    // 1. Workstream leads + activation of WS01/WS02/WS06/WS07 (Draft → Not started) + accountable owners.
    const workstreams = await asUser('pm', (ctx) => portfolio.listWorkstreams(ctx, pid));
    const ws = new Map(workstreams.items.map((w) => [w.code, w]));
    for (const [code, persona] of Object.entries(DEMO_WS)) {
      const w = ws.get(code)!;
      if (!w.leadUserId) await asUser('pm', (ctx) => portfolio.assignWorkstreamLead(ctx, pid, w.id, uid[persona]!, w.version));
      // Idempotent: on a re-run nothing is left in Draft, so the (audited) bulk activation is not invoked again.
      const drafts = await asUser('pm', (ctx) => wbs.listTasks(ctx, pid, { page: 1, pageSize: 1, workstreamId: w.id, status: ['draft'] }));
      if (drafts.total > 0) {
        const r = await asUser('pm', (ctx) => wbs.activateWorkstreamTasks(ctx, pid, w.id, 'Demo: plan confirmed for the demo scenario'));
        if (r.activated) log(`planning: activated ${r.activated} ${code} tasks`);
      }
      const tasks = await asUser('pm', (ctx) => wbs.listTasks(ctx, pid, { page: 1, pageSize: 100, workstreamId: w.id }));
      for (const t of tasks.items) {
        if (t.accountableUserId || t.status === 'draft') continue;
        await asUser('pm', (ctx) => wbs.assignOwner(ctx, pid, 'task', t.id, { expectedVersion: t.version, userId: uid[persona]!, reason: 'Demo: accountable owner for the demo scenario' }));
      }
    }

    // 2. Planned dates for a coherent subset: early dates of complete driving networks (assumed durations; demo dates).
    const dated = await asUser('pm', async (ctx) => {
      const out = new Map<string, { start: string; finish: string; type: string }>();
      for (const code of DATED_TARGETS) {
        const g = await sched.graph(pid);
        const target = g.nodes.find((n) => n.code === code);
        if (!target) continue;
        const s = await sched.getSchedule(ctx, pid, target.id);
        if (s.status !== 'complete') {
          log(`planning: schedule for ${code} is ${s.status} — not dated`);
          continue;
        }
        for (const n of s.nodes) if (n.earlyStart && n.earlyFinish) out.set(n.id, { start: n.earlyStart, finish: n.earlyFinish, type: n.type });
      }
      return out;
    });
    let datedCount = 0;
    for (const [id, d] of dated) {
      if (d.type === 'task') {
        const t = await asUser('pm', (ctx) => wbs.getTask(ctx, pid, id));
        if (t.status === 'draft' || t.plannedStart) continue;
        await asUser('pm', (ctx) => wbs.updateTask(ctx, pid, id, { expectedVersion: t.version, plannedStart: d.start, plannedFinish: d.finish }));
        datedCount++;
      } else {
        const m = await asUser('pm', (ctx) => wbs.getMilestone(ctx, pid, id));
        if (m.plannedDate || !DEMO_WS[m.workstreamCode ?? '']) continue;
        await asUser('pm', (ctx) => wbs.updateMilestone(ctx, pid, id, { expectedVersion: m.version, plannedDate: d.finish }));
        datedCount++;
      }
    }
    if (datedCount) log(`planning: set demo planned dates on ${datedCount} activities`);

    // 3. Baseline v1: proposed by the PM, approved by the Sponsor (separation of duties).
    const baselines = await asUser('pm', (ctx) => cc.listBaselines(ctx, pid));
    if (baselines.items.length === 0) {
      const b = await asUser('pm', (ctx) => cc.proposeBaseline(ctx, pid, { note: 'Demo baseline v1 — synthetic plan derived from template-assumed durations' }));
      await asUser('sponsor', (ctx) => cc.approveBaseline(ctx, pid, b.id, { expectedVersion: b.version, note: 'Demo approval (synthetic persona)' }));
      log('planning: baseline v1 proposed (pm) and approved (sponsor)');
    }

    // 4. Forecast slip on a critical-path activity (AT-15 demonstration: schedule-based forecast, no probability).
    const slip = await asUser('pm', (ctx) => wbs.findTaskByWbs(pid, SLIP_TASK).then((t) => wbs.getTask(ctx, pid, t.id)));
    if (slip.plannedFinish && !slip.forecastFinish) {
      const cal = await asUser('pm', async (ctx) => support.calendar(await support.project(ctx, pid)));
      await asUser('pm', (ctx) =>
        wbs.updateTaskProgress(ctx, pid, slip.id, { expectedVersion: slip.version, reportedProgress: 0, forecastFinish: addWorkingDays(slip.plannedFinish!, 10, cal), note: 'Demo: forecast slip of 10 working days to demonstrate the delay-impact forecast' }),
      );
      log(`planning: forecast slip set on ${SLIP_TASK}`);
    }

    // 5. RAID (synthetic).
    const risks = await asUser('pm', (ctx) => raid.list(ctx, pid, 'risks', { page: 1, pageSize: 5 }));
    if (risks.total === 0) {
      const w = (c: string) => ws.get(c)!.id;
      await asUser('tech.lead', (ctx) =>
        raid.createRisk(ctx, pid, { workstreamId: w('WS06'), title: `${DEMO}: identity separation may take longer than the assumed duration`, probability: 3, impact: 4, trigger: 'Directory clean-up not started by the planned date', response: 'Start the identity inventory early; agree interim access model', responseStrategy: 'mitigate', ownerUserId: uid['tech.lead'] }),
      );
      const r2 = await asUser('ops.lead', (ctx) =>
        raid.createRisk(ctx, pid, { workstreamId: w('WS07'), title: `${DEMO}: shared NOC service scope unclear for the TSA schedule`, probability: 4, impact: 4, trigger: 'Service catalogue owner not assigned', response: 'Escalate to the PMO for an owner decision', responseStrategy: 'mitigate', ownerUserId: uid['ops.lead'] }),
      );
      await asUser('pm', (ctx) => raid.command(ctx, pid, 'risks', r2.id, 'escalate', { expectedVersion: 1, level: 1, reason: 'Demo: needs a PMO decision on the catalogue owner' }));
      await asUser('contributor', (ctx) => raid.createRisk(ctx, pid, { workstreamId: w('WS02'), title: `${DEMO}: disagreement on classifying shared assets`, probability: 3, impact: 3, responseStrategy: 'mitigate', response: 'Agree classification rules before the workshop' }));
      await asUser('pm', (ctx) => raid.createRisk(ctx, pid, { workstreamId: w('WS01'), title: `${DEMO}: committee quorum availability during holidays`, probability: 2, impact: 4, responseStrategy: 'accept', ownerUserId: uid['pm'] }));
      await asUser('tech.lead', (ctx) => raid.createIssue(ctx, pid, { workstreamId: w('WS06'), title: `${DEMO}: test environment not yet available`, severity: 3, ownerUserId: uid['tech.lead'] }));
      await asUser('ops.lead', (ctx) => raid.raiseIssueFromRisk(ctx, pid, r2.id, { expectedVersion: 2, title: `${DEMO}: shared-services catalogue has no accountable owner`, severity: 4 }));
      await asUser('contributor', (ctx) => raid.createAssumption(ctx, pid, { workstreamId: w('WS02'), title: `${DEMO}: activity durations follow the template assumptions`, basis: 'Template v1 assumed durations — not validated with owners', validationPlan: 'Validate in the planning workshop' }));
      await asUser('tech.lead', (ctx) => raid.createAssumption(ctx, pid, { workstreamId: w('WS06'), title: `${DEMO}: current applications can be cloned for NewCo`, basis: 'Assumption pending specialist assessment' }));
      await asUser('ops.lead', (ctx) => raid.createDependency(ctx, pid, { workstreamId: w('WS07'), title: `${DEMO}: TSA principles need a committee decision`, dependsOn: 'Committee decision on TSA principles — to be scheduled' }));
      log('planning: 9 demo RAID items created');
    }

    // 6. One change request draft (illustrative).
    const crs = await asUser('pm', (ctx) => cc.listChangeRequests(ctx, pid, { page: 1, pageSize: 5 }));
    if (crs.total === 0) {
      await asUser('pm', (ctx) =>
        cc.createChangeRequest(ctx, pid, {
          title: `${DEMO}: add a shared cooling asset to the perimeter (illustrative)`,
          rationale: 'Demo change request: illustrates change control after baseline approval. Not a real proposal.',
          alternatives: ['Keep the asset with the parent and cover it with a TSA', 'Defer until the perimeter review'],
          impacts: { scope: 'Adds one shared asset (illustrative)', tsa: 'May need an interim cooling service (to be assessed)' },
          rebaseline: false,
        }),
      );
      log('planning: demo change request draft created');
    }

    // 7. Status updates: WS06 accepted, WS07 submitted, WS02 none (→ "Not updated").
    const ups = await asUser('pm', (ctx) => health.listStatusUpdates(ctx, pid, { page: 1, pageSize: 5 }));
    if (ups.total === 0) {
      const today = await asUser('pm', async (ctx) => support.today(await support.project(ctx, pid)));
      const u6 = await asUser('tech.lead', (ctx) => health.createStatusUpdate(ctx, pid, { workstreamId: ws.get('WS06')!.id, periodEnd: today, summary: `${DEMO} update: inventory preparation started; no real data.`, nextSteps: 'Demo: complete the application inventory', ragReported: 'green' }));
      await asUser('tech.lead', (ctx) => health.statusUpdateCommand(ctx, pid, u6.id, 'submit', { expectedVersion: 1 }));
      await asUser('secretary', (ctx) => health.statusUpdateCommand(ctx, pid, u6.id, 'accept', { expectedVersion: 2, note: 'Demo acceptance' }));
      const u7 = await asUser('ops.lead', (ctx) => health.createStatusUpdate(ctx, pid, { workstreamId: ws.get('WS07')!.id, periodEnd: today, summary: `${DEMO} update: operations model workshop planned.`, blockers: 'Demo: catalogue owner not assigned', ragReported: 'amber' }));
      await asUser('ops.lead', (ctx) => health.statusUpdateCommand(ctx, pid, u7.id, 'submit', { expectedVersion: 1 }));
      log('planning: demo status updates (WS06 accepted, WS07 submitted, WS02 none)');
    }

    // 8. A RAG override request pending review.
    const ovs = await asUser('pm', (ctx) => health.listRagOverrides(ctx, pid, {}));
    if (ovs.items.length === 0) {
      const today = await asUser('pm', async (ctx) => support.today(await support.project(ctx, pid)));
      const exp = addWorkingDays(today, 20);
      await asUser('tech.lead', (ctx) =>
        health.requestRagOverride(ctx, pid, { entityType: 'workstream', entityId: ws.get('WS06')!.id, overrideStatus: 'amber', reason: `${DEMO}: lead judgement — test environment dependency not yet reflected in dates`, expiresOn: exp }),
      );
      log('planning: demo RAG override request pending review');
    }
  },
};

import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { schema } from '@hub/db';
import { LOOK_AHEAD_WEEKS, addCalendarDays, isOverdue, lookAheadBucket, serverMessage, workingDaySlip, UPDATE_STALE_AFTER_DAYS } from '@hub/domain';
import type { ReportCellDto } from '@hub/contracts';
import { bi, figure, section, table, type StoredSection } from '../report-model';
import { displayNames, reachWhere, workstreamCodes, type Gen } from './gen-context';

const PERM = 'planning.plan.read';
const TASK_FINISHED: readonly string[] = ['accepted', 'done', 'cancelled'];
const MILESTONE_FINISHED: readonly string[] = ['achieved_verified', 'achieved_pending_evidence', 'cancelled'];
const DELIVERABLE_FINISHED: readonly string[] = ['accepted', 'cancelled'];
const RAID_OPEN = ['open', 'monitoring', 'escalated'] as const;

type Task = typeof schema.task.$inferSelect;
type Milestone = typeof schema.milestone.$inferSelect;
type Deliverable = typeof schema.deliverable.$inferSelect;

/** Planning records read once per generation with the generator's reach (tasks, milestones, deliverables, baseline). */
export interface PlanningData {
  tasks: Task[];
  milestones: Milestone[];
  deliverables: Deliverable[];
  baselineDates: Map<string, string | null>;
  ws: Map<string, { code: string; name: string; nameAr: string | null }>;
  names: Map<string, string>;
}

export async function loadPlanning(g: Gen): Promise<PlanningData | null> {
  if (!g.access.canCollect(g.ctx, g.projectId, PERM)) return null;
  const tx = g.db.tx();
  // One connection per request transaction: queries run one after the other.
  const tasks = await tx.select().from(schema.task).where(and(eq(schema.task.projectId, g.projectId), reachWhere(g, PERM, schema.task.workstreamId))).orderBy(asc(schema.task.wbsCode), asc(schema.task.id));
  const milestones = await tx.select().from(schema.milestone).where(and(eq(schema.milestone.projectId, g.projectId), reachWhere(g, PERM, schema.milestone.workstreamId))).orderBy(asc(schema.milestone.plannedDate), asc(schema.milestone.code));
  const deliverables = await tx.select().from(schema.deliverable).where(and(eq(schema.deliverable.projectId, g.projectId), reachWhere(g, PERM, schema.deliverable.workstreamId))).orderBy(asc(schema.deliverable.dueDate), asc(schema.deliverable.code));
  const [b] = await tx.select().from(schema.baselineVersion).where(and(eq(schema.baselineVersion.projectId, g.projectId), eq(schema.baselineVersion.status, 'approved'))).limit(1);
  const baselineDates = new Map<string, string | null>();
  if (b) {
    const snap = b.snapshot as { tasks?: { id: string; plannedFinish: string | null }[]; milestones?: { id: string; plannedDate: string | null }[] };
    for (const t of snap.tasks ?? []) baselineDates.set(t.id, t.plannedFinish);
    for (const m of snap.milestones ?? []) baselineDates.set(m.id, m.plannedDate);
  }
  const names = await displayNames(g, [...tasks.map((t) => t.accountableUserId), ...milestones.map((m) => m.ownerUserId), ...deliverables.map((d) => d.ownerUserId)]);
  return { tasks, milestones, deliverables, baselineDates, ws: await workstreamCodes(g), names };
}

const taskDue = (t: Task) => t.forecastFinish ?? t.plannedFinish;
const msDue = (m: Milestone) => m.forecastDate ?? m.plannedDate;
const wsCode = (d: PlanningData, id: string | null) => (id ? (d.ws.get(id)?.code ?? null) : null);
const person = (d: PlanningData, id: string | null) => (id ? (d.names.get(id) ?? null) : null);
const unverifiedOf = (rows: { id: string; label: string; status: string }[], type: string) =>
  rows.filter((r) => r.status !== 'confirmed').map((r) => ({ type, id: r.id, label: r.label, status: r.status }));

function access(g: Gen) {
  return g.access.structured(g.ctx, g.projectId, '', [PERM], [g.baseClassification], { workstreamId: g.workstreamId });
}
const withKey = (g: Gen, key: string) => ({ ...access(g), key });

/** Milestone slip (working days) from the baseline (or planned) date to the forecast / actual date; null when unknown. */
function slipOf(g: Gen, d: PlanningData, m: Milestone): number | null {
  const from = d.baselineDates.get(m.id) ?? m.plannedDate;
  const to = m.actualDate ?? m.forecastDate ?? (m.status === 'missed' ? g.today : null);
  return from && to ? workingDaySlip(from, to, g.calendar) : null;
}

/** "What is delayed and what is the impact" (executive summary, committee pack). */
export function delaysSection(g: Gen, d: PlanningData): StoredSection {
  const overdueTasks = d.tasks.filter((t) => t.status !== 'draft' && isOverdue(taskDue(t), g.today, !TASK_FINISHED.includes(t.status)));
  const lateMilestones = d.milestones
    .filter((m) => !['cancelled', 'achieved_verified'].includes(m.status))
    .map((m) => ({ m, slip: slipOf(g, d, m) }))
    .filter((x) => x.m.status === 'missed' || (x.slip !== null && x.slip > 0) || isOverdue(x.m.plannedDate, g.today, !MILESTONE_FINISHED.includes(x.m.status)))
    .sort((a, b) => (b.slip ?? 0) - (a.slip ?? 0) || (a.m.code < b.m.code ? -1 : 1));
  const critical = lateMilestones.filter((x) => x.m.isCritical);
  const maxSlip = critical.reduce<number | null>((acc, x) => (x.slip === null ? acc : Math.max(acc ?? 0, x.slip)), null);
  return section('delays', withKey(g, 'delays'), {
    figures: [
      figure('overdue_tasks', overdueTasks.length),
      figure('late_milestones', lateMilestones.length),
      figure('late_critical_milestones', critical.length),
      figure('max_critical_slip_days', critical.length ? (maxSlip ?? null) : 0, 'days'),
    ],
    tables: [
      table(
        'late_milestones',
        [['code', 'code'], ['title', 'bilingual'], ['workstream', 'code'], ['plannedDate', 'date'], ['baselineDate', 'date'], ['forecastDate', 'date'], ['slipDays', 'number'], ['critical', 'boolean'], ['gateKey', 'code'], ['status', 'enum', 'milestoneStatuses'], ['owner', 'person']],
        lateMilestones.map(({ m, slip }) => ({
          code: m.code,
          title: bi(m.title, m.titleAr),
          workstream: wsCode(d, m.workstreamId),
          plannedDate: m.plannedDate,
          baselineDate: d.baselineDates.get(m.id) ?? null,
          forecastDate: m.actualDate ?? m.forecastDate,
          slipDays: slip,
          critical: m.isCritical,
          gateKey: m.gateKey,
          status: m.status,
          owner: person(d, m.ownerUserId),
        })),
        25,
      ),
      table(
        'overdue_tasks',
        [['wbs', 'code'], ['title', 'bilingual'], ['workstream', 'code'], ['dueDate', 'date'], ['status', 'enum', 'taskStatuses'], ['owner', 'person']],
        overdueTasks
          .sort((a, b) => (taskDue(a)! < taskDue(b)! ? -1 : 1))
          .map((t) => ({ wbs: t.wbsCode, title: bi(t.title, t.titleAr), workstream: wsCode(d, t.workstreamId), dueDate: taskDue(t), status: t.status, owner: person(d, t.accountableUserId) })),
        25,
      ),
    ],
    notes: d.baselineDates.size ? [] : [serverMessage('report.no_approved_baseline')],
    unverified: unverifiedOf(lateMilestones.map(({ m }) => ({ id: m.id, label: m.code, status: m.verificationStatus })), 'milestone'),
    sourceRefs: [{ type: 'register', id: null, label: 'milestone_register' }, { type: 'register', id: null, label: 'task_register' }],
  });
}

/** Plan / milestones (committee pack). */
export function milestonesSection(g: Gen, d: PlanningData): StoredSection {
  const rows = d.milestones.filter((m) => m.status !== 'cancelled');
  const achieved = rows.filter((m) => m.status === 'achieved_verified').length;
  return section('milestones', withKey(g, 'milestones'), {
    figures: [figure('milestones_total', rows.length), figure('milestones_achieved_verified', achieved), figure('milestones_at_risk', rows.filter((m) => m.status === 'at_risk' || m.status === 'missed').length)],
    tables: [
      table(
        'milestones',
        [['code', 'code'], ['title', 'bilingual'], ['workstream', 'code'], ['plannedDate', 'date'], ['forecastDate', 'date'], ['actualDate', 'date'], ['critical', 'boolean'], ['status', 'enum', 'milestoneStatuses'], ['verification', 'enum', 'verificationStatuses']],
        rows.map((m) => ({
          code: m.code,
          title: bi(m.title, m.titleAr),
          workstream: wsCode(d, m.workstreamId),
          plannedDate: m.plannedDate,
          forecastDate: m.forecastDate,
          actualDate: m.actualDate,
          critical: m.isCritical,
          status: m.status,
          verification: m.verificationStatus,
        })),
        60,
      ),
    ],
    unverified: unverifiedOf(rows.map((m) => ({ id: m.id, label: m.code, status: m.verificationStatus })), 'milestone'),
    sourceRefs: [{ type: 'register', id: null, label: 'milestone_register' }],
  });
}

/** 2 / 4 / 8-week look-ahead on business dates (weekly report, look-ahead report). */
export function lookAheadSection(g: Gen, d: PlanningData): StoredSection {
  type Item = { type: string; code: string; title: ReportCellDto; workstream: string | null; due: string; window: number; status: string; owner: string | null; enumName: string };
  const items: Item[] = [];
  for (const t of d.tasks) {
    if (t.status === 'draft' || TASK_FINISHED.includes(t.status)) continue;
    const w = lookAheadBucket(g.today, taskDue(t));
    if (w) items.push({ type: 'task', code: t.wbsCode, title: bi(t.title, t.titleAr), workstream: wsCode(d, t.workstreamId), due: taskDue(t)!, window: w, status: t.status, owner: person(d, t.accountableUserId), enumName: 'taskStatuses' });
  }
  for (const m of d.milestones) {
    if (MILESTONE_FINISHED.includes(m.status)) continue;
    const w = lookAheadBucket(g.today, msDue(m));
    if (w) items.push({ type: 'milestone', code: m.code, title: bi(m.title, m.titleAr), workstream: wsCode(d, m.workstreamId), due: msDue(m)!, window: w, status: m.status, owner: person(d, m.ownerUserId), enumName: 'milestoneStatuses' });
  }
  for (const x of d.deliverables) {
    if (DELIVERABLE_FINISHED.includes(x.status)) continue;
    const w = lookAheadBucket(g.today, x.dueDate);
    if (w) items.push({ type: 'deliverable', code: x.code, title: bi(x.title, x.titleAr), workstream: wsCode(d, x.workstreamId), due: x.dueDate!, window: w, status: x.status, owner: person(d, x.ownerUserId), enumName: 'deliverableStatuses' });
  }
  items.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.code < b.code ? -1 : 1));
  const within = (weeks: number) => items.filter((i) => i.window <= weeks);
  return section('look_ahead', withKey(g, 'look_ahead'), {
    figures: LOOK_AHEAD_WEEKS.flatMap((w) => [figure(`due_within_${w}_weeks`, within(w).length)]),
    tables: [
      table(
        'look_ahead_items',
        [['window', 'number'], ['type', 'enum', 'reportItemTypes'], ['code', 'code'], ['title', 'bilingual'], ['workstream', 'code'], ['dueDate', 'date'], ['status', 'enum'], ['owner', 'person']],
        items.map((i) => ({ window: i.window, type: i.type, code: i.code, title: i.title, workstream: i.workstream, dueDate: i.due, status: `${i.enumName}:${i.status}`, owner: i.owner })),
        120,
      ),
    ],
    notes: [serverMessage('report.look_ahead_windows', { from: g.today, to2: addCalendarDays(g.today, 13), to4: addCalendarDays(g.today, 27), to8: addCalendarDays(g.today, 55) })],
    sourceRefs: [{ type: 'register', id: null, label: 'plan_registers' }],
  });
}

/** Overdue items (weekly and look-ahead reports). */
export function overdueSection(g: Gen, d: PlanningData): StoredSection {
  const rows: { type: string; code: string; title: ReportCellDto; workstream: string | null; due: string; status: string; owner: string | null }[] = [];
  for (const t of d.tasks) if (t.status !== 'draft' && isOverdue(taskDue(t), g.today, !TASK_FINISHED.includes(t.status))) rows.push({ type: 'task', code: t.wbsCode, title: bi(t.title, t.titleAr), workstream: wsCode(d, t.workstreamId), due: taskDue(t)!, status: `taskStatuses:${t.status}`, owner: person(d, t.accountableUserId) });
  for (const m of d.milestones) if (isOverdue(msDue(m), g.today, !MILESTONE_FINISHED.includes(m.status))) rows.push({ type: 'milestone', code: m.code, title: bi(m.title, m.titleAr), workstream: wsCode(d, m.workstreamId), due: msDue(m)!, status: `milestoneStatuses:${m.status}`, owner: person(d, m.ownerUserId) });
  for (const x of d.deliverables) if (isOverdue(x.dueDate, g.today, !DELIVERABLE_FINISHED.includes(x.status))) rows.push({ type: 'deliverable', code: x.code, title: bi(x.title, x.titleAr), workstream: wsCode(d, x.workstreamId), due: x.dueDate!, status: `deliverableStatuses:${x.status}`, owner: person(d, x.ownerUserId) });
  rows.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.code < b.code ? -1 : 1));
  return section('overdue', withKey(g, 'overdue'), {
    figures: [figure('overdue_tasks', rows.filter((r) => r.type === 'task').length), figure('overdue_milestones', rows.filter((r) => r.type === 'milestone').length), figure('overdue_deliverables', rows.filter((r) => r.type === 'deliverable').length)],
    tables: [
      table(
        'overdue_items',
        [['type', 'enum', 'reportItemTypes'], ['code', 'code'], ['title', 'bilingual'], ['workstream', 'code'], ['dueDate', 'date'], ['daysOverdue', 'number'], ['status', 'enum'], ['owner', 'person']],
        rows.map((r) => ({ type: r.type, code: r.code, title: r.title, workstream: r.workstream, dueDate: r.due, daysOverdue: Math.max(0, workingDaySlip(r.due, g.today, g.calendar)), status: r.status, owner: r.owner })),
        120,
      ),
    ],
    sourceRefs: [{ type: 'register', id: null, label: 'plan_registers' }],
  });
}

/** Latest ACCEPTED periodic update per workstream (weekly report — submitted / returned / draft updates are not used). */
export async function statusUpdatesSection(g: Gen, d: PlanningData): Promise<StoredSection> {
  const S = schema.statusUpdate;
  const rows = await g.db
    .tx()
    .select()
    .from(S)
    .where(and(eq(S.projectId, g.projectId), eq(S.status, 'accepted'), reachWhere(g, PERM, S.workstreamId)))
    .orderBy(desc(S.periodEnd), desc(S.id));
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const k = r.workstreamId ?? '-';
    if (!latest.has(k)) latest.set(k, r);
  }
  const list = [...latest.values()].sort((a, b) => ((wsCode(d, a.workstreamId) ?? '') < (wsCode(d, b.workstreamId) ?? '') ? -1 : 1));
  const staleLimit = addCalendarDays(g.today, -UPDATE_STALE_AFTER_DAYS);
  const reviewers = await displayNames(g, list.map((r) => r.reviewedBy));
  return section('status_updates', withKey(g, 'status_updates'), {
    figures: [figure('accepted_updates', list.length), figure('stale_updates', list.filter((r) => r.periodEnd < staleLimit).length)],
    tables: [
      table(
        'accepted_updates',
        [['workstream', 'code'], ['periodEnd', 'date'], ['ragReported', 'enum', 'ragStatuses'], ['ragCalculated', 'enum', 'ragStatuses'], ['summary', 'text'], ['blockers', 'text'], ['nextSteps', 'text'], ['reviewedBy', 'person']],
        list.map((r) => ({
          workstream: wsCode(d, r.workstreamId),
          periodEnd: r.periodEnd,
          ragReported: r.ragReported,
          ragCalculated: r.ragCalculated,
          summary: r.summary,
          blockers: r.blockers,
          nextSteps: r.nextSteps,
          reviewedBy: r.reviewedBy ? (reviewers.get(r.reviewedBy) ?? null) : null,
        })),
      ),
    ],
    notes: [serverMessage('report.accepted_updates_only')],
    sourceRefs: list.map((r) => ({ type: 'status_update', id: r.id, label: `${wsCode(d, r.workstreamId) ?? ''} ${r.periodEnd}`.trim() })),
  });
}

/** Risks and issues (committee pack, weekly report). */
export async function raidSection(g: Gen, d: PlanningData): Promise<StoredSection> {
  const tx = g.db.tx();
  const risks = await tx.select().from(schema.risk).where(and(eq(schema.risk.projectId, g.projectId), inArray(schema.risk.status, RAID_OPEN), reachWhere(g, PERM, schema.risk.workstreamId)));
  const issues = await tx.select().from(schema.issue).where(and(eq(schema.issue.projectId, g.projectId), inArray(schema.issue.status, RAID_OPEN), reachWhere(g, PERM, schema.issue.workstreamId)));
  const names = await displayNames(g, [...risks.map((r) => r.ownerUserId), ...issues.map((r) => r.ownerUserId)]);
  const score = (r: (typeof risks)[number]) => r.probability * r.impact;
  risks.sort((a, b) => score(b) - score(a) || (a.code < b.code ? -1 : 1));
  issues.sort((a, b) => b.severity - a.severity || (a.code < b.code ? -1 : 1));
  return section('raid', withKey(g, 'raid'), {
    figures: [
      figure('open_risks', risks.length),
      figure('high_risks', risks.filter((r) => score(r) >= 15).length),
      figure('open_issues', issues.length),
      figure('escalated_items', [...risks, ...issues].filter((r) => r.status === 'escalated' || r.escalationLevel > 0).length),
    ],
    tables: [
      table(
        'risks',
        [['code', 'code'], ['title', 'text'], ['workstream', 'code'], ['probability', 'number'], ['impact', 'number'], ['score', 'number'], ['status', 'enum', 'raidStatuses'], ['dueDate', 'date'], ['owner', 'person']],
        risks.map((r) => ({ code: r.code, title: r.title, workstream: wsCode(d, r.workstreamId), probability: r.probability, impact: r.impact, score: score(r), status: r.status, dueDate: r.dueDate, owner: r.ownerUserId ? (names.get(r.ownerUserId) ?? null) : null })),
        30,
      ),
      table(
        'issues',
        [['code', 'code'], ['title', 'text'], ['workstream', 'code'], ['severity', 'number'], ['status', 'enum', 'raidStatuses'], ['dueDate', 'date'], ['owner', 'person']],
        issues.map((r) => ({ code: r.code, title: r.title, workstream: wsCode(d, r.workstreamId), severity: r.severity, status: r.status, dueDate: r.dueDate, owner: r.ownerUserId ? (names.get(r.ownerUserId) ?? null) : null })),
        30,
      ),
    ],
    sourceRefs: [{ type: 'register', id: null, label: 'raid_register' }],
  });
}

/** Data-quality findings of the plan (health & data quality report). */
export async function dataQualitySection(g: Gen, d: PlanningData): Promise<StoredSection> {
  const open = d.tasks.filter((t) => !TASK_FINISHED.includes(t.status));
  const ws = await g.db
    .tx()
    .select({ id: schema.workstream.id, code: schema.workstream.code, leadUserId: schema.workstream.leadUserId })
    .from(schema.workstream)
    .where(and(eq(schema.workstream.projectId, g.projectId), g.workstreamId ? eq(schema.workstream.id, g.workstreamId) : undefined));
  const reach = g.access.policy.permissionReach(g.ctx, PERM, g.projectId);
  const reachable = ws.filter((w) => reach.all || reach.workstreamIds.includes(w.id));
  const U = schema.statusUpdate;
  const accepted = await g.db
    .tx()
    .select({ workstreamId: U.workstreamId, periodEnd: U.periodEnd })
    .from(U)
    .where(and(eq(U.projectId, g.projectId), eq(U.status, 'accepted'), reachWhere(g, PERM, U.workstreamId)));
  const lastAccepted = new Map<string, string>();
  for (const a of accepted) if (a.workstreamId && (!lastAccepted.has(a.workstreamId) || lastAccepted.get(a.workstreamId)! < a.periodEnd)) lastAccepted.set(a.workstreamId, a.periodEnd);
  const staleLimit = addCalendarDays(g.today, -UPDATE_STALE_AFTER_DAYS);
  const findings: [string, number][] = [
    ['open_tasks_without_owner', open.filter((t) => t.status !== 'draft' && !t.accountableUserId).length],
    ['open_tasks_without_finish_date', open.filter((t) => t.status !== 'draft' && !t.plannedFinish).length],
    ['draft_tasks_not_confirmed', d.tasks.filter((t) => t.status === 'draft').length],
    ['milestones_without_date', d.milestones.filter((m) => m.status !== 'cancelled' && !m.plannedDate).length],
    ['milestones_not_confirmed', d.milestones.filter((m) => m.status !== 'cancelled' && m.verificationStatus !== 'confirmed').length],
    ['deliverables_weight_not_approved', d.deliverables.filter((x) => x.status !== 'cancelled' && !x.weightApproved).length],
    ['workstreams_without_lead', reachable.filter((w) => !w.leadUserId).length],
    ['workstreams_without_fresh_update', reachable.filter((w) => !lastAccepted.has(w.id) || lastAccepted.get(w.id)! < staleLimit).length],
  ];
  const historical = d.tasks.filter((t) => ['historical_unverified', 'conflicting', 'unknown'].includes(t.verificationStatus));
  return section('data_quality', withKey(g, 'data_quality'), {
    figures: findings.map(([k, v]) => figure(k, v)),
    tables: [
      table(
        'workstream_updates',
        [['workstream', 'code'], ['lead', 'boolean'], ['lastAcceptedUpdate', 'date'], ['fresh', 'boolean']],
        reachable
          .sort((a, b) => (a.code < b.code ? -1 : 1))
          .map((w) => ({ workstream: w.code, lead: !!w.leadUserId, lastAcceptedUpdate: lastAccepted.get(w.id) ?? null, fresh: !!lastAccepted.get(w.id) && lastAccepted.get(w.id)! >= staleLimit })),
      ),
    ],
    notes: [serverMessage('report.stale_after_days', { days: UPDATE_STALE_AFTER_DAYS })],
    unverified: historical.slice(0, 100).map((t) => ({ type: 'task', id: t.id, label: t.wbsCode, status: t.verificationStatus })),
    sourceRefs: [{ type: 'register', id: null, label: 'data_quality_registers' }],
  });
}

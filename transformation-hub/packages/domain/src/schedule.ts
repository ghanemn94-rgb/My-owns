import {
  WorkingCalendar,
  DEFAULT_CALENDAR,
  onOrNextWorkingDay,
  addCalendarDays,
  addWorkingDays,
  isWorkingDay,
  assertIsoDate,
} from './calendar';
import { SUPPORTED_DEPENDENCY_TYPES, DependencyType } from './enums';
import type { ServerMessage } from './messages';
import { planMessage, planningEn } from './planning-messages';

/**
 * Deterministic critical-path engine (spec §9, AT-15).
 *
 * Model: time is measured in working-day *boundaries* from the project's first working day (boundary 0 =
 * start of day 0). An activity with duration d starting at boundary s finishes at boundary s + d and occupies
 * working days [s, s+d). A milestone has d = 0. Finish-to-Start with lag L: ES(succ) ≥ EF(pred) + L.
 * Only FS is supported; SS/FF/SF make the schedule "incomplete" rather than silently mis-computed.
 * Missing durations make the schedule incomplete: no critical path is reported (spec: "Incomplete schedule").
 * Outputs are "schedule-based forecasts" — no probabilities are produced.
 */

export interface ScheduleNode {
  id: string;
  label?: string;
  /** Record code (e.g. WBS code) — used in translated assumptions instead of the (English) label. */
  code?: string;
  durationDays: number | null; // working days; 0 = milestone; null = missing
  /** Start-no-earlier-than constraint (e.g. planned start). */
  earliestStart?: string | null;
  actualStart?: string | null;
  actualFinish?: string | null;
  /** Forecast finish entered by the owner (used when not yet finished). */
  forecastFinish?: string | null;
  cancelled?: boolean;
}

export interface ScheduleEdge {
  predecessorId: string;
  successorId: string;
  type: DependencyType;
  lagDays: number;
}

export type ScheduleIssueCode =
  | 'missing_duration'
  | 'unsupported_dependency_type'
  | 'cycle'
  | 'unknown_node'
  | 'negative_duration'
  | 'invalid_date'
  | 'missing_project_start';

export interface ScheduleIssue {
  code: ScheduleIssueCode;
  nodeIds: string[];
  message: string;
}

export interface NodeResult {
  id: string;
  earlyStart: string;
  earlyFinish: string;
  lateStart: string;
  lateFinish: string;
  totalFloatDays: number;
  critical: boolean;
  durationDays: number;
}

export interface ScheduleResult {
  status: 'complete' | 'incomplete' | 'invalid';
  issues: ScheduleIssue[];
  assumptions: string[];
  /** One message per assumption, same order (QA-P2-04): the client translates them. */
  assumptionsI18n: ServerMessage[];
  projectStart: string;
  projectFinish: string | null;
  nodes: Record<string, NodeResult>;
  criticalPath: string[] | null;
}

/** Maps working-day boundaries <-> dates for a calendar. */
class WorkingDayIndex {
  private days: string[] = [];
  private index = new Map<string, number>();
  private negDays: string[] = []; // negDays[i] = working day at index -(i+1)

  constructor(private readonly day0: string, private readonly cal: WorkingCalendar) {
    this.days.push(day0);
    this.index.set(day0, 0);
  }

  private extendForward(to: number) {
    while (this.days.length <= to) {
      let x = addCalendarDays(this.days[this.days.length - 1]!, 1);
      let guard = 0;
      while (!isWorkingDay(x, this.cal)) {
        x = addCalendarDays(x, 1);
        if (++guard > 3660) throw new Error('calendar has no working days');
      }
      this.index.set(x, this.days.length);
      this.days.push(x);
    }
  }

  private extendBackward(toNeg: number) {
    while (this.negDays.length < toNeg) {
      const last = this.negDays.length === 0 ? this.day0 : this.negDays[this.negDays.length - 1]!;
      let x = addCalendarDays(last, -1);
      let guard = 0;
      while (!isWorkingDay(x, this.cal)) {
        x = addCalendarDays(x, -1);
        if (++guard > 3660) throw new Error('calendar has no working days');
      }
      this.negDays.push(x);
      this.index.set(x, -this.negDays.length);
    }
  }

  dayAt(i: number): string {
    if (i >= 0) {
      this.extendForward(i);
      return this.days[i]!;
    }
    this.extendBackward(-i);
    return this.negDays[-i - 1]!;
  }

  /** Index of the working day on or after `d`. */
  indexOnOrAfter(d: string): number {
    const w = onOrNextWorkingDay(d, this.cal);
    if (w >= this.day0) {
      // walk forward
      let i = 0;
      while (this.dayAt(i) < w) i++;
      return i;
    }
    let i = -1;
    while (this.dayAt(i) > w) i--;
    return this.dayAt(i) === w ? i : i + 1;
  }

  /** Start boundary for a date: activity starting on d. */
  startBoundary(d: string): number {
    return this.indexOnOrAfter(d);
  }

  /** Finish boundary for an activity finishing on d (end of that working day). */
  finishBoundary(d: string): number {
    // last working day on or before d
    let x = d;
    let guard = 0;
    while (!isWorkingDay(x, this.cal)) {
      x = addCalendarDays(x, -1);
      if (++guard > 3660) break;
    }
    return this.indexOnOrAfter(x) + 1;
  }

  /** Date on which an activity starting at boundary b starts. */
  startDate(b: number): string {
    return this.dayAt(b);
  }

  /** Date on which an activity finishing at boundary b finishes (d>0) — the last occupied working day. */
  finishDate(b: number, duration: number): string {
    if (duration === 0) return this.dayAt(Math.max(b - 1, b === 0 ? 0 : b - 1));
    return this.dayAt(b - 1);
  }
}

export function computeSchedule(
  nodes: ScheduleNode[],
  edges: ScheduleEdge[],
  projectStart: string,
  cal: WorkingCalendar = DEFAULT_CALENDAR,
): ScheduleResult {
  const issues: ScheduleIssue[] = [];
  const assumptionsI18n: ServerMessage[] = [
    planMessage('plan.assumption.calendar', { timezone: cal.timezone, days: cal.workingDays.join(','), holidays: cal.holidays.length }),
    planMessage('plan.assumption.fs_only'),
    planMessage('plan.assumption.no_predecessor_start'),
    planMessage('plan.assumption.not_probability'),
  ];
  const assumptions: string[] = assumptionsI18n.map((m) => planningEn([m]));
  try {
    assertIsoDate(projectStart);
  } catch {
    return {
      status: 'invalid',
      issues: [{ code: 'invalid_date', nodeIds: [], message: `Invalid project start ${projectStart}` }],
      assumptions,
      assumptionsI18n,
      projectStart,
      projectFinish: null,
      nodes: {},
      criticalPath: null,
    };
  }

  const active = nodes.filter((n) => !n.cancelled);
  const byId = new Map(active.map((n) => [n.id, n]));
  const cancelledIds = new Set(nodes.filter((n) => n.cancelled).map((n) => n.id));
  const usableEdges: ScheduleEdge[] = [];
  for (const e of edges) {
    if (cancelledIds.has(e.predecessorId) || cancelledIds.has(e.successorId)) continue;
    if (!byId.has(e.predecessorId) || !byId.has(e.successorId)) {
      issues.push({ code: 'unknown_node', nodeIds: [e.predecessorId, e.successorId], message: 'Dependency references an unknown activity' });
      continue;
    }
    if (!(SUPPORTED_DEPENDENCY_TYPES as readonly string[]).includes(e.type)) {
      issues.push({
        code: 'unsupported_dependency_type',
        nodeIds: [e.predecessorId, e.successorId],
        message: `Dependency type ${e.type} is not supported by the schedule engine yet`,
      });
      continue;
    }
    usableEdges.push(e);
  }
  for (const n of active) {
    if (n.durationDays === null || n.durationDays === undefined) {
      issues.push({ code: 'missing_duration', nodeIds: [n.id], message: `Activity ${n.label ?? n.id} has no duration` });
    } else if (n.durationDays < 0 || !Number.isInteger(n.durationDays)) {
      issues.push({ code: 'negative_duration', nodeIds: [n.id], message: `Activity ${n.label ?? n.id} has an invalid duration` });
    }
  }

  const cycle = findCycle(active.map((n) => n.id), usableEdges);
  if (cycle) {
    issues.push({ code: 'cycle', nodeIds: cycle, message: 'Dependencies contain a cycle' });
    return { status: 'invalid', issues, assumptions, assumptionsI18n, projectStart, projectFinish: null, nodes: {}, criticalPath: null };
  }
  if (issues.length > 0) {
    return { status: 'incomplete', issues, assumptions, assumptionsI18n, projectStart, projectFinish: null, nodes: {}, criticalPath: null };
  }

  const day0 = onOrNextWorkingDay(projectStart, cal);
  const idx = new WorkingDayIndex(day0, cal);
  const order = topoSort(active.map((n) => n.id), usableEdges)!;
  const preds = new Map<string, ScheduleEdge[]>();
  const succs = new Map<string, ScheduleEdge[]>();
  for (const e of usableEdges) {
    (preds.get(e.successorId) ?? preds.set(e.successorId, []).get(e.successorId)!).push(e);
    (succs.get(e.predecessorId) ?? succs.set(e.predecessorId, []).get(e.predecessorId)!).push(e);
  }

  const es = new Map<string, number>();
  const ef = new Map<string, number>();
  for (const id of order) {
    const n = byId.get(id)!;
    const d = n.durationDays!;
    let start = 0;
    if (n.earliestStart) start = Math.max(start, idx.startBoundary(n.earliestStart));
    for (const e of preds.get(id) ?? []) start = Math.max(start, ef.get(e.predecessorId)! + e.lagDays);
    if (n.actualStart) start = idx.startBoundary(n.actualStart);
    let finish = start + d;
    if (n.actualFinish) finish = Math.max(idx.finishBoundary(n.actualFinish), n.actualStart ? start : 0);
    else if (n.forecastFinish) finish = Math.max(finish, idx.finishBoundary(n.forecastFinish));
    if (n.actualFinish && !n.actualStart) start = Math.min(start, finish - d);
    es.set(id, start);
    ef.set(id, finish);
  }
  const projectFinishB = Math.max(0, ...[...ef.values()]);

  const lf = new Map<string, number>();
  const ls = new Map<string, number>();
  for (const id of [...order].reverse()) {
    const n = byId.get(id)!;
    const span = ef.get(id)! - es.get(id)!;
    let late = projectFinishB;
    for (const e of succs.get(id) ?? []) late = Math.min(late, ls.get(e.successorId)! - e.lagDays);
    lf.set(id, late);
    ls.set(id, late - span);
    void n;
  }

  const results: Record<string, NodeResult> = {};
  for (const id of order) {
    const n = byId.get(id)!;
    const span = ef.get(id)! - es.get(id)!;
    const float = ls.get(id)! - es.get(id)!;
    results[id] = {
      id,
      earlyStart: idx.startDate(es.get(id)!),
      earlyFinish: span === 0 ? idx.startDate(Math.max(es.get(id)! - (es.get(id)! > 0 ? 1 : 0), 0)) : idx.finishDate(ef.get(id)!, span),
      lateStart: idx.startDate(ls.get(id)!),
      lateFinish: span === 0 ? idx.startDate(Math.max(lf.get(id)! - (lf.get(id)! > 0 ? 1 : 0), 0)) : idx.finishDate(lf.get(id)!, span),
      totalFloatDays: float,
      critical: float <= 0,
      durationDays: n.durationDays!,
    };
  }

  // Critical path: walk from a critical start node through critical, zero-slack links.
  const critical = new Set(order.filter((id) => results[id]!.critical));
  const path: string[] = [];
  const starts = order.filter((id) => critical.has(id) && !(preds.get(id) ?? []).some((e) => critical.has(e.predecessorId)));
  let cur: string | undefined = starts.sort((a, b) => es.get(a)! - es.get(b)!)[0];
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    path.push(cur);
    const next: ScheduleEdge | undefined = (succs.get(cur) ?? []).find(
      (e) => critical.has(e.successorId) && es.get(e.successorId)! === ef.get(cur!)! + e.lagDays,
    );
    cur = next?.successorId;
  }

  const lastDay = projectFinishB === 0 ? day0 : idx.dayAt(projectFinishB - 1);
  return {
    status: 'complete',
    issues,
    assumptions,
    assumptionsI18n,
    projectStart: day0,
    projectFinish: lastDay,
    nodes: results,
    criticalPath: path,
  };
}

/** Returns the ids forming a cycle, or null. */
export function findCycle(ids: string[], edges: Pick<ScheduleEdge, 'predecessorId' | 'successorId'>[]): string[] | null {
  const adj = new Map<string, string[]>();
  for (const id of ids) adj.set(id, []);
  for (const e of edges) {
    if (!adj.has(e.predecessorId)) adj.set(e.predecessorId, []);
    if (!adj.has(e.successorId)) adj.set(e.successorId, []);
    adj.get(e.predecessorId)!.push(e.successorId);
  }
  const WHITE = 0, GREY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const parent = new Map<string, string>();
  for (const start of adj.keys()) {
    if ((color.get(start) ?? WHITE) !== WHITE) continue;
    const stack: [string, number][] = [[start, 0]];
    color.set(start, GREY);
    while (stack.length) {
      const top = stack[stack.length - 1]!;
      const [node, i] = top;
      const next = adj.get(node)!;
      if (i < next.length) {
        top[1] = i + 1;
        const m = next[i]!;
        const c = color.get(m) ?? WHITE;
        if (c === WHITE) {
          color.set(m, GREY);
          parent.set(m, node);
          stack.push([m, 0]);
        } else if (c === GREY) {
          const cycle = [m];
          let x = node;
          while (x !== m) {
            cycle.push(x);
            x = parent.get(x)!;
          }
          return cycle.reverse();
        }
      } else {
        color.set(node, BLACK);
        stack.pop();
      }
    }
  }
  return null;
}

export function wouldCreateCycle(
  edges: Pick<ScheduleEdge, 'predecessorId' | 'successorId'>[],
  candidate: Pick<ScheduleEdge, 'predecessorId' | 'successorId'>,
): boolean {
  if (candidate.predecessorId === candidate.successorId) return true;
  const ids = new Set<string>();
  for (const e of edges) {
    ids.add(e.predecessorId);
    ids.add(e.successorId);
  }
  ids.add(candidate.predecessorId);
  ids.add(candidate.successorId);
  return findCycle([...ids], [...edges, candidate]) !== null;
}

function topoSort(ids: string[], edges: ScheduleEdge[]): string[] | null {
  const indeg = new Map(ids.map((id) => [id, 0]));
  const adj = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of edges) {
    adj.get(e.predecessorId)!.push(e.successorId);
    indeg.set(e.successorId, (indeg.get(e.successorId) ?? 0) + 1);
  }
  // Stable order: preserve input order among ready nodes.
  const ready = ids.filter((id) => indeg.get(id) === 0);
  const out: string[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    out.push(id);
    for (const m of adj.get(id)!) {
      indeg.set(m, indeg.get(m)! - 1);
      if (indeg.get(m) === 0) ready.push(m);
    }
  }
  return out.length === ids.length ? out : null;
}

export interface DelayImpact {
  status: 'computed' | 'incomplete' | 'invalid';
  delayedNodeId: string;
  delayWorkingDays: number;
  baselineFinish: string | null;
  forecastFinish: string | null;
  projectSlipWorkingDays: number | null;
  affected: { id: string; label?: string; earlyFinishBefore: string; earlyFinishAfter: string; slipWorkingDays: number; critical: boolean }[];
  issues: ScheduleIssue[];
  assumptions: string[];
  assumptionsI18n: ServerMessage[];
}

/**
 * AT-15: impact of delaying one activity by N working days, computed reproducibly from the plan and calendar.
 */
export function delayImpact(
  nodes: ScheduleNode[],
  edges: ScheduleEdge[],
  projectStart: string,
  delayedNodeId: string,
  delayWorkingDays: number,
  cal: WorkingCalendar = DEFAULT_CALENDAR,
): DelayImpact {
  const before = computeSchedule(nodes, edges, projectStart, cal);
  if (before.status !== 'complete') {
    return {
      status: before.status === 'invalid' ? 'invalid' : 'incomplete',
      delayedNodeId,
      delayWorkingDays,
      baselineFinish: null,
      forecastFinish: null,
      projectSlipWorkingDays: null,
      affected: [],
      issues: before.issues,
      assumptions: before.assumptions,
      assumptionsI18n: before.assumptionsI18n,
    };
  }
  // The delay applies on top of the activity's CURRENT finish: its duration and, when the owner recorded a forecast
  // finish (not yet finished), that forecast too — otherwise an existing forecast slip would absorb the what-if delay.
  const delayed = nodes.map((n) =>
    n.id === delayedNodeId && n.durationDays !== null
      ? {
          ...n,
          durationDays: n.durationDays + delayWorkingDays,
          forecastFinish: n.forecastFinish && !n.actualFinish ? addWorkingDays(n.forecastFinish, delayWorkingDays, cal) : n.forecastFinish,
        }
      : n,
  );
  const after = computeSchedule(delayed, edges, projectStart, cal);
  const affected: DelayImpact['affected'] = [];
  const label = new Map(nodes.map((n) => [n.id, n.label]));
  const code = new Map(nodes.map((n) => [n.id, n.code]));
  for (const id of Object.keys(after.nodes)) {
    const b = before.nodes[id]!;
    const a = after.nodes[id]!;
    if (a.earlyFinish !== b.earlyFinish) {
      affected.push({
        id,
        label: label.get(id),
        earlyFinishBefore: b.earlyFinish,
        earlyFinishAfter: a.earlyFinish,
        slipWorkingDays: countWorkingDaySlip(b.earlyFinish, a.earlyFinish, cal),
        critical: a.critical,
      });
    }
  }
  // The delayed activity is named by its record code (its title is data, shown separately in the client's language).
  const delayed1 = planMessage('plan.assumption.delay_applied', { days: delayWorkingDays, node: code.get(delayedNodeId) ?? label.get(delayedNodeId) ?? delayedNodeId });
  return {
    status: 'computed',
    delayedNodeId,
    delayWorkingDays,
    baselineFinish: before.projectFinish,
    forecastFinish: after.projectFinish,
    projectSlipWorkingDays:
      before.projectFinish && after.projectFinish ? countWorkingDaySlip(before.projectFinish, after.projectFinish, cal) : null,
    affected,
    issues: [],
    assumptions: [...after.assumptions, planningEn([delayed1])],
    assumptionsI18n: [...after.assumptionsI18n, delayed1],
  };
}

function countWorkingDaySlip(from: string, to: string, cal: WorkingCalendar): number {
  if (from === to) return 0;
  const forward = to > from;
  let [a, b] = forward ? [from, to] : [to, from];
  let n = 0;
  let x = addCalendarDays(a, 1);
  while (x <= b) {
    if (isWorkingDay(x, cal)) n++;
    x = addCalendarDays(x, 1);
  }
  void a;
  void b;
  return forward ? n : -n;
}

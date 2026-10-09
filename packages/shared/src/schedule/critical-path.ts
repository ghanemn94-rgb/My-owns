// The critical path from defined scheduling logic (ADR-0031 §8; REQ-S09-009 "Critical path is computed by a documented
// algorithm (zero total float) and only shown when inputs are complete"; T-DG4-BE-E). Pure: no clock, no I/O.
//
// Algorithm `cpm-fs/1`: the critical path method on finish-to-start edges with zero lag, in working-day offsets from 0.
//  1. Topological order by Kahn's algorithm, ties broken by initiative code.
//  2. Forward pass: ES(n) = max EF(p) over predecessors p (0 without predecessors); EF(n) = ES(n) + d(n);
//     project duration P = max EF.
//  3. Backward pass: LF(n) = min LS(s) over successors s (P without successors); LS(n) = LF(n) - d(n).
//  4. Total float TF(n) = LS(n) - ES(n). A node is critical iff TF(n) = 0; an edge p -> s is critical iff both ends
//     are critical and EF(p) = ES(s).
//  5. Critical paths: the paths of critical edges from a critical node with ES = 0 to a critical node with EF = P,
//     enumerated depth-first in code order, at most MAX_CRITICAL_PATHS (`truncated: true` beyond). A path is taken
//     maximal: it starts at a node without an incoming critical edge and ends at a node without an outgoing critical
//     edge (this only matters for zero-duration nodes, which would otherwise yield prefixes of the same chain). A single
//     critical node with ES = 0 and EF = P and no critical edge is a path of length one.
// No claim without complete inputs: when any node lacks a duration, the result is `not_computable` with reason
// `missing_durations` and those nodes listed, and NOTHING is marked critical (`critical: null`, offsets null). No node
// gives `no_initiatives`; a cycle (the database guard should make it impossible) gives `cycle`. Nothing is stored:
// callers compute on every read, so a changed duration, date or dependency is reflected at once ("recompute").

export const CPM_ALGORITHM = "cpm-fs/1" as const;
export const MAX_CRITICAL_PATHS = 20;

export interface ScheduleNodeInput {
  readonly initiativeId: string;
  readonly code: string;
  readonly name: string;
  /** Planned duration in working days, or null when missing. */
  readonly durationWorkingDays: number | null;
}

export interface ScheduleEdgeInput {
  readonly dependencyId: string;
  readonly code: string;
  /** "From must deliver before To" (finish-to-start). */
  readonly fromInitiativeId: string;
  readonly toInitiativeId: string;
}

export interface ScheduleNodeResult {
  readonly initiativeId: string;
  readonly code: string;
  readonly name: string;
  readonly durationWorkingDays: number | null;
  readonly earliestStart: number | null;
  readonly earliestFinish: number | null;
  readonly latestStart: number | null;
  readonly latestFinish: number | null;
  readonly totalFloat: number | null;
  readonly critical: boolean | null;
}

export interface ScheduleEdgeResult {
  readonly dependencyId: string;
  readonly code: string;
  readonly fromInitiativeId: string;
  readonly toInitiativeId: string;
  readonly critical: boolean | null;
}

export type CriticalPathReason = "missing_durations" | "no_initiatives" | "cycle";

export interface CriticalPathResult {
  readonly algorithm: typeof CPM_ALGORITHM;
  readonly status: "computed" | "not_computable";
  readonly reason: CriticalPathReason | null;
  readonly projectDurationWorkingDays: number | null;
  readonly missingDurations: readonly { initiativeId: string; code: string; name: string }[];
  readonly nodes: readonly ScheduleNodeResult[];
  readonly edges: readonly ScheduleEdgeResult[];
  /** Each path is the list of initiative ids from start to finish. */
  readonly criticalPaths: readonly (readonly string[])[];
  readonly truncated: boolean;
}

const byCode = <T extends { code: string }>(a: T, b: T): number => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);

function notComputable(
  reason: CriticalPathReason,
  nodes: readonly ScheduleNodeInput[],
  edges: readonly ScheduleEdgeInput[],
): CriticalPathResult {
  return {
    algorithm: CPM_ALGORITHM,
    status: "not_computable",
    reason,
    projectDurationWorkingDays: null,
    missingDurations: nodes
      .filter((n) => n.durationWorkingDays === null)
      .map((n) => ({ initiativeId: n.initiativeId, code: n.code, name: n.name })),
    nodes: nodes.map((n) => ({
      initiativeId: n.initiativeId,
      code: n.code,
      name: n.name,
      durationWorkingDays: n.durationWorkingDays,
      earliestStart: null,
      earliestFinish: null,
      latestStart: null,
      latestFinish: null,
      totalFloat: null,
      critical: null,
    })),
    edges: edges.map((e) => ({ ...e, critical: null })),
    criticalPaths: [],
    truncated: false,
  };
}

/**
 * The critical path of a network (ADR-0031 §8). Edges whose ends are not both nodes are ignored (an external
 * predecessor has no duration and adds no edge); the caller passes only the network's edges anyway. Nodes and edges are
 * returned in code order.
 */
export function computeCriticalPath(
  nodeInputs: readonly ScheduleNodeInput[],
  edgeInputs: readonly ScheduleEdgeInput[],
): CriticalPathResult {
  const nodes = [...nodeInputs].sort(byCode);
  const ids = new Set(nodes.map((n) => n.initiativeId));
  const edges = [...edgeInputs]
    .filter((e) => ids.has(e.fromInitiativeId) && ids.has(e.toInitiativeId))
    .sort((a, b) => byCode(a, b) || (a.dependencyId < b.dependencyId ? -1 : 1));
  if (nodes.length === 0) return notComputable("no_initiatives", nodes, edges);
  for (const n of nodes) {
    const d = n.durationWorkingDays;
    if (d !== null && (!Number.isInteger(d) || d < 0))
      throw new RangeError(`duration of ${n.code} must be a non-negative integer, got ${String(d)}`);
  }
  if (nodes.some((n) => n.durationWorkingDays === null)) return notComputable("missing_durations", nodes, edges);

  const node = new Map(nodes.map((n) => [n.initiativeId, n]));
  const preds = new Map<string, ScheduleEdgeInput[]>(nodes.map((n) => [n.initiativeId, []]));
  const succs = new Map<string, ScheduleEdgeInput[]>(nodes.map((n) => [n.initiativeId, []]));
  for (const e of edges) {
    preds.get(e.toInitiativeId)!.push(e);
    succs.get(e.fromInitiativeId)!.push(e);
  }

  // 1. Kahn's algorithm; the ready set is kept in code order.
  const indegree = new Map(nodes.map((n) => [n.initiativeId, preds.get(n.initiativeId)!.length]));
  const ready = nodes.filter((n) => indegree.get(n.initiativeId) === 0);
  const order: ScheduleNodeInput[] = [];
  while (ready.length > 0) {
    ready.sort(byCode);
    const n = ready.shift()!;
    order.push(n);
    for (const e of succs.get(n.initiativeId)!) {
      const left = indegree.get(e.toInitiativeId)! - 1;
      indegree.set(e.toInitiativeId, left);
      if (left === 0) ready.push(node.get(e.toInitiativeId)!);
    }
  }
  if (order.length !== nodes.length) return notComputable("cycle", nodes, edges);

  const d = (id: string): number => node.get(id)!.durationWorkingDays!;
  // 2. Forward pass.
  const es = new Map<string, number>();
  const ef = new Map<string, number>();
  for (const n of order) {
    const start = Math.max(0, ...preds.get(n.initiativeId)!.map((e) => ef.get(e.fromInitiativeId)!));
    es.set(n.initiativeId, start);
    ef.set(n.initiativeId, start + d(n.initiativeId));
  }
  const project = Math.max(...[...ef.values()]);
  // 3. Backward pass.
  const lf = new Map<string, number>();
  const ls = new Map<string, number>();
  for (const n of [...order].reverse()) {
    const out = succs.get(n.initiativeId)!;
    const finish = out.length === 0 ? project : Math.min(...out.map((e) => ls.get(e.toInitiativeId)!));
    lf.set(n.initiativeId, finish);
    ls.set(n.initiativeId, finish - d(n.initiativeId));
  }
  // 4. Float and criticality.
  const float = (id: string): number => ls.get(id)! - es.get(id)!;
  const critical = (id: string): boolean => float(id) === 0;
  const edgeCritical = (e: ScheduleEdgeInput): boolean =>
    critical(e.fromInitiativeId) &&
    critical(e.toInitiativeId) &&
    ef.get(e.fromInitiativeId) === es.get(e.toInitiativeId);

  // 5. Critical paths, depth-first in code order.
  const criticalOut = (id: string): ScheduleEdgeInput[] =>
    succs
      .get(id)!
      .filter(edgeCritical)
      .sort((a, b) => byCode(node.get(a.toInitiativeId)!, node.get(b.toInitiativeId)!));
  const hasCriticalIn = (id: string): boolean => preds.get(id)!.some(edgeCritical);
  const paths: string[][] = [];
  let truncated = false;
  const walk = (id: string, trail: string[]): void => {
    if (truncated) return;
    const next = criticalOut(id);
    if (next.length === 0) {
      if (ef.get(id) === project) {
        if (paths.length === MAX_CRITICAL_PATHS) truncated = true;
        else paths.push(trail);
      }
      return;
    }
    for (const e of next) walk(e.toInitiativeId, [...trail, e.toInitiativeId]);
  };
  for (const n of nodes)
    if (critical(n.initiativeId) && es.get(n.initiativeId) === 0 && !hasCriticalIn(n.initiativeId))
      walk(n.initiativeId, [n.initiativeId]);

  return {
    algorithm: CPM_ALGORITHM,
    status: "computed",
    reason: null,
    projectDurationWorkingDays: project,
    missingDurations: [],
    nodes: nodes.map((n) => ({
      initiativeId: n.initiativeId,
      code: n.code,
      name: n.name,
      durationWorkingDays: n.durationWorkingDays,
      earliestStart: es.get(n.initiativeId)!,
      earliestFinish: ef.get(n.initiativeId)!,
      latestStart: ls.get(n.initiativeId)!,
      latestFinish: lf.get(n.initiativeId)!,
      totalFloat: float(n.initiativeId),
      critical: critical(n.initiativeId),
    })),
    edges: edges.map((e) => ({ ...e, critical: edgeCritical(e) })),
    criticalPaths: paths,
    truncated,
  };
}

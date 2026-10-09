// Unit tests of the critical path method `cpm-fs/1` (ADR-0031 §8; REQ-S09-009 A05 "for a fixture network the computed
// critical path matches the expected chain; with missing durations no critical path is claimed"; T-DG4-BE-E).
// Fixture (ADR-0031 §8; durations in working days): INI-01 (5) -> INI-02 (10) -> INI-04 (3); INI-01 -> INI-03 (4) ->
// INI-04. P = 18; critical path INI-01 -> INI-02 -> INI-04; INI-03 has total float 6. SYNTHETIC data.
import { describe, expect, it } from "vitest";
import {
  computeCriticalPath,
  MAX_CRITICAL_PATHS,
  type ScheduleEdgeInput,
  type ScheduleNodeInput,
} from "./critical-path.ts";

const n = (code: string, d: number | null): ScheduleNodeInput => ({
  initiativeId: `id-${code}`,
  code,
  name: `Synthetic ${code}`,
  durationWorkingDays: d,
});
const e = (code: string, from: string, to: string): ScheduleEdgeInput => ({
  dependencyId: `dep-${code}`,
  code,
  fromInitiativeId: `id-${from}`,
  toInitiativeId: `id-${to}`,
});

const fixtureNodes = [n("INI-04", 3), n("INI-02", 10), n("INI-03", 4), n("INI-01", 5)];
const fixtureEdges = [
  e("DEP-01", "INI-01", "INI-02"),
  e("DEP-02", "INI-02", "INI-04"),
  e("DEP-03", "INI-01", "INI-03"),
  e("DEP-04", "INI-03", "INI-04"),
];

describe("computeCriticalPath: the ADR-0031 §8 fixture", () => {
  const r = computeCriticalPath(fixtureNodes, fixtureEdges);

  it("P = 18 and the critical path is INI-01 -> INI-02 -> INI-04", () => {
    expect([r.algorithm, r.status, r.reason, r.projectDurationWorkingDays]).toEqual(["cpm-fs/1", "computed", null, 18]);
    expect(r.criticalPaths).toEqual([["id-INI-01", "id-INI-02", "id-INI-04"]]);
    expect(r.truncated).toBe(false);
    expect(r.missingDurations).toEqual([]);
  });

  it("ES/EF/LS/LF and total float per node; INI-03 has float 6 and is not critical", () => {
    const by = Object.fromEntries(r.nodes.map((x) => [x.code, x]));
    const row = (c: string) => {
      const x = by[c]!;
      return [x.earliestStart, x.earliestFinish, x.latestStart, x.latestFinish, x.totalFloat, x.critical];
    };
    expect(row("INI-01")).toEqual([0, 5, 0, 5, 0, true]);
    expect(row("INI-02")).toEqual([5, 15, 5, 15, 0, true]);
    expect(row("INI-03")).toEqual([5, 9, 11, 15, 6, false]);
    expect(row("INI-04")).toEqual([15, 18, 15, 18, 0, true]);
    expect(r.nodes.map((x) => x.code)).toEqual(["INI-01", "INI-02", "INI-03", "INI-04"]);
  });

  it("an edge is critical iff both ends are critical and EF(from) = ES(to)", () => {
    expect(Object.fromEntries(r.edges.map((x) => [x.code, x.critical]))).toEqual({
      "DEP-01": true,
      "DEP-02": true,
      "DEP-03": false,
      "DEP-04": false,
    });
  });

  it("recompute: lengthening INI-03 to 11 moves the critical path through it (two paths, P = 19)", () => {
    const longer = computeCriticalPath(
      fixtureNodes.map((x) => (x.code === "INI-03" ? n("INI-03", 11) : x)),
      fixtureEdges,
    );
    expect(longer.projectDurationWorkingDays).toBe(19);
    expect(longer.criticalPaths).toEqual([["id-INI-01", "id-INI-03", "id-INI-04"]]);
    const tie = computeCriticalPath(
      fixtureNodes.map((x) => (x.code === "INI-03" ? n("INI-03", 10) : x)),
      fixtureEdges,
    );
    expect(tie.criticalPaths).toEqual([
      ["id-INI-01", "id-INI-02", "id-INI-04"],
      ["id-INI-01", "id-INI-03", "id-INI-04"],
    ]);
  });
});

describe("computeCriticalPath: no claim without complete inputs", () => {
  it("INI-03's duration removed -> not_computable, missingDurations [INI-03], nothing critical", () => {
    const r = computeCriticalPath(
      fixtureNodes.map((x) => (x.code === "INI-03" ? n("INI-03", null) : x)),
      fixtureEdges,
    );
    expect([r.status, r.reason, r.projectDurationWorkingDays]).toEqual(["not_computable", "missing_durations", null]);
    expect(r.missingDurations).toEqual([{ initiativeId: "id-INI-03", code: "INI-03", name: "Synthetic INI-03" }]);
    expect(r.criticalPaths).toEqual([]);
    for (const x of r.nodes) {
      expect(x.critical).toBeNull();
      expect([x.earliestStart, x.earliestFinish, x.latestStart, x.latestFinish, x.totalFloat]).toEqual([
        null,
        null,
        null,
        null,
        null,
      ]);
    }
    expect(r.nodes.find((x) => x.code === "INI-02")!.durationWorkingDays).toBe(10);
    expect(r.edges.every((x) => x.critical === null)).toBe(true);
  });

  it("no node -> not_computable with reason no_initiatives", () => {
    const r = computeCriticalPath([], []);
    expect([r.status, r.reason, r.nodes, r.edges, r.criticalPaths]).toEqual([
      "not_computable",
      "no_initiatives",
      [],
      [],
      [],
    ]);
  });

  it("a cycle (normally refused by the database guard) -> not_computable with reason cycle, nothing critical", () => {
    const r = computeCriticalPath(
      [n("INI-01", 1), n("INI-02", 1)],
      [e("DEP-01", "INI-01", "INI-02"), e("DEP-02", "INI-02", "INI-01")],
    );
    expect([r.status, r.reason]).toEqual(["not_computable", "cycle"]);
    expect(r.nodes.every((x) => x.critical === null)).toBe(true);
  });

  it("an invalid duration is a programming error", () => {
    expect(() => computeCriticalPath([n("INI-01", -1)], [])).toThrow(RangeError);
    expect(() => computeCriticalPath([n("INI-01", 1.5)], [])).toThrow(RangeError);
  });
});

describe("computeCriticalPath: shapes", () => {
  it("a single node is a critical path of length one", () => {
    const r = computeCriticalPath([n("INI-01", 7)], []);
    expect([r.projectDurationWorkingDays, r.criticalPaths]).toEqual([7, [["id-INI-01"]]]);
  });

  it("independent nodes: only the longest is critical; equal ones are each a path", () => {
    const r = computeCriticalPath([n("INI-01", 7), n("INI-02", 3), n("INI-03", 7)], []);
    expect(r.criticalPaths).toEqual([["id-INI-01"], ["id-INI-03"]]);
    expect(r.nodes.find((x) => x.code === "INI-02")!.totalFloat).toBe(4);
  });

  it("an edge to a node outside the network is ignored (an external predecessor adds no edge)", () => {
    const r = computeCriticalPath([n("INI-01", 2)], [e("DEP-01", "EXT-01", "INI-01")]);
    expect([r.edges, r.criticalPaths]).toEqual([[], [["id-INI-01"]]]);
  });

  it("zero-duration milestones keep the path maximal (no prefixes)", () => {
    const r = computeCriticalPath([n("INI-01", 4), n("INI-02", 0)], [e("DEP-01", "INI-01", "INI-02")]);
    expect(r.criticalPaths).toEqual([["id-INI-01", "id-INI-02"]]);
  });

  it(`at most ${MAX_CRITICAL_PATHS} paths, then truncated`, () => {
    const nodes = Array.from({ length: MAX_CRITICAL_PATHS + 3 }, (_, i) =>
      n(`INI-${String(i + 1).padStart(2, "0")}`, 1),
    );
    const r = computeCriticalPath(nodes, []);
    expect(r.criticalPaths).toHaveLength(MAX_CRITICAL_PATHS);
    expect(r.truncated).toBe(true);
  });
});

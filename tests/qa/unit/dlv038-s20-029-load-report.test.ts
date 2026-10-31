// REQ-S20-029 / REQ-DLV-038 (qa-verifier, T-DG6-QA-EB): an independent check of the DG6 load report against the
// binding row text "A22;A13: the load report states the dataset, infrastructure and workload, and gives actual p95
// figures for reads/updates and dashboards, with any miss against 2 s/4 s listed as a finding" (and REQ-DLV-038 "...
// the load report states the actual results against REQ-S20-029").
//
// What this proves, offline and deterministically, from the files DO-G committed (docs/delivery/handbacks/DG6/
// T-DG6-DO-G-evidence/final/):
//  1. every p95 the summary states is recomputed HERE from the raw steady-state samples (samples.csv.gz, gunzipped
//     in-process; nearest rank ceil(0.95 n) over every steady sample, errors included, as ADR-0058 states it), with
//     code written for this test (not DO-G's report.mjs or awk script), and must be equal to the microsecond;
//  2. the report states the dataset (50 transformations, 1,000 initiatives, 10,000 KPI-period actuals, 100,000 audit
//     events), the infrastructure (CPUs, memory, PostgreSQL and its non-default settings) and the workload (100
//     concurrent users, warm-up and steady durations, three repetitions);
//  3. each class's highest p95 is compared with its target (2 s reads/updates/search/export start, 4 s dashboards);
//     the report must list a miss for every class over target, and claims "no miss" only if none is over target.
// It does NOT re-run the load (that needs the dedicated load host and about 40 minutes): it checks that the figures
// are what the raw samples say and that the report states what the row requires. These are engineering measurements
// on a sandbox host, not Mobily production capacity.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const DIR = new URL("../../../docs/delivery/handbacks/DG6/T-DG6-DO-G-evidence/final/", import.meta.url).pathname;
const REPS = ["rep-1", "rep-2", "rep-3"] as const;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const summary: any = JSON.parse(readFileSync(join(DIR, "summary.json"), "utf8"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const infra: any = JSON.parse(readFileSync(join(DIR, "infrastructure.json"), "utf8"));
const report = readFileSync(join(DIR, "report.md"), "utf8");

/** Nearest-rank percentile: the ceil(p/100 * n)-th smallest value (1-based). */
function nearestRank(sorted: readonly number[], p: number): number {
  const k = Math.ceil((p * sorted.length) / 100);
  return sorted[Math.max(0, k - 1)]!;
}

/** Steady-state latencies (integer microseconds) per class of one repetition, parsed here from the raw CSV. Rows that
 * are not well formed are collected (and asserted empty), not skipped. */
function steadyByClass(rep: string): { header: string; bad: string[]; by: Map<string, number[]> } {
  const csv = gunzipSync(readFileSync(join(DIR, rep, "samples.csv.gz"))).toString("utf8");
  const [header = "", ...rows] = csv.split("\n").filter((l) => l !== "");
  const by = new Map<string, number[]>();
  const bad: string[] = [];
  for (const r of rows) {
    const f = r.split(",");
    const micros = Number(f[6]);
    if (f.length !== 7 || !Number.isInteger(micros) || micros < 0) {
      bad.push(r);
      continue;
    }
    if (f[0] !== "steady") continue;
    const list = by.get(f[2]!) ?? [];
    list.push(micros);
    by.set(f[2]!, list);
  }
  return { header, bad, by };
}
// Parsed once at module load (about 107,000 rows), so no test's time budget includes the gunzip and parse.
const RAW = new Map(REPS.map((rep) => [rep, steadyByClass(rep)] as const));

const TARGET_MS: Record<string, number> = {
  read: 2000,
  update: 2000,
  search: 2000,
  dashboard: 4000,
  export: 2000,
  "read+search": 2000,
};

describe("REQ-S20-029: the DG6 load report's p95 figures equal an independent recomputation from the raw samples", () => {
  const recomputed = new Map<string, number[]>(); // group key -> p95 per repetition (micros)
  const counts = new Map<string, number[]>();

  it("three repetitions, each with steady-state samples of the five classes", () => {
    expect(summary.repetitions.map((r: { name: string }) => r.name)).toEqual([...REPS]);
    for (const rep of REPS) {
      const { header, bad, by } = RAW.get(rep)!;
      expect(header).toBe("phase,user,class,operation,status,outcome,micros");
      expect(bad, `${rep}: malformed rows`).toEqual([]);
      expect([...by.keys()].sort()).toEqual(["dashboard", "export", "read", "search", "update"]);
      const groups: Record<string, number[]> = {
        ...Object.fromEntries(by),
        "read+search": [...by.get("read")!, ...by.get("search")!],
      };
      for (const [key, values] of Object.entries(groups)) {
        const sorted = [...values].sort((a, b) => a - b);
        recomputed.set(key, [...(recomputed.get(key) ?? []), nearestRank(sorted, 95)]);
        counts.set(key, [...(counts.get(key) ?? []), sorted.length]);
      }
      const steady = [...by.values()].reduce((n, v) => n + v.length, 0);
      const stated = summary.repetitions.find((r: { name: string }) => r.name === rep).requestsSteady;
      expect(steady, `${rep}: steady samples = requestsSteady`).toBe(stated);
    }
  });

  it("every stated p95 and count (6 groups x 3 repetitions) equals the recomputation to the microsecond", () => {
    expect(recomputed.size).toBe(6);
    const keys = (summary.groups as { key: string }[]).map((g) => g.key).sort();
    expect(keys).toEqual(Object.keys(TARGET_MS).sort());
    for (const g of summary.groups as {
      key: string;
      perRep: { p95: number; count: number }[];
      worstP95Micros: number;
    }[]) {
      expect(
        g.perRep.map((r) => r.p95),
        `${g.key} p95 per repetition`,
      ).toEqual(recomputed.get(g.key));
      expect(
        g.perRep.map((r) => r.count),
        `${g.key} count per repetition`,
      ).toEqual(counts.get(g.key));
      expect(g.worstP95Micros, `${g.key} worst p95`).toBe(Math.max(...recomputed.get(g.key)!));
    }
  });

  it("each class is judged against its target (2 s, dashboards 4 s); a class over target is a listed miss, and 'no miss' is claimed only when none is over", () => {
    const over: string[] = [];
    for (const g of summary.groups as { key: string; targetMs: number; verdict: string }[]) {
      expect(g.targetMs, `${g.key} target`).toBe(TARGET_MS[g.key]);
      const worstMs = Math.max(...recomputed.get(g.key)!) / 1000;
      const miss = worstMs > g.targetMs;
      if (miss) over.push(g.key);
      expect(g.verdict, `${g.key}: highest p95 ${worstMs} ms vs ${g.targetMs} ms`).toBe(
        miss ? "MISS" : "within target",
      );
    }
    const missSection = report.slice(report.indexOf("## 2. Misses"), report.indexOf("## 3."));
    expect(missSection.length, "the report has a misses section").toBeGreaterThan(20);
    if (over.length === 0) expect(missSection).toMatch(/None of the five ADR-0058 §3 classes missed its target/);
    else for (const k of over) expect(missSection.toLowerCase()).toContain(k);
  });
});

describe("REQ-S20-029: the report states the dataset, the infrastructure and the workload", () => {
  it("dataset: 50 transformations, 1,000 initiatives, 10,000 KPI-period actuals, 100,000 audit events (marker and counts at capture)", () => {
    const blocks = [...report.matchAll(/```json\n([\s\S]*?)```/g)].map(
      (m) => JSON.parse(m[1]!) as Record<string, unknown>,
    );
    const atCapture = blocks.find((b) => !("dataset_code" in b) && "kpi_actuals" in b);
    expect(atCapture, "the counts at capture").toBeDefined();
    expect(atCapture).toMatchObject({
      transformations: 50,
      initiatives: 1000,
      kpi_actuals: 10000,
      audit_events: 100000,
    });
    expect(Number(atCapture!["users"])).toBeGreaterThanOrEqual(100);
    const marker = blocks.find((b) => b["dataset_code"] === "mth_load_v1");
    expect(marker).toMatchObject({ transformations: 50, initiatives: 1000, kpi_actuals: 10000, audit_events: 100000 });
  });

  it("infrastructure: CPUs, memory, Node, PostgreSQL with its non-default settings, and the not-production caveat", () => {
    expect(infra.cpu.logicalCpus).toBeGreaterThan(0);
    expect(infra.memory.totalBytes).toBeGreaterThan(0);
    expect(String(infra.node)).toMatch(/^v\d+/);
    expect(String(infra.postgres.version)).toMatch(/^PostgreSQL \d+/);
    expect(Array.isArray(infra.postgres.nonDefaultSettings)).toBe(true);
    expect(report).toMatch(/not Mobily production capacity/);
  });

  it("workload: 100 concurrent users, warm-up excluded, a 600 s steady state, three repetitions with the same seed", () => {
    for (const r of summary.repetitions as {
      users: number;
      warmupSeconds: number;
      steadySeconds: number;
      seed: number;
    }[]) {
      expect(r).toMatchObject({ users: 100, steadySeconds: 600, seed: 20261027 });
      expect(r.warmupSeconds).toBeGreaterThan(0);
    }
    expect(report).toMatch(/100 concurrent virtual users/);
    expect(report).toMatch(/3 repetition\(s\)/);
  });
});

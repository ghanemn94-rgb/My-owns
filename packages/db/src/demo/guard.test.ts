// Unit tests of the demo environment's pure parts (ADR-0050 §3, §5, §9; T-DG5-BE-S): the exact refusal texts and exit
// code, the reset's configuration refusals, the coverage runner (a condition without a query is never counted as 0),
// and the URL helpers the reset uses. The database behaviour is tested in packages/db/test/integration/demo.test.ts.
import { describe, expect, it } from "vitest";
import type { Tx } from "../pool.ts";
import { DEMO_COVERAGE_CONDITIONS, runCoverage, type CoverageCondition } from "./coverage.ts";
import {
  BOOTSTRAP_DEMO_REFUSAL,
  DemoRefused,
  RESET_DEMO_REFUSALS,
  resetDemoConfigRefusal,
  SEED_DEMO_REFUSALS,
} from "./guard.ts";
import { databaseNameOf, urlForDatabase } from "./reset.ts";
import { DEMO_ID_PATTERN, maintenanceUrl } from "./seed.ts";

const tx = {} as Tx;

describe("refusals (ADR-0050 §3, §9: exact texts, exit 3)", () => {
  it("prints `mth-db <command>: refused: <reason>` with exit code 3", () => {
    const e = new DemoRefused("seed-demo", SEED_DEMO_REFUSALS.production);
    expect([e.message, e.exitCode, e.reason]).toEqual([
      "mth-db seed-demo: refused: MTH_ENV is production",
      3,
      "MTH_ENV is production",
    ]);
    expect(new DemoRefused("bootstrap", BOOTSTRAP_DEMO_REFUSAL).message).toBe(
      "mth-db bootstrap: refused: this database is a demo database",
    );
  });

  it("the four seed-demo reasons and the three reset-demo reasons are ADR-0050's", () => {
    expect(Object.values(SEED_DEMO_REFUSALS)).toEqual([
      "MTH_ENV is production",
      "this database was initialized for production",
      "this database is not empty",
      "this database is already a demo database; use reset-demo",
    ]);
    expect(Object.values(RESET_DEMO_REFUSALS)).toEqual([
      "MTH_ENV is not demo",
      "MTH_DEMO_ADMIN_DATABASE_URL is not set",
      "the target database is not a demo database",
    ]);
  });

  it("reset-demo needs MTH_ENV=demo and an admin URL", () => {
    expect(resetDemoConfigRefusal("production", "postgres://a@h/postgres")).toBe(RESET_DEMO_REFUSALS.notDemoEnv);
    expect(resetDemoConfigRefusal("development", "postgres://a@h/postgres")).toBe(RESET_DEMO_REFUSALS.notDemoEnv);
    expect(resetDemoConfigRefusal("demo", null)).toBe(RESET_DEMO_REFUSALS.noAdminUrl);
    expect(resetDemoConfigRefusal("demo", "")).toBe(RESET_DEMO_REFUSALS.noAdminUrl);
    expect(resetDemoConfigRefusal("demo", "postgres://a@h/postgres")).toBeNull();
  });
});

describe("the coverage runner (ADR-0050 §5)", () => {
  it("lists every ADR-0050 §5 condition: T01-T16, G1-G6, six phases, ten TOM dimensions, six areas and the eight states", () => {
    const codes = DEMO_COVERAGE_CONDITIONS.map((c) => c.code);
    expect(codes).toHaveLength(16 + 6 + 6 + 10 + 6 + 8);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.slice(0, 2)).toEqual(["template.t01", "template.t02"]);
    expect(codes).toContain("template.t16");
    expect(codes).toContain("gate.g6");
    expect(codes).toContain("tom.dimension_10");
    expect(codes).toContain("dashboard.area_6");
    for (const c of [
      "health_assessment.submitted",
      "kpi.stale",
      "decision.overdue",
      "benefit.shared",
      "adoption.gap",
      "bau.handover",
      "evidence.missing",
      "approval.pending",
    ])
      expect(codes).toContain(c);
  });

  it("a condition without a query is not counted (never 0) and makes the run incomplete", async () => {
    const r = await runCoverage(tx, "t", [
      { code: "a", requirement: "a", query: async () => 2 },
      { code: "b", requirement: "b", query: null },
    ]);
    expect(r).toEqual({ counts: { a: 2 }, notImplemented: ["b"], complete: false });
  });

  it("complete only when every condition has a query and a count >= 1", async () => {
    const one: CoverageCondition = { code: "a", requirement: "a", query: async () => 1 };
    const zero: CoverageCondition = { code: "b", requirement: "b", query: async () => 0 };
    expect((await runCoverage(tx, "t", [one])).complete).toBe(true);
    expect(await runCoverage(tx, "t", [one, zero])).toEqual({
      counts: { a: 1, b: 0 },
      notImplemented: [],
      complete: false,
    });
  });

  it("refuses an invalid count", async () => {
    await expect(runCoverage(tx, "t", [{ code: "x", requirement: "x", query: async () => -1 }])).rejects.toThrow(
      /invalid count/,
    );
  });
});

describe("helpers", () => {
  it("fixed demo ids are literal UUIDs in 01995000-…", () => {
    expect(DEMO_ID_PATTERN.test("01995000-0000-7000-8000-000000000001")).toBe(true);
    expect(DEMO_ID_PATTERN.test("01995001-0000-7000-8000-000000000001")).toBe(false);
  });

  it("maps URLs to the maintenance database and to the target database, keeping credentials and options", () => {
    const url = "postgresql://admin:pw@127.0.0.1:24450/mth_demo?options=-c%20role%3Dmth_owner";
    expect(maintenanceUrl(url)).toBe("postgresql://admin:pw@127.0.0.1:24450/postgres?options=-c%20role%3Dmth_owner");
    expect(databaseNameOf(url)).toBe("mth_demo");
    expect(urlForDatabase("postgresql://admin:pw@127.0.0.1:24450/postgres", "mth_demo")).toBe(
      "postgresql://admin:pw@127.0.0.1:24450/mth_demo",
    );
    expect(() => databaseNameOf("postgresql://a@h/bad;name")).toThrow(/plain identifier/);
  });
});

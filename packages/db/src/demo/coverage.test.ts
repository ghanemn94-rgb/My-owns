// The seed-coverage condition list (ADR-0050 §5; REQ-S18-002; T-DG5-BE-T). Unit level (no database): every condition
// of ADR-0050 §5 is listed once, in order, and has its count query. The database test that seeds the roaming dataset
// and asserts each count is packages/db/test/integration/demo-roaming.test.ts (the integration project's location;
// a test under packages/*/src runs in the unit-node project, which has no database).
import { describe, expect, it } from "vitest";
import { DEMO_COVERAGE_CONDITIONS, DEMO_TRANSFORMATION_ID } from "./coverage.ts";

const pad = (n: number): string => String(n).padStart(2, "0");

/** ADR-0050 §5, in order. */
const EXPECTED_CODES = [
  ...Array.from({ length: 16 }, (_, i) => `template.t${pad(i + 1)}`),
  ...Array.from({ length: 6 }, (_, i) => `gate.g${i + 1}`),
  ...Array.from({ length: 6 }, (_, i) => `phase.${i + 1}`),
  ...Array.from({ length: 10 }, (_, i) => `tom.dimension_${pad(i + 1)}`),
  ...Array.from({ length: 6 }, (_, i) => `dashboard.area_${i + 1}`),
  "health_assessment.submitted",
  "kpi.stale",
  "decision.overdue",
  "benefit.shared",
  "adoption.gap",
  "bau.handover",
  "evidence.missing",
  "approval.pending",
];

describe("REQ-S18-002: the seed-coverage conditions (ADR-0050 §5)", () => {
  it("lists every condition of ADR-0050 §5 exactly once, in order", () => {
    expect(DEMO_COVERAGE_CONDITIONS.map((c) => c.code)).toEqual(EXPECTED_CODES);
    expect(new Set(DEMO_COVERAGE_CONDITIONS.map((c) => c.code)).size).toBe(EXPECTED_CODES.length);
  });

  it("gives every condition its count query (none is left unimplemented) and an English requirement", () => {
    for (const c of DEMO_COVERAGE_CONDITIONS) {
      expect(typeof c.query, c.code).toBe("function");
      expect(c.requirement.length, c.code).toBeGreaterThan(0);
    }
  });

  it("reads the one roaming transformation, whose id is a fixed 01995000-… literal", () => {
    expect(DEMO_TRANSFORMATION_ID).toMatch(/^01995000-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

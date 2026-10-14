// Unit tests of the pure condition evaluator (ADR-0043 §2, §10; T-DG5-BE-H2): AND semantics, decimal comparison
// without floats, and Unknown never treated as 0 or as a match (automation.condition_unknown_value).
import { describe, expect, it } from "vitest";
import { evaluateConditions } from "./conditions.ts";

describe("evaluateConditions", () => {
  it("an empty list holds; every condition must hold (AND)", () => {
    expect(evaluateConditions([], {})).toEqual({ met: true, findings: [] });
    const both = [
      { field: "gateCode", op: "eq" as const, value: "G3" },
      { field: "outcome", op: "in" as const, value: ["approved", "deferred"] },
    ];
    expect(evaluateConditions(both, { gateCode: "G3", outcome: "approved" }).met).toBe(true);
    expect(evaluateConditions(both, { gateCode: "G3", outcome: "rejected" }).met).toBe(false);
  });

  it("compares decimal strings exactly (0.1 + 0.2 territory never involves a float)", () => {
    const gt = [{ field: "v", op: "gt" as const, value: "0.3" }];
    expect(evaluateConditions(gt, { v: "0.300001" }).met).toBe(true);
    expect(evaluateConditions(gt, { v: "0.3" }).met).toBe(false);
    expect(evaluateConditions([{ field: "v", op: "gte" as const, value: "-1.5" }], { v: "-1.5" }).met).toBe(true);
    expect(evaluateConditions([{ field: "v", op: "lt" as const, value: "10" }], { v: 9 }).met).toBe(true);
    expect(
      evaluateConditions([{ field: "v", op: "lte" as const, value: "999999999999999999" }], {
        v: "1000000000000000000",
      }).met,
    ).toBe(false);
  });

  it("a missing, null, float or non-decimal value is not met, with the finding; never 0", () => {
    for (const payload of [{}, { v: null }, { v: 0.5 }, { v: "1e3" }, { v: "abc" }, { v: true }]) {
      const r = evaluateConditions([{ field: "v", op: "gte" as const, value: "0" }], payload);
      expect(r, JSON.stringify(payload)).toEqual({
        met: false,
        findings: [{ code: "automation.condition_unknown_value", pointer: "/conditions/0", field: "v" }],
      });
    }
    // neq on a missing value is Unknown too: it never matches by default.
    expect(evaluateConditions([{ field: "g", op: "neq" as const, value: "G3" }], {}).met).toBe(false);
  });

  it("present / absent never produce a finding; booleans compare as booleans", () => {
    expect(evaluateConditions([{ field: "x", op: "present" as const }], { x: 0 })).toEqual({ met: true, findings: [] });
    expect(evaluateConditions([{ field: "x", op: "absent" as const }], { x: null })).toEqual({
      met: true,
      findings: [],
    });
    expect(evaluateConditions([{ field: "f", op: "eq" as const, value: true }], { f: "true" }).met).toBe(false);
    expect(evaluateConditions([{ field: "f", op: "eq" as const, value: true }], { f: true }).met).toBe(true);
    // An inherited member is not the payload's own value.
    expect(evaluateConditions([{ field: "toString", op: "present" as const }], {}).met).toBe(false);
  });
});

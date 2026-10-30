// The three-way grouping of compare-and-reapply (T-DG6-FE-D2; ADR-0057 §7; REQ-S16-026 A14: "the UI offers compare
// and reapply without losing the first change"). SYNTHETIC values.
import { describe, expect, it } from "vitest";
import { allResolved, mergedValues, reapplyKeys, sameValue, threeWay } from "./threeWay.ts";

const KEYS = ["name", "objective", "risksSummary", "plannedEnd", "scopeIn"];
const B = { name: "Alpha", objective: "Grow", risksSummary: "", plannedEnd: null, scopeIn: "Retail" };

describe("threeWay (ADR-0057 §7)", () => {
  it("groups my changes, their changes, conflicts and agreed values", () => {
    const M = { ...B, name: "Alpha 2", objective: "Grow fast", scopeIn: "Retail and B2B" };
    const C = { ...B, objective: "Grow safely", risksSummary: "Vendor delay", scopeIn: "Retail and B2B" };
    expect(threeWay(KEYS, B, M, C)).toEqual({
      mine: ["name"],
      theirs: ["risksSummary"],
      conflicts: ["objective"],
      agreed: ["scopeIn"],
    });
  });

  it("never sends a field only they changed (the first change stays intact)", () => {
    const M = { ...B, name: "Alpha 2" };
    const C = { ...B, objective: "Theirs" };
    const r = threeWay(KEYS, B, M, C);
    expect(reapplyKeys(r, {})).toEqual(["name"]);
    expect(mergedValues(C, M, ["name"])).toEqual({ ...B, name: "Alpha 2", objective: "Theirs" });
  });

  it("asks for a choice on every conflict before reapplying, and honours it", () => {
    const M = { ...B, name: "Mine", objective: "Mine" };
    const C = { ...B, name: "Theirs", objective: "Theirs" };
    const r = threeWay(KEYS, B, M, C);
    expect(r.conflicts).toEqual(["name", "objective"]);
    expect(allResolved(r, { name: "mine" })).toBe(false);
    expect(reapplyKeys(r, { name: "mine" })).toBeNull();
    expect(reapplyKeys(r, { name: "mine", objective: "theirs" })).toEqual(["name"]);
    expect(reapplyKeys(r, { name: "theirs", objective: "theirs" })).toEqual([]);
  });

  it("treats a missing value and null alike, and compares decimals as text (no float)", () => {
    expect(sameValue(undefined, null)).toBe(true);
    expect(sameValue("1.10", "1.1")).toBe(false);
    expect(threeWay(["x"], {}, { x: null }, {})).toEqual({ mine: [], theirs: [], conflicts: [], agreed: [] });
  });
});

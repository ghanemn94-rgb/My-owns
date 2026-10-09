// The pure Transform readiness checks (REQ-PB-008, B0013 "Operating model before execution"; ADR-0026 §9;
// T-DG4-BE-C): "readiness for Transform shows 'not ready' when T11 or charter decision rights are empty and 'ready'
// once they are completed". Integration: governance/raci-matrices.test.ts.
import { describe, expect, it } from "vitest";
import { transformReadinessChecks, type TransformReadinessFacts } from "./readiness.ts";

const SEEDED = [
  { templateKey: "business_scope_change", status: "active", approvePartyCode: "SP" },
  { templateKey: "funding_reallocation", status: "active", approvePartyCode: "STEERCO" },
  { templateKey: "target_state_design", status: "active", approvePartyCode: "BO" },
  { templateKey: "go_live_scale", status: "active", approvePartyCode: "BO" },
];
const complete: TransformReadinessFacts = {
  charterDecisionRights: "Synthetic: the T11 matrix applies.",
  decisionRights: SEEDED,
  mappedParties: new Set(["SP", "STEERCO", "BO"]),
  raciDeliverables: [
    { key: "bau_handover", status: "active", accountabilityException: null, values: ["I", "A/R", "R"] },
  ],
};
const passed = (f: TransformReadinessFacts) => transformReadinessChecks(f).map((c) => [c.code, c.passed, c.missing]);

describe("Transform readiness checks (REQ-PB-008)", () => {
  it("all four pass on completed content (A/R counts as the one accountable)", () => {
    expect(passed(complete)).toEqual([
      ["charter_decision_rights", true, []],
      ["t11_seeded_decisions", true, []],
      ["t11_approvers_mapped", true, []],
      ["t12_accountable", true, []],
    ]);
  });

  it("empty or blank charter decision rights fail (the shared hasText rule)", () => {
    expect(passed({ ...complete, charterDecisionRights: null })[0]).toEqual([
      "charter_decision_rights",
      false,
      ["charter.decision_rights"],
    ]);
    expect(passed({ ...complete, charterDecisionRights: " ‏ " })[0]![1]).toBe(false);
  });

  it("an empty T11 fails, naming the four seeded decisions; a retired seeded row is missing", () => {
    expect(passed({ ...complete, decisionRights: [] })[1]).toEqual([
      "t11_seeded_decisions",
      false,
      ["business_scope_change", "funding_reallocation", "target_state_design", "go_live_scale"],
    ]);
    const retired = SEEDED.map((r) => (r.templateKey === "go_live_scale" ? { ...r, status: "retired" } : r));
    expect(passed({ ...complete, decisionRights: retired })[1]).toEqual([
      "t11_seeded_decisions",
      false,
      ["go_live_scale"],
    ]);
  });

  it("an unmapped Approve party fails once, by party; two accountable cells fail unless an exception is documented", () => {
    expect(passed({ ...complete, mappedParties: new Set(["SP"]) })[2]).toEqual([
      "t11_approvers_mapped",
      false,
      ["STEERCO", "BO"],
    ]);
    const two = { key: "charter", status: "active", accountabilityException: null, values: ["A", "A"] };
    expect(passed({ ...complete, raciDeliverables: [two] })[3]).toEqual(["t12_accountable", false, ["charter"]]);
    expect(
      passed({ ...complete, raciDeliverables: [{ ...two, accountabilityException: "Synthetic rule GR-1" }] })[3]![1],
    ).toBe(true);
  });
});

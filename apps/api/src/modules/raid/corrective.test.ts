// Unit tests of the corrective half of the raid module (T-DG4-BE-D2; ADR-0031 §5.2, §5.5, §11): the rule-shape refusals,
// the Value Review scope key, the default rules as the API reports them, and the database last-line mappings of the
// corrective constraints (the API returns the same codes and exact English texts first).
import { describe, expect, it } from "vitest";
import { HttpProblem, mapDatabaseGuardError } from "../platform/index.ts";
import { valueReviewScopeKey } from "./corrective-cases.ts";
import { checkRuleShape, defaultRule } from "./corrective-rules.ts";

const refusal = (fn: () => void): HttpProblem => {
  try {
    fn();
  } catch (err) {
    if (err instanceof HttpProblem) return err;
    throw err;
  }
  throw new Error("expected a refusal");
};

describe("corrective rules (ADR-0031 §5.2)", () => {
  it("a severity for KPI deviations only, and required there; persistence > 1 for the series kinds only", () => {
    expect(() => checkRuleShape("kpi_deviation", "red", 2)).not.toThrow();
    expect(() => checkRuleShape("benefit_variance", null, 4)).not.toThrow();
    expect(refusal(() => checkRuleShape("kpi_deviation", null, 2)).code).toBe("corrective_rule.severity_kpi_only");
    expect(refusal(() => checkRuleShape("control_check", "amber", 1)).code).toBe("corrective_rule.severity_kpi_only");
    const p = refusal(() => checkRuleShape("adoption_check", null, 2));
    expect([p.status, p.code, p.detail]).toEqual([
      422,
      "corrective_rule.persistence_series_only",
      "A failed check is one event: its persistence is 1 cycle.",
    ]);
  });
  it("reports the defaults with isDefault and no id or version", () => {
    expect(defaultRule("kpi_deviation")).toEqual({
      id: null,
      sourceKind: "kpi_deviation",
      minKpiRag: "red",
      persistenceCycles: 2,
      followUpWorkingDays: 5,
      enabled: true,
      isDefault: true,
      version: null,
    });
  });
});

describe("Value Review scope key (ADR-0031 §5.5)", () => {
  it("is value_review: + the trimmed, lower-cased finding reference", () => {
    expect(valueReviewScopeKey("  VR-2026-Q3 Item 4 ")).toBe("value_review:vr-2026-q3 item 4");
  });
});

describe("database last lines of the corrective constraints (ADR-0031 §11)", () => {
  const map = (constraint: string) => mapDatabaseGuardError({ code: "23514", constraint, message: "x" });
  it("maps each to its code and exact text", () => {
    const rows: [string, number, string, string][] = [
      [
        "corrective_case_status_transition",
        422,
        "corrective_case.status_transition",
        "A corrective action moves between Open and In progress; use Close to close it.",
      ],
      [
        "corrective_case_starts_open",
        422,
        "corrective_case.status_transition",
        "A corrective action moves between Open and In progress; use Close to close it.",
      ],
      [
        "corrective_case_closed_final",
        422,
        "corrective_case.closed",
        "This corrective action is closed and can no longer be changed.",
      ],
      [
        "corrective_case_owner_required",
        422,
        "corrective_case.owner_required",
        "Assign an owner before closing this corrective action.",
      ],
      [
        "corrective_action_rule_severity_kpi_only",
        422,
        "corrective_rule.severity_kpi_only",
        "A severity applies to KPI deviations only, and a KPI deviation rule needs one.",
      ],
      [
        "corrective_action_rule_persistence_series_only",
        422,
        "corrective_rule.persistence_series_only",
        "A failed check is one event: its persistence is 1 cycle.",
      ],
      [
        "corrective_action_rule_source_key",
        409,
        "corrective_rule.exists",
        "A rule for this source already exists in this transformation; update it instead.",
      ],
    ];
    for (const [constraint, status, code, detail] of rows) {
      const p = map(constraint)!;
      expect([constraint, p.status, p.code, p.detail]).toEqual([constraint, status, code, detail]);
    }
    expect([map("corrective_case_one_open_key")!.status, map("corrective_case_one_open_key")!.code]).toEqual([
      409,
      "corrective_case.already_open",
    ]);
    expect(map("corrective_case_code_key")!.status).toBe(409);
    for (const internal of [
      "corrective_case_source_fields",
      "corrective_case_created_source",
      "corrective_case_source_immutable",
      "corrective_case_one_per_check_key",
      "corrective_action_rule_source_immutable",
      "corrective_signal_outcome_case",
    ])
      expect([internal, map(internal)!.status]).toEqual([internal, 500]);
  });
});

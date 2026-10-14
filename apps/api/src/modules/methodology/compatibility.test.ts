// Unit tests of the ADR-0039 §5 compatibility classification (T-DG5-BE-B). Pure: no database. Synthetic values.
import { describe, expect, it } from "vitest";
import { classifyChange } from "./compatibility.ts";

const at = { elementType: "gate" as const, stableKey: "G3" };

describe("classifyChange (ADR-0039 §5)", () => {
  it("label and help text only is compatible", () => {
    expect(
      classifyChange({
        ...at,
        change: "changed",
        from: { labelEn: "a", helpAr: "x" },
        to: { labelEn: "b", helpAr: "y" },
      }),
    ).toBeNull();
    expect(classifyChange({ ...at, change: "changed", from: { labelEn: "a" }, to: { labelEn: "a" } })).toBeNull();
  });

  it("a changed approver or routing mode warns", () => {
    for (const [from, to] of [
      [{ defaultApproverRoleCode: "SP" }, { defaultApproverRoleCode: "BO" }],
      [{ approverRoleCodes: ["SP"] }, { approverRoleCodes: ["SP", "BO"] }],
      [{ mode: "any" }, { mode: "sequential" }],
    ] as const)
      expect(classifyChange({ ...at, change: "changed", from, to })).toMatchObject({
        severity: "warn",
        code: "compatibility.approver_changed",
      });
  });

  it("any other behavioural change warns; a removal warns; only a mandatory addition warns", () => {
    expect(
      classifyChange({ ...at, change: "changed", from: { submissionEnabled: true }, to: { submissionEnabled: false } }),
    ).toMatchObject({
      severity: "warn",
      code: "compatibility.behaviour_changed",
      params: { fields: "submissionEnabled" },
    });
    expect(classifyChange({ ...at, change: "removed", from: {}, to: null })).toMatchObject({
      code: "compatibility.element_removed",
    });
    expect(classifyChange({ ...at, change: "added", from: null, to: { mandatory: true } })).toMatchObject({
      code: "compatibility.required_element_added",
    });
    expect(classifyChange({ ...at, change: "added", from: null, to: { mandatory: false } })).toBeNull();
  });
});

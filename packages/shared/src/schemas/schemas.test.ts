// Unit tests of zod mirror details that differ from a naive reading of the contract.
import { describe, expect, it } from "vitest";
import {
  BLANK_TEXT_CODE,
  charterUpdate,
  charterWrite,
  composeThesis,
  decisionCreate,
  diagnosticItemUpdate,
  evidenceCreate,
  freeText,
  gateDecisionCreate,
  gateSubmissionCreate,
  hasText,
  kpiDefinitionCreate,
  me,
  role,
  roleAssignmentCreate,
  tomGapUpdate,
} from "./index.ts";

const base = {
  userId: "01920000-0000-7000-8000-000000000001",
  roleCode: "TL",
  scope: { type: "organization", id: "01920000-0000-7000-8000-000000000002" },
  reason: "Synthetic reason",
};

describe("roleAssignmentCreate effective range", () => {
  it("compares instants, not strings, across offsets", () => {
    // 10:00+03:00 is 07:00Z, i.e. BEFORE 08:00Z, although the string "2026-01-01T10..." sorts after "2026-01-01T08...".
    expect(
      roleAssignmentCreate.safeParse({
        ...base,
        effectiveFrom: "2026-01-01T10:00:00+03:00",
        effectiveTo: "2026-01-01T08:00:00Z",
      }).success,
    ).toBe(true);
    expect(
      roleAssignmentCreate.safeParse({
        ...base,
        effectiveFrom: "2026-01-01T08:00:00Z",
        effectiveTo: "2026-01-01T10:00:00+03:00",
      }).success,
    ).toBe(false);
  });
});

describe("uniqueItems mirrors", () => {
  it("rejects duplicate permissions in Role and Me.effectivePermissions", () => {
    const r = {
      id: base.userId,
      code: "TL",
      nameEn: "x",
      nameAr: "x",
      kind: "source",
      inheritsDownward: false,
      permissions: ["role.read", "role.read"],
    };
    expect(role.safeParse(r).success).toBe(false);
    expect(role.safeParse({ ...r, permissions: ["role.read"] }).success).toBe(true);
    const shape = me.shape.effectivePermissions.element;
    expect(
      shape.safeParse({ scope: base.scope, inheritsDownward: true, permissions: ["audit.read", "audit.read"] }).success,
    ).toBe(false);
  });
});

// F-DG2-150 (T-DG2-BE5): blank free text is never stored as content; `null` clears a nullable field.
describe("blank free text (F-DG2-150)", () => {
  const OWNER = "01920000-0000-7000-8000-000000000001";
  const codes = (r: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } }) =>
    r.success ? [] : r.error!.issues.map((i) => [i.path.join("/"), i.message]);

  it("hasText: only a string with a non-whitespace character is present", () => {
    for (const v of [null, undefined, "", " ", "   ", "\t\n\r ", "\u00a0", "\u3000"])
      expect(hasText(v), JSON.stringify(v)).toBe(false);
    for (const v of ["a", " a ", "\u0645", ".", "  x\n"]) expect(hasText(v), JSON.stringify(v)).toBe(true);
  });

  it("freeText rejects whitespace-only text with validation.blank, keeps the text as entered, and stays typed", () => {
    expect(BLANK_TEXT_CODE).toBe("validation.blank");
    expect(codes(freeText(1, 10).safeParse("   "))).toEqual([["", "validation.blank"]]);
    expect(codes(freeText(1, 10).safeParse("\u00a0\t"))).toEqual([["", "validation.blank"]]);
    // An empty string fails `min` only (one error, not two).
    const empty = freeText(1, 10).safeParse("");
    expect(empty.error!.issues.map((i) => i.code)).toEqual(["too_small"]);
    // Rationale-style minimum: three spaces satisfy min(3) but are still blank.
    expect(codes(freeText(3, 10).safeParse("   "))).toEqual([["", "validation.blank"]]);
    // Optional fields with no minimum still accept "", but never spaces alone.
    expect(freeText(0, 10).safeParse("").success).toBe(true);
    expect(codes(freeText(0, 10).safeParse("  "))).toEqual([["", "validation.blank"]]);
    // No trimming transform: the stored value is exactly what was entered.
    expect(freeText(1, 20).parse("  padded text  ")).toBe("  padded text  ");
    expect(freeText(1, 10).nullable().parse(null)).toBeNull();
    const typed: string | null | undefined = freeText(1, 10).nullable().optional().parse(undefined);
    expect(typed).toBeUndefined();
  });

  it("every kind of P2 free text rejects a blank value with a pointer to the field", () => {
    expect(codes(charterUpdate.safeParse({ inScope: "  ", changeSummary: "Synthetic" }))).toEqual([
      ["inScope", "validation.blank"],
    ]);
    expect(codes(charterWrite.safeParse({ caseForChange: "\n\n" }))).toEqual([["caseForChange", "validation.blank"]]);
    expect(codes(charterWrite.safeParse({ thesisBecause: " " }))).toEqual([["thesisBecause", "validation.blank"]]);
    expect(codes(charterUpdate.safeParse({ inScope: "Synthetic", changeSummary: "   " }))).toEqual([
      ["changeSummary", "validation.blank"],
    ]);
    expect(codes(diagnosticItemUpdate.safeParse({ currentState: "   " }))).toEqual([
      ["currentState", "validation.blank"],
    ]);
    expect(codes(diagnosticItemUpdate.safeParse({ rootCause: "\t" }))).toEqual([["rootCause", "validation.blank"]]);
    expect(codes(tomGapUpdate.safeParse({ gap: "  " }))).toEqual([["gap", "validation.blank"]]);
    expect(codes(decisionCreate.safeParse({ transformationId: OWNER, title: "   " }))).toEqual([
      ["title", "validation.blank"],
    ]);
    expect(
      codes(kpiDefinitionCreate.safeParse({ name: "  ", unitKind: "count", polarity: "higher_is_better" })),
    ).toEqual([["name", "validation.blank"]]);
    expect(
      codes(evidenceCreate.safeParse({ kind: "note", title: "Synthetic", ownerUserId: OWNER, noteBody: "   " })),
    ).toEqual([["noteBody", "validation.blank"]]);
    expect(codes(gateSubmissionCreate.safeParse({ submissionNote: "  " }))).toEqual([
      ["submissionNote", "validation.blank"],
    ]);
    expect(codes(gateDecisionCreate.safeParse({ submissionNo: 1, outcome: "approved", rationale: "    " }))).toEqual([
      ["rationale", "validation.blank"],
    ]);
  });

  it("null still clears a nullable field, and valid text still passes", () => {
    expect(charterUpdate.safeParse({ inScope: null, changeSummary: "Synthetic" }).success).toBe(true);
    expect(diagnosticItemUpdate.safeParse({ currentState: null }).success).toBe(true);
    expect(tomGapUpdate.safeParse({ gap: null }).success).toBe(true);
    expect(diagnosticItemUpdate.safeParse({ currentState: "Synthetic manual billing" }).success).toBe(true);
  });

  it("a blank thesis part is incomplete", () => {
    const parts = { thesisChange: "x", thesisOutcomes: "y", thesisBenefits: "z", thesisBecause: "  \t " };
    expect(composeThesis(parts)).toEqual({ complete: false, missing: ["thesisBecause"], sentence: null });
    expect(composeThesis({ ...parts, thesisBecause: "w" }).complete).toBe(true);
  });
});

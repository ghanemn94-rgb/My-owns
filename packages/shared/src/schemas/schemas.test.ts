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
  hasVisibleContent,
  kpiDefinitionCreate,
  me,
  name,
  reason,
  reasonRequest,
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

  // F-DG2-160 (T-DG2-BE6): "blank" means no visible content (White_Space, Cf format characters, invisible fillers).
  const INVISIBLE: ReadonlyArray<readonly [string, string]> = [
    ["U+0085 NEXT LINE", "\u0085"],
    ["U+200B ZERO WIDTH SPACE", "\u200b"],
    ["U+200C ZWNJ", "\u200c"],
    ["U+200D ZWJ", "\u200d"],
    ["U+2060 WORD JOINER", "\u2060"],
    ["U+200E LRM", "\u200e"],
    ["U+200F RLM", "\u200f"],
    ["U+061C ARABIC LETTER MARK", "\u061c"],
    ["U+00AD SOFT HYPHEN", "\u00ad"],
    ["U+180E MONGOLIAN VOWEL SEPARATOR", "\u180e"],
    ["U+FEFF BOM", "\ufeff"],
    ["U+115F HANGUL CHOSEONG FILLER", "\u115f"],
    ["U+1160 HANGUL JUNGSEONG FILLER", "\u1160"],
    ["U+3164 HANGUL FILLER", "\u3164"],
    ["U+FFA0 HALFWIDTH HANGUL FILLER", "\uffa0"],
    ["U+2800 BRAILLE PATTERN BLANK", "\u2800"],
    ["U+00A0 NBSP", "\u00a0"],
    ["U+2028 LINE SEPARATOR", "\u2028"],
    ["U+3000 IDEOGRAPHIC SPACE", "\u3000"],
    // F-DG2-180 (T-DG2-BE8): Default_Ignorable code points outside Cf, controls (Cc) and lone surrogates (Cs).
    ["U+FE00 VARIATION SELECTOR-1", "\ufe00"],
    ["U+FE0E VARIATION SELECTOR-15", "\ufe0e"],
    ["U+FE0F VARIATION SELECTOR-16", "\ufe0f"],
    ["U+E0100 VARIATION SELECTOR-17", "\u{E0100}"],
    ["U+E01EF VARIATION SELECTOR-256", "\u{E01EF}"],
    ["U+034F COMBINING GRAPHEME JOINER", "\u034f"],
    ["U+180B MONGOLIAN FVS1", "\u180b"],
    ["U+180C MONGOLIAN FVS2", "\u180c"],
    ["U+180D MONGOLIAN FVS3", "\u180d"],
    ["U+180F MONGOLIAN FVS4", "\u180f"],
    ["U+17B4 KHMER VOWEL INHERENT AQ", "\u17b4"],
    ["U+17B5 KHMER VOWEL INHERENT AA", "\u17b5"],
    ["U+E0041 TAG LATIN CAPITAL LETTER A", "\u{E0041}"],
    ["U+0001 START OF HEADING (Cc)", "\u0001"],
    ["U+001F UNIT SEPARATOR (Cc)", "\u001f"],
    ["U+007F DELETE (Cc)", "\u007f"],
    ["U+0080 C1 control (Cc)", "\u0080"],
    ["U+009F C1 control (Cc)", "\u009f"],
    ["lone low surrogate U+DC00 (Cs)", "\udc00"],
    ["lone high surrogate U+D800 (Cs)", "\ud800"], // last, so the mix below never forms a pair
  ];

  it.each(INVISIBLE)("invisible-only %s, alone and repeated, is blank and not present (F-DG2-160)", (_label, ch) => {
    for (const v of [ch, ch.repeat(3), `${ch} ${ch}\t`]) {
      expect(hasVisibleContent(v), JSON.stringify(v)).toBe(false);
      expect(hasText(v), JSON.stringify(v)).toBe(false);
      expect(codes(freeText(1, 20).safeParse(v)), JSON.stringify(v)).toEqual([["", "validation.blank"]]);
      expect(codes(freeText(0, 20).nullable().safeParse(v)), JSON.stringify(v)).toEqual([["", "validation.blank"]]);
    }
  });

  it("a mix of every invisible code point is still blank, on every kind of P2 field (F-DG2-160)", () => {
    const all = INVISIBLE.map(([, ch]) => ch).join("");
    expect(hasText(all)).toBe(false);
    expect(codes(charterUpdate.safeParse({ outOfScope: "\u200f", changeSummary: "Synthetic" }))).toEqual([
      ["outOfScope", "validation.blank"],
    ]);
    expect(codes(charterWrite.safeParse({ caseForChange: "\u2060\u2060\u2060" }))).toEqual([
      ["caseForChange", "validation.blank"],
    ]);
    expect(codes(diagnosticItemUpdate.safeParse({ currentState: "\u061c" }))).toEqual([
      ["currentState", "validation.blank"],
    ]);
    expect(codes(gateDecisionCreate.safeParse({ submissionNo: 1, outcome: "approved", rationale: all }))).toEqual([
      ["rationale", "validation.blank"],
    ]);
  });

  it("visible content with invisible marks is accepted, present and stored verbatim (F-DG2-160)", () => {
    const accepted = [
      "\u200fقطاع الشركات خارج النطاق\u200f", // Arabic with RLM marks
      "\u061cالفوترة اليدوية", // Arabic with ALM
      "\u{1F469}\u200d\u{1F4BB}", // emoji ZWJ sequence (woman technologist)
      "\u{1F468}\u200d\u{1F469}\u200d\u{1F467}", // family ZWJ sequence
      "\u200bleading ZWSP",
      "trailing ZWSP\u200b",
      "x",
      "\u0645",
      "\u00a0.\u00a0",
      ...INVISIBLE.map(([, ch]) => `${ch}a${ch}`),
      // F-DG2-180: visible text with default-ignorable marks stays accepted and verbatim.
      "\u2764\ufe0f", // emoji with VS16 (red heart)
      "\u{1F44D}\u{1F3FD}\ufe0f", // emoji with a skin-tone modifier and VS16
      "\u200f\u0633\u0628\u0628\u200f", // Arabic with RLM
      "\u1820\u180b\u1821", // Mongolian letters with an FVS
      "\u1820\u180f", // Mongolian letter with FVS4
      "e\u0301", // letter with a combining acute accent
      "\u0915\u094d\u0937", // Devanagari conjunct with a virama
      "\u8fbb\u{E0100}", // CJK ideograph with an ideographic variation selector
      "\u{1F600}", // astral emoji (a surrogate pair is not a lone surrogate)
    ];
    for (const v of accepted) {
      expect(hasVisibleContent(v), JSON.stringify(v)).toBe(true);
      expect(hasText(v), JSON.stringify(v)).toBe(true);
      expect(freeText(1, 100).parse(v)).toBe(v);
    }
    const arabic = "\u200fقطاع الشركات خارج النطاق\u200f";
    expect(charterUpdate.parse({ outOfScope: arabic, changeSummary: "Synthetic" }).outOfScope).toBe(arabic);
  });

  it("an invisible-only thesis part is incomplete (F-DG2-160)", () => {
    const parts = { thesisChange: "x", thesisOutcomes: "\u200f", thesisBenefits: "z", thesisBecause: "\u2060." };
    expect(composeThesis(parts)).toEqual({
      complete: false,
      missing: ["thesisOutcomes", "thesisBecause"],
      sentence: null,
    });
  });

  it("a blank thesis part is incomplete", () => {
    const parts = { thesisChange: "x", thesisOutcomes: "y", thesisBenefits: "z", thesisBecause: "  \t " };
    expect(composeThesis(parts)).toEqual({ complete: false, missing: ["thesisBecause"], sentence: null });
    expect(composeThesis({ ...parts, thesisBecause: "w" }).complete).toBe(true);
  });
});

// F-DG2-160 (T-DG2-BE7): the shared `name` and `reason` follow the same visible-content rule as `freeText`.
describe("name and reason: one blank rule (F-DG2-160, T-DG2-BE7)", () => {
  const issues = (r: {
    success: boolean;
    error?: { issues: Array<{ path: PropertyKey[]; code: string; message: string }> };
  }) => (r.success ? [] : r.error!.issues.map((i) => [i.path.join("/"), i.code === "custom" ? i.message : i.code]));
  const INVISIBLE = [
    "\u200f\u200f\u200f",
    "\u2060\u2060\u2060",
    "\u0085\u0085\u0085",
    // F-DG2-180 (T-DG2-BE8)
    "\ufe0f\u034f\ufe0f",
    "\u180b\u180b\u180b",
    "\u{E0100}\u{E0100}",
    "\u0001\u0001\u0001",
    "\ud800\ud800\ud800",
    "\u17b4\u17b5\u180f",
  ];
  const SCHEMAS = [
    ["name", name],
    ["reason", reason],
  ] as const;

  it.each(SCHEMAS)("%s rejects invisible-only values with validation.blank only", (_label, schema) => {
    for (const v of INVISIBLE) expect(issues(schema.safeParse(v)), JSON.stringify(v)).toEqual([["", BLANK_TEXT_CODE]]);
  });

  it.each(SCHEMAS)("%s: spaces only still fail too_small only (one error, never two)", (_label, schema) => {
    for (const v of ["   ", "", " \t\n "])
      expect(issues(schema.safeParse(v)), JSON.stringify(v)).toEqual([["", "too_small"]]);
  });

  it("a value too short for min after trimming gets too_small only, even when it is invisible", () => {
    expect(issues(reason.safeParse("\u200f"))).toEqual([["", "too_small"]]);
    expect(issues(reason.safeParse(" \u2060\u2060 "))).toEqual([["", "too_small"]]);
  });

  it("visible text is accepted and trimmed as before, including Arabic with an RLM", () => {
    expect(name.parse("  Synthetic name  ")).toBe("Synthetic name");
    expect(reason.parse("  Synthetic reason\n")).toBe("Synthetic reason");
    const arabic = "\u200f\u0633\u0628\u0628 \u0627\u0635\u0637\u0646\u0627\u0639\u064a\u200f";
    expect(reason.parse(` ${arabic} `)).toBe(arabic);
    expect(name.parse(arabic)).toBe(arabic);
    expect(name.parse("x")).toBe("x");
    // F-DG2-180: visible text with default-ignorable marks is accepted verbatim.
    expect(name.parse("\u2764\ufe0f")).toBe("\u2764\ufe0f");
    expect(reason.parse("\u1820\u180b\u1821")).toBe("\u1820\u180b\u1821");
    expect(reason.parse("Cafe\u0301")).toBe("Cafe\u0301");
  });

  it("max still applies after trimming", () => {
    expect(issues(name.safeParse("a".repeat(201)))).toEqual([["", "too_big"]]);
    expect(name.parse(` ${"a".repeat(200)} `)).toBe("a".repeat(200));
  });

  it("reasonRequest reports the blank reason at /reason", () => {
    expect(issues(reasonRequest.safeParse({ reason: "\u2060\u2060\u2060" }))).toEqual([["reason", BLANK_TEXT_CODE]]);
    expect(issues(reasonRequest.safeParse({ reason: "\u180b\u180b\u180b" }))).toEqual([["reason", BLANK_TEXT_CODE]]);
    expect(reasonRequest.parse({ reason: " Synthetic reason " })).toEqual({ reason: "Synthetic reason" });
  });
});

// Unit test: the transformation thesis (B0036/B0037, REQ-PB-030; F-DG2-203). The composed sentence follows the source
// structure "If we change ..., then ... will improve, which will create ..., because ...", and a thesis with any empty
// part is flagged incomplete (one `charter.thesis_incomplete` warning per empty part; no sentence is composed).
import { composeThesis, THESIS_PARTS, THESIS_SOURCE_TEMPLATE_EN } from "@mth/shared/schemas";
import { describe, expect, it } from "vitest";
import { thesisWarnings } from "./charter.ts";

const FULL = {
  thesisChange: "the prepaid onboarding journey",
  thesisOutcomes: "first-week activation",
  thesisBenefits: "SAR 40m of retained revenue.",
  thesisBecause: "the diagnostic shows 30% of churn happens in week one",
};

describe("composeThesis (B0037)", () => {
  it("renders the four parts in the source sentence structure", () => {
    expect(THESIS_SOURCE_TEMPLATE_EN).toBe(
      "If we change {change}, then {outcomes} will improve, which will create {benefits}, because {because}.",
    );
    expect(composeThesis(FULL)).toEqual({
      complete: true,
      missing: [],
      sentence:
        "If we change the prepaid onboarding journey, then first-week activation will improve, which will create SAR 40m of retained revenue, because the diagnostic shows 30% of churn happens in week one.",
    });
  });

  it("flags any empty, blank or missing part as incomplete and composes no sentence", () => {
    for (const part of THESIS_PARTS) {
      for (const empty of [null, undefined, "", "   ", " . "]) {
        const t = composeThesis({ ...FULL, ...Object.fromEntries([[part, empty]]) });
        expect(t, `${part}=${JSON.stringify(empty)}`).toEqual({ complete: false, missing: [part], sentence: null });
      }
    }
    expect(composeThesis({}).missing).toEqual([...THESIS_PARTS]);
  });

  it("accepts a translated template of the same structure (e.g. Arabic)", () => {
    const ar = "إذا غيّرنا {change}، فستتحسن {outcomes}، مما سيحقق {benefits}، لأن {because}.";
    expect(composeThesis({ ...FULL, thesisBenefits: "منافع" }, ar).sentence).toContain("مما سيحقق منافع");
  });
});

describe("charter thesis warnings (F-DG2-203)", () => {
  it("a complete thesis has no warning; each empty part is one charter.thesis_incomplete warning with its pointer", () => {
    expect(thesisWarnings(FULL)).toEqual([]);
    const w = thesisWarnings({ ...FULL, thesisChange: null, thesisBecause: null });
    expect(w.map((x) => [x.code, x.pointer])).toEqual([
      ["charter.thesis_incomplete", "/charter/thesisChange"],
      ["charter.thesis_incomplete", "/charter/thesisBecause"],
    ]);
    expect(w[0]!.message).toContain("If we change ..., then ... will improve, which will create ..., because ...");
  });
});

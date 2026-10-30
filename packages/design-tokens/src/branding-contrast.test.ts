// Unit tests of the runtime branding contrast rule (ADR-0061 §1.1, §1.5, §6; REQ-S15-003; T-DG6-BE-W).
// #0078FF is a provisional brand token, not a verified Mobily colour.
import { describe, expect, it } from "vitest";
import {
  BRANDING_CONTRAST_RULES,
  brandedTokenSource,
  checkBrandingContrast,
  checkContrast,
  colorTokens,
  contrastMessage,
  contrastPointer,
  contrastRatio,
  primaryDependentTokens,
  resolveTokens,
  tokenSource,
} from "./index.ts";

const SEED_PRIMARY = colorTokens["brand.primary"].value;
const SEED_SECONDARY = colorTokens["brand.deep"].value;
const failing = (primary: string, secondary: string) =>
  checkBrandingContrast(primary, secondary).filter((p) => !p.pass);

describe("the seeds (ADR-0061 §1.5): the runtime function returns exactly the build-time report", () => {
  it("50 declared pairs, the same pairs, colours, ratios and thresholds, all passing", () => {
    const runtime = checkBrandingContrast(SEED_PRIMARY, SEED_SECONDARY);
    const build = checkContrast();
    expect(runtime).toHaveLength(50);
    expect(runtime).toEqual(build.pairs);
    expect(build.failures).toEqual([]);
    expect(runtime.every((p) => p.pass)).toBe(true);
    expect(BRANDING_CONTRAST_RULES).toBe("wcag2x-aa-v1");
  });
  it("the re-derived source with the seeds resolves to the shipped derived values", () => {
    const src = brandedTokenSource(SEED_PRIMARY, SEED_SECONDARY);
    expect(resolveTokens(src).get("action.primary")?.hex).toBe("#006DE9");
    expect(resolveTokens(src).get("action.primary-hover")?.hex).toBe("#0055B6");
    expect(resolveTokens(src).get("nav.background")?.hex).toBe("#0071F1");
    expect(src.contrastPairs).toBe(tokenSource.contrastPairs);
  });
});

describe("a failing primary: #FFD700 (ADR-0061 Context 2, RL02)", () => {
  it("fails exactly the two brand.primary pairs; every action, link, focus and navigation pair still passes", () => {
    const f = failing("#FFD700", SEED_SECONDARY);
    expect(f.map((p) => [p.fg, p.bg, p.use, p.ratio, p.threshold])).toEqual([
      ["brand.primary", "surface.card", "ui", 1.4, 3],
      ["brand.primary", "surface.page", "large-text", 1.31, 3],
    ]);
    expect(f.map((p) => contrastPointer(p))).toEqual(["/primaryColour", "/primaryColour"]);
    expect(f.map(contrastMessage)).toEqual([
      "brand.primary / surface.card | ui | 1.40:1 < 3.0:1",
      "brand.primary / surface.page | large-text | 1.31:1 < 3.0:1",
    ]);
  });
  it("re-derives the shades from the new colour (the action shade is not the seeded one)", () => {
    const action = checkBrandingContrast("#FFD700", SEED_SECONDARY).find(
      (p) => p.fg === "text.inverse" && p.bg === "action.primary",
    );
    expect(action?.bgHex).not.toBe("#006DE9");
    expect(action?.pass).toBe(true);
  });
});

describe("a failing secondary: #6FA8DC (ADR-0061 Context 2, RL03)", () => {
  it("fails the text pairs through brand.deep (and the badge boundary on the header), each on /secondaryColour", () => {
    const f = failing(SEED_PRIMARY, "#6FA8DC");
    expect(f.map((p) => [p.fg, p.bg, p.use, p.ratio, p.threshold])).toEqual([
      ["brand.deep", "surface.page", "text", 2.37, 4.5],
      ["brand.deep", "surface.card", "text", 2.52, 4.5],
      ["nav.selected-text", "nav.selected-background", "text", 2.52, 4.5],
      ["text.inverse", "header.gradient-start", "text", 2.52, 4.5],
      ["brand.deep", "surface.selected", "text", 2.21, 4.5],
      ["feedback.info.fg", "feedback.info.bg", "text", 2.21, 4.5],
      ["text.inverse", "brand.deep", "text", 2.52, 4.5],
      ["badge.provisional.bg", "header.gradient-start", "ui", 2.26, 3],
    ]);
    // Every failing pair goes through brand.deep (directly or by reference): the primary pairs are untouched.
    const deep = new Set(["brand.deep", "nav.selected-text", "header.gradient-start", "feedback.info.fg"]);
    expect(f.every((p) => deep.has(p.fg) || deep.has(p.bg))).toBe(true);
    expect(new Set(f.map((p) => contrastPointer(p)))).toEqual(new Set(["/secondaryColour"]));
    expect(contrastMessage(f[0]!)).toBe("brand.deep / surface.page | text | 2.37:1 < 4.5:1");
  });
});

describe("only the declared pairs decide (ADR-0061 §1.1, Alternatives 4)", () => {
  it("a darker primary that makes a prohibited pair pass is not a failure", () => {
    // White small text on #003B73 passes (about 11.2:1), so the prohibited pair text.inverse on brand.primary passes.
    expect(contrastRatio("#FFFFFF", "#003B73")).toBeGreaterThan(4.5);
    const src = brandedTokenSource("#003B73", SEED_SECONDARY);
    const prohibited = checkContrast(src).prohibited.find((p) => p.fg === "text.inverse" && p.bg === "brand.primary");
    expect(prohibited?.pass).toBe(true);
    expect(failing("#003B73", SEED_SECONDARY)).toEqual([]);
  });
});

describe("the pointer rule (ADR-0061 §6)", () => {
  it("names the tokens that resolve through brand.primary", () => {
    expect([...primaryDependentTokens()].sort()).toEqual(
      ["action.primary", "action.primary-hover", "brand.primary", "focus.ring", "nav.background"].sort(),
    );
    expect(contrastPointer({ fg: "focus.ring", bg: "surface.card" })).toBe("/primaryColour");
    expect(contrastPointer({ fg: "nav.text", bg: "nav.background" })).toBe("/primaryColour");
    expect(contrastPointer({ fg: "brand.deep", bg: "surface.page" })).toBe("/secondaryColour");
  });
  it("refuses a colour that is not upper-case #RRGGBB", () => {
    expect(() => checkBrandingContrast("#0078ff", SEED_SECONDARY)).toThrow(/RRGGBB/);
    expect(() => checkBrandingContrast(SEED_PRIMARY, "#03F")).toThrow(/RRGGBB/);
  });
});

// Unit tests of the token source, the generator and the contrast gate (REQ-S15-002, REQ-S15-003).
import { describe, expect, it } from "vitest";
import {
  checkContrast,
  colorTokens,
  contrastRatio,
  cssVarName,
  deriveDarkerShade,
  deriveNavigationBackground,
  NAVIGATION_TEXT,
  NAVIGATION_TEXT_CONTRAST,
  generateTokensCss,
  resolveTokens,
  tokenSource,
  tokensAreProvisional,
  type TokenSource,
} from "./index.ts";

const clone = (): { -readonly [K in keyof TokenSource]: TokenSource[K] } => JSON.parse(JSON.stringify(tokenSource));

describe("seeded provisional tokens (REQ-S15-002)", () => {
  it("keeps exactly the seven §15 values, all marked provisional", () => {
    expect(Object.fromEntries(Object.entries(colorTokens).map(([k, v]) => [k, v.value]))).toEqual({
      "brand.primary": "#0078FF",
      "brand.deep": "#003B73",
      "surface.page": "#F5F8FC",
      "surface.card": "#FFFFFF",
      "text.primary": "#142438",
      "text.secondary": "#526174",
      "border.default": "#DCE5EF",
    });
    expect(Object.values(colorTokens).every((t) => t.provisional)).toBe(true);
    expect(tokensAreProvisional).toBe(true);
  });
});

describe("WCAG maths", () => {
  it("matches the reference ratios recorded in ADR-0009", () => {
    expect(contrastRatio("#0078FF", "#FFFFFF")).toBeCloseTo(4.09, 2);
    expect(contrastRatio("#0078FF", "#F5F8FC")).toBeCloseTo(3.84, 2);
    expect(contrastRatio("#FFFFFF", "#003B73")).toBeCloseTo(11.21, 2);
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBe(1);
  });
  it("rejects malformed colours", () => {
    expect(() => contrastRatio("#FFF", "#000000")).toThrow(/RRGGBB/);
  });
});

describe("derived accessible action shade (REQ-S15-003)", () => {
  it("never puts small white text on #0078FF: the action shade passes 4.5:1 on card and page", () => {
    const tokens = resolveTokens();
    const action = tokens.get("action.primary")!.hex;
    expect(action).not.toBe("#0078FF");
    expect(contrastRatio("#FFFFFF", action)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(action, "#F5F8FC")).toBeGreaterThanOrEqual(4.5);
  });
  it("is the lightest passing shade (stays as close to the provisional brand as the rule allows)", () => {
    const shade = deriveDarkerShade("#0078FF", ["#FFFFFF", "#F5F8FC"], 4.5);
    expect(shade).toBe(resolveTokens().get("action.primary")!.hex);
  });
  it("fails resolution when a seed changes without re-deriving the stored value", () => {
    const src = clone();
    (src.color as Record<string, { value: string; purpose: string; provisional: boolean }>)["brand.primary"] = {
      value: "#3399FF",
      purpose: "changed",
      provisional: true,
    };
    expect(() => resolveTokens(src)).toThrow(/regenerate tokens.json/);
  });
});

describe("semantic tokens", () => {
  it("has separate status tokens that are not blue", () => {
    const tokens = resolveTokens();
    for (const s of ["on-track", "at-risk", "off-track", "unknown", "stale"]) {
      const fg = tokens.get(`status.${s}.fg`)!.hex;
      expect(fg).not.toBe(tokens.get("brand.primary")!.hex);
      expect(fg).not.toBe(tokens.get("brand.deep")!.hex);
      const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(fg.slice(i, i + 2), 16)) as [number, number, number];
      // "Blue never implies a favourable status": the favourable colour is green-dominant.
      if (s === "on-track") expect(g).toBeGreaterThan(b);
      expect(r + g + b).toBeGreaterThan(0);
    }
  });
  it("emits references as var() so runtime branding overrides propagate", () => {
    const css = generateTokensCss();
    expect(css).toContain("--mth-brand-primary: #0078FF;");
    // D-163: the navigation background is derived from brand.primary (a literal shade), no longer brand.deep.
    expect(css).toContain("--mth-nav-background: #0071F1;");
    expect(css).toContain("--mth-nav-text-muted: var(--mth-nav-text);");
    expect(css).toContain("--mth-focus-ring: var(--mth-action-primary);");
    expect(css).toMatch(/PROVISIONAL/);
    expect(generateTokensCss()).toBe(css); // deterministic
  });
  it("rejects unknown references and cycles", () => {
    const a = clone();
    (a.semantic as Record<string, unknown>)["x.y"] = { ref: "nope", purpose: "", provisional: true };
    expect(() => resolveTokens(a)).toThrow(/unknown token reference/);
    const b = clone();
    (b.semantic as Record<string, unknown>)["x.a"] = { ref: "x.b", purpose: "", provisional: true };
    (b.semantic as Record<string, unknown>)["x.b"] = { ref: "x.a", purpose: "", provisional: true };
    expect(() => resolveTokens(b)).toThrow(/cycle/);
  });
  it("maps token names to CSS variables", () => {
    expect(cssVarName("brand.primary")).toBe("--mth-brand-primary");
    expect(cssVarName("status.on-track.fg")).toBe("--mth-status-on-track-fg");
  });
});

describe("contrast gate", () => {
  it("passes every declared pair of the repository tokens", () => {
    const report = checkContrast();
    expect(report.failures).toEqual([]);
    expect(report.pairs.length).toBeGreaterThanOrEqual(40);
    expect(report.pairs.every((p) => p.pass)).toBe(true);
  });
  it("covers every derived and semantic token in at least one declared pair", () => {
    const used = new Set(tokenSource.contrastPairs.pairs.flatMap((p) => [p.fg, p.bg]));
    const unused = [...resolveTokens().values()]
      .filter((t) => t.kind !== "seed" && !used.has(t.name))
      .map((t) => t.name);
    expect(unused).toEqual([]);
  });
  it("documents the prohibited combinations, which really fail", () => {
    const report = checkContrast();
    const white = report.prohibited.find((p) => p.fg === "text.inverse" && p.bg === "brand.primary");
    expect(white?.pass).toBe(false);
    expect(white?.ratio).toBe(4.09);
  });
  it("fails the build for a failing pair", () => {
    const src = clone();
    (src.contrastPairs.pairs as unknown[]).push({ fg: "text.inverse", bg: "brand.primary", use: "text", where: "bad" });
    const report = checkContrast(src);
    expect(report.failures.some((f) => f.includes("text.inverse on brand.primary"))).toBe(true);
  });
  it("fails when a large-text threshold would hide a small-text failure", () => {
    const src = clone();
    (src.contrastPairs.pairs as unknown[]).push({ fg: "brand.primary", bg: "surface.page", use: "text", where: "x" });
    expect(checkContrast(src).failures.length).toBeGreaterThan(0);
  });
});

describe("navigation background derived from brand.primary (D-163, REQ-S15-004)", () => {
  const white = "#FFFFFF";
  it("the provisional #0078FF fails 4.5:1 behind white text, so it is darkened to #0071F1, which passes", () => {
    expect(contrastRatio(white, "#0078FF")).toBeLessThan(4.5);
    expect(deriveNavigationBackground("#0078FF")).toBe("#0071F1");
    expect(contrastRatio(white, "#0071F1")).toBeGreaterThanOrEqual(4.5);
  });
  it("a light colour (#FFD700) is darkened, keeping its hue, until white text reaches 4.5:1", () => {
    const nav = deriveNavigationBackground("#FFD700");
    expect(nav).toBe("#8B7500");
    expect(contrastRatio(white, nav)).toBeGreaterThanOrEqual(4.5);
    // HSV value steps: every channel is scaled by the same factor (255:215:0 kept).
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(nav.slice(i, i + 2), 16)) as [number, number, number];
    expect(b).toBe(0);
    expect(Math.abs(g / r - 215 / 255)).toBeLessThan(0.01);
  });
  it("a colour that already passes (#003B73) is used as it is", () => {
    expect(contrastRatio(white, "#003B73")).toBeGreaterThanOrEqual(4.5);
    expect(deriveNavigationBackground("#003B73")).toBe("#003B73");
  });
  it("is the lightest passing shade: one step lighter would fail", () => {
    // #0071F1 is the first passing step from #0078FF; the step before it (factor + 0.001) fails.
    const step = (hex: string, f: number) =>
      `#${[1, 3, 5]
        .map((i) =>
          Math.round(Number.parseInt(hex.slice(i, i + 2), 16) * f)
            .toString(16)
            .padStart(2, "0"),
        )
        .join("")
        .toUpperCase()}`;
    let f = 1;
    while (step("#0078FF", f) !== "#0071F1") f -= 0.001;
    expect(contrastRatio(white, step("#0078FF", f + 0.001))).toBeLessThan(4.5);
  });
  it("tokens.json carries exactly this rule for nav.background, against white navigation text", () => {
    const tokens = resolveTokens();
    expect(tokens.get("nav.background")!.hex).toBe(deriveNavigationBackground(tokens.get("brand.primary")!.hex));
    expect(tokens.get("nav.background")!.kind).toBe("derived");
    // The rule is computed against surface.card; it stands for the navigation text only while both are white.
    expect(tokens.get("surface.card")!.hex).toBe(NAVIGATION_TEXT);
    expect(tokens.get("nav.text")!.hex).toBe(NAVIGATION_TEXT);
    expect(tokens.get("nav.text-muted")!.hex).toBe(NAVIGATION_TEXT);
    const spec = tokenSource.derived["nav.background"] as { derivedFrom: string; rule: { darkenUntil: number } };
    expect(spec.derivedFrom).toBe("brand.primary");
    expect(spec.rule.darkenUntil).toBe(NAVIGATION_TEXT_CONTRAST);
    expect(tokens.get("nav.background")!.provisional).toBe(true);
  });
  it("the contrast gate checks white navigation text on the derived background", () => {
    const pair = checkContrast().pairs.find(
      (p) => p.fg === "nav.text" && p.bg === "nav.background" && p.use === "text",
    );
    expect(pair?.pass).toBe(true);
    expect(pair?.bgHex).toBe("#0071F1");
  });
});

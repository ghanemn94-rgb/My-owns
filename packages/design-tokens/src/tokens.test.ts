// Unit tests of the token source, the generator and the contrast gate (REQ-S15-002, REQ-S15-003).
import { describe, expect, it } from "vitest";
import {
  checkContrast,
  colorTokens,
  contrastRatio,
  cssVarName,
  deriveDarkerShade,
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
    expect(css).toContain("--mth-nav-background: var(--mth-brand-deep);");
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

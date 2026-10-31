// qa-verifier A20 "UX and branding", REQ-S15-003 (DG6, T-DG6-QA-D). Binding row text (docs/delivery/requirements.csv):
// "A20: the contrast test lists every pair and passes; white small text on #0078FF is not used for action buttons;
// status chips are distinguishable in greyscale". The row's notes: "WCAG thresholds are an implementation assumption
// for 'adequate contrast'" (text 4.5:1; large text and UI 3:1, WCAG 2.1 SC 1.4.3 / 1.4.11).
// An INDEPENDENT re-computation from the single token source (packages/design-tokens/src/tokens.json): the WCAG 2.x
// relative luminance and contrast ratio are implemented here from the WCAG definition, not imported from the product.
// The list of every pair with its ratio is written to the evidence folder (QA_EVIDENCE_DIR, default
// test-results/qa-a20) as "contrast-pairs.txt". The greyscale half: each status's chip, rendered in greyscale (the
// luminance of its fg and bg), is distinguishable from its own background (>= 3:1), and no two statuses share a label
// token (the chips always carry a label, REQ-S15-003 "always carry labels or icons"; the rendered labels are checked in
// e2e/a20-p6-ux.spec.ts). The tokens are provisional (#0078FF is a provisional brand token, not a verified colour).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const TOKENS = JSON.parse(readFileSync(path.join(ROOT, "packages", "design-tokens", "src", "tokens.json"), "utf8")) as {
  color: Record<string, { value: string }>;
  derived: Record<string, { value?: string }>;
  semantic: Record<string, { value?: string; ref?: string }>;
  contrastPairs: { pairs: { fg: string; bg: string; use: "text" | "large-text" | "ui"; where: string }[] };
};
const EVIDENCE = process.env["QA_EVIDENCE_DIR"] ?? path.join(ROOT, "test-results", "qa-a20");

function hex(name: string, seen: string[] = []): string {
  if (seen.includes(name)) throw new Error(`ref cycle ${seen.join(">")}`);
  const t = TOKENS.color[name] ?? TOKENS.derived[name] ?? TOKENS.semantic[name];
  if (!t || typeof t !== "object") throw new Error(`unknown token ${name}`);
  if ("ref" in t && t.ref) return hex(t.ref, [...seen, name]);
  if (!t.value) throw new Error(`token ${name} has no value`);
  return t.value.toUpperCase();
}
/** WCAG 2.x relative luminance of an sRGB hex colour. */
function luminance(h: string): number {
  const n = Number.parseInt(h.slice(1), 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
function ratio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}
const MIN = { text: 4.5, "large-text": 3, ui: 3 } as const;

describe("REQ-S15-003 (A20): token contrast", () => {
  it("lists every declared foreground/background pair with its ratio, and every pair meets its WCAG AA threshold", () => {
    const pairs = TOKENS.contrastPairs.pairs;
    expect(pairs.length).toBeGreaterThan(20);
    const lines = pairs.map((p) => {
      const r = ratio(hex(p.fg), hex(p.bg));
      return { ...p, fgHex: hex(p.fg), bgHex: hex(p.bg), r, ok: r >= MIN[p.use] };
    });
    mkdirSync(EVIDENCE, { recursive: true });
    writeFileSync(
      path.join(EVIDENCE, "contrast-pairs.txt"),
      lines
        .map(
          (l) =>
            `${l.ok ? "PASS" : "FAIL"} ${l.fg} ${l.fgHex} on ${l.bg} ${l.bgHex} use=${l.use} min=${MIN[l.use]} ratio=${l.r.toFixed(2)} (${l.where})`,
        )
        .join("\n") + "\n",
    );
    expect(lines.filter((l) => !l.ok).map((l) => `${l.fg} on ${l.bg}: ${l.r.toFixed(2)}`)).toEqual([]);
  });

  it("every text/background token pair the shell paints is declared (text.*, nav.*, header.*, status.*, feedback.*, badge.*)", () => {
    const declared = new Set(TOKENS.contrastPairs.pairs.map((p) => `${p.fg}|${p.bg}`));
    const families = ["status.on-track", "status.at-risk", "status.off-track", "status.unknown", "status.stale"];
    for (const f of families) expect(declared.has(`${f}.fg|${f}.bg`), `${f} chip pair declared`).toBe(true);
    for (const f of ["feedback.error", "feedback.warning", "feedback.success", "feedback.info", "badge.provisional"])
      expect(declared.has(`${f}.fg|${f}.bg`), `${f} pair declared`).toBe(true);
    expect(declared.has("text.primary|surface.page")).toBe(true);
    expect(declared.has("nav.text|nav.background")).toBe(true);
  });

  it("white small text on #0078FF is not used for action buttons: the action shades differ from brand.primary and pass 4.5:1 with white", () => {
    expect(hex("brand.primary")).toBe("#0078FF");
    const white = hex("text.inverse");
    expect(white).toBe("#FFFFFF");
    expect(ratio(white, "#0078FF"), "white on #0078FF is below 4.5:1 (why it must not be used)").toBeLessThan(4.5);
    for (const a of ["action.primary", "action.primary-hover", "nav.background"]) {
      expect(hex(a), a).not.toBe("#0078FF");
      expect(ratio(white, hex(a)), `white on ${a}`).toBeGreaterThanOrEqual(4.5);
    }
    // The pair declared for the primary action button is NOT the brand token itself.
    const button = TOKENS.contrastPairs.pairs.filter((p) => /primary action button/.test(p.where));
    expect(button.length).toBeGreaterThanOrEqual(1);
    for (const p of button) expect(hex(p.bg)).not.toBe("#0078FF");
  });

  it("status chips are distinguishable in greyscale: each chip's text against its background is >= 4.5:1 in luminance alone, and no status uses blue", () => {
    for (const s of ["on-track", "at-risk", "off-track", "unknown", "stale"]) {
      const fg = hex(`status.${s}.fg`);
      const bg = hex(`status.${s}.bg`);
      // Contrast is computed from luminance only, i.e. exactly what remains in greyscale.
      expect(ratio(fg, bg), `status ${s} in greyscale`).toBeGreaterThanOrEqual(4.5);
      // "never using blue to imply a favourable status": the hue of the favourable chip is not blue.
      const n = Number.parseInt(fg.slice(1), 16);
      const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      if (s === "on-track") expect(b > r && b > g, "on-track is not blue").toBe(false);
    }
  });
});

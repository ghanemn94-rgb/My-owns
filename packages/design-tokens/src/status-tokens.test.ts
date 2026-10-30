// Status tokens are never blue (T-DG6-FE-F; ADR-0061 §3 item 1; REQ-S15-003 "use separate semantic status tokens …
// never using blue to imply a favourable status"; M0300). Every `status.*` token is a token of its own: it is not equal
// to, and does not reference (directly or through a chain of `ref`s), any brand, action, navigation or focus token, so a
// status colour never follows the brand blue, and a Branding Settings change of the brand colours leaves every status
// colour unchanged.
import { describe, expect, it } from "vitest";
import { brandedTokenSource, resolveTokens, type ResolvedToken } from "./index.ts";

const BLUE_FAMILIES = ["brand.", "action.", "nav.", "focus."];
const isBlueFamily = (name: string) => BLUE_FAMILIES.some((p) => name.startsWith(p));
const STATUSES = ["on-track", "at-risk", "off-track", "unknown", "stale"];

/** The chain of references a token follows (its own `ref`, then that token's, …). */
function refChain(tokens: ReadonlyMap<string, ResolvedToken>, name: string): string[] {
  const chain: string[] = [];
  let ref = tokens.get(name)?.ref;
  while (ref !== undefined && !chain.includes(ref)) {
    chain.push(ref);
    ref = tokens.get(ref)?.ref;
  }
  return chain;
}

describe("status tokens are never blue (ADR-0061 §3 item 1)", () => {
  const tokens = resolveTokens();
  const status = [...tokens.values()].filter((t) => t.name.startsWith("status."));
  const blue = [...tokens.values()].filter((t) => isBlueFamily(t.name));

  it("declares a foreground and a background token for each of the five statuses", () => {
    for (const s of STATUSES) {
      expect(tokens.has(`status.${s}.fg`), s).toBe(true);
      expect(tokens.has(`status.${s}.bg`), s).toBe(true);
    }
    expect(blue.length).toBeGreaterThanOrEqual(4);
  });

  it("no status token references a brand, action, navigation or focus token, directly or through a chain", () => {
    for (const t of status) expect(refChain(tokens, t.name).filter(isBlueFamily), t.name).toEqual([]);
  });

  it("no status token has the colour of a brand, action, navigation or focus token", () => {
    const blueHex = new Map(blue.map((b) => [b.hex.toUpperCase(), b.name]));
    for (const t of status) expect(blueHex.get(t.hex.toUpperCase()), t.name).toBeUndefined();
  });

  it("the on-track (favourable) colours are not blue: their blue channel is not the dominant one", () => {
    for (const name of ["status.on-track.fg", "status.on-track.bg"]) {
      const hex = tokens.get(name)!.hex;
      const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
      expect(b > r && b > g, `${name} ${hex}`).toBe(false);
    }
  });

  it("a branding change of the brand colours leaves every status colour unchanged", () => {
    const rebranded = resolveTokens(brandedTokenSource("#5A2D82", "#1F1147"));
    expect(rebranded.get("brand.primary")!.hex).toBe("#5A2D82");
    for (const t of status) expect(rebranded.get(t.name)!.hex, t.name).toBe(t.hex);
  });
});

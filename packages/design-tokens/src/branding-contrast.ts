// The contrast rule for runtime branding (ADR-0061 §1, §6; REQ-S15-003; p6-work-split §I/K.1, T-DG6-BE-W).
// A published branding version replaces two seeded tokens at runtime: `brand.primary` (the primary colour) and
// `brand.deep` (the secondary colour). `checkBrandingContrast` builds the token source with those two colours,
// re-derives every rule-derived token from them (the ADR-0009 §3 `deriveDarkerShade` rule, exactly as `resolveTokens`
// requires), and returns `checkContrast()`'s evaluation of every DECLARED pair for that source, in declared order.
// Only the declared pairs decide: the prohibited pairs are a build-time documentation check of the seeded tokens, and a
// branded colour that makes a prohibited pair pass is not a failure (ADR-0061 §1.1, Alternatives 4).
// Pure: no I/O, no clock. Ratios are display measurements (not money or rates) and are reported rounded DOWN (floor2).
// #0078FF is a provisional brand token, not a verified Mobily colour; nothing here claims official brand compliance.
import { deriveDarkerShade } from "./contrast.ts";
import { checkContrast, tokenSource, type DerivedTokenSpec, type PairResult, type TokenSource } from "./index.ts";

/** The token the primary colour replaces. */
export const BRANDING_PRIMARY_TOKEN = "brand.primary";
/** The token the secondary colour replaces (ADR-0049 §8). */
export const BRANDING_SECONDARY_TOKEN = "brand.deep";
/** The closed rule-set name stored with a report (`branding_contrast_report.rules`). */
export const BRANDING_CONTRAST_RULES = "wcag2x-aa-v1";

const UPPER_HEX = /^#[0-9A-F]{6}$/;

/** The source with the two branding colours in place and every derived token re-derived from them. */
export function brandedTokenSource(primary: string, secondary: string, source: TokenSource = tokenSource): TokenSource {
  for (const c of [primary, secondary])
    if (!UPPER_HEX.test(c)) throw new Error(`branding colour must be upper-case #RRGGBB, got ${c}`);
  const color: Record<string, TokenSource["color"][string]> = {};
  for (const [name, t] of Object.entries(source.color)) {
    if (name === BRANDING_PRIMARY_TOKEN) color[name] = { ...t, value: primary };
    else if (name === BRANDING_SECONDARY_TOKEN) color[name] = { ...t, value: secondary };
    else color[name] = t;
  }
  // Derived tokens are resolved in declaration order against the seeds and the derived tokens before them, as in
  // resolveTokens; each value is recomputed so resolveTokens' "value matches its rule" check holds for the new colours.
  const hex = new Map(Object.entries(color).map(([k, t]) => [k, t.value] as const));
  const derived: Record<string, DerivedTokenSpec | string> = {};
  for (const [name, raw] of Object.entries(source.derived)) {
    if (name.startsWith("$") || typeof raw === "string") {
      derived[name] = raw;
      continue;
    }
    const base = hex.get(raw.derivedFrom);
    const against = raw.rule.against.map((k) => hex.get(k));
    if (base === undefined || against.some((a) => a === undefined)) {
      derived[name] = raw; // resolveTokens reports the unknown reference
      continue;
    }
    const value = deriveDarkerShade(base, against as string[], raw.rule.darkenUntil);
    derived[name] = { ...raw, value };
    hex.set(name, value);
  }
  return { ...source, color, derived };
}

/**
 * Every declared contrast pair of `source` evaluated with `primary` as `brand.primary` and `secondary` as
 * `brand.deep` (the derived shades re-derived from them), in declared order. A pair fails when `pass` is false.
 * With the seeded colours it returns exactly `checkContrast(source).pairs`.
 */
export function checkBrandingContrast(
  primary: string,
  secondary: string,
  source: TokenSource = tokenSource,
): readonly PairResult[] {
  return checkContrast(brandedTokenSource(primary, secondary, source)).pairs;
}

/**
 * The token names whose colour resolves through `brand.primary`: the token itself, the tokens derived from it, and the
 * semantic references that reach one of them (at this revision: brand.primary, action.primary, action.primary-hover,
 * nav.background, focus.ring).
 */
export function primaryDependentTokens(source: TokenSource = tokenSource): ReadonlySet<string> {
  const out = new Set<string>([BRANDING_PRIMARY_TOKEN]);
  for (const [name, raw] of Object.entries(source.derived)) {
    if (name.startsWith("$") || typeof raw === "string") continue;
    if (out.has(raw.derivedFrom)) out.add(name);
  }
  const refs = new Map<string, string>();
  for (const [name, raw] of Object.entries(source.semantic)) {
    if (name.startsWith("$") || typeof raw === "string") continue;
    if ("ref" in raw) refs.set(name, raw.ref);
  }
  for (const name of refs.keys()) {
    const seen = new Set<string>();
    let at: string | undefined = name;
    while (at !== undefined && !seen.has(at)) {
      if (out.has(at)) {
        out.add(name);
        break;
      }
      seen.add(at);
      at = refs.get(at);
    }
  }
  return out;
}

/**
 * The field a failing pair is reported on (ADR-0061 §6): `/primaryColour` when its foreground or background resolves
 * through `brand.primary`, otherwise `/secondaryColour`.
 */
export function contrastPointer(
  pair: Pick<PairResult, "fg" | "bg">,
  source: TokenSource = tokenSource,
): "/primaryColour" | "/secondaryColour" {
  const primary = primaryDependentTokens(source);
  return primary.has(pair.fg) || primary.has(pair.bg) ? "/primaryColour" : "/secondaryColour";
}

/** A ratio as the stored `numeric(4,2)` decimal string (already rounded down by floor2), e.g. "4.09". */
export function contrastRatioText(ratio: number): string {
  return ratio.toFixed(2);
}

/** A threshold as the stored `numeric(2,1)` decimal string: "4.5" or "3.0". */
export function contrastThresholdText(threshold: number): string {
  return threshold.toFixed(1);
}

/**
 * The language-neutral field-error message of a failing pair (ADR-0061 §6):
 * `"<fg> / <bg> | <use> | <ratio>:1 < <threshold>:1"`.
 */
export function contrastMessage(pair: Pick<PairResult, "fg" | "bg" | "use" | "ratio" | "threshold">): string {
  return `${pair.fg} / ${pair.bg} | ${pair.use} | ${contrastRatioText(pair.ratio)}:1 < ${contrastThresholdText(pair.threshold)}:1`;
}

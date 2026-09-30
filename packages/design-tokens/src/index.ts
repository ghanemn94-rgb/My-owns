// @mth/design-tokens (ADR-0009). tokens.json is the single source. This module resolves it into one flat token map
// (the seven PROVISIONAL §15 seeds, rule-derived tokens such as the accessible action shade, and semantic tokens such
// as status colours), generates the CSS custom properties (`--mth-brand-primary` ...) and runs the WCAG contrast gate
// (REQ-S15-002/003). #0078FF is a provisional brand token, not a verified Mobily colour.
import tokens from "./tokens.json" with { type: "json" };
import { AA_THRESHOLD, contrastRatio, deriveDarkerShade, floor2, type PairUse } from "./contrast.ts";

export * from "./contrast.ts";

export type ColorTokenName = keyof typeof tokens.color;

export interface ColorToken {
  readonly value: string;
  readonly purpose: string;
  readonly provisional: boolean;
}

/** The seven seeded §15 tokens exactly as supplied (REQ-S15-002). */
export const colorTokens: Readonly<Record<ColorTokenName, ColorToken>> = tokens.color;

/** True while any token is provisional; the UI shows the provisional wordmark/notice (REQ-S15-006). */
export const tokensAreProvisional: boolean = tokens.provisional;

/** CSS custom-property name for a token, e.g. brand.primary -> --mth-brand-primary. */
export function cssVarName(token: string): string {
  return `--mth-${token.replace(/\./g, "-")}`;
}

// ------------------------------------------------------------------------------------------------ source model
export interface DerivedTokenSpec {
  readonly value: string;
  readonly purpose: string;
  readonly derivedFrom: string;
  readonly rule: { readonly darkenUntil: number; readonly against: readonly string[] };
  readonly provisional: boolean;
}
export type SemanticTokenSpec =
  | { readonly value: string; readonly purpose: string; readonly provisional: boolean }
  | { readonly ref: string; readonly purpose: string; readonly provisional: boolean };
export interface ContrastPairSpec {
  readonly fg: string;
  readonly bg: string;
  readonly use: PairUse;
  readonly where: string;
}
export interface ProhibitedPairSpec {
  readonly fg: string;
  readonly bg: string;
  readonly use: PairUse;
  readonly why: string;
}
export interface TokenSource {
  readonly provisional: boolean;
  readonly color: Readonly<Record<string, ColorToken>>;
  readonly derived: Readonly<Record<string, DerivedTokenSpec | string>>;
  readonly semantic: Readonly<Record<string, SemanticTokenSpec | string>>;
  readonly contrastPairs: {
    readonly pairs: readonly ContrastPairSpec[];
    readonly prohibited: readonly ProhibitedPairSpec[];
  };
}

/** The repository's token source (tokens.json). */
export const tokenSource: TokenSource = tokens as unknown as TokenSource;

export type TokenKind = "seed" | "derived" | "semantic";

export interface ResolvedToken {
  readonly name: string;
  readonly kind: TokenKind;
  /** Final colour (#RRGGBB) after following references. */
  readonly hex: string;
  /** CSS value: a literal, or `var(--mth-…)` for references so runtime overrides propagate. */
  readonly css: string;
  readonly purpose: string;
  readonly provisional: boolean;
  readonly ref?: string;
}

function entries<T>(record: Readonly<Record<string, T | string>>): [string, T][] {
  // `$comment` keys document the file; they are not tokens.
  return Object.entries(record).filter(([k]) => !k.startsWith("$")) as [string, T][];
}

/**
 * Resolves every token to a colour. Throws on unknown references, reference cycles, malformed colours, duplicate
 * names across sections, or a derived value that no longer matches its rule (a seed changed without regenerating).
 */
export function resolveTokens(source: TokenSource = tokenSource): ReadonlyMap<string, ResolvedToken> {
  const out = new Map<string, ResolvedToken>();
  const add = (t: ResolvedToken) => {
    if (out.has(t.name)) throw new Error(`duplicate token name: ${t.name}`);
    if (!/^#[0-9A-F]{6}$/.test(t.hex))
      throw new Error(`token ${t.name}: colour must be upper-case #RRGGBB, got ${t.hex}`);
    out.set(t.name, t);
  };
  for (const [name, t] of Object.entries(source.color)) {
    add({ name, kind: "seed", hex: t.value, css: t.value, purpose: t.purpose, provisional: t.provisional });
  }
  for (const [name, d] of entries<DerivedTokenSpec>(source.derived)) {
    const base = out.get(d.derivedFrom);
    if (!base) throw new Error(`derived token ${name}: unknown base ${d.derivedFrom}`);
    const against = d.rule.against.map((k) => {
      const t = out.get(k);
      if (!t) throw new Error(`derived token ${name}: unknown rule colour ${k}`);
      return t.hex;
    });
    const expected = deriveDarkerShade(base.hex, against, d.rule.darkenUntil);
    if (expected !== d.value) {
      throw new Error(`derived token ${name} is ${d.value} but its rule gives ${expected}; regenerate tokens.json`);
    }
    add({ name, kind: "derived", hex: d.value, css: d.value, purpose: d.purpose, provisional: d.provisional });
  }
  const semantic = entries<SemanticTokenSpec>(source.semantic);
  const specs = new Map(semantic);
  const resolving = new Set<string>();
  const hexOf = (name: string): string => {
    const known = out.get(name);
    if (known) return known.hex;
    const spec = specs.get(name);
    if (!spec) throw new Error(`unknown token reference: ${name}`);
    if ("value" in spec) return spec.value;
    if (resolving.has(name)) throw new Error(`token reference cycle at ${name}`);
    resolving.add(name);
    const hex = hexOf(spec.ref);
    resolving.delete(name);
    return hex;
  };
  for (const [name, spec] of semantic) {
    if ("value" in spec) {
      add({
        name,
        kind: "semantic",
        hex: spec.value,
        css: spec.value,
        purpose: spec.purpose,
        provisional: spec.provisional,
      });
    } else {
      add({
        name,
        kind: "semantic",
        hex: hexOf(name),
        css: `var(${cssVarName(spec.ref)})`,
        purpose: spec.purpose,
        provisional: spec.provisional,
        ref: spec.ref,
      });
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ CSS generation
/** The complete tokens.css: one `:root` block of `--mth-*` custom properties. Deterministic output. */
export function generateTokensCss(source: TokenSource = tokenSource): string {
  const resolved = resolveTokens(source);
  const lines = [
    "/* GENERATED by @mth/design-tokens from src/tokens.json. Do not edit by hand. */",
    "/* PROVISIONAL tokens (master prompt §15): #0078FF is not a verified Mobily colour. */",
    ":root {",
    `  --mth-tokens-provisional: ${source.provisional ? 1 : 0};`,
  ];
  for (const t of resolved.values()) lines.push(`  ${cssVarName(t.name)}: ${t.css};`);
  lines.push("}", "");
  return lines.join("\n");
}

// ------------------------------------------------------------------------------------------------ contrast gate
export interface PairResult {
  readonly fg: string;
  readonly bg: string;
  readonly use: PairUse;
  readonly note: string;
  readonly fgHex: string;
  readonly bgHex: string;
  /** Rounded down to 2 decimals. */
  readonly ratio: number;
  readonly threshold: number;
  readonly pass: boolean;
}

export interface ContrastReport {
  readonly pairs: readonly PairResult[];
  /** Known-failing combinations the UI must not use; each must actually fail (documents why). */
  readonly prohibited: readonly PairResult[];
  readonly failures: readonly string[];
}

export function checkContrast(source: TokenSource = tokenSource): ContrastReport {
  const resolved = resolveTokens(source);
  const failures: string[] = [];
  const evaluate = (fg: string, bg: string, use: PairUse, note: string): PairResult | null => {
    const f = resolved.get(fg);
    const b = resolved.get(bg);
    if (!f || !b) {
      failures.push(`unknown token in pair ${fg} on ${bg}`);
      return null;
    }
    const ratio = floor2(contrastRatio(f.hex, b.hex));
    const threshold = AA_THRESHOLD[use];
    return {
      fg,
      bg,
      use,
      note,
      fgHex: f.hex,
      bgHex: b.hex,
      ratio,
      threshold,
      pass: contrastRatio(f.hex, b.hex) >= threshold,
    };
  };
  const pairs: PairResult[] = [];
  for (const p of source.contrastPairs.pairs) {
    const r = evaluate(p.fg, p.bg, p.use, p.where);
    if (!r) continue;
    pairs.push(r);
    if (!r.pass) failures.push(`${p.fg} on ${p.bg} (${p.use}): ${r.ratio}:1 < ${r.threshold}:1 [${p.where}]`);
  }
  if (pairs.length === 0) failures.push("no contrast pairs declared");
  const prohibited: PairResult[] = [];
  for (const p of source.contrastPairs.prohibited) {
    const r = evaluate(p.fg, p.bg, p.use, p.why);
    if (!r) continue;
    prohibited.push(r);
    if (r.pass) failures.push(`prohibited pair ${p.fg} on ${p.bg} now passes; remove it from "prohibited"`);
    if (pairs.some((q) => q.fg === p.fg && q.bg === p.bg && q.use === p.use)) {
      failures.push(`pair ${p.fg} on ${p.bg} (${p.use}) is both declared and prohibited`);
    }
  }
  return { pairs, prohibited, failures };
}

/** Plain-text table of a report (used by the check:contrast script). */
export function formatContrastReport(report: ContrastReport): string {
  const row = (r: PairResult, status: string) =>
    `${status.padEnd(6)} ${r.ratio.toFixed(2).padStart(6)}:1  min ${r.threshold.toFixed(1)}  ${r.use.padEnd(10)} ` +
    `${r.fg} ${r.fgHex} on ${r.bg} ${r.bgHex}  (${r.note})`;
  return [
    "WCAG 2.x AA contrast of every declared token pair (REQ-S15-003):",
    ...report.pairs.map((r) => row(r, r.pass ? "PASS" : "FAIL")),
    "",
    "Prohibited combinations (must fail; never used by the UI):",
    ...report.prohibited.map((r) => row(r, r.pass ? "ERROR" : "fails")),
  ].join("\n");
}

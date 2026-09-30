// WCAG 2.x contrast maths and the accessible-shade derivation (ADR-0009 §3, REQ-S15-003).
// Pure functions, no dependencies: used by the contrast gate (check-contrast.ts), the generator and the tests.

export type Rgb = readonly [number, number, number];

const HEX = /^#([0-9a-f]{6})$/i;

export function parseHex(hex: string): Rgb {
  const m = HEX.exec(hex);
  if (!m?.[1]) throw new Error(`not a #RRGGBB colour: ${hex}`);
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

export function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b]
    .map((c) => Math.round(c).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

/** WCAG 2.x relative luminance (sRGB). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as unknown as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio, 1..21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** How a pair is used decides the WCAG AA threshold. */
export type PairUse = "text" | "large-text" | "ui";

export const AA_THRESHOLD: Readonly<Record<PairUse, number>> = {
  text: 4.5, // 1.4.3 normal text
  "large-text": 3, // 1.4.3 large text (>= 18.66px bold / 24px)
  ui: 3, // 1.4.11 non-text contrast (control boundaries, focus indicators, icons)
};

/** Ratio rounded DOWN to two decimals, so a reported "4.50" never hides a 4.499. */
export function floor2(ratio: number): number {
  return Math.floor(ratio * 100) / 100;
}

export function passes(ratio: number, use: PairUse): boolean {
  return ratio >= AA_THRESHOLD[use];
}

/**
 * Darkens `base` (scaling its RGB channels towards black, which keeps the hue) until the colour reaches `target`
 * contrast against every colour in `against`. Returns the first (lightest) passing shade, so the result stays as
 * close to the provisional brand colour as the rule allows. Throws if nothing passes (cannot happen against white).
 */
export function deriveDarkerShade(base: string, against: readonly string[], target: number): string {
  const rgb = parseHex(base);
  for (let step = 0; step <= 1000; step++) {
    const f = 1 - step / 1000;
    const candidate = toHex([rgb[0] * f, rgb[1] * f, rgb[2] * f]);
    if (against.every((bg) => contrastRatio(candidate, bg) >= target)) return candidate;
  }
  throw new Error(`no darker shade of ${base} reaches ${target}:1`);
}

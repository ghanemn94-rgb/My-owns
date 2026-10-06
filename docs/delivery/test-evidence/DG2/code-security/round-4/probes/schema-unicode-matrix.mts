// code-security-reviewer DG2 round-4 (T-DG2-REV-SEC-R4). Schema-level Unicode matrix for F-DG2-160 and residual probes.
// Usage (Node 24 type stripping): node schema-unicode-matrix.mts <clone>/packages/shared
// Runs freeText(1,100), hasText, the shared `name` and `reason` over: the 18 round-3 code points, every residual
// "renders as nothing" candidate (Unicode Default_Ignorable_Code_Point outside \p{Cf}), combining marks alone, and
// visible controls. Then an exhaustive sweep of all code points with \p{Default_Ignorable_Code_Point} that the shared
// predicate still counts as visible, and a timing check on very long invisible strings (ReDoS / linear-time).
// All data SYNTHETIC.
const { freeText, hasText, hasVisibleContent, name, reason } = await import(process.argv[2] + "/src/schemas/common.ts");
const s = freeText(1, 100);
const hex = (v: string) => [...v].map((c) => "U+" + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")).join(" ");
const res = (schema: any, v: string) => {
  const r = schema.safeParse(v);
  return r.success ? "ACCEPTED" : "rejected(" + r.error.issues.map((i: any) => i.message ?? i.code).join(",") + ")";
};
const groups: Record<string, [string, string][]> = {
  "round-3 matrix (F-DG2-160 reproduction set)": [
    ["U+0020 x3", "   "], ["TAB/LF/CR", "\t\n\r"], ["U+00A0 NBSP", " "], ["U+3000 ideographic", "　"],
    ["U+2028 LS", " "], ["U+FEFF BOM", "﻿"], ["U+2007 figure sp", " "], ["U+0085 NEL", "\u0085"],
    ["U+180E Mongolian VS", "᠎"], ["U+200B ZWSP", "​"], ["U+200C ZWNJ", "‌"], ["U+200D ZWJ", "‍"],
    ["U+2060 WJ", "⁠"], ["U+3164 Hangul filler", "ㅤ"], ["U+2800 braille blank", "⠀"],
    ["U+00AD soft hyphen", "­"], ["U+061C ALM", "؜"], ["U+200F RLM", "‏"],
  ],
  "extra Cf / fillers (expected rejected)": [
    ["U+115F Hangul choseong filler", "ᅟ"], ["U+1160 jungseong filler", "ᅠ"], ["U+FFA0 halfwidth filler", "ﾠ"],
    ["U+202E RLO", "‮"], ["U+2066 LRI", "⁦"], ["U+2062 invisible times", "⁢"], ["U+1BCA0 shorthand fmt", "\u{1bca0}"],
    ["U+E0020 tag space", "\u{e0020}"], ["U+E0001 language tag", "\u{e0001}"], ["U+1D173 musical begin beam", "\u{1d173}"],
    ["mixed NEL+RLM+WJ+NBSP x50", "\u0085‏⁠ ".repeat(50).slice(0, 100)],
  ],
  "residual candidates: Default_Ignorable_Code_Point outside Cf (render as nothing)": [
    ["U+034F COMBINING GRAPHEME JOINER", "͏"], ["U+17B4 KHMER VOWEL INHERENT AQ", "឴"],
    ["U+17B5 KHMER VOWEL INHERENT AA", "឵"], ["U+180B MONGOLIAN FVS1", "᠋"], ["U+180C FVS2", "᠌"],
    ["U+180D FVS3", "᠍"], ["U+180F FVS4", "᠏"], ["U+FE00 VS1", "︀"], ["U+FE0F VS16 (emoji)", "️"],
    ["U+FE0F x3", "️️️"], ["U+E0100 VS17", "\u{e0100}"], ["U+FFF0 (unassigned DI)", "￰"],
    ["U+E0000 (unassigned DI)", "\u{e0000}"], ["RLM + VS16 + CGJ", "‏️͏"],
  ],
  "combining marks alone (render a visible mark on a dotted circle / nothing to attach to)": [
    ["U+0301 COMBINING ACUTE", "́"], ["U+064B ARABIC FATHATAN", "ً"], ["U+0670 ARABIC SUPERSCRIPT ALEF", "ٰ"],
    ["U+0651 ARABIC SHADDA x2", "ّّ"],
  ],
  "visible controls (expected ACCEPTED)": [
    ["a", "a"], ["Arabic alef", "ا"], ["RLM + Arabic text", "‏نص"], ["emoji ZWJ family", "\u{1f468}‍\u{1f469}‍\u{1f467}"],
    ["leading ZWSP + text", "​scope"], ["lone surrogate U+D800", "\ud800"], ["U+FFFC object replacement", "￼"],
  ],
};
for (const [g, cases] of Object.entries(groups)) {
  console.log(`\n## ${g}`);
  for (const [k, v] of cases)
    console.log(k.padEnd(36), "freeText:", res(s, v).padEnd(28), "hasText:", String(hasText(v)).padEnd(6), "name:", res(name, v).padEnd(28), "reason(x3):", res(reason, v.repeat(3)));
}

console.log("\n## shared name / reason (trimmedText) edge cases");
for (const [k, schema, v] of [
  ["name '   '", name, "   "], ["name '\\u200b'", name, "​"], ["name ' \\u200f '", name, " ‏ "], ["name 'Ali'", name, "Ali"],
  ["reason 'ab'", reason, "ab"], ["reason '\\u200f\\u200f\\u200f'", reason, "‏‏‏"], ["reason NEL x3", reason, "\u0085\u0085\u0085"],
  ["reason '  \\u200f  '", reason, "  ‏  "], ["reason '  \\u200f\\u2060\\u200b '", reason, "  ‏⁠​ "], ["reason 'ok!'", reason, "ok!"],
  ["reason 'a'+ZWSP+ZWSP", reason, "a​​"],
] as [string, any, string][])
  console.log(k.padEnd(36), res(schema, v), schema.safeParse(v).success ? "-> " + JSON.stringify(schema.parse(v)) : "");

console.log("\n## exhaustive: \\p{Default_Ignorable_Code_Point} code points that hasVisibleContent() still counts as VISIBLE");
const DI = /^\p{Default_Ignorable_Code_Point}$/u;
const residual: number[] = [];
let diTotal = 0;
for (let cp = 0; cp <= 0x10ffff; cp++) {
  if (cp >= 0xd800 && cp <= 0xdfff) continue;
  const ch = String.fromCodePoint(cp);
  if (!DI.test(ch)) continue;
  diTotal++;
  if (hasVisibleContent(ch)) residual.push(cp);
}
const ranges: string[] = [];
for (let i = 0; i < residual.length; ) {
  let j = i;
  while (j + 1 < residual.length && residual[j + 1] === residual[j]! + 1) j++;
  const f = (n: number) => "U+" + n.toString(16).toUpperCase().padStart(4, "0");
  const cat = /\p{Mn}/u.test(String.fromCodePoint(residual[i]!)) ? "Mn" : /\p{Cn}/u.test(String.fromCodePoint(residual[i]!)) ? "Cn" : /\p{Lo}/u.test(String.fromCodePoint(residual[i]!)) ? "Lo" : "other";
  ranges.push(i === j ? `${f(residual[i]!)} (${cat})` : `${f(residual[i]!)}..${f(residual[j]!)} (${cat}, ${j - i + 1})`);
  i = j + 1;
}
console.log(`DI code points: ${diTotal}; counted as visible content: ${residual.length}`);
console.log(ranges.join("\n"));
console.log("assigned (non-Cn) residuals:", residual.filter((cp) => !/\p{Cn}/u.test(String.fromCodePoint(cp))).map((cp) => cp.toString(16)).join(" "));

console.log("\n## performance: very long invisible / whitespace strings (linear scan, no backtracking expected)");
for (const n of [1_000, 100_000, 1_000_000, 10_000_000]) {
  for (const [lbl, unit] of [["RLM", "‏"], ["NEL+WJ+NBSP", "\u0085⁠ "], ["spaces", " "]] as [string, string][]) {
    const v = unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
    const t0 = performance.now();
    const h = hasVisibleContent(v);
    const t1 = performance.now();
    const p = freeText(1, 4000).safeParse(v);
    const t2 = performance.now();
    const tail = hasVisibleContent(v + "x");
    const t3 = performance.now();
    console.log(`n=${String(n).padEnd(9)} ${lbl.padEnd(12)} hasVisibleContent=${h} ${(t1 - t0).toFixed(1)}ms | freeText(1,4000) ${p.success ? "ACCEPTED" : p.error.issues.map((i: any) => i.message ?? i.code).join(",")} ${(t2 - t1).toFixed(1)}ms | +'x' at end -> ${tail} ${(t3 - t2).toFixed(1)}ms`);
  }
}

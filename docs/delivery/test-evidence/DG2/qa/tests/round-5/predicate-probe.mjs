// qa-verifier DG2 round 5: independent probe of the shared visible-content predicate (F-DG2-180) on the BUILT package.
// usage: node predicate-probe.mjs <clone>/packages/shared/dist/schemas/index.js
const { hasText, hasVisibleContent } = await import(process.argv[2]); // built @mth/shared/schemas (dist/schemas/index.js) of the clone
const cases = [
  ["VS16 alone U+FE0F", "️", false], ["VS17 alone U+E0100", "\u{E0100}", false], ["CGJ U+034F", "͏", false],
  ["Mongolian FVS1 U+180B", "᠋", false], ["Khmer U+17B4", "឴", false], ["Hangul filler U+3164", "ㅤ", false],
  ["C0 U+0001 U+0007", "\u0001\u0007", false], ["C1 U+0085", "\u0085", false], ["lone surrogate U+D800", "\uD800", false],
  ["tag chars U+E0041", "\u{E0041}", false], ["braille blank U+2800", "⠀", false], ["ZWSP+NBSP+RLM", "​ ‏", false],
  ["emoji+VS16", "✔️", true], ["Arabic + RLM", "‏نص", true], ["combining mark alone U+0301", "́", true],
  ["Mongolian letter + FVS", "ᠠ᠋", true], ["leading ZWSP + text", "​QA", true],
];
let bad = 0;
for (const [name, v, want] of cases) {
  const got = hasVisibleContent(v), ht = hasText(v);
  const ok = got === want && ht === want;
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: hasVisibleContent=${got} hasText=${ht} expected=${want}`);
}
console.log(`failures: ${bad}`); process.exit(bad ? 1 : 0);

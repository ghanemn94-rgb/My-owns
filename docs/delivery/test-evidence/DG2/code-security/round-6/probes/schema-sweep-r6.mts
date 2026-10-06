// code-security-reviewer DG2 round-6 (T-DG2-REV-SEC-R6). Schema-level re-verification of F-DG2-230/231 on 51a692b1.
// Usage (Node 24 type stripping): node schema-sweep-r6.mts <clone>/packages/shared
// 1. exhaustive: the set of single code points counted NOT visible must equal exactly
//    White_Space ∪ Cc ∪ Cf ∪ Cs ∪ Default_Ignorable_Code_Point ∪ {U+2800, U+16FE4, U+1D159} (no more, no less);
// 2. each placeholder alone / repeated / mixed -> freeText, name, reason rejected (validation.blank), hasText false;
// 3. each placeholder with visible text -> accepted, verbatim (freeText), marks kept;
// 4. U+0000: alone, inside, leading, trailing -> exactly one error validation.invalid_character for freeText/name/reason;
//    hasInvalidCharacter true only for U+0000 across all code points.
// All data SYNTHETIC.
const m = await import(process.argv[2] + "/src/schemas/common.ts");
const { freeText, hasText, hasVisibleContent, hasInvalidCharacter, name, reason } = m;
const s = freeText(1, 100);
let unexpected = 0;
const codes = (schema: any, v: string) => { const r = schema.safeParse(v); return r.success ? "ACCEPTED" : r.error.issues.map((i: any) => i.message).join(","); };
const excluded = /^[\p{White_Space}\p{Cc}\p{Cf}\p{Cs}\p{Default_Ignorable_Code_Point}⠀\u{16FE4}\u{1D159}]$/u;
let invisible = 0, extraInvisible: string[] = [], missedExcluded: string[] = [], invalidChar: string[] = [];
for (let cp = 0; cp <= 0x10ffff; cp++) {
  const ch = cp >= 0xd800 && cp <= 0xdfff ? String.fromCharCode(cp) : String.fromCodePoint(cp);
  const vis = hasVisibleContent(ch);
  if (!vis) invisible++;
  if (!vis && !excluded.test(ch)) extraInvisible.push(cp.toString(16));
  if (vis && excluded.test(ch)) missedExcluded.push(cp.toString(16));
  if (hasInvalidCharacter(ch)) invalidChar.push(cp.toString(16));
}
console.log(`## exhaustive sweep 0..10FFFF: invisible=${invisible}; invisible but outside the declared set: ${extraInvisible.length} ${extraInvisible.slice(0, 20).join(" ")}; declared set but still visible: ${missedExcluded.length} ${missedExcluded.slice(0, 20).join(" ")}; hasInvalidCharacter true for: [${invalidChar.join(" ")}]`);
if (extraInvisible.length || missedExcluded.length || invalidChar.join() !== "0") unexpected++;
console.log("\n## placeholders without visible content: expect rejected validation.blank, hasText false");
for (const [k, v] of [["U+16FE4", "\u{16FE4}"], ["U+1D159", "\u{1D159}"], ["U+1D159 x2", "\u{1D159}\u{1D159}"], ["U+16FE4 x3", "\u{16FE4}".repeat(3)], ["U+2800+U+16FE4+U+1D159+NBSP+RLM+VS16", "⠀\u{16FE4}\u{1D159} ‏️"]] as [string, string][]) {
  const r = [codes(s, v), String(hasText(v)), codes(name, v), codes(reason, v.repeat(3))];
  const ok = r[0] === "validation.blank" && r[1] === "false" && r[2] === "validation.blank" && r[3] === "validation.blank";
  if (!ok) unexpected++;
  console.log((ok ? "ok  " : "BAD ") + k.padEnd(40), "freeText:", r[0], " hasText:", r[1], " name:", r[2], " reason(x3):", r[3]);
}
console.log("\n## placeholders with visible text: expect accepted, verbatim");
for (const [k, v] of [["a+U+16FE4", "a\u{16FE4}"], ["U+1D159+Arabic", "\u{1D159}نص"], ["Khitan char U+18B00 + filler", "\u{18B00}\u{16FE4}"], ["musical G clef + null notehead", "\u{1D11E}\u{1D159}"], ["emoji+VS16+U+1D159", "❤️\u{1D159}"]] as [string, string][]) {
  const r = [codes(s, v), String(hasText(v)), codes(name, v), codes(reason, v + "xx")];
  const ok = r[0] === "ACCEPTED" && s.parse(v) === v && r[1] === "true" && r[2] === "ACCEPTED" && name.parse(v) === v && r[3] === "ACCEPTED";
  if (!ok) unexpected++;
  console.log((ok ? "ok  " : "BAD ") + k.padEnd(40), "freeText:", r[0], " verbatim:", s.parse(v) === v, " hasText:", r[1], " name:", r[2], " reason:", r[3]);
}
console.log("\n## U+0000: expect exactly one error validation.invalid_character");
for (const [k, v] of [["NUL alone", "\u0000"], ["NUL x3", "\u0000\u0000\u0000"], ["inside", "Syn\u0000thetic"], ["leading", "\u0000Synthetic"], ["trailing", "Synthetic\u0000"], ["NUL+spaces", " \u0000 "], ["NUL+RLM", "‏\u0000"]] as [string, string][]) {
  const r = [codes(s, v), codes(name, v), codes(reason, v.length >= 3 ? v : v + "\u0000\u0000")];
  const ok = r.every((x) => x === "validation.invalid_character");
  if (!ok) unexpected++;
  console.log((ok ? "ok  " : "BAD ") + k.padEnd(20), "freeText:", r[0], " name:", r[1], " reason:", r[2]);
}
console.log("\n## legitimate input kept: U+0001..U+001F inside visible text, '\\\\0', '%00', U+FFFD");
for (const v of ["a\u0001b", "Synthetic \\0", "100%00", "a�b"]) {
  const ok = codes(s, v) === "ACCEPTED" && s.parse(v) === v;
  if (!ok) unexpected++;
  console.log((ok ? "ok  " : "BAD ") + JSON.stringify(v).padEnd(20), "freeText:", codes(s, v));
}
console.log(`\nUNEXPECTED: ${unexpected}`);
process.exit(unexpected ? 1 : 0);

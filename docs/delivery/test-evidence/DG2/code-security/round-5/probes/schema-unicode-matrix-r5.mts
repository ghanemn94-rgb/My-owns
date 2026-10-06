// code-security-reviewer DG2 round-5 (T-DG2-REV-SEC-R5). Schema-level Unicode matrix re-verifying F-DG2-180 on the
// round-5 candidate (96a3c293). Usage (Node 24 type stripping): node schema-unicode-matrix-r5.mts <clone>/packages/shared
// 1. the round-3 (F-DG2-160) and round-4 (F-DG2-180) sets through freeText(1,100), hasText, `name`, `reason`;
// 2. further "renders as nothing" candidates outside the excluded set (adversarial);
// 3. visible text that carries marks (VS16 emoji, Arabic + RLM, combining marks, Mongolian + FVS, keycap, tag flag):
//    must be ACCEPTED and stored VERBATIM (freeText) / trimmed only at the ends (name, reason);
// 4. exhaustive sweeps: every Default_Ignorable / Cc / Cf / Cs / White_Space code point must be NOT visible; and a
//    census, by general category, of every code point that is still counted as visible when alone;
// 5. timing up to 10^7 code units (linear, no backtracking). All data SYNTHETIC.
const { freeText, hasText, hasVisibleContent, name, reason } = await import(process.argv[2] + "/src/schemas/common.ts");
const s = freeText(1, 100);
const res = (schema: any, v: string) => {
  const r = schema.safeParse(v);
  return r.success ? "ACCEPTED" : "rejected(" + r.error.issues.map((i: any) => i.message ?? i.code).join(",") + ")";
};
let unexpected = 0;
const row = (k: string, v: string, expectVisible: boolean) => {
  const ft = res(s, v), ht = hasText(v), nm = res(name, v), rs = res(reason, v.repeat(3));
  const ok = expectVisible
    ? ft === "ACCEPTED" && ht && nm === "ACCEPTED" && rs === "ACCEPTED" && s.parse(v) === v
    : ft !== "ACCEPTED" && !ht && nm !== "ACCEPTED" && rs !== "ACCEPTED";
  if (!ok) unexpected++;
  console.log((ok ? "ok  " : "BAD ") + k.padEnd(40), "freeText:", ft.padEnd(28), "hasText:", String(ht).padEnd(6), "name:", nm.padEnd(28), "reason(x3):", rs);
};
const invisible: Record<string, [string, string][]> = {
  "round-3 set (F-DG2-160): expect rejected": [
    ["U+0020 x3", "   "], ["TAB/LF/CR", "\t\n\r"], ["U+00A0 NBSP", " "], ["U+3000", "　"], ["U+2028 LS", " "],
    ["U+FEFF BOM", "﻿"], ["U+2007", " "], ["U+0085 NEL", "\u0085"], ["U+180E", "᠎"], ["U+200B ZWSP", "​"],
    ["U+200C ZWNJ", "‌"], ["U+200D ZWJ", "‍"], ["U+2060 WJ", "⁠"], ["U+3164", "ㅤ"], ["U+2800", "⠀"],
    ["U+00AD", "­"], ["U+061C ALM", "؜"], ["U+200F RLM", "‏"],
  ],
  "round-4 residual set (F-DG2-180): expect rejected": [
    ["U+034F CGJ", "͏"], ["U+034F x2", "͏͏"], ["U+17B4", "឴"], ["U+17B5", "឵"], ["U+180B FVS1", "᠋"],
    ["U+180C", "᠌"], ["U+180D", "᠍"], ["U+180F FVS4", "᠏"], ["U+FE00 VS1", "︀"], ["U+FE0F VS16", "️"],
    ["U+FE0F x3", "️️️"], ["U+E0100 VS17", "\u{e0100}"], ["U+E01EF VS256", "\u{e01ef}"], ["U+FFF0 (Cn DI)", "￰"],
    ["U+E0000 (Cn DI)", "\u{e0000}"], ["U+2065 (Cn DI)", "⁥"], ["U+E0FFF (Cn DI)", "\u{e0fff}"], ["RLM+VS16+CGJ", "‏️͏"],
    ["U+115F", "ᅟ"], ["U+1160", "ᅠ"], ["U+FFA0", "ﾠ"], ["U+E0020 tag sp", "\u{e0020}"], ["U+1BCA0", "\u{1bca0}"],
    ["U+0001 (Cc)", "\u0001"], ["U+0000 NUL (Cc)", "\u0000"], ["U+007F DEL", "\u007f"], ["U+009F (C1)", "\u009f"],
    ["lone U+D800 (Cs)", "\ud800"], ["lone U+DFFF (Cs)", "\udfff"], ["mixed NEL+RLM+WJ+NBSP+VS16+CGJ", "\u0085‏⁠ ️͏"],
  ],
};
const visible: [string, string][] = [
  ["a", "a"], ["Arabic alef", "ا"], ["RLM + Arabic text", "‏نص"], ["Arabic + RLM after", "نص‏"],
  ["emoji heart + VS16", "❤️"], ["VS16 then heart", "️❤"], ["keycap 1 (1 VS16 U+20E3)", "1️⃣"],
  ["emoji ZWJ family", "\u{1f468}‍\u{1f469}‍\u{1f467}"], ["flag England (tag seq)", "\u{1f3f4}\u{e0067}\u{e0062}\u{e0065}\u{e006e}\u{e0067}\u{e007f}"],
  ["e + U+0301 (decomposed e-acute)", "é"], ["Arabic ba + shadda + fatha", "بَّ"], ["Mongolian a + FVS1", "ᠠ᠋"],
  ["Hangul syllable", "가"], ["Devanagari ka+virama+ssa", "क्ष"], ["leading ZWSP + text", "​scope"],
  ["text + CGJ inside", "a͏b"], ["CJK ideograph", "中"],
];
for (const [g, cases] of Object.entries(invisible)) { console.log(`\n## ${g}`); for (const [k, v] of cases) row(k, v, false); }
console.log("\n## visible text that carries marks: expect ACCEPTED, freeText output === input");
for (const [k, v] of visible) row(k, v, true);
console.log("\n## name/reason keep marks inside, trim only ECMAScript whitespace at the ends");
for (const [k, schema, v, out] of [
  ["name '  \\u2764\\ufe0f '", name, "  ❤️ ", "❤️"],
  ["name '\\u200f\\u0646\\u0635'", name, "‏نص", "‏نص"],
  ["reason 'e\\u0301e\\u0301e\\u0301'", reason, "ééé", "ééé"],
  ["reason '\\ufe0f\\ufe0f\\ufe0f'", reason, "️️️", null],
] as [string, any, string, string | null][]) {
  const r = schema.safeParse(v);
  const ok = out === null ? !r.success : r.success && r.data === out;
  if (!ok) unexpected++;
  console.log((ok ? "ok  " : "BAD ") + k.padEnd(40), r.success ? "ACCEPTED -> " + JSON.stringify(r.data) : "rejected(" + r.error.issues.map((i: any) => i.message).join(",") + ")");
}

console.log("\n## adversarial: other code points that may render as nothing (informational: counted visible?)");
for (const [k, v] of [
  ["U+1D159 MUSICAL SYMBOL NULL NOTEHEAD (So)", "\u{1d159}"], ["U+16FE4 KHITAN SMALL SCRIPT FILLER", "\u{16fe4}"],
  ["U+0301 combining acute alone (Mn)", "́"], ["U+064B Arabic fathatan alone (Mn)", "ً"], ["U+20DD enclosing circle (Me)", "⃝"],
  ["U+E000 private use (Co)", ""], ["U+F0000 plane-15 PUA (Co)", "\u{f0000}"], ["U+FFFE noncharacter (Cn)", "￾"],
  ["U+FDD0 noncharacter (Cn)", "﷐"], ["U+0378 unassigned (Cn)", "͸"], ["U+FFFC object replacement", "￼"],
  ["U+FFFD replacement char", "�"], ["U+2062 invisible times (Cf)", "⁢"], ["U+1D173 (Cf)", "\u{1d173}"],
  ["U+13430 Egyptian format (Cf)", "\u{13430}"], ["U+0F0C Tibetan nbsp tsheg (Po)", "༌"], ["U+0E00 unassigned Thai (Cn)", "฀"],
  ["U+1CBB? (Cn)", "᲻"], ["U+3000+U+3164 mix", "　ㅤ"], ["U+2800 x3", "⠀⠀⠀"],
] as [string, string][])
  console.log(k.padEnd(44), "hasVisibleContent:", hasVisibleContent(v), " freeText:", res(s, v));

console.log("\n## exhaustive: code points with an EXCLUDED property that are still counted visible (expect 0 each)");
for (const [label, re] of [
  ["Default_Ignorable_Code_Point", /^\p{Default_Ignorable_Code_Point}$/u], ["White_Space", /^\p{White_Space}$/u],
  ["Cc", /^\p{Cc}$/u], ["Cf", /^\p{Cf}$/u],
] as [string, RegExp][]) {
  let total = 0; const bad: string[] = [];
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    const ch = String.fromCodePoint(cp);
    if (!re.test(ch)) continue;
    total++; if (hasVisibleContent(ch)) bad.push(cp.toString(16));
  }
  if (bad.length) unexpected++;
  console.log(`${label.padEnd(30)} code points: ${String(total).padEnd(6)} still counted visible: ${bad.length} ${bad.slice(0, 20).join(" ")}`);
}
let cs = 0; for (let cp = 0xd800; cp <= 0xdfff; cp++) if (hasVisibleContent(String.fromCharCode(cp))) cs++;
if (cs) unexpected++;
console.log(`Cs (lone surrogates)           code points: 2048   still counted visible: ${cs}`);

console.log("\n## census: code points counted VISIBLE when alone, by general category (informational)");
const cats = ["Lu","Ll","Lt","Lm","Lo","Mn","Mc","Me","Nd","Nl","No","Pc","Pd","Ps","Pe","Pi","Pf","Po","Sm","Sc","Sk","So","Zs","Zl","Zp","Cc","Cf","Cs","Co","Cn"];
const catRe = cats.map((c) => [c, new RegExp(`^\\p{${c}}$`, "u")] as [string, RegExp]);
const census: Record<string, number> = {};
for (let cp = 0; cp <= 0x10ffff; cp++) {
  if (cp >= 0xd800 && cp <= 0xdfff) continue;
  const ch = String.fromCodePoint(cp);
  if (!hasVisibleContent(ch)) continue;
  const c = catRe.find(([, r]) => r.test(ch))![0];
  census[c] = (census[c] ?? 0) + 1;
}
console.log(JSON.stringify(census));
console.log("Mn/Me (combining marks) render as a mark on a dotted circle; Co/Cn render as a replacement/tofu glyph. None is in Zs/Zl/Zp/Cc/Cf/Cs:", !census["Zs"] && !census["Zl"] && !census["Zp"] && !census["Cc"] && !census["Cf"]);

console.log("\n## performance (linear scan expected)");
for (const n of [1_000, 100_000, 1_000_000, 10_000_000]) {
  for (const [lbl, unit] of [["VS16", "️"], ["NEL+WJ+NBSP+CGJ", "\u0085⁠ ͏"], ["E0100 (astral)", "\u{e0100}"]] as [string, string][]) {
    const v = unit.repeat(Math.ceil(n / unit.length)).slice(0, n - (n % 2));
    const t0 = performance.now(); const h = hasVisibleContent(v); const t1 = performance.now();
    const tail = hasVisibleContent(v + "x"); const t2 = performance.now();
    console.log(`n=${String(n).padEnd(9)} ${lbl.padEnd(16)} visible=${h} ${(t1 - t0).toFixed(1)}ms | +'x' -> ${tail} ${(t2 - t1).toFixed(1)}ms`);
  }
}
console.log(`\nUNEXPECTED RESULTS: ${unexpected}`);

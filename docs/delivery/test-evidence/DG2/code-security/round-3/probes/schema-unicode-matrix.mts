const { freeText, hasText } = await import(process.argv[2] + "/src/schemas/common.ts");
const s = freeText(1, 100);
const cases: Record<string, string> = {
  "U+0020 x3": "   ", "TAB/LF/CR": "\t\n\r", "U+00A0 NBSP": " ", "U+3000 ideographic": "　", "U+2028 LS": " ",
  "U+FEFF BOM": "﻿", "U+2007 figure sp": " ", "U+0085 NEL": "\u0085", "U+180E Mongolian VS": "᠎",
  "U+200B ZWSP": "​", "U+200C ZWNJ": "‌", "U+200D ZWJ": "‍", "U+2060 WJ": "⁠",
  "U+3164 Hangul filler": "ㅤ", "U+2800 braille blank": "⠀", "U+00AD soft hyphen": "­", "U+061C ALM": "؜", "U+200F RLM": "‏",
};
for (const [k, v] of Object.entries(cases)) {
  const r = s.safeParse(v);
  console.log(k.padEnd(24), "freeText:", r.success ? "ACCEPTED" : "rejected(" + r.error.issues.map((i: any) => i.message).join(",") + ")", " hasText:", hasText(v));
}

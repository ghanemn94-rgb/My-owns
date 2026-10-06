// code-security-reviewer DG2 round-7: truncateText (packages/shared/src/schemas/common.ts) boundary cases. SYNTHETIC.
// Usage: node --experimental-strip-types truncate-text-edges.mts <path to packages/shared/src/schemas/common.ts of a disposable clone>
const { truncateText, hasInvalidCharacter } = await import(process.argv[2]!);
const E = "\u{1F600}"; // 2 UTF-16 units
let fail = 0;
const check = (name: string, got: string, want: string) => {
  const ok = got === want && got.isWellFormed();
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: got ${JSON.stringify(got)} (len ${got.length}, wellFormed ${got.isWellFormed()}) want ${JSON.stringify(want)}`);
};
check("max between pair halves", truncateText("ab" + E, 3), "ab");
check("max after pair", truncateText("ab" + E + "c", 4), "ab" + E);
check("max=1 with leading pair", truncateText(E + "x", 1), "");
check("max=0", truncateText("abc", 0), "");
check("no cut needed", truncateText("a" + E, 3), "a" + E);
check("Arabic BMP", truncateText("نطاق تجريبي", 4), "نطاق");
check("ZWJ family cut mid-sequence stays well-formed", truncateText("\u{1F468}‍\u{1F469}", 3), "\u{1F468}‍");
// Exhaustive: every prefix length of a mixed string is well-formed and a prefix of the input, at most max units.
const s = ("x" + E + "ي" + E + E + "‍").repeat(20);
for (let m = 0; m <= s.length + 1; m++) {
  const t = truncateText(s, m);
  if (!t.isWellFormed() || !s.startsWith(t) || t.length > m || t.length < m - 1) { fail++; console.log(`FAIL exhaustive m=${m}`); }
}
console.log(`exhaustive: ${s.length + 2} lengths checked`);
const caseTable: [string, boolean][] = [["\uD800", true], ["\uDFFF", true], ["a\uDBFFb", true], [E, false], ["\u0000", true], ["نص", false], ["�", false]];
for (const [v, want] of caseTable) { const got = hasInvalidCharacter(v); if (got !== want) fail++; console.log(`${got === want ? "PASS" : "FAIL"} hasInvalidCharacter(${JSON.stringify(v)}) = ${got}`); }
console.log(fail === 0 ? "ALL PASS" : `${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);

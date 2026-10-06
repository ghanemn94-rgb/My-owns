// code-security-reviewer DG2 round-5: supporting schema checks for F-DG2-230 / F-DG2-231. SYNTHETIC data.
// Usage: node extra-schema-checks.mts <96a3c293 clone>/packages/shared <round-4 common.ts predicate source file>
const cur = await import(process.argv[2] + "/src/schemas/common.ts");
const { readFileSync } = await import("node:fs");
const r4src = readFileSync(process.argv[3], "utf8");
const r4re = new RegExp(r4src.match(/const VISIBLE_CONTENT = \/(.*)\/u;/)![1]!, "u");
console.log("round-4 (e37f6ea4) VISIBLE_CONTENT:", r4re.source);
const ok = (s: any, v: string) => (s.safeParse(v).success ? "ACCEPTED" : "rejected");
for (const [k, v] of [["U+16FE4", "\u{16fe4}"], ["U+1D159 x2", "\u{1d159}\u{1d159}"]] as [string, string][])
  console.log(`96a3c293 ${k.padEnd(12)} freeText:${ok(cur.freeText(1, 100), v)} name:${ok(cur.name, v)} reason(x3):${ok(cur.reason, v.repeat(3))} hasText:${cur.hasText(v)}`);
for (const v of ["Synthetic\u0000exclusion", "Synthetic\u0000name"])
  console.log(`NUL inside text ${JSON.stringify(v)}: 96a3c293 freeText:${ok(cur.freeText(1, 100), v)} name:${ok(cur.name, v)} reason:${ok(cur.reason, v)} | e37f6ea4 predicate visible: ${r4re.test(v)}`);

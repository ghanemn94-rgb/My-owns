// QA-DG6R3: static scan of e2e budgets (F-DG6-144). A spec is "file-budgeted" if it has a top-level (column-0)
// test.setTimeout(...) or test.describe.configure({... timeout ...}); otherwise each test(...) call is checked for a
// test.setTimeout / testInfo.setTimeout inside its body or an enclosing describe.configure timeout.
import fs from "node:fs";
const files = process.argv.slice(2);
let defaultCount = 0, total = 0; const rows = [];
for (const f of files) {
  const src = fs.readFileSync(f, "utf8"); const lines = src.split("\n");
  const fileLevel = lines.some((l) => /^test\.setTimeout\(/.test(l) || /^test\.describe\.configure\(\{[^}]*timeout/.test(l) || /^\s{0,2}test\.describe\.configure\(\{[^}]*timeout/.test(l) && false);
  const topCfg = /^(test\.describe\.configure\(\{[^}]*timeout|test\.setTimeout\()/m.test(src);
  // tests: lines starting with test( / test.only( / test.describe(.. are counted by "test(" with a title
  const testIdx = []; lines.forEach((l, i) => { if (/^\s*test(\.skip|\.fixme)?\(\s*[`"']/.test(l)) testIdx.push(i); });
  let unb = 0;
  for (let k = 0; k < testIdx.length; k++) {
    total++;
    if (topCfg) continue;
    const body = lines.slice(testIdx[k], k + 1 < testIdx.length ? testIdx[k + 1] : lines.length).join("\n");
    // enclosing describe.configure with timeout above this test, same indentation level - approximate: any indented configure before
    const before = lines.slice(0, testIdx[k]).join("\n");
    const descCfg = /describe\.configure\(\{[^}]*timeout/.test(before);
    if (/setTimeout\(\s*[\dA-Z_]/.test(body) || descCfg) continue;
    unb++; defaultCount++; rows.push(`${f}:${testIdx[k] + 1}: ${lines[testIdx[k]].trim().slice(0, 110)}`);
  }
  if (!topCfg) rows.push(`# ${f}: no file-level budget; ${testIdx.length} tests, ${unb} without an explicit budget`);
}
console.log(rows.join("\n")); console.log(`TOTAL tests ${total}; on the default 30 s (heuristic): ${defaultCount}`);

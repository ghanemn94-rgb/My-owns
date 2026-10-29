// T-DG6-FE-G (F-DG5-145/146/151): reads Playwright `list` reporter logs and prints, per test (file:line), the loaded
// worst case over its runs (chromium-en and chromium-ar), its outcome, and whether it runs on the default 30 s budget
// (no `test.setTimeout(` inside the test body, no `test.slow(`, no file-level `test.setTimeout(`/`describe.configure`
// timeout). Tests above 15 s on the default budget are flagged "NEEDS BUDGET" (ADR-0061 §9: an explicit budget of at
// least 2x the loaded worst case, or a split). A failed run's duration is a lower bound (it stopped at its budget).
// Usage: node e2e-durations.mjs <list-log>... (from the repository root)
import { readFileSync } from "node:fs";

const rows = new Map();
const re = /^\s+([✓✘])\s+\d+\s+\[(chromium-(?:en|ar))\] › (\S+?):(\d+):\d+ › (.*) \((\d+(?:\.\d+)?)(ms|s|m)\)\s*$/u;
for (const file of process.argv.slice(2))
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = re.exec(line);
    if (!m) continue;
    const [, mark, project, spec, ln, title, n, unit] = m;
    const sec = Number(n) * (unit === "ms" ? 0.001 : unit === "m" ? 60 : 1);
    const key = `${spec}:${ln}`;
    const r = rows.get(key) ?? { spec, line: Number(ln), title, runs: [] };
    r.runs.push({ project, sec, ok: mark === "✓" });
    rows.set(key, r);
  }

const sources = new Map();
function budgetOf(spec, line) {
  if (!sources.has(spec)) sources.set(spec, readFileSync(spec, "utf8").split("\n"));
  const src = sources.get(spec);
  const fileLevel = src.some((l) => /^test\.setTimeout\(|describe\.configure\(\{[^}]*timeout/.test(l));
  if (fileLevel) return "explicit(file)";
  // The test body: from its line to the next top-level `test(`/`test.describe(` (or the end).
  let end = src.length;
  for (let i = line; i < src.length; i++)
    if (/^(test|  test)(\.describe)?\(/.test(src[i]) && i > line - 1) {
      end = i;
      break;
    }
  const body = src.slice(line - 1, end).join("\n");
  const m = /test\.setTimeout\(([\d_]+)\)/.exec(body);
  if (m) return `explicit(${Number(m[1].replace(/_/g, "")) / 1000}s)`;
  if (/test\.slow\(/.test(body)) return "slow(90s)";
  return "default(30s)";
}

const out = [];
for (const r of rows.values()) {
  const worst = Math.max(...r.runs.map((x) => x.sec));
  const failed = r.runs.filter((x) => !x.ok).map((x) => x.project);
  const budget = budgetOf(r.spec, r.line);
  const flag = budget === "default(30s)" && worst > 15 ? "NEEDS BUDGET" : "";
  out.push({ ...r, worst, failed, budget, flag });
}
out.sort((a, b) => (a.spec === b.spec ? a.line - b.line : a.spec < b.spec ? -1 : 1));
console.log("spec:line | worst loaded (s) | runs | failed in | budget | flag | title");
for (const r of out)
  console.log(
    `${r.spec}:${r.line} | ${r.worst.toFixed(1)} | ${r.runs.length} | ${r.failed.join(",") || "-"} | ${r.budget} | ${r.flag} | ${r.title.slice(0, 90)}`,
  );
const flagged = out.filter((r) => r.flag);
console.log(`\n${out.length} tests measured; ${flagged.length} on the default budget above 15 s (NEEDS BUDGET).`);

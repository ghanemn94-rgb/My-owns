// Detects import cycles among apps/web/src modules (static `import ... from "./x"` and `import("./x")`, relative only).
import { readFileSync, existsSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
const root = process.argv[2];
const files = execSync(`git -C ${root} ls-files 'apps/web/src/**.ts' 'apps/web/src/**.tsx'`, { encoding: "utf8" })
  .split("\n").filter((f) => f && !/\.test\.tsx?$/.test(f)).map((f) => resolve(root, f));
const set = new Set(files);
const res = (from, spec) => {
  const b = resolve(dirname(from), spec);
  for (const c of [b, `${b}.ts`, `${b}.tsx`, `${b}/index.ts`, `${b}/index.tsx`]) if (set.has(c)) return c;
  return null;
};
const g = new Map(); const lazy = new Map(); let lazyCount = 0;
for (const f of files) {
  const s = readFileSync(f, "utf8");
  const deps = new Set();
  for (const m of s.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^'"]*?from\s+["'](\.[^"']+)["']/gm)) { const r = res(f, m[1]); if (r) deps.add(r); }
  for (const m of s.matchAll(/^\s*import\s+["'](\.[^"']+)["']/gm)) { const r = res(f, m[1]); if (r) deps.add(r); }
  for (const m of s.matchAll(/import\(\s*["'](\.[^"']+)["']\s*\)/g)) lazyCount++;
  g.set(f, deps);
}
// Tarjan SCC
let idx = 0; const st = []; const on = new Set(); const ix = new Map(); const low = new Map(); const sccs = [];
const sc = (v) => { ix.set(v, idx); low.set(v, idx); idx++; st.push(v); on.add(v);
  for (const w of g.get(v) ?? []) { if (!ix.has(w)) { sc(w); low.set(v, Math.min(low.get(v), low.get(w))); } else if (on.has(w)) low.set(v, Math.min(low.get(v), ix.get(w))); }
  if (low.get(v) === ix.get(v)) { const c = []; let w; do { w = st.pop(); on.delete(w); c.push(w); } while (w !== v); if (c.length > 1 || (g.get(v) ?? new Set()).has(v)) sccs.push(c); } };
for (const v of files) if (!ix.has(v)) sc(v);
console.log(`web source modules=${files.length} dynamic import() sites=${lazyCount} cycles(value imports)=${sccs.length}`);
for (const c of sccs) console.log("CYCLE:", c.map((x) => x.replace(root + "/", "")).join(" <-> "));
process.exit(sccs.length === 0 ? 0 : 1);

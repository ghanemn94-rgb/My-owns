// Reviewer probe: file-level static value-import graph of apps/web/src (excluding tests, `import type`, and dynamic
// import() which is code splitting), cycle detection (Tarjan SCC).
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
const base = join(process.argv[2], "apps/web/src");
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f) && !/\.test\.|\.spec\./.test(f)) files.push(p); } };
walk(base);
const edges = new Map(files.map((f) => [f, []]));
for (const f of files) {
  const s = readFileSync(f, "utf8");
  for (const m of s.matchAll(/^\s*(import|export)\s+(type\s+)?[^;]*?from\s+"(\.[^"]+)"/gms)) {
    if (m[2]) continue;
    let t = resolve(dirname(f), m[3]);
    if (!existsSync(t)) for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) if (existsSync(t + ext)) { t += ext; break; }
    if (edges.has(t)) edges.get(f).push(t);
  }
}
let idx = 0; const st = []; const on = new Set(); const ix = new Map(); const low = new Map(); const sccs = [];
const sc = (v) => { ix.set(v, idx); low.set(v, idx++); st.push(v); on.add(v);
  for (const w of edges.get(v)) { if (!ix.has(w)) { sc(w); low.set(v, Math.min(low.get(v), low.get(w))); } else if (on.has(w)) low.set(v, Math.min(low.get(v), ix.get(w))); }
  if (low.get(v) === ix.get(v)) { const c = []; let w; do { w = st.pop(); on.delete(w); c.push(w); } while (w !== v); if (c.length > 1 || edges.get(v).includes(v)) sccs.push(c); } };
for (const f of files) if (!ix.has(f)) sc(f);
console.log(`web files ${files.length}; import cycles (SCCs > 1): ${sccs.length}`);
for (const c of sccs) console.log("  " + c.map((x) => x.slice(base.length + 1)).join(" <-> "));

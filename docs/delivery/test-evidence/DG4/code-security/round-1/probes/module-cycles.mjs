// Reviewer probe: module-level import graph of apps/api/src/modules (static imports, excluding tests), cycle detection.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
const root = process.argv[2];
const base = join(root, "apps/api/src/modules");
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f) && !/\.test\./.test(f)) files.push(p); } };
walk(base);
const edges = new Map();
const mod = (p) => relative(base, p).split("/")[0].replace(/\.ts$/, "");
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+"(\.[^"]+)"/gms)) {
    if (/^\s*import\s+type\s/.test(m[0])) continue;
    const target = resolve(dirname(f), m[1]);
    if (!target.startsWith(base)) continue;
    const a = mod(f), b = mod(target);
    if (a === b) continue;
    if (!edges.has(a)) edges.set(a, new Set());
    edges.get(a).add(b);
  }
}
const out = [...edges].map(([a, s]) => `${a} -> ${[...s].sort().join(", ")}`).sort();
console.log(out.join("\n"));
// cycles
const color = new Map(); const cycles = [];
const dfs = (n, stack) => { color.set(n, 1); stack.push(n); for (const m of edges.get(n) ?? []) { if (color.get(m) === 1) cycles.push([...stack.slice(stack.indexOf(m)), m].join(" -> ")); else if (!color.get(m)) dfs(m, stack); } stack.pop(); color.set(n, 2); };
for (const n of edges.keys()) if (!color.get(n)) dfs(n, []);
console.log(`cycles (value imports): ${cycles.length}`); for (const c of cycles) console.log("  " + c);

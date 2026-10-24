// code-security-reviewer DG5 r2: static import-cycle check of apps/web/src (relative imports, non-test files; type-only
// imports excluded since they vanish at build time) and the lazy-route check (every page module reached from the router
// through lazy()/lazyPage). Clone root.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
const root = "apps/web/src";
const files = [];
(function walk(d) { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) && !/test-utils|setupTests/.test(p)) files.push(p); } })(root);
const res = (from, spec) => { const b = resolve(dirname(from), spec); for (const c of [b, `${b}.ts`, `${b}.tsx`, join(b, "index.ts"), join(b, "index.tsx")]) if (existsSync(c) && statSync(c).isFile()) return c.replace(process.cwd() + "/", ""); return null; };
const g = new Map();
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const deps = [];
  for (const m of src.matchAll(/^\s*import\s+(type\s+)?[^;]*?from\s+["'](\.[^"']+)["']/gms)) if (!m[1]) { const r = res(f, m[2]); if (r) deps.push(r); }
  for (const m of src.matchAll(/^\s*export\s+(type\s+)?[^;]*?from\s+["'](\.[^"']+)["']/gms)) if (!m[1]) { const r = res(f, m[2]); if (r) deps.push(r); }
  g.set(f, deps);
}
const cycles = []; const color = new Map(); const stack = [];
function dfs(u) { color.set(u, 1); stack.push(u); for (const v of g.get(u) ?? []) { if (!g.has(v)) continue; if (color.get(v) === 1) cycles.push(stack.slice(stack.indexOf(v)).concat(v)); else if (!color.get(v)) dfs(v); } stack.pop(); color.set(u, 2); }
for (const f of g.keys()) if (!color.get(f)) dfs(f);
console.log(`web modules: ${g.size}; static (value) import cycles: ${cycles.length}`);
for (const c of cycles.slice(0, 20)) console.log("CYCLE " + c.join(" -> "));
const router = files.filter((f) => /routes?\.tsx?$|router\.tsx?$/i.test(f));
const lazy = router.map((f) => [f, (readFileSync(f, "utf8").match(/lazy(Page)?\(/g) ?? []).length]);
console.log("router files and lazy() counts:", JSON.stringify(lazy));
const eagerPages = router.flatMap((f) => [...readFileSync(f, "utf8").matchAll(/^import\s+(?!type)[^;]*from\s+["']([^"']*pages\/[^"']+)["']/gm)].map((m) => `${f}: ${m[1]}`));
console.log("eager (non-lazy) page imports in router files:", JSON.stringify(eagerPages));
process.exit(cycles.length === 0 ? 0 : 1);

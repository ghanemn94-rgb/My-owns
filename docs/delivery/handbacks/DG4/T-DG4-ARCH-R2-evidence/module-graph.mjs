// T-DG4-ARCH-R2 item 6 (ADR-0032 amendment G1): proves that adding governance -> raid to API_MODULES keeps the module
// graph acyclic, and that once it exists the reverse edge raid -> governance would close a cycle. Reads apps/api/src/modules.ts as is
// (Node type stripping); changes nothing. Usage: node docs/delivery/handbacks/DG4/T-DG4-ARCH-R2-evidence/module-graph.mjs
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const { API_MODULES } = await import(pathToFileURL(resolve("apps/api/src/modules.ts")).href);

function graphOf(extra = []) {
  const g = new Map(Object.entries(API_MODULES).map(([m, d]) => [m, [...d.dependsOn]]));
  for (const [from, to] of extra) g.get(from).push(to);
  return g;
}

/** Kahn's algorithm: a topological order (dependencies first), or the modules left on a cycle. */
function topo(g) {
  for (const [m, deps] of g) for (const d of deps) if (!g.has(d)) throw new Error(`${m} depends on unknown ${d}`);
  const remaining = new Map([...g].map(([m, deps]) => [m, new Set(deps)]));
  const order = [];
  while (remaining.size > 0) {
    const ready = [...remaining].filter(([, deps]) => deps.size === 0).map(([m]) => m).sort();
    if (ready.length === 0) return { acyclic: false, cycleMembers: [...remaining.keys()].sort(), order };
    for (const m of ready) {
      order.push(m);
      remaining.delete(m);
      for (const deps of remaining.values()) deps.delete(m);
    }
  }
  return { acyclic: true, order };
}

function check(label, g) {
  const r = topo(g);
  const pos = new Map(r.order.map((m, i) => [m, i]));
  const ordered = r.acyclic && [...g].every(([m, deps]) => deps.every((d) => pos.get(d) < pos.get(m)));
  console.log(`${label}: acyclic=${r.acyclic}${r.acyclic ? ` every-dependency-first=${ordered}` : ""}`);
  if (r.acyclic) console.log(`  order: ${r.order.join(" < ")}`);
  else console.log(`  modules on or behind a cycle: ${r.cycleMembers.join(", ")}`);
  return r.acyclic && ordered;
}

const dependants = (g, target) => [...g].filter(([, deps]) => deps.includes(target)).map(([m]) => m).sort();
function reaches(g, from, to, seen = new Set()) {
  if (from === to) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  return g.get(from).some((d) => reaches(g, d, to, seen));
}

const base = graphOf();
const withEdge = graphOf([["governance", "raid"]]);
const both = graphOf([["governance", "raid"], ["raid", "governance"]]);
console.log(`governance.dependsOn (as is): ${API_MODULES.governance.dependsOn.join(", ")}`);
console.log(`raid.dependsOn (as is): ${API_MODULES.raid.dependsOn.join(", ")}`);
console.log(`modules that depend on governance (as is): ${dependants(base, "governance").join(", ")}`);
console.log(`raid reaches governance (as is): ${reaches(base, "raid", "governance")}`);
const a = check("as is", base);
const b = check("with governance -> raid", withEdge);
const c = check("with governance -> raid AND raid -> governance (must NOT be acyclic)", both);
const ok = a && b && !c && !reaches(base, "raid", "governance");
console.log(ok ? "RESULT: PASS (governance -> raid keeps the graph acyclic; with it, raid -> governance would close a cycle)" : "RESULT: FAIL");
process.exit(ok ? 0 : 1);

import { readFileSync } from "node:fs";
const p = JSON.parse(readFileSync(process.argv[2], "utf8"));
const byId = new Map(p.nodes.map((n) => [n.id, n]));
const parent = new Map(); for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const dt = new Map(); for (let i = 0; i < p.samples.length; i++) dt.set(p.samples[i], (dt.get(p.samples[i]) ?? 0) + (p.timeDeltas[i] ?? 0));
const self = new Map(), incl = new Map();
const key = (n) => `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.replace(/.*\/(apps|packages|node_modules)\//, "$1/")}:${n.callFrame.lineNumber + 1}`;
let total = 0;
for (const [id, t] of dt) { total += t; const n = byId.get(id); self.set(key(n), (self.get(key(n)) ?? 0) + t);
  const seen = new Set(); let cur = id; while (cur !== undefined) { const k = key(byId.get(cur)); if (!seen.has(k)) { seen.add(k); incl.set(k, (incl.get(k) ?? 0) + t); } cur = parent.get(cur); } }
const top = (m, f, n) => [...m].filter(([k]) => f(k)).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, t]) => `${(t / 1000).toFixed(0).padStart(7)} ms  ${k}`).join("\n");
console.log(`total sampled ${(total / 1000).toFixed(0)} ms`);
console.log("--- self (top 15)\n" + top(self, () => true, 15));
console.log("--- inclusive, apps/api src (top 30)\n" + top(incl, (k) => k.includes("apps/api") || k.includes("packages/"), 30));

#!/usr/bin/env node
// Independent feasibility check (qa-verifier, T-DG0-REV-QA-R1): acceptance-map.md and stage-plan.md vs the register.
import { readFileSync } from "node:fs";
import { join } from "node:path";
const root = process.argv[2] || process.cwd();
const rd = (p) => readFileSync(join(root, p), "utf8");
// minimal RFC4180 parse
function parse(t){const R=[];let r=[],f="",q=false;for(let i=0;i<t.length;i++){const c=t[i];if(q){if(c=='"'&&t[i+1]=='"'){f+='"';i++}else if(c=='"')q=false;else f+=c}else if(c=='"')q=true;else if(c==','){r.push(f);f=""}else if(c=='\n'){r.push(f);R.push(r);r=[];f=""}else if(c!='\r')f+=c}if(f||r.length){r.push(f);R.push(r)}return R}
const rows = parse(rd("docs/delivery/requirements.csv")); const H = rows[0];
const reqs = rows.slice(1).map((r) => Object.fromEntries(H.map((h, i) => [h, r[i]])));
const byId = new Map(reqs.map((r) => [r.req_id, r]));
const expand = (s) => { const out = []; for (const grp of s.split(";")) for (let p of grp.split(",")) { p = p.trim(); if (!p) continue;
  const m = p.match(/^(REQ-[A-Z0-9]+-)(\d{3})\.\.(\d{3})$/); if (m) { for (let n = +m[2]; n <= +m[3]; n++) out.push(m[1] + String(n).padStart(3, "0")); } else out.push(p); } return out; };
const map = rd("docs/analysis/acceptance-map.md").split("\n").filter((l) => /^\| A\d\d \| [^|]+\| REQ-S20/.test(l));
const errors = []; const lines = [];
const LEVELS = /(unit|integration|e2e|visual|ops|CI)/;
const seen = new Set();
for (const l of map) {
  const c = l.split("|").slice(1, -1).map((x) => x.trim());
  const [a, name, test, level, first, gate, proved] = c;
  seen.add(a);
  const tr = byId.get(test);
  if (!tr) errors.push(`${a}: test req ${test} missing from register`);
  else {
    if (tr.final_gate !== gate) errors.push(`${a}: map says must pass at ${gate} but ${test}.final_gate=${tr.final_gate}`);
    if (!new RegExp(`\\b${a}\\b`).test(tr.acceptance)) errors.push(`${a}: ${test} acceptance does not cite ${a}`);
  }
  if (!LEVELS.test(level)) errors.push(`${a}: no concrete test level ('${level}')`);
  const fp = first.match(/P(\d)/); if (!fp) errors.push(`${a}: no first-delivered stage`);
  else if (+fp[1] > +gate.slice(2)) errors.push(`${a}: first delivered P${fp[1]} after gate ${gate}`);
  const listed = new Set(expand(proved));
  for (const id of listed) if (!byId.has(id)) errors.push(`${a}: lists unknown ${id}`);
  const citing = reqs.filter((r) => r.req_id !== test && new RegExp(`\\b${a}\\b`).test(r.acceptance)).map((r) => r.req_id);
  const missing = citing.filter((x) => !listed.has(x)); const extra = [...listed].filter((x) => !citing.includes(x));
  if (missing.length) errors.push(`${a}: register rows cite ${a} but map omits: ${missing.join(" ")}`);
  if (extra.length) errors.push(`${a}: map lists rows whose acceptance doesn't cite ${a}: ${extra.join(" ")}`);
  lines.push(`${a} level=${level} first=${first.slice(0, 30)} gate=${gate} proved=${listed.size} citing=${citing.length}`);
}
for (let n = 1; n <= 28; n++) { const a = `A${String(n).padStart(2, "0")}`; if (!seen.has(a)) errors.push(`${a}: absent from acceptance map`); }
const plan = rd("docs/analysis/stage-plan.md");
const planMiss = []; for (let n = 1; n <= 28; n++) { const a = `A${String(n).padStart(2, "0")}`; if (!plan.includes(a) && !/A01[–-]A2[78]/.test(plan)) planMiss.push(a); }
const planScen = new Set(plan.match(/\bA(0[1-9]|1\d|2[0-8])\b/g) || []);
lines.push(`stage-plan mentions ${planScen.size} distinct scenario IDs explicitly; ranges present: ${(plan.match(/A\d\d[–-]A\d\d/g) || []).join(",")}`);
if (planMiss.length) errors.push(`stage-plan does not mention: ${planMiss.join(" ")}`);
for (const g of ["P0","P1","P2","P3","P4","P5","P6","P7"]) if (!plan.includes(g)) errors.push(`stage-plan lacks ${g}`);
lines.forEach((l) => console.log(l));
console.log(`errors (${errors.length}):`); errors.forEach((e) => console.log("  - " + e));
console.log(errors.length ? "RESULT: FAIL" : "RESULT: PASS"); process.exit(errors.length ? 1 : 0);

#!/usr/bin/env node
// Independent register integrity check (qa-verifier, T-DG0-REV-QA-R1). Own RFC 4180 parser; no reuse of tools/gates.
// Usage: node register-integrity.mjs <repo-root>   -> prints a report; exit 1 if any integrity error.
import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] || process.cwd();
const rd = (p) => readFileSync(join(root, p), "utf8");

function parse(text) {
  const rows = [];
  let row = [], f = "", i = 0, inq = false;
  if (text.charCodeAt(0) === 0xfeff) throw new Error("BOM present");
  while (i < text.length) {
    const c = text[i];
    if (inq) {
      if (c === '"' && text[i + 1] === '"') { f += '"'; i += 2; continue; }
      if (c === '"') { inq = false; i++; continue; }
      f += c; i++; continue;
    }
    if (c === '"') { if (f.length) throw new Error(`stray quote at row ${rows.length + 1}`); inq = true; i++; continue; }
    if (c === ",") { row.push(f); f = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; i++; continue; }
    f += c; i++;
  }
  if (inq) throw new Error("unterminated quote");
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows;
}

const errors = [], notes = [];
const COLS = "req_id,class,title,source_ref,source_heading,template_id,input_fields,procedure,output,owner_roles,permissions,automation,screen_api,acceptance,increments,final_gate,status,evidence,notes".split(",");
const raw = parse(rd("docs/delivery/requirements.csv"));
if (raw[0].join(",") !== COLS.join(",")) errors.push("header mismatch: " + raw[0].join(","));
const reqs = [];
raw.slice(1).forEach((r, n) => {
  if (r.length !== COLS.length) errors.push(`data row ${n + 2}: ${r.length} columns (expected ${COLS.length})`);
  reqs.push(Object.fromEntries(COLS.map((c, k) => [c, r[k] ?? ""])));
});
const B = new Set(JSON.parse(rd("docs/source/playbook.blocks.json")).map((b) => b.id));
const M = new Set(JSON.parse(rd("docs/source/master-prompt.blocks.json")).map((b) => b.id));
const expectB = Array.from({ length: 165 }, (_, i) => `B${String(i + 1).padStart(4, "0")}`);
const expectM = Array.from({ length: 423 }, (_, i) => `M${String(i + 1).padStart(4, "0")}`);
if (JSON.stringify([...B]) !== JSON.stringify(expectB)) errors.push("playbook.blocks.json is not exactly B0001..B0165");
if (JSON.stringify([...M]) !== JSON.stringify(expectM)) errors.push("master-prompt.blocks.json is not exactly M0001..M0423");

const list = (v) => v.split(";").map((s) => s.trim()).filter(Boolean);
const byId = new Map();
const count = { class: {}, area: {}, final_gate: {}, status: {} };
const inc = (o, k) => (o[k] = (o[k] || 0) + 1);
const accSeen = {};
for (const r of reqs) {
  const id = r.req_id;
  if (byId.has(id)) errors.push(`${id}: duplicate`);
  byId.set(id, r);
  const m = id.match(/^REQ-(PB|DLV|S0[1-9]|S1[0-9]|S2[01])-(\d{3})$/);
  if (!m) errors.push(`${id}: bad id`);
  inc(count.class, r.class); inc(count.area, m ? m[1] : "?"); inc(count.final_gate, r.final_gate); inc(count.status, r.status);
  for (const c of COLS) if (!["template_id", "evidence", "notes"].includes(c) && !r[c].trim()) errors.push(`${id}: empty ${c}`);
  for (const c of COLS) if (r[c] !== r[c].trim()) notes.push(`${id}: ${c} has leading/trailing whitespace`);
  if (r.status === "VERIFIED") errors.push(`${id}: declares VERIFIED (must be derived)`);
  if (!["PLANNED", "SPECIFIED", "IMPLEMENTED", "BLOCKED"].includes(r.status)) errors.push(`${id}: status ${r.status}`);
  if (!["SOURCE", "USER", "ENGINEERING"].includes(r.class)) errors.push(`${id}: class ${r.class}`);
  const refs = list(r.source_ref);
  for (const a of refs) if (!(B.has(a) || M.has(a))) errors.push(`${id}: anchor ${a} does not exist`);
  if (r.class === "SOURCE" && !refs.some((a) => B.has(a))) errors.push(`${id}: SOURCE without playbook block`);
  if (m && m[1] === "PB" && r.class !== "SOURCE") errors.push(`${id}: PB id but class ${r.class}`);
  if (m && m[1] === "DLV" && r.class === "SOURCE") notes.push(`${id}: DLV row classed SOURCE`);
  if (m && /^S\d\d$/.test(m[1])) {
    // area S<nn> should cite at least one master-prompt block
    if (!refs.some((a) => M.has(a))) errors.push(`${id}: area ${m[1]} cites no master-prompt block`);
  }
  if (r.template_id && !/^(T(0[1-9]|1[0-6])|CHARTER|TOM-CANVAS|BIZCASE|LAUNCH90|HEALTH25|ROAMING-EX)$/.test(r.template_id)) errors.push(`${id}: template_id '${r.template_id}'`);
  const acc = r.acceptance.match(/\bA(0[1-9]|1\d|2[0-8])\b/g) || [];
  if (!acc.length) errors.push(`${id}: no A01-A28 scenario`);
  const passText = r.acceptance.replace(/\bA\d\d\b[:,;]?/g, "").trim();
  if (passText.length < 15) errors.push(`${id}: acceptance lacks a concrete pass condition`);
  for (const a of new Set(acc)) inc(accSeen, a);
  const incs = list(r.increments);
  if (!incs.length || incs.some((p) => !/^P[0-7]$/.test(p))) errors.push(`${id}: increments '${r.increments}'`);
  const fg = /^DG[0-7]$/.test(r.final_gate) ? Number(r.final_gate[2]) : -1;
  if (fg < 0) errors.push(`${id}: final_gate '${r.final_gate}'`);
  const maxInc = Math.max(...incs.map((p) => Number(p.slice(1))));
  if (fg >= 0 && maxInc > fg) errors.push(`${id}: last increment P${maxInc} after final_gate ${r.final_gate}`);
  if (fg >= 0 && maxInc !== fg) notes.push(`${id}: final_gate ${r.final_gate} != last increment P${maxInc}`);
  if (fg === 0 && r.status !== "IMPLEMENTED") errors.push(`${id}: final_gate DG0 but ${r.status}`);
  if (fg > 0 && r.status === "IMPLEMENTED") notes.push(`${id}: IMPLEMENTED ahead of final gate ${r.final_gate}`);
  if (r.status === "BLOCKED" && !r.notes.trim()) errors.push(`${id}: BLOCKED without notes`);
  if (["PLANNED", "SPECIFIED"].includes(r.status) && r.evidence.trim()) notes.push(`${id}: ${r.status} but evidence non-empty`);
  if (r.status === "IMPLEMENTED") {
    if (!r.evidence.trim()) errors.push(`${id}: IMPLEMENTED without evidence`);
    for (const ev of list(r.evidence)) {
      const p = ev.split("#")[0];
      if (!p.includes("/")) { notes.push(`${id}: evidence '${ev}' is not a path`); continue; }
      if (!existsSync(join(root, p))) errors.push(`${id}: evidence path missing: ${ev}`);
      else if (statSync(join(root, p)).isFile() && statSync(join(root, p)).size === 0) errors.push(`${id}: evidence file empty: ${ev}`);
      if (p.startsWith("docs/delivery/") && /^(docs\/delivery\/(reviews|gates|test-evidence|runs|candidates|handbacks|assignments)\/|docs\/delivery\/(findings\.json|progress\.md|stages\.json)$)/.test(p)) notes.push(`${id}: evidence ${ev} is delivery metadata (outside the candidate)`);
    }
  }
}
for (let n = 1; n <= 28; n++) {
  const a = `A${String(n).padStart(2, "0")}`;
  if (!accSeen[a]) errors.push(`scenario ${a} not referenced`);
}

function coverage(rel, expected, prefix) {
  const rows = parse(rd(rel));
  if (rows[0].join(",") !== "block_id,disposition,req_ids,rationale") errors.push(`${rel}: header`);
  const seen = new Map(), disp = {};
  for (const r of rows.slice(1)) {
    if (r.length !== 4) errors.push(`${rel}: row ${r[0]} has ${r.length} columns`);
    const [b, d, ids, why] = r;
    if (seen.has(b)) errors.push(`${rel}: duplicate ${b}`);
    seen.set(b, { d, ids: list(ids || ""), why: why || "" });
    inc(disp, d);
  }
  const got = [...seen.keys()];
  if (JSON.stringify(got) !== JSON.stringify(expected)) {
    const missing = expected.filter((x) => !seen.has(x)), extra = got.filter((x) => !expected.includes(x));
    if (missing.length || extra.length) errors.push(`${rel}: missing [${missing.join(" ")}] extra [${extra.join(" ")}]`);
    else notes.push(`${rel}: rows not in block order`);
  }
  for (const [b, v] of seen) {
    if (!["REQUIREMENT", "CONTEXT", "NON-REQUIREMENT"].includes(v.d)) errors.push(`${rel}: ${b} disposition ${v.d}`);
    if (v.d === "REQUIREMENT") {
      if (!v.ids.length) errors.push(`${rel}: ${b} REQUIREMENT without ids`);
      for (const id of v.ids) {
        const r = byId.get(id);
        if (!r) errors.push(`${rel}: ${b} -> unknown ${id}`);
        else if (!list(r.source_ref).includes(b)) errors.push(`${rel}: ${b} -> ${id} which does not cite ${b}`);
      }
    } else {
      if (!v.why.trim()) errors.push(`${rel}: ${b} ${v.d} without rationale`);
      if (v.ids.length) notes.push(`${rel}: ${b} is ${v.d} but lists req_ids`);
    }
  }
  // reverse direction: every requirement citing block b must be listed by b's coverage row
  let reverseGaps = 0;
  for (const r of reqs) for (const a of list(r.source_ref)) {
    if (!a.startsWith(prefix)) continue;
    const v = seen.get(a);
    if (!v) continue;
    if (v.d !== "REQUIREMENT") { errors.push(`${rel}: ${r.req_id} cites ${a} but ${a} is ${v.d}`); reverseGaps++; }
    else if (!v.ids.includes(r.req_id)) { errors.push(`${rel}: ${r.req_id} cites ${a} but ${a}'s row does not list it`); reverseGaps++; }
  }
  return { disp, reverseGaps };
}
const cb = coverage("docs/analysis/source-coverage.csv", expectB, "B");
const cm = coverage("docs/analysis/master-prompt-coverage.csv", expectM, "M");

console.log(`root: ${root}`);
console.log(`rows: ${reqs.length}`);
console.log("by class:", JSON.stringify(count.class));
console.log("by area:", JSON.stringify(count.area));
console.log("by final_gate:", JSON.stringify(count.final_gate));
console.log("by status:", JSON.stringify(count.status));
console.log("scenario refs:", JSON.stringify(accSeen));
console.log("source-coverage dispositions:", JSON.stringify(cb.disp), "reverse gaps:", cb.reverseGaps);
console.log("master-prompt-coverage dispositions:", JSON.stringify(cm.disp), "reverse gaps:", cm.reverseGaps);
const dg0 = reqs.filter((r) => r.final_gate === "DG0");
console.log(`final_gate DG0 rows (${dg0.length}):`);
for (const r of dg0) console.log(`  ${r.req_id} [${r.status}] evidence=${r.evidence} :: ${r.title}`);
console.log(`notes (${notes.length}):`);
notes.forEach((n) => console.log("  - " + n));
console.log(`errors (${errors.length}):`);
errors.forEach((e) => console.log("  - " + e));
console.log(errors.length ? "RESULT: FAIL" : "RESULT: PASS");
process.exit(errors.length ? 1 : 0);

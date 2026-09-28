// Independent register-integrity check (qa-verifier, DG0 round 3 (copied unchanged from round 2)). Own RFC-4180 parser; no project imports.
// Usage: node register-integrity.mjs <repo-root>
import { readFileSync, statSync, existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";

const repo = resolve(process.argv[2] || ".");
const errors = [];
const info = [];

function parse(text) {
  const rows = [];
  let row = [], f = "", i = 0, q = false;
  while (i < text.length) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { f += '"'; i += 2; continue; }
      if (c === '"') { q = false; i++; if (i < text.length && ![",", "\n", "\r"].includes(text[i])) throw new Error(`text after closing quote at ${i}`); continue; }
      f += c; i++; continue;
    }
    if (c === '"' && f === "") { q = true; i++; continue; }
    if (c === ",") { row.push(f); f = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; i++; continue; }
    f += c; i++;
  }
  if (q) throw new Error("unterminated quote");
  if (f !== "" || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const read = (rel) => readFileSync(join(repo, rel), "utf8");
const isRepoFile = (rel) => {
  const abs = resolve(repo, rel);
  if (!abs.startsWith(repo + sep)) return false;
  try { return statSync(abs).isFile(); } catch { return false; }
};

const COLS = ["req_id","class","title","source_ref","source_heading","template_id","input_fields","procedure","output","owner_roles","permissions","automation","screen_api","acceptance","increments","final_gate","status","evidence","notes"];
const all = parse(read("docs/delivery/requirements.csv"));
const header = all[0];
if (JSON.stringify(header) !== JSON.stringify(COLS)) errors.push(`header mismatch: ${header.join(",")}`);
const rows = all.slice(1).filter((r) => !(r.length === 1 && r[0] === ""));
const recs = [];
rows.forEach((r, n) => {
  if (r.length !== COLS.length) errors.push(`line ${n + 2}: ${r.length} columns (expected ${COLS.length})`);
  recs.push(Object.fromEntries(COLS.map((c, k) => [c, (r[k] ?? "").trim()])));
});
const blocks = (rel) => new Set(JSON.parse(read(rel)).map((b) => b.id));
const B = blocks("docs/source/playbook.blocks.json");
const M = blocks("docs/source/master-prompt.blocks.json");
info.push(`playbook blocks: ${B.size} (${[...B][0]}..${[...B].at(-1)}); master-prompt blocks: ${M.size} (${[...M][0]}..${[...M].at(-1)})`);

const byId = new Map();
const G = ["DG0","DG1","DG2","DG3","DG4","DG5","DG6","DG7"];
const counts = { class: {}, area: {}, gate: {}, status: {}, gateByArea: {} };
const bump = (o, k) => (o[k] = (o[k] || 0) + 1);
const accSeen = new Map();
for (const r of recs) {
  const id = r.req_id;
  if (byId.has(id)) errors.push(`${id}: duplicate`);
  byId.set(id, r);
  const m = id.match(/^REQ-(PB|DLV|S0[1-9]|S1[0-9]|S2[01])-(\d{3})$/);
  if (!m) errors.push(`${id}: bad id`);
  for (const c of COLS) if (!["template_id","evidence","notes"].includes(c) && !r[c]) errors.push(`${id}: empty ${c}`);
  if (r.status === "VERIFIED") errors.push(`${id}: status VERIFIED is declared (must be derived)`);
  if (!["PLANNED","SPECIFIED","IMPLEMENTED","BLOCKED"].includes(r.status)) errors.push(`${id}: status ${r.status}`);
  if (!["SOURCE","USER","ENGINEERING"].includes(r.class)) errors.push(`${id}: class ${r.class}`);
  if (m && m[1] === "PB" && r.class !== "SOURCE") errors.push(`${id}: PB not SOURCE`);
  if (r.class === "SOURCE" && (!m || m[1] !== "PB")) errors.push(`${id}: SOURCE row outside REQ-PB`);
  const refs = r.source_ref.split(";").map((x) => x.trim()).filter(Boolean);
  for (const x of refs) {
    if (/^B\d{4}$/.test(x)) { if (!B.has(x)) errors.push(`${id}: unknown ${x}`); }
    else if (/^M\d{4}$/.test(x)) { if (!M.has(x)) errors.push(`${id}: unknown ${x}`); }
    else errors.push(`${id}: bad source_ref token '${x}'`);
  }
  if (r.class === "SOURCE" && !refs.some((x) => x.startsWith("B"))) errors.push(`${id}: SOURCE without playbook block`);
  const inc = r.increments.split(";").map((x) => x.trim()).filter(Boolean);
  if (!inc.length || inc.some((p) => !/^P[0-7]$/.test(p))) errors.push(`${id}: increments '${r.increments}'`);
  const gi = G.indexOf(r.final_gate);
  if (gi < 0) errors.push(`${id}: final_gate '${r.final_gate}'`);
  else {
    const nums = inc.map((p) => +p.slice(1));
    if (Math.max(...nums) !== gi) errors.push(`${id}: final_gate ${r.final_gate} != last increment P${Math.max(...nums)}`);
    const sorted = [...nums].sort((a, b) => a - b);
    if (JSON.stringify(sorted) !== JSON.stringify(nums)) errors.push(`${id}: increments not ascending '${r.increments}'`);
    if (new Set(nums).size !== nums.length) errors.push(`${id}: duplicate increments`);
  }
  if (gi === 0 && r.status !== "IMPLEMENTED") errors.push(`${id}: DG0 row is ${r.status}`);
  if (gi > 0 && r.status === "IMPLEMENTED") info.push(`${id}: IMPLEMENTED before its final gate ${r.final_gate}`);
  if (gi > 0 && r.status !== "SPECIFIED" && r.status !== "IMPLEMENTED") errors.push(`${id}: later-gate row is ${r.status}`);
  if (r.status === "IMPLEMENTED") {
    const ev = r.evidence.split(";").map((x) => x.trim()).filter(Boolean);
    if (!ev.length) errors.push(`${id}: IMPLEMENTED without evidence`);
    for (const e of ev) if (!isRepoFile(e.split("#")[0])) errors.push(`${id}: evidence missing: ${e}`);
  }
  for (const a of r.acceptance.match(/\bA(0[1-9]|1\d|2[0-8])\b/g) || []) { if (!accSeen.has(a)) accSeen.set(a, []); accSeen.get(a).push(id); }
  if (!/\bA(0[1-9]|1\d|2[0-8])\b/.test(r.acceptance)) errors.push(`${id}: acceptance cites no A-scenario`);
  bump(counts.class, r.class); bump(counts.area, m ? m[1] : "?"); bump(counts.gate, r.final_gate); bump(counts.status, r.status);
  counts.gateByArea[r.final_gate] ||= {}; bump(counts.gateByArea[r.final_gate], m ? m[1] : "?");
}
for (let n = 1; n <= 28; n++) { const a = `A${String(n).padStart(2, "0")}`; if (!accSeen.has(a)) errors.push(`${a}: not cited by any row`); }
// every A-scenario has its REQ-S20-0nn executable test row and it cites that scenario
for (let n = 1; n <= 28; n++) {
  const a = `A${String(n).padStart(2, "0")}`, t = `REQ-S20-${String(n).padStart(3, "0")}`;
  const r = byId.get(t);
  if (!r) errors.push(`${t}: executable test row for ${a} missing`);
  else if (!new RegExp(`\\b${a}\\b`).test(r.acceptance)) errors.push(`${t}: does not cite ${a}`);
}

function coverage(rel, ids) {
  const c = parse(read(rel));
  if (JSON.stringify(c[0]) !== JSON.stringify(["block_id","disposition","req_ids","rationale"])) errors.push(`${rel}: header ${c[0]}`);
  const seen = new Map(); const disp = {};
  for (const r of c.slice(1).filter((r) => r.join("") !== "")) {
    const [b, d, reqs, why] = r.map((x) => (x ?? "").trim());
    if (r.length !== 4) errors.push(`${rel} ${b}: ${r.length} columns`);
    if (seen.has(b)) errors.push(`${rel}: duplicate ${b}`);
    seen.set(b, true); bump(disp, d);
    if (!ids.has(b)) errors.push(`${rel}: unknown block ${b}`);
    if (d === "REQUIREMENT") {
      const list = reqs.split(";").map((x) => x.trim()).filter(Boolean);
      if (!list.length) errors.push(`${rel} ${b}: REQUIREMENT with no req_ids`);
      for (const q of list) {
        const rr = byId.get(q);
        if (!rr) errors.push(`${rel} ${b}: unknown ${q}`);
        else if (!rr.source_ref.split(";").map((x) => x.trim()).includes(b)) errors.push(`${rel} ${b}: ${q} does not cite ${b}`);
      }
    } else if (["CONTEXT","NON-REQUIREMENT"].includes(d)) {
      if (!why) errors.push(`${rel} ${b}: ${d} without rationale`);
      if (reqs) info.push(`${rel} ${b}: ${d} but lists req_ids ${reqs}`);
    } else errors.push(`${rel} ${b}: disposition '${d}'`);
  }
  for (const b of ids) if (!seen.has(b)) errors.push(`${rel}: missing ${b}`);
  // reverse: every block a register row cites that is dispositioned must be REQUIREMENT and list the row
  const rowsByBlock = new Map();
  for (const r of c.slice(1)) rowsByBlock.set(r[0], r);
  for (const rec of recs) for (const b of rec.source_ref.split(";").map((x) => x.trim()).filter((x) => ids.has(x))) {
    const cr = rowsByBlock.get(b);
    if (!cr) continue;
    if (cr[1] !== "REQUIREMENT") errors.push(`${rel}: ${rec.req_id} cites ${b} but the block is ${cr[1]}`);
    else if (!cr[2].split(";").map((x) => x.trim()).includes(rec.req_id)) info.push(`${rel}: ${rec.req_id} cites ${b} but ${b} does not list it (one-way)`);
  }
  info.push(`${rel}: ${seen.size} rows / ${ids.size} blocks; dispositions ${JSON.stringify(disp)}`);
}
coverage("docs/analysis/source-coverage.csv", B);
coverage("docs/analysis/master-prompt-coverage.csv", M);

const dg0 = recs.filter((r) => r.final_gate === "DG0");
console.log(`rows: ${recs.length}`);
console.log(`by class: ${JSON.stringify(counts.class)}`);
console.log(`by area: ${JSON.stringify(counts.area)}`);
console.log(`by final_gate: ${JSON.stringify(counts.gate)}`);
console.log(`by status: ${JSON.stringify(counts.status)}`);
console.log(`final_gate x area: ${JSON.stringify(counts.gateByArea)}`);
console.log(`A-scenario citation counts: ${[...accSeen.keys()].sort().map((a) => `${a}=${accSeen.get(a).length}`).join(" ")}`);
console.log(`DG0 rows (${dg0.length}):`);
for (const r of dg0) console.log(`  ${r.req_id} [${r.status}] evidence=${r.evidence}`);
for (const i of info) console.log(`INFO ${i}`);
for (const e of errors) console.log(`ERROR ${e}`);
console.log(`errors: ${errors.length}`);
process.exit(errors.length ? 1 : 0);

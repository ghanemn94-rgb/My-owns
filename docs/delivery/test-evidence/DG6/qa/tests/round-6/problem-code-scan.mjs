// qa-verifier DG6 round 6 (T-DG6-REV-QA-R6): my round-5 scan, re-run unchanged on candidate 0fea8adf.
// qa-verifier DG6 round 5 (copied unchanged from round 4): independent, broader scan of the problem / field-error codes the server can emit, and of
// their en + ar catalogue texts (the open question of D-211: problems-all.test.ts may miss codes emitted as constants).
// Usage: node problem-code-scan.mjs <repo-root>. Read-only. Prints every code, its first source, and whether
// problems.<key> (or <ns>.problem(s).<key>) exists in en and in ar, with Arabic letters, different from the English.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
const ROOT = process.argv[2];
const CODE = String.raw`[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+`; // dotted codes only (undotted generic codes are handled apart)
function files(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== "node_modules" && n !== "dist" && n !== "test") files(p, out); }
    else if (n.endsWith(".ts") && !n.endsWith(".test.ts") && !n.includes("testkit")) out.push(p);
  }
  return out;
}
const src = [...files(join(ROOT, "apps/api/src")), ...files(join(ROOT, "apps/worker/src"))];
const found = new Map(); // code -> {file, how}
const add = (c, f, how) => { if (!found.has(c)) found.set(c, { file: relative(ROOT, f), how }); };
const pats = [
  ["helper-literal", new RegExp(String.raw`\b(?:problems\.\w+|rule|businessRule|duplicate|badRequest|refuse|refusal|fail|reject)\(\s*["'\x60](${CODE})["'\x60]`, "g")],
  ["code-field", new RegExp(String.raw`\b(?:code|errorCode|lastErrorCode|error_code|last_error_code|reasonCode)\s*:\s*["'](${CODE})["']`, "g")],
  ["tuple", new RegExp(String.raw`\[\s*["'](${CODE})["']\s*,\s*["'\x60]`, "g")],
  ["const", new RegExp(String.raw`\bconst\s+[A-Z0-9_]*(?:CODE|REFUSAL|ERROR)[A-Z0-9_]*\s*=\s*["'](${CODE})["']`, "g")],
  ["as-const-array", new RegExp(String.raw`(?:CODES|REFUSALS|ERRORS)\w*\s*=\s*\[([^\]]*)\]`, "g")],
  ["return-literal", new RegExp(String.raw`return\s+["'](${CODE})["'];`, "g")],
  ["ternary-literal", new RegExp(String.raw`\?\s*["'](${CODE})["']\s*:\s*["'](${CODE})["']`, "g")],
];
for (const f of src) {
  const t = readFileSync(f, "utf8");
  for (const [how, re] of pats) for (const m of t.matchAll(re)) {
    if (how === "as-const-array") { for (const c of m[1].matchAll(new RegExp(String.raw`["'](${CODE})["']`, "g"))) add(c[1], f, how); continue; }
    for (let i = 1; i < m.length; i++) if (m[i]) add(m[i], f, how);
  }
  // `${kind}.archived` style templates: report them for manual resolution.
  for (const m of t.matchAll(/problems\.\w+\(\s*`([^`]*\$\{[^`]*)`/g)) add(`TEMPLATE:${m[1]}`, f, "template");
}
function flat(o, p = "", out = new Map()) { for (const [k, v] of Object.entries(o)) { const q = p ? `${p}.${k}` : k; if (typeof v === "string") out.set(q, v); else flat(v, q, out); } return out; }
function cat(lang) { const d = join(ROOT, "apps/web/src/i18n", lang); const m = new Map(); for (const n of readdirSync(d)) if (n.endsWith(".json")) for (const [k, v] of flat(JSON.parse(readFileSync(join(d, n), "utf8")))) m.set(`${n.replace(/\.json$/, "")}.${k}`, v); return m; }
const en = cat("en"), ar = cat("ar");
const keysFor = (code) => { const k = code.replace(/\./g, "__"); const out = [`problems.${k}`]; for (const key of en.keys()) if (key.endsWith(`.problem.${k}`) || key.endsWith(`.problems.${k}`) || key.endsWith(`.${k}.why`)) out.push(key); return out; };
const rows = []; let missing = 0;
for (const [code, { file, how }] of [...found].sort()) {
  if (code.startsWith("TEMPLATE:")) { rows.push(`TEMPLATE  ${code.slice(9)}  ${file}`); continue; }
  const ks = keysFor(code);
  const hit = ks.find((k) => en.has(k) && ar.has(k));
  const okAr = hit && /[؀-ۿ]/.test(ar.get(hit)) && ar.get(hit) !== en.get(hit);
  const st = hit ? (okAr ? "OK" : "AR-NOT-ARABIC") : ks.some((k) => en.has(k) || ar.has(k)) ? "ONE-LANG" : "MISSING";
  if (st !== "OK") missing++;
  rows.push(`${st.padEnd(13)} ${code.padEnd(60)} ${hit ?? "-"}  ${file} [${how}]`);
}
console.log(rows.join("\n"));
console.log(`\nSUMMARY codes=${[...found.keys()].filter((c) => !c.startsWith("TEMPLATE:")).length} notOK=${missing}`);

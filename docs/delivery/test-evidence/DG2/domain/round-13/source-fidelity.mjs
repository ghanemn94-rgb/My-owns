// domain-reviewer DG2 round 13: static source-fidelity cross-check. Extracts the playbook rows straight from
// docs/source/playbook.md (B0009, B0018, B0023, B0035, B0037, B0039-B0043, B0029, B0056, B0062) and checks that the
// candidate carries each source text verbatim where the product shows or seeds it. Read-only; no stack needed.
import { readFileSync } from "node:fs";
const pb = readFileSync("docs/source/playbook.md", "utf8").split("\n");
const block = (id) => { const i = pb.findIndex((l) => l.includes(`<!-- ${id} table -->`)); const rows = []; for (let j = i + 1; j < pb.length && (pb[j].startsWith("|") || rows.length === 0); j++) if (pb[j].startsWith("|")) rows.push(pb[j]); return rows.filter((r) => !/^\|\s*-+/.test(r)).map((r) => r.split("|").slice(1, -1).map((c) => c.trim())); };
const line = (id) => pb.find((l) => l.includes(`<!-- ${id} -->`)).replace(`<!-- ${id} -->`, "").trim();
const read = (f) => readFileSync(f, "utf8");
const out = []; const rec = (id, exp, act, ok) => { out.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${id} :: expected ${exp} :: actual ${act}`); };
const files = {
  modes: ["apps/web/src/i18n/en/transformations.json", "apps/api/src/modules/transformations/phase.ts"],
  roles: ["packages/db/migrations/0005_seed_roles_permissions.sql", "packages/db/migrations/0018_p2_access_instantiation.sql"],
  catalogue: ["packages/db/migrations/0011_p2_methodology_catalogue.sql"],
};
const has = (fs, s) => fs.filter((f) => read(f).includes(s) || read(f).includes(s.replace(/'/g, "''")));
// B0009 modes
for (const [mode, when, how] of block("B0009").slice(1)) {
  rec(`B0009.${mode}`, `'When to use' and 'How' verbatim in ${files.modes[0]}`, `when in ${JSON.stringify(has(files.modes, when))}; how in ${JSON.stringify(has(files.modes, how))}`, has(files.modes, when).includes(files.modes[0]) && has(files.modes, how).includes(files.modes[0]));
}
// B0018 roles
// Role names: the product names the per-person role in the singular ("Business Owner", "Workstream Lead") where the
// B0018 table header is plural; the check accepts that singular form and reports which form matched.
for (const [role, acc] of block("B0018").slice(1)) { const verb = has(files.roles, `'${role}'`).length > 0; const sing = !verb && /s$/.test(role) && has(files.roles, `'${role.replace(/s$/, "")}'`).length > 0; rec(`B0018.${role}`, "role name (verbatim, or singular of a plural table header) and accountability verbatim in the access seeds", `name=${verb ? "verbatim" : sing ? `singular '${role.replace(/s$/, "")}'` : "missing"} accountability=${has(files.roles, acc).length > 0}`, (verb || sing) && has(files.roles, acc).length > 0); }
// B0023 gates (G1-G6 names, questions, evidence)
for (const [gate, q, ev] of block("B0023").slice(1)) rec(`B0023.${gate.slice(0, 2)}`, "name, question and evidence verbatim in the methodology catalogue", `name=${has(files.catalogue, gate).length > 0} q=${has(files.catalogue, q).length > 0} ev=${has(files.catalogue, ev).length > 0}`, has(files.catalogue, gate).length > 0 && has(files.catalogue, q).length > 0 && has(files.catalogue, ev).length > 0);
// B0039-B0043 scope checks
for (const id of ["B0039", "B0040", "B0041", "B0042", "B0043"]) { const q = line(id); rec(`${id}.scope-check`, "question verbatim in the catalogue", `${JSON.stringify(q)} found=${has(files.catalogue, q).length > 0}`, has(files.catalogue, q).length > 0); }
// B0029 / B0056 / B0062 rows (first text column) present in the catalogue
{ const cells = block("B0062").flat().map((c) => c.split("<br>")); const missing = cells.filter(([title, prompt]) => !has(files.catalogue, `'${title}', '${prompt}'`).length).map((c) => c.slice(0, 2)); rec("B0062.canvas-cells", "10 canvas cells: title and prompt verbatim (adjacent) in the catalogue", `cells=${cells.length} missing=${JSON.stringify(missing)}`, cells.length === 10 && missing.length === 0); }
for (const id of ["B0029", "B0056"]) { const rows = block(id).slice(1); const missing = rows.map((r) => r.find((c, k) => k > 0 && c.length > 20) ?? r[1]).filter((c) => !has(files.catalogue, c).length); rec(`${id}.rows`, `${rows.length} row texts verbatim in the catalogue`, `rows=${rows.length} missing=${JSON.stringify(missing)}`, rows.length > 0 && missing.length === 0); }
// B0035 charter fields: 14 fields, each has an EN label in define.json
const define = JSON.parse(read("apps/web/src/i18n/en/define.json"));
const labels = JSON.stringify(define).toLowerCase();
const fields = block("B0035").slice(1).map((r) => r[0]);
const label = (f) => (f === "Top 3-5 outcomes" ? "top outcomes" : f.toLowerCase());
const missingF = fields.filter((f) => !labels.includes(label(f)));
const guidance = define.outcomes.topCountOk.includes("3 to 5") && define.charter?.topOutcomesWarning?.includes("3 to 5");
rec("B0035.fourteen-fields", "14 source fields, each labelled in EN define.json (B0035 'Top 3-5 outcomes' is labelled 'Top outcomes', with the 3-5 count carried by the REQ-PB-035 guidance/warning text)", `fields=${fields.length} missing=${JSON.stringify(missingF)} 3-5 guidance in topCountOk and charter.topOutcomesWarning=${guidance}`, fields.length === 14 && missingF.length === 0 && guidance);
// B0037 thesis: the four connectors of the sentence appear in the EN composed-thesis text
const thesis = block("B0037")[0][0];
const enThesis = JSON.stringify(define);
const parts = ["If we change", "will improve", "which will create", "because"];
rec("B0037.thesis-sentence", "the composed thesis uses the four B0037 connectors", `source=${JSON.stringify(thesis.slice(0, 80))}… present=${JSON.stringify(parts.map((p) => enThesis.includes(p)))}`, parts.every((p) => thesis.includes(p) && enThesis.includes(p)));
console.log(`SUMMARY ${out.filter(Boolean).length}/${out.length} PASS`);
process.exit(out.every(Boolean) ? 0 : 1);

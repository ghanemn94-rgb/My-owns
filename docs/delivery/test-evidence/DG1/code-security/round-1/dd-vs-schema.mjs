// Cross-check docs/architecture/data-dictionary.md (## <table> sections, first-column names of each table row)
// against SCHEMA_COLUMNS in packages/db/src/schema.ts, which catalogue.test.ts pins to information_schema.
// Run from a clone root: node <this file>. Exit 0 = identical table/column sets.
import { readFileSync } from "node:fs";
const { SCHEMA_COLUMNS, VIEW_NAMES } = await import(new URL("packages/db/src/schema.ts", `file://${process.cwd()}/`).href);
const md = readFileSync("docs/architecture/data-dictionary.md", "utf8").split("\n");
const dd = new Map(); let cur = null;
for (const l of md) {
  const h = /^## `?([a-z_0-9]+)`?(\s|$)/.exec(l); if (h) { cur = h[1]; dd.set(cur, new Set()); continue; }
  if (/^## /.test(l)) { cur = null; continue; }
  const r = /^\|\s*([a-z_0-9`\s\/,]+?)\s*\|/.exec(l);
  if (cur && r) for (const n of r[1].split(/[\/,]/).map((x) => x.replace(/`/g, "").trim())) if (/^[a-z_0-9]+$/.test(n) && n !== "column") dd.get(cur).add(n);
}
// Global rules: version + row stamps are declared once for every mutable table (not repeated per table).
const STAMPS = new Set(["version", "created_at", "updated_at", "created_by", "updated_by"]);
const problems = [];
for (const [t, cols] of Object.entries(SCHEMA_COLUMNS)) {
  if (!dd.has(t)) { if (VIEW_NAMES.includes(t)) { problems.push(`view ${t}: no data-dictionary section (check erd.md)`); continue; } problems.push(`table/view ${t} missing from data dictionary`); continue; }
  for (const c of cols) if (!dd.get(t).has(c) && !STAMPS.has(c)) problems.push(`${t}.${c} missing from data dictionary`);
  for (const c of dd.get(t)) if (!cols.includes(c) && c !== "stamps") problems.push(`${t}.${c} in data dictionary but not in schema`);
}
for (const t of dd.keys()) if (!(t in SCHEMA_COLUMNS) && dd.get(t).size > 0) problems.push(`data dictionary section ${t} is not a schema relation`);
console.log(`schema relations: ${Object.keys(SCHEMA_COLUMNS).length}; views: ${JSON.stringify(VIEW_NAMES)}; dictionary sections: ${dd.size}`);
console.log(problems.length ? problems.join("\n") : "OK: identical table/column sets");
process.exit(problems.length ? 1 : 0);

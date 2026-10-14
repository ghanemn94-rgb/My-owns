import { readFileSync } from "node:fs";
const en = JSON.parse(readFileSync("apps/web/src/i18n/en/transformations.json","utf8")).audit;
const files = process.argv.slice(2);
for (const f of files) {
  const s = readFileSync(f, "utf8");
  const acts = new Set(); const fields = new Set();
  for (const line of s.split("\n")) if (/\baction:/.test(line)) for (const m of line.matchAll(/"([a-z_]+\.[a-z_]+)"/g)) acts.add(m[1]);
  for (const m of s.matchAll(/["']?([A-Za-z_][A-Za-z0-9_]*)["']?:\s*\{\s*from:/g)) fields.add(m[1]);
  const k = (f) => f.replace(/[A-Z]/g, c => "_" + c.toLowerCase());
  console.log(f, "missing actions:", [...acts].filter(a => !en.actions[a.replace(/\./g,"_")]).join(" "), "| missing fields:", [...fields].filter(x => !en.field[k(x)]).join(" "));
}

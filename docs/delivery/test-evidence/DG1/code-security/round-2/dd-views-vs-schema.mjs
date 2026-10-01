// code-security-reviewer DG1 round 2 (F-DG1-145): cross-check the "### <view>" sections under "## Views" in
// docs/architecture/data-dictionary.md against SCHEMA_COLUMNS/VIEW_NAMES (pinned to information_schema by
// packages/db/test/integration/catalogue.test.ts). Run from a clone root with --conditions=@mth/source.
import { readFileSync } from "node:fs";
const { SCHEMA_COLUMNS, VIEW_NAMES } = await import(new URL("packages/db/src/schema.ts", `file://${process.cwd()}/`).href);
const md = readFileSync("docs/architecture/data-dictionary.md", "utf8").split("\n");
const doc = new Map(); let inViews = false, cur = null;
for (const l of md) {
  if (/^## /.test(l)) { inViews = /^## Views/.test(l); cur = null; continue; }
  const h = /^### `?([a-z_0-9]+)`?/.exec(l);
  if (inViews && h) { cur = h[1]; doc.set(cur, []); continue; }
  const r = /^\|\s*([a-z_0-9]+)\s*\|/.exec(l);
  if (inViews && cur && r) doc.get(cur).push(r[1]);
}
let bad = 0;
for (const v of VIEW_NAMES) {
  const want = [...SCHEMA_COLUMNS[v]].sort().join(","), got = [...(doc.get(v) ?? [])].sort().join(",");
  const ok = want === got; if (!ok) bad++;
  console.log(`${ok ? "MATCH" : "DIFF "} ${v}: schema=[${want}] doc=[${got}]`);
}
for (const k of doc.keys()) if (!VIEW_NAMES.includes(k)) { bad++; console.log(`EXTRA doc view ${k}`); }
console.log(`views=${VIEW_NAMES.length} mismatches=${bad}`); process.exit(bad ? 1 : 0);

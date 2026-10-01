#!/usr/bin/env bash
# qa-verifier DG1 r1 (REQ-S19-004): fresh DB -> mth-db migrate -> compare public tables AND columns with
# docs/architecture/data-dictionary.md (## <table> sections; column names in the first table cell of each row).
# Run: tests/qa/support/with-pg.sh bash <this file>   (from the candidate clone)
set -uo pipefail
A="$TEST_DATABASE_ADMIN_URL"; export NODE_ENV=development
psql "$A" -q -v ON_ERROR_STOP=1 -c "CREATE ROLE mth_owner NOLOGIN" -c "CREATE ROLE mth_app NOLOGIN" -c "CREATE DATABASE qaschema OWNER mth_owner"
DB="${A%/postgres}/qaschema"
DATABASE_OWNER_URL="$(node -e 'const u=new URL(process.argv[1]);u.pathname="/qaschema";u.searchParams.set("options","-c role=mth_owner");console.log(u.toString())' "$A")" node packages/db/dist/cli.js migrate | tail -1
psql "$DB" -At -F'|' -c "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' ORDER BY 1, ordinal_position" > "$TMPDIR/cols.txt"
node - "$TMPDIR/cols.txt" docs/architecture/data-dictionary.md <<'JS'
const fs = require("fs");
const [colsFile, dd] = process.argv.slice(2);
const db = new Map();
for (const l of fs.readFileSync(colsFile, "utf8").trim().split("\n")) { const [t, c] = l.split("|"); if (!db.has(t)) db.set(t, new Set()); db.get(t).add(c); }
const doc = new Map(); let cur = null;
for (const l of fs.readFileSync(dd, "utf8").split("\n")) {
  const h = l.match(/^## ([a-z_]+)\b/); if (h) { cur = h[1]; doc.set(cur, new Set()); continue; }
  if (/^## /.test(l)) { cur = null; continue; }
  const r = cur && l.match(/^\|\s*`?([a-z_][a-z0-9_]*)`?\s*\|/); if (r && !["column","name","field"].includes(r[1])) doc.get(cur).add(r[1]);
}
let bad = 0;
for (const [t, cols] of db) {
  if (!doc.has(t)) { console.log(`MISSING-IN-DICTIONARY table ${t}`); bad++; continue; }
  const d = doc.get(t);
  const miss = [...cols].filter((c) => !d.has(c));
  const extra = [...d].filter((c) => !cols.has(c));
  console.log(`${miss.length || extra.length ? "DIFF" : "OK  "} ${t}: db ${cols.size} cols, dictionary ${d.size}${miss.length ? " | undocumented: " + miss.join(",") : ""}${extra.length ? " | documented-not-in-db: " + extra.join(",") : ""}`);
  if (miss.length || extra.length) bad++;
}
for (const t of doc.keys()) if (!db.has(t)) console.log(`DOCUMENTED-NOT-IN-DB table ${t}`);
console.log(bad ? `SCHEMA-VS-DICTIONARY: ${bad} difference(s)` : "SCHEMA-VS-DICTIONARY: MATCH");
process.exit(bad ? 1 : 0);
JS

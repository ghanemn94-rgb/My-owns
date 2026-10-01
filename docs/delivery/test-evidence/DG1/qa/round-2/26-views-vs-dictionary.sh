#!/usr/bin/env bash
# qa-verifier DG1 round-2 (F-DG1-230 re-verification): migrate a fresh DB, read the live definition of every view in
# schema public (columns, types, relkind, grants) and compare columns+types with the "### <view>" tables of
# docs/architecture/data-dictionary.md; also list views not mentioned in data-dictionary.md / erd.md.
set -uo pipefail
A="$TEST_DATABASE_ADMIN_URL"; export NODE_ENV=development
psql "$A" -q -v ON_ERROR_STOP=1 -c "CREATE ROLE mth_owner NOLOGIN" -c "CREATE ROLE mth_app NOLOGIN" -c "CREATE DATABASE qaviews OWNER mth_owner"
OWN="$(node -e 'const u=new URL(process.argv[1]);u.pathname="/qaviews";u.searchParams.set("options","-c role=mth_owner");console.log(u.toString())' "$A")"
DB="${A%/postgres}/qaviews"
DATABASE_OWNER_URL="$OWN" node packages/db/dist/cli.js migrate | tail -1
echo "== live views (schema public)"; psql "$DB" -At -c "SELECT c.relname, c.relkind, pg_get_userbyid(c.relowner) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('v','m') ORDER BY 1"
echo "== grants on views"; psql "$DB" -At -c "SELECT table_name, grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name IN (SELECT table_name FROM information_schema.views WHERE table_schema='public') AND grantee <> 'mth_owner' GROUP BY 1,2 ORDER BY 1,2"
psql "$DB" -At -F '|' -c "SELECT c.table_name, c.column_name, c.data_type FROM information_schema.columns c JOIN information_schema.views v USING (table_schema, table_name) WHERE c.table_schema='public' ORDER BY 1, c.ordinal_position" > "$TMPDIR/live-views.txt"
echo "== live view columns"; cat "$TMPDIR/live-views.txt"
echo "== compare with data-dictionary.md"
node - "$TMPDIR/live-views.txt" <<'JS'
const fs = require("fs");
const live = fs.readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => l.split("|"));
const md = fs.readFileSync("docs/architecture/data-dictionary.md", "utf8");
const erd = fs.readFileSync("docs/architecture/erd.md", "utf8");
const norm = (t) => t.replace(/\s+NULL$/i, "").replace("character varying", "text").trim();
let bad = 0;
for (const view of [...new Set(live.map((r) => r[0]))]) {
  const m = md.match(new RegExp("### " + view + "\\b[^\\n]*\\n([\\s\\S]*?)(?=\\n### |\\n## )"));
  if (!m) { console.log(`MISSING  ${view}: no '### ${view}' section in data-dictionary.md`); bad++; continue; }
  const rows = m[1].split("\n").filter((l) => /^\|/.test(l) && !/^\|\s*(Column|---)/.test(l)).map((l) => l.split("|").map((s) => s.trim()));
  const doc = new Map(rows.map((r) => [r[1], norm(r[2])]));
  for (const [, col, type] of live.filter((r) => r[0] === view)) {
    if (!doc.has(col)) { console.log(`MISSING  ${view}.${col} (${type}) not in dictionary`); bad++; }
    else if (doc.get(col) !== norm(type)) { console.log(`TYPE     ${view}.${col}: live ${type}, doc ${doc.get(col)}`); bad++; }
    else console.log(`OK       ${view}.${col} ${type}`);
  }
  for (const col of doc.keys()) if (!live.some((r) => r[0] === view && r[1] === col)) { console.log(`EXTRA    ${view}.${col} documented but not live`); bad++; }
  console.log(`${erd.includes(view) ? "OK      " : "MISSING "} ${view} mentioned in erd.md`); if (!erd.includes(view)) bad++;
}
console.log(bad ? `RESULT: ${bad} mismatch(es)` : "RESULT: every live view, column and type is documented; every view is in the ERD");
process.exit(bad ? 1 : 0);
JS

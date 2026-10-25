#!/usr/bin/env bash
# domain-reviewer DG5 round 1 (T-DG5-RG-DOM-R1). Run INSIDE apps/web/e2e/support/with-stack.sh (production-path
# database: migrate + seed-dev, no demo marker, AUTH_MODE=dev), from the clone root. Read-mostly: it prints table counts,
# tries `mth-db seed-demo` in production mode and on a non-empty database (both must be refused, nothing written), and
# reads, through the real API with the synthetic dev users, /environment, /branding, /me/navigation and the four
# guiding questions. Prints "CHECK <id> OK|MISMATCH". SYNTHETIC users only; nothing approves anything real.
set -u
PGURL=$(node -e 'const u=new URL(process.env.DATABASE_OWNER_URL);u.search="";console.log(u.toString())')
q() { psql "$PGURL" -At -c "$1"; }
bad=0
check() { if [ "$2" = "$3" ]; then echo "CHECK $1 OK ($2)"; else echo "CHECK $1 MISMATCH (got '$2', want '$3')"; bad=$((bad+1)); fi; }
echo "== production-path database (with-stack.sh: migrate + seed-dev)"
for t in deployment_environment demo_seed_record demo_dataset_run; do echo "$t rows: $(q "select count(*) from $t")"; done
check demo_seed_record.empty "$(q "select count(*) from demo_seed_record")" 0
check roaming.users.none "$(q "select count(*) from user_identity where subject like 'roaming.user.%'")" 0
check roaming.transformation.none "$(q "select count(*) from transformation where code='ROAMING'")" 0
echo "== seed-demo with MTH_ENV=production"
MTH_ENV=production node packages/db/dist/cli.js seed-demo; rc=$?; echo "seed-demo exit=$rc"
[ "$rc" -ne 0 ] && check seed-demo.refused.production nonzero nonzero || check seed-demo.refused.production 0 nonzero
echo "== seed-demo with MTH_ENV unset on this non-empty database"
env -u MTH_ENV node packages/db/dist/cli.js seed-demo; rc=$?; echo "seed-demo exit=$rc"
[ "$rc" -ne 0 ] && check seed-demo.refused.non-empty nonzero nonzero || check seed-demo.refused.non-empty 0 nonzero
check demo_seed_record.after-refusals "$(q "select count(*) from demo_seed_record")" 0
echo "== API (base $E2E_BASE_URL)"
node --input-type=module - <<'EOF'
const base = process.env.E2E_BASE_URL;
async function session(username) {
  const r = await fetch(`${base}/api/v1/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify({ username }) });
  const cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  return async (path) => { const x = await fetch(`${base}${path}`, { headers: { cookie, origin: base } }); return { status: x.status, body: await x.json().catch(() => null) }; };
}
const anon = async (p) => { const x = await fetch(`${base}${p}`); return { status: x.status, body: await x.json().catch(() => null) }; };
const env = await anon("/api/v1/environment");
console.log("GET /environment (anonymous):", env.status, JSON.stringify(env.body));
const brand = await anon("/api/v1/branding");
console.log("GET /branding:", brand.status, JSON.stringify(brand.body).slice(0, 600));
for (const u of ["dev.admin", "dev.office", "dev.lead", "dev.auditor", "dev.nobody"]) {
  const s = await session(u);
  const n = await s("/api/v1/me/navigation");
  const areas = (n.body?.areas ?? []).map((a) => a.code);
  console.log(`navigation ${u}: ${n.status} ${areas.length} areas: ${areas.join(",")}`);
}
EOF
echo "probe mismatches: $bad"
exit $bad

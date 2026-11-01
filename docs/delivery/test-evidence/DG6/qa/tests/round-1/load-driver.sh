#!/usr/bin/env bash
# qa-verifier DG6 round 1 (T-DG6-REV-QA-R1): independent re-measurement of REQ-S20-029 (load p95) and REQ-S20-030 (async
# export at full scale), plus a check of the in-tree generator. Based on T-DG6-DO-G's final driver (same scripts, same
# environment variables); NOT part of the candidate. Run INSIDE tests/qa/support/with-pg.sh from the root of a disposable
# copy of the candidate:
#   QA_PG_PORT=28040 MTH_PORT_POOL=28000-28099 tests/qa/support/with-pg.sh bash <this file>
# Phase A: the TREE's deploy/load/generate.mjs (unpatched), profile smoke, into database mth_tree; sessions; API; every
#          initiative and transformation GET as its TL -> status histogram (the non-RFC id question, DO-F §5 item 1).
# Phase B: DO-F's generate-rfc-uuid.patch applied to a scratch copy of the generator (the copy every DG6 load figure used),
#          profile default, into database mth; sessions; reindex; ONE repetition of the workload (WARMUP_S/STEADY_S);
#          report.mjs; the export proof (export-proof.mjs unchanged).
# The figures are engineering measurements on a SHARED, LOADED sandbox host (three reviews ran at once), labelled
# PROVISIONAL; they say nothing about Mobily production capacity. Synthetic data only; nothing here approves anything.
set -uo pipefail
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
OUT="${OUT:?set OUT to the evidence directory}"
PATCH="${PATCH:?set PATCH to DO-F generate-rfc-uuid.patch}"
API_PORT="${API_PORT:-28045}"
WARMUP_S="${WARMUP_S:-60}" STEADY_S="${STEADY_S:-300}"
ADMIN="$TEST_DATABASE_ADMIN_URL"
BASE_PG="${ADMIN%/postgres}"
url() { echo "$BASE_PG/$1?options=-c%20role%3D$2"; }
WORK="$TMPDIR/qa-load"
rm -rf "$WORK"; mkdir -p "$OUT" "$WORK/evidence" "$WORK/gen/deploy/load"
host() { echo "host $1: $(date -u +%FT%TZ) loadavg $(cut -d' ' -f1-3 /proc/loadavg) nproc $(nproc) mem $(free -m | awk '/Mem:/ {print $2" MB total, "$7" MB available"}')"; }

echo "== qa load driver start $(date -u +%FT%TZ); node $(node -v)"
host start
cp deploy/load/generate.mjs "$WORK/gen/deploy/load/generate.mjs"
ln -s "$PWD/packages" "$WORK/gen/packages"
(cd "$WORK/gen" && patch -p0 --no-backup-if-mismatch < "$PATCH") || { echo "BLOCKED: the patch does not apply"; exit 3; }
sha256sum deploy/load/generate.mjs "$WORK/gen/deploy/load/generate.mjs" deploy/load/sessions.mjs deploy/load/workload.mjs \
  deploy/load/report.mjs deploy/load/export-proof.mjs apps/api/dist/main.js apps/worker/dist/main.js "$PATCH" | sed "s#$TMPDIR#\$TMPDIR#"
grep -n '^export const START_TARGET_MS' deploy/load/export-proof.mjs

psql "$ADMIN" -q -v ON_ERROR_STOP=1 -c "CREATE ROLE mth_owner NOLOGIN" -c "CREATE ROLE mth_app NOLOGIN"
mkdb() {
  psql "$ADMIN" -q -v ON_ERROR_STOP=1 -c "CREATE DATABASE $1 OWNER mth_owner ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0"
  DATABASE_OWNER_URL="$(url "$1" mth_owner)" DATABASE_URL="$(url "$1" mth_app)" NODE_ENV=production node packages/db/dist/cli.js migrate | tail -1
}
API_PID="" WORKER_PID=""
stop() {
  for p in $API_PID $WORKER_PID; do kill -TERM "$p" 2>/dev/null || true; done
  for p in $API_PID $WORKER_PID; do for _ in $(seq 1 100); do kill -0 "$p" 2>/dev/null || break; sleep 0.1; done; done
  for p in $API_PID $WORKER_PID; do kill -KILL "$p" 2>/dev/null || true; done
  API_PID="" WORKER_PID=""
}
trap stop EXIT
start() { # $1 db, $2 tag, $3 with worker (1/0)
  export DATABASE_URL="$(url "$1" mth_app)" DATABASE_OWNER_URL="$(url "$1" mth_owner)" MTH_LOAD_DB_URL="$BASE_PG/$1"
  if [ "$3" = 1 ]; then node apps/worker/dist/main.js >>"$WORK/worker-$2.log" 2>&1 </dev/null & WORKER_PID=$!; fi
  node apps/api/dist/main.js >>"$WORK/api-$2.log" 2>&1 </dev/null &
  API_PID=$!
  for _ in $(seq 1 240); do curl -fsS "http://localhost:$API_PORT/readyz" >/dev/null 2>&1 && return 0; sleep 0.5; done
  echo "API not ready"; tail -30 "$WORK/api-$2.log"; return 1
}
export NODE_ENV=production MTH_ENV=load AUTH_MODE=oidc LOG_LEVEL=warn APP_BASE_URL="http://localhost:$API_PORT" PORT="$API_PORT"
export OIDC_ISSUER_URL="https://idp.example.invalid/realms/mth-load" OIDC_CLIENT_ID=mth-load OIDC_CLIENT_SECRET=not-used-load-run
export EVIDENCE_STORAGE_DRIVER=filesystem EVIDENCE_STORAGE_PATH="$WORK/evidence"
unset RATE_LIMIT_PER_MINUTE AUTH_RATE_LIMIT_PER_MINUTE SEARCH_RATE_LIMIT_PER_MINUTE EXPORT_RATE_LIMIT_PER_MINUTE

# ---------------------------------------------------------------- Phase A: the tree's generator
if [ "${SKIP_A:-0}" != 1 ]; then
echo; echo "################ Phase A: tree generate.mjs (unpatched), profile smoke $(date -u +%FT%TZ)"
mkdb mth_tree
DATABASE_OWNER_URL="$(url mth_tree mth_owner)" NODE_ENV=production node deploy/load/generate.mjs --profile smoke | grep -v '^hash ' | tail -3
echo "generate exit=${PIPESTATUS[0]}"
psql "$BASE_PG/mth_tree" -qAtc "select 'initiatives ' || count(*) || ', non-RFC ids ' || count(*) filter (where id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\$') from initiative" \
  -c "select 'transformations ' || count(*) || ', non-RFC ids ' || count(*) filter (where id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\$') from transformation"
DATABASE_URL="$(url mth_tree mth_app)" DATABASE_OWNER_URL="$(url mth_tree mth_owner)" node deploy/load/sessions.mjs --duration-minutes 60 --out "$WORK/sessions-tree.json" 2>&1 | tail -2
start mth_tree a 0
node --input-type=module - "$WORK/sessions-tree.json" "http://127.0.0.1:$API_PORT" "$BASE_PG/mth_tree" <<'EOF'
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/packages/db/package.json");
const pg = require("pg");
const [file, base, db] = process.argv.slice(2);
const s = JSON.parse(readFileSync(file, "utf8"));
const sessions = s.sessions ?? s.users ?? s;
const c = new pg.Client({ connectionString: db }); await c.connect();
const rows = (await c.query(`select i.id as iid, i.transformation_id as tid, u.id as uid from initiative i
  join scoped_assignment a on a.scope_type='transformation' and a.scope_id=i.transformation_id
  join role r on r.id=a.role_id and r.code='TL' join app_user u on u.id=a.user_id`)).rows;
await c.end();
const byUser = new Map((Array.isArray(sessions) ? sessions : Object.values(sessions)).map((x) => [x.userId ?? x.user_id, x]));
const hist = {}; const tHist = {}; let tried = 0; const seenI = new Set(); const seenT = new Set(); let sample = null;
for (const r of rows) {
  const ses = byUser.get(r.uid); if (!ses) continue;
  const cookie = ses.cookie ?? `${ses.cookieName}=${ses.token}`;
  if (!seenI.has(r.iid)) { seenI.add(r.iid); tried++;
    const res = await fetch(`${base}/api/v1/initiatives/${r.iid}`, { headers: { cookie } });
    hist[res.status] = (hist[res.status] ?? 0) + 1;
    if (res.status === 400 && !sample) sample = await res.text(); else await res.arrayBuffer(); }
  if (!seenT.has(r.tid)) { seenT.add(r.tid);
    const res = await fetch(`${base}/api/v1/transformations/${r.tid}`, { headers: { cookie } });
    tHist[res.status] = (tHist[res.status] ?? 0) + 1; await res.arrayBuffer(); }
}
console.log(`PHASE-A getInitiative statuses over ${tried} initiatives: ${JSON.stringify(hist)}`);
console.log(`PHASE-A getTransformation statuses over ${seenT.size} transformations: ${JSON.stringify(tHist)}`);
if (sample) console.log(`PHASE-A sample 400 body: ${sample}`);
EOF
echo "phase A probe exit=$?"
stop
fi

# ---------------------------------------------------------------- Phase B: the patched copy, default profile
if [ "${SKIP_B:-0}" = 1 ]; then echo "Phase B skipped (SKIP_B=1)"; exit 0; fi
echo; echo "################ Phase B: patched generator copy, profile default $(date -u +%FT%TZ)"
host before-generate
mkdb mth
s=$(date +%s%N)
DATABASE_OWNER_URL="$(url mth mth_owner)" node "$WORK/gen/deploy/load/generate.mjs" --profile default | grep -v '^hash ' | tail -5
echo "generate exit=${PIPESTATUS[0]} wall_ms=$((($(date +%s%N) - s) / 1000000))"
D="$BASE_PG/mth"
psql "$D" -qAtc "select to_jsonb(m)-'generated_at' from load_dataset_marker m" \
  -c "select 'audit_event ' || count(*) from audit_event" -c "select 'transformation ' || count(*) from transformation" \
  -c "select 'initiative ' || count(*) from initiative" -c "select 'kpi_actual ' || count(*) from kpi_actual" \
  -c "select 'non-RFC initiative ids ' || count(*) from initiative where id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\$'" \
  -c "select 'database size ' || pg_size_pretty(pg_database_size('mth'))"
DATABASE_URL="$(url mth mth_app)" DATABASE_OWNER_URL="$(url mth mth_owner)" node deploy/load/sessions.mjs --duration-minutes 240 --out "$WORK/sessions.json" 2>&1 | tail -2
echo "== reindex $(date -u +%FT%TZ)"
start mth index 1
n=0 t=0
for _ in $(seq 1 360); do
  n=$(psql "$D" -qAtc "select count(*) from pgboss.job where name = 'search.reindex' and state = 'completed'")
  t=$(psql "$D" -qAtc "select count(*) from search_index_state where status <> 'idle'")
  [ "$n" -ge 1 ] && [ "$t" = 0 ] && break
  sleep 5
done
echo "search index: reindex completed jobs $n, types not idle $t $(date -u +%FT%TZ)"
stop
PGDATA_DIR="$(psql "$ADMIN" -qAtc 'show data_directory')"
node deploy/load/report.mjs capture-infra --out "$OUT/infrastructure.json" --pgdata "$PGDATA_DIR" \
  --api-processes 1 --api-pool 20 --worker-processes 1 --worker-pool 5 2>&1 | tail -2
echo "== workload repetition 1 (warmup $WARMUP_S s, steady $STEADY_S s) $(date -u +%FT%TZ)"
host before-workload
start mth rep1 1
node deploy/load/workload.mjs --sessions "$WORK/sessions.json" --base-url "http://127.0.0.1:$API_PORT" \
  --out "$OUT/rep-1" --warmup-s "$WARMUP_S" --steady-s "$STEADY_S" --repetition 1 2>&1 | tail -5
echo "workload exit=${PIPESTATUS[0]}"
host after-workload
stop
echo "api error-level log lines: $(grep -c '"level":50' "$WORK/api-rep1.log" || true); worker: $(grep -c '"level":50' "$WORK/worker-rep1.log" || true)"
node deploy/load/report.mjs report --run "$OUT" --title "qa-verifier DG6 R1 re-measurement (PROVISIONAL, shared loaded host)" 2>&1 | tail -3
echo "report exit=${PIPESTATUS[0]}"
echo "== export proof $(date -u +%FT%TZ)"
start mth proof 1
host before-proof
node deploy/load/export-proof.mjs --sessions "$WORK/sessions.json" --base-url "http://127.0.0.1:$API_PORT" \
  --db-url "$D" --out "$OUT/export-proof.json" --label qa-dg6-r1
echo "export-proof exit=$?"
host after-proof
stop
echo "api error-level log lines: $(grep -c '"level":50' "$WORK/api-proof.log" || true); worker: $(grep -c '"level":50' "$WORK/worker-proof.log" || true)"
psql "$D" -qAtc "select 'export_job ' || status || ' ' || count(*) from export_job group by status order by 1"
rm -f "$WORK/sessions.json" "$WORK/sessions-tree.json"
echo "== qa load driver end $(date -u +%FT%TZ)"

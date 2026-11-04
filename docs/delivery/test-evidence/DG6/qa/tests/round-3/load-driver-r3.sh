# qa-verifier DG6 round 3 (T-DG6-REV-QA-R3): the round-2 driver re-used on candidate aa219bd2; changes: names r2 -> r3, default port 29675. Run with SKIP_A=1 (Phase A was the F-DG6-142 check).
#!/usr/bin/env bash
# qa-verifier DG6 round 2 (T-DG6-REV-QA-R2): REQ-S20-029 (load p95), REQ-S20-030 (async export at full scale) and the
# F-DG6-142 / F-DG6-147 re-verification, with the IN-TREE deploy/load/generate.mjs (no patch) exactly as
# deploy/load/README.md documents it, and `eval "$(node deploy/load/rate-limits.mjs)"` for the load stack.
# NOT part of the candidate. Run INSIDE tests/qa/support/with-pg.sh from the root of a disposable copy:
#   QA_PG_PORT=28850 MTH_PORT_POOL=28800-28899 OUT=... tests/qa/support/with-pg.sh bash <this file>
# Phase A: profile smoke into mth_tree; every uuid-typed column of every public table checked against the RFC 9562
#          pattern; sessions; API; GET every initiative and transformation as its TL -> status histogram.
# Phase B: profile default into mth; the same uuid check; sessions; reindex; ONE workload repetition; report.mjs;
#          export-proof.mjs unchanged (REPS repetitions, default 1, each on the same database after the workload).
# Figures are PROVISIONAL engineering measurements on a SHARED, LOADED 4-vCPU sandbox host (three reviews at once); they
# say nothing about Mobily production capacity. Synthetic data only; nothing here approves anything.
set -uo pipefail
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
OUT="${OUT:?set OUT}"; API_PORT="${API_PORT:-29675}"; WARMUP_S="${WARMUP_S:-60}" STEADY_S="${STEADY_S:-300}"; REPS="${REPS:-1}"
ADMIN="$TEST_DATABASE_ADMIN_URL"; BASE_PG="${ADMIN%/postgres}"
url() { echo "$BASE_PG/$1?options=-c%20role%3D$2"; }
WORK="$TMPDIR/qa-load-r3"; rm -rf "$WORK"; mkdir -p "$OUT" "$WORK/evidence"
host() { echo "host $1: $(date -u +%FT%TZ) loadavg $(cut -d' ' -f1-3 /proc/loadavg) nproc $(nproc) mem $(free -m | awk '/Mem:/ {print $2" MB total, "$7" MB available"}')"; }
echo "== qa load driver r3 start $(date -u +%FT%TZ); node $(node -v)"; host start
sha256sum deploy/load/generate.mjs deploy/load/sessions.mjs deploy/load/workload.mjs deploy/load/report.mjs \
  deploy/load/export-proof.mjs deploy/load/rate-limits.mjs apps/api/dist/main.js apps/worker/dist/main.js
grep -n '^export const START_TARGET_MS' deploy/load/export-proof.mjs
psql "$ADMIN" -q -v ON_ERROR_STOP=1 -c "CREATE ROLE mth_owner NOLOGIN" -c "CREATE ROLE mth_app NOLOGIN"
mkdb() {
  psql "$ADMIN" -q -v ON_ERROR_STOP=1 -c "CREATE DATABASE $1 OWNER mth_owner ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0"
  DATABASE_OWNER_URL="$(url "$1" mth_owner)" DATABASE_URL="$(url "$1" mth_app)" NODE_ENV=production node packages/db/dist/cli.js migrate | tail -1
}
RFC='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
uuidcheck() { # every uuid column of every public base table: rows and non-RFC values (nil uuid excluded)
  psql "$BASE_PG/$1" -qAt -v ON_ERROR_STOP=1 <<SQL
DO \$\$ DECLARE r record; n bigint; bad bigint; tot bigint := 0; badtot bigint := 0; lines text := ''; BEGIN
  FOR r IN SELECT c.table_name t, c.column_name col FROM information_schema.columns c JOIN information_schema.tables b
    ON b.table_schema = c.table_schema AND b.table_name = c.table_name AND b.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.data_type = 'uuid' ORDER BY 1, 2 LOOP
    EXECUTE format('SELECT count(%I), count(*) FILTER (WHERE %I IS NOT NULL AND %I <> ''00000000-0000-0000-0000-000000000000'' AND %I::text !~ %L) FROM %I', r.col, r.col, r.col, r.col, '$RFC', r.t) INTO n, bad;
    tot := tot + n; badtot := badtot + bad;
    IF bad > 0 THEN lines := lines || format(E'\n  non-RFC %s.%s: %s of %s', r.t, r.col, bad, n); END IF;
  END LOOP;
  RAISE NOTICE 'UUIDCHECK %: % uuid values checked, % not RFC 9562%', '$1', tot, badtot, lines;
END \$\$;
SQL
}
API_PID="" WORKER_PID=""
stop() {
  for p in $API_PID $WORKER_PID; do kill -TERM "$p" 2>/dev/null || true; done
  for p in $API_PID $WORKER_PID; do for _ in $(seq 1 100); do kill -0 "$p" 2>/dev/null || break; sleep 0.1; done; done
  for p in $API_PID $WORKER_PID; do kill -KILL "$p" 2>/dev/null || true; done; API_PID="" WORKER_PID=""
}
trap stop EXIT
start() { # $1 db, $2 tag, $3 with worker (1/0)
  export DATABASE_URL="$(url "$1" mth_app)" DATABASE_OWNER_URL="$(url "$1" mth_owner)" MTH_LOAD_DB_URL="$BASE_PG/$1"
  if [ "$3" = 1 ]; then node apps/worker/dist/main.js >>"$WORK/worker-$2.log" 2>&1 </dev/null & WORKER_PID=$!; fi
  node apps/api/dist/main.js >>"$WORK/api-$2.log" 2>&1 </dev/null & API_PID=$!
  for _ in $(seq 1 240); do curl -fsS "http://localhost:$API_PORT/readyz" >/dev/null 2>&1 && return 0; sleep 0.5; done
  echo "API not ready"; tail -30 "$WORK/api-$2.log"; return 1
}
export NODE_ENV=production MTH_ENV=load AUTH_MODE=oidc LOG_LEVEL=warn APP_BASE_URL="http://localhost:$API_PORT" PORT="$API_PORT"
export OIDC_ISSUER_URL="https://idp.example.invalid/realms/mth-load" OIDC_CLIENT_ID=mth-load OIDC_CLIENT_SECRET=not-used-load-run
export EVIDENCE_STORAGE_DRIVER=filesystem EVIDENCE_STORAGE_PATH="$WORK/evidence"
unset RATE_LIMIT_PER_MINUTE AUTH_RATE_LIMIT_PER_MINUTE SEARCH_RATE_LIMIT_PER_MINUTE EXPORT_RATE_LIMIT_PER_MINUTE UPLOAD_RATE_LIMIT_PER_MINUTE ASSISTANT_RATE_LIMIT_PER_MINUTE WEBHOOK_RATE_LIMIT_PER_MINUTE
echo "== rate-limits.mjs (as deploy/load/README.md):"; eval "$(node deploy/load/rate-limits.mjs)"; env | grep -E '_RATE_LIMIT_PER_MINUTE=' | sort

if [ "${SKIP_A:-0}" != 1 ]; then
echo; echo "################ Phase A: in-tree generate.mjs, profile smoke $(date -u +%FT%TZ)"
mkdb mth_tree
DATABASE_OWNER_URL="$(url mth_tree mth_owner)" NODE_ENV=production node deploy/load/generate.mjs --profile smoke | grep -v '^hash ' | tail -3
echo "generate exit=${PIPESTATUS[0]}"
uuidcheck mth_tree 2>&1
DATABASE_URL="$(url mth_tree mth_app)" DATABASE_OWNER_URL="$(url mth_tree mth_owner)" node deploy/load/sessions.mjs --duration-minutes 60 --out "$WORK/sessions-tree.json" 2>&1 | tail -1 | sed "s#$TMPDIR#\$TMPDIR#"
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
    if (res.status !== 200 && !sample) sample = await res.text(); else await res.arrayBuffer(); }
  if (!seenT.has(r.tid)) { seenT.add(r.tid);
    const res = await fetch(`${base}/api/v1/transformations/${r.tid}`, { headers: { cookie } });
    tHist[res.status] = (tHist[res.status] ?? 0) + 1; await res.arrayBuffer(); }
}
console.log(`PHASE-A getInitiative statuses over ${tried} initiatives: ${JSON.stringify(hist)}`);
console.log(`PHASE-A getTransformation statuses over ${seenT.size} transformations: ${JSON.stringify(tHist)}`);
if (sample) console.log(`PHASE-A sample non-200 body: ${sample}`);
EOF
echo "phase A probe exit=$?"
stop
psql "$ADMIN" -q -c "DROP DATABASE mth_tree"
fi

if [ "${SKIP_B:-0}" = 1 ]; then echo "Phase B skipped (SKIP_B=1)"; exit 0; fi
echo; echo "################ Phase B: in-tree generator, profile default $(date -u +%FT%TZ)"
host before-generate
mkdb mth
s=$(date +%s%N)
DATABASE_OWNER_URL="$(url mth mth_owner)" node deploy/load/generate.mjs --profile default | grep -v '^hash ' | tail -5
echo "generate exit=${PIPESTATUS[0]} wall_ms=$((($(date +%s%N) - s) / 1000000))"
D="$BASE_PG/mth"
psql "$D" -qAtc "select to_jsonb(m)-'generated_at' from load_dataset_marker m" \
  -c "select 'audit_event ' || count(*) from audit_event" -c "select 'transformation ' || count(*) from transformation" \
  -c "select 'initiative ' || count(*) from initiative" -c "select 'kpi_actual ' || count(*) from kpi_actual" \
  -c "select 'app_user ' || count(*) from app_user" -c "select 'database size ' || pg_size_pretty(pg_database_size('mth'))"
uuidcheck mth 2>&1
DATABASE_URL="$(url mth mth_app)" DATABASE_OWNER_URL="$(url mth mth_owner)" node deploy/load/sessions.mjs --duration-minutes 240 --out "$WORK/sessions.json" 2>&1 | tail -1 | sed "s#$TMPDIR#\$TMPDIR#"
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
  --api-processes 1 --api-pool 20 --worker-processes 1 --worker-pool 5 2>&1 | tail -1 | sed "s#$TMPDIR#\$TMPDIR#"
sed -i "s#$TMPDIR#\$TMPDIR#g" "$OUT/infrastructure.json"
if [ "${SKIP_WORKLOAD:-0}" != 1 ]; then
echo "== workload repetition 1 (warmup $WARMUP_S s, steady $STEADY_S s) $(date -u +%FT%TZ)"
host before-workload
start mth rep1 1
node deploy/load/workload.mjs --sessions "$WORK/sessions.json" --base-url "http://127.0.0.1:$API_PORT" \
  --out "$OUT/rep-1" --warmup-s "$WARMUP_S" --steady-s "$STEADY_S" --repetition 1 2>&1 | tail -5
echo "workload exit=${PIPESTATUS[0]}"
host after-workload
stop
echo "api error-level log lines: $(grep -c '"level":50' "$WORK/api-rep1.log" || true); worker: $(grep -c '"level":50' "$WORK/worker-rep1.log" || true); rate-limit refusals: $(grep -c 'rate limit class exceeded' "$WORK/api-rep1.log" || true)"
node deploy/load/report.mjs report --run "$OUT" --title "qa-verifier DG6 R3 re-measurement (PROVISIONAL, shared loaded host)" 2>&1 | tail -3 | sed "s#$TMPDIR#\$TMPDIR#"
echo "report exit=${PIPESTATUS[0]}"
else echo "== workload skipped (SKIP_WORKLOAD=1)"; fi
for rep in $(seq 1 "$REPS"); do
  echo "== export proof $rep $(date -u +%FT%TZ)"
  start mth proof$rep 1
  if [ -n "${IDLE_LOAD:-}" ]; then # D-202's idle criterion: wait until the 1-minute load <= IDLE_LOAD (max IDLE_MAX_S)
    w0=$(date +%s); why=timeout
    while [ $(($(date +%s) - w0)) -lt "${IDLE_MAX_S:-1800}" ]; do l1=$(cut -d' ' -f1 /proc/loadavg)
      if awk -v l="$l1" -v m="$IDLE_LOAD" 'BEGIN{exit !(l<=m)}'; then why="load1 $l1 <= $IDLE_LOAD"; break; fi; sleep 5; done
    echo "idle wait $(($(date +%s) - w0)) s, ended by: $why"
  fi
  host before-proof$rep
  node deploy/load/export-proof.mjs --sessions "$WORK/sessions.json" --base-url "http://127.0.0.1:$API_PORT" \
    --db-url "$D" --out "$OUT/export-proof-$rep.json" --label qa-dg6-r3-$rep 2>&1 | sed "s#$TMPDIR#\$TMPDIR#"
  echo "export-proof $rep exit=${PIPESTATUS[0]}"
  host after-proof$rep
  stop
  echo "api error-level log lines: $(grep -c '"level":50' "$WORK/api-proof$rep.log" || true); worker: $(grep -c '"level":50' "$WORK/worker-proof$rep.log" || true); rate-limit refusals: $(grep -c 'rate limit class exceeded' "$WORK/api-proof$rep.log" || true)"
  grep '"level":50' "$WORK/api-proof$rep.log" "$WORK/worker-proof$rep.log" 2>/dev/null | head -5 | cut -c1-400
done
psql "$D" -qAtc "select 'export_job ' || status || coalesce(' ' || error_code, '') || ' ' || count(*) from export_job group by status, error_code order by 1"
psql "$D" -qAtc "select 'assembly attempts max ' || max(assembly_attempt_count) || ', pending ' || count(*) filter (where snapshot_id is null and status='queued') from export_job"
rm -f "$WORK/sessions.json" "$WORK/sessions-tree.json"
echo "== qa load driver r3 end $(date -u +%FT%TZ)"

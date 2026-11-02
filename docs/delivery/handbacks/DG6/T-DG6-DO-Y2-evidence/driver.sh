#!/usr/bin/env bash
# T-DG6-DO-Y2 (D-207, F-DG6-147): 50 simultaneous export starts on the FULL load dataset, on the merged tree (BE-Y5's
# asynchronous live-export assembly merged), with the P6 rate-limit classes raised for the load stack so the limiter
# does not decide the result. The exact driver used.
#
# Method: DO-H's driver (T-DG6-DO-H-evidence/driver.sh) and QA's export-proof-idle-driver.sh, with these differences:
#   - the SHIPPED generator deploy/load/generate.mjs (no patch: since T-DG6-DO-Y1 the shipped file IS the patched copy
#     every DG6 figure used, sha256 6b2a9007...; printed below), profile `default`, default seed;
#   - before the API and worker start: eval "$(node deploy/load/rate-limits.mjs)" (this task's shipped helper), so the
#     five P6 class budgets are 100000/min; global and auth limits stay at the product default (300 and 20);
#   - REPS repetitions, each on a freshly generated database (as DO-H), with the reindex before any measurement and a
#     freshly started API and worker; then an idle wait (1-minute load <= IDLE_LOAD or IDLE_MAX_S), then
#     deploy/load/export-proof.mjs UNCHANGED (part A: LOAD-T01, 16 exports by one user; part B: 50 exports queued at
#     once by 50 users; START_TARGET_MS 2000);
#   - the 1-minute load average is sampled every 2 s during each proof (min/max/last reported), and the database is
#     asked, after each proof, for the time from the first job's creation to the last job's finish.
#
# Run INSIDE tests/qa/support/with-pg.sh from the tree's root:
#   QA_PG_PORT=28500 MTH_PORT_POOL=28501-28519 tests/qa/support/with-pg.sh \
#     bash docs/delivery/handbacks/DG6/T-DG6-DO-Y2-evidence/driver.sh
# Processes are stopped by their own PIDs only. The OIDC issuer is never contacted (sessions are minted by
# deploy/load/sessions.mjs). No secret: trust authentication on loopback; the session file stays under $TMPDIR and is
# deleted. Synthetic data only; figures from one shared sandbox host are PROVISIONAL, not Mobily production capacity.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
RUN_DIR=docs/delivery/handbacks/DG6/T-DG6-DO-Y2-evidence
API_PORT="${API_PORT:-28530}" REPS="${REPS:-3}" IDLE_LOAD="${IDLE_LOAD:-1.0}" IDLE_MAX_S="${IDLE_MAX_S:-300}"
ADMIN="$TEST_DATABASE_ADMIN_URL"; BASE_PG="${ADMIN%/postgres}"
url() { echo "$BASE_PG/mth?options=-c%20role%3D$1"; }
D="$BASE_PG/mth"
host() { echo "host $1: $(date -u +%FT%TZ) loadavg $(cut -d' ' -f1-3 /proc/loadavg) nproc $(nproc)"; }

echo "== driver start $(date -u +%FT%TZ); git HEAD $(git rev-parse HEAD); node $(node -v)"
host driver-start
git status --short -- apps packages deploy | sed 's/^/uncommitted product file: /'
sha256sum deploy/load/generate.mjs deploy/load/sessions.mjs deploy/load/export-proof.mjs deploy/load/rate-limits.mjs \
  apps/api/dist/main.js apps/api/dist/modules/reporting/exports/jobs.js apps/api/dist/modules/reporting/exports/assembly.js \
  apps/worker/dist/main.js packages/db/dist/cli.js
ls packages/db/migrations | tail -2
grep -n '^export const START_TARGET_MS' deploy/load/export-proof.mjs

export NODE_ENV=production MTH_LOAD_DB_URL="$D"
export MTH_ENV=load AUTH_MODE=oidc LOG_LEVEL=warn APP_BASE_URL="http://localhost:$API_PORT" PORT="$API_PORT"
export OIDC_ISSUER_URL="https://idp.example.invalid/realms/mth-load" OIDC_CLIENT_ID=mth-load OIDC_CLIENT_SECRET=not-used-load-run
unset RATE_LIMIT_PER_MINUTE AUTH_RATE_LIMIT_PER_MINUTE UPLOAD_RATE_LIMIT_PER_MINUTE SEARCH_RATE_LIMIT_PER_MINUTE \
  ASSISTANT_RATE_LIMIT_PER_MINUTE WEBHOOK_RATE_LIMIT_PER_MINUTE EXPORT_RATE_LIMIT_PER_MINUTE
eval "$(node deploy/load/rate-limits.mjs)"
env | grep -E '_RATE_LIMIT_PER_MINUTE=' | sort

API_PID="" WORKER_PID="" SAMPLER_PID=""
stop() {
  for p in $API_PID $WORKER_PID; do kill -TERM "$p" 2>/dev/null || true; done
  for p in $API_PID $WORKER_PID; do for _ in $(seq 1 100); do kill -0 "$p" 2>/dev/null || break; sleep 0.1; done; done
  for p in $API_PID $WORKER_PID $SAMPLER_PID; do kill -KILL "$p" 2>/dev/null || true; done
  API_PID="" WORKER_PID="" SAMPLER_PID=""
}
trap stop EXIT
start() {
  node apps/worker/dist/main.js >>"$WORK/worker-$1.log" 2>&1 </dev/null & WORKER_PID=$!
  node apps/api/dist/main.js >>"$WORK/api-$1.log" 2>&1 </dev/null & API_PID=$!
  for _ in $(seq 1 240); do curl -fsS "http://localhost:$API_PORT/readyz" >/dev/null 2>&1 && return 0; sleep 0.5; done
  echo "API not ready"; tail -30 "$WORK/api-$1.log"; return 1
}

overall=0
for rep in $(seq 1 "$REPS"); do
  WORK="$TMPDIR/doy2-rep-$rep"; rm -rf "$WORK"; mkdir -p "$WORK/evidence" "$RUN_DIR/rep-$rep"
  export EVIDENCE_STORAGE_DRIVER=filesystem EVIDENCE_STORAGE_PATH="$WORK/evidence"
  echo; echo "################ repetition $rep of $REPS $(date -u +%FT%TZ)"
  psql "$ADMIN" -q -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS mth WITH (FORCE)"
  [ "$rep" = 1 ] && psql "$ADMIN" -q -v ON_ERROR_STOP=1 -c "CREATE ROLE mth_owner NOLOGIN" -c "CREATE ROLE mth_app NOLOGIN"
  psql "$ADMIN" -q -v ON_ERROR_STOP=1 -c "CREATE DATABASE mth OWNER mth_owner ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0"
  export DATABASE_URL="$(url mth_app)" DATABASE_OWNER_URL="$(url mth_owner)"
  node packages/db/dist/cli.js migrate | tail -1; echo "migrate exit=${PIPESTATUS[0]}"
  s=$(date +%s%N)
  node deploy/load/generate.mjs --profile default | grep -v '^hash ' | tail -2
  echo "generate exit=${PIPESTATUS[0]} wall_ms=$((($(date +%s%N) - s) / 1000000))"
  psql "$D" -qAtc "select 'marker ' || (to_jsonb(m)-'generated_at')::text from load_dataset_marker m" \
    -c "select 'transformation ' || count(*) from transformation" -c "select 'initiative ' || count(*) from initiative" \
    -c "select 'raid_entry ' || count(*) from raid_entry" -c "select 'audit_event ' || count(*) from audit_event" \
    -c "select 'app_user ' || count(*) from app_user" -c "select 'export_job before proof ' || count(*) from export_job"
  node deploy/load/sessions.mjs --duration-minutes 120 --out "$WORK/sessions.json" 2>&1 | tail -1 | sed "s#$TMPDIR#\$TMPDIR#"
  start index || { overall=1; stop; continue; }
  n=0 t=0
  for _ in $(seq 1 360); do
    n=$(psql "$D" -qAtc "select count(*) from pgboss.job where name='search.reindex' and state='completed'")
    t=$(psql "$D" -qAtc "select count(*) from search_index_state where status <> 'idle'")
    [ "$n" -ge 1 ] && [ "$t" = 0 ] && break; sleep 5
  done
  echo "search index: reindex completed jobs $n, types not idle $t $(date -u +%FT%TZ)"; stop
  start proof || { overall=1; stop; continue; }
  w0=$(date +%s); why=timeout
  while [ $(($(date +%s) - w0)) -lt "$IDLE_MAX_S" ]; do
    l1=$(cut -d' ' -f1 /proc/loadavg)
    if awk -v l="$l1" -v m="$IDLE_LOAD" 'BEGIN{exit !(l<=m)}'; then why="load1 $l1 <= $IDLE_LOAD"; break; fi; sleep 5
  done
  echo "idle wait: $(($(date +%s) - w0)) s, ended by: $why"
  host "rep-$rep-before-proof"
  ( while :; do echo "$(date +%s) $(cut -d' ' -f1 /proc/loadavg)"; sleep 2; done ) >"$WORK/loadavg.txt" & SAMPLER_PID=$!
  node deploy/load/export-proof.mjs --sessions "$WORK/sessions.json" --base-url "http://127.0.0.1:$API_PORT" \
    --db-url "$D" --out "$RUN_DIR/rep-$rep/export-proof.json" --label "do-y2-rep-$rep"
  prc=$?
  kill -KILL "$SAMPLER_PID" 2>/dev/null; SAMPLER_PID=""
  host "rep-$rep-after-proof"
  awk '{ if (NR==1||$2<mn) mn=$2; if (NR==1||$2>mx) mx=$2; last=$2 } END { printf "loadavg-1m during proof: samples %d min %s max %s last %s\n", NR, mn, mx, last }' "$WORK/loadavg.txt"
  cp "$WORK/loadavg.txt" "$RUN_DIR/rep-$rep/loadavg-during-proof.txt"
  echo "rep $rep export-proof exit=$prc"; [ "$prc" = 0 ] || overall=1
  psql "$D" -qAtc "select 'export_job ' || status || ' ' || count(*) from export_job group by status order by 1" \
    -c "select 'first created -> last finished (s) ' || round(extract(epoch from max(finished_at) - min(created_at))::numeric, 3) || '; jobs ' || count(*) || '; unfinished ' || count(*) filter (where finished_at is null) from export_job" \
    -c "select 'jobs with no snapshot ' || count(*) from export_job where snapshot_id is null"
  stop
  echo "api error-level log lines: $(grep -cE '\"level\":(50|60)' "$WORK/api-proof.log"); worker: $(grep -cE '\"level\":(50|60)' "$WORK/worker-proof.log"); api 429 class lines: $(grep -c 'rate limit class exceeded' "$WORK/api-proof.log")"
  rm -f "$WORK/sessions.json"
done
host driver-end
echo "== driver end $(date -u +%FT%TZ); proofs overall exit $overall (0 = every assertion held in every repetition)"
exit "$overall"

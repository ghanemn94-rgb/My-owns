#!/usr/bin/env bash
# T-DG6-DO-H (D-202): the REQ-S20-030 export proof (ADR-0058 §7) re-measured on an IDLE host, three repetitions.
# The exact driver used. It is T-DG6-DO-G's proof-idle-queue-driver.sh (T-DG6-DO-G-evidence/final/), unchanged in
# method and workload: the same patched generator copy (sha256 6b2a9007…), profile `default` and seed, the same 100
# minted sessions, the reindex before any measurement, a freshly started API and worker, product default rate limits,
# and deploy/load/export-proof.mjs unchanged (sha256 7865d9d3…; part A: LOAD-T01, 16 exports; part B: 50 exports at
# once, 50 users; START_TARGET_MS 2000). Nothing is tuned (p6-plan R4).
#
# Differences from DO-G's driver, all on the measurement side, none on the workload or the threshold:
#   - three repetitions, each on its own freshly generated database (dropped and recreated), so each proof meets the
#     same data and an idle export queue;
#   - `uptime` and `nproc` are recorded before and after each proof (D-202);
#   - before each proof, with the API and worker already started and ready, the driver waits until the 1-minute load
#     average is <= IDLE_LOAD (default 1.0) or IDLE_MAX_S (default 600 s) has passed, and records which one ended the
#     wait. The proof itself is not changed.
#
# Run INSIDE tests/qa/support/with-pg.sh (a disposable PostgreSQL 16 cluster in this process tree):
#
#   QA_PG_PORT=27450 MTH_PORT_POOL=27451-27469 tests/qa/support/with-pg.sh \
#     bash docs/delivery/handbacks/DG6/T-DG6-DO-H-evidence/driver.sh
#
# GEN is DO-F's generate-rfc-uuid.patch applied to a scratch copy of deploy/load/generate.mjs (the tree's file still
# writes non-RFC UUIDs; DO-F/DO-FB §5 item 1, still open). $TMPDIR/gen/packages is a symlink to this tree's packages/,
# so the copy resolves `pg` exactly as the tree's file does. Processes are stopped by their own PIDs only. The OIDC
# issuer is never contacted (sessions are minted by deploy/load/sessions.mjs). No secret: trust authentication on
# loopback only; the session file stays under $TMPDIR. Synthetic data only; nothing here approves anything.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
RUN_DIR=docs/delivery/handbacks/DG6/T-DG6-DO-H-evidence
GEN="${GEN:-$TMPDIR/gen/deploy/load/generate.mjs}"
API_PORT="${API_PORT:-27480}"
REPS="${REPS:-3}" IDLE_LOAD="${IDLE_LOAD:-1.0}" IDLE_MAX_S="${IDLE_MAX_S:-600}"
ADMIN="$TEST_DATABASE_ADMIN_URL"
BASE_PG="${ADMIN%/postgres}"
url() { echo "$BASE_PG/mth?options=-c%20role%3D$1"; }
D="$BASE_PG/mth"
host() { echo "host $1: uptime: $(uptime); nproc: $(nproc); date $(date -u +%FT%TZ)"; }

echo "== driver start $(date -u +%FT%TZ); git HEAD $(git rev-parse HEAD); node $(node -v)"
host driver-start
git status --short -- apps packages deploy | sed 's/^/uncommitted product file: /' || true
sha256sum "$GEN" deploy/load/generate.mjs deploy/load/sessions.mjs deploy/load/export-proof.mjs \
  apps/api/dist/main.js apps/worker/dist/main.js packages/db/dist/cli.js
ls packages/db/migrations | tail -3
grep -n '^export const START_TARGET_MS' deploy/load/export-proof.mjs

export NODE_ENV=production
export MTH_LOAD_DB_URL="$D"
export MTH_ENV=load AUTH_MODE=oidc LOG_LEVEL=warn APP_BASE_URL="http://localhost:$API_PORT" PORT="$API_PORT"
export OIDC_ISSUER_URL="https://idp.example.invalid/realms/mth-load" OIDC_CLIENT_ID=mth-load OIDC_CLIENT_SECRET=not-used-load-run
unset RATE_LIMIT_PER_MINUTE AUTH_RATE_LIMIT_PER_MINUTE SEARCH_RATE_LIMIT_PER_MINUTE EXPORT_RATE_LIMIT_PER_MINUTE

API_PID="" WORKER_PID=""
stop() {
  for p in $API_PID $WORKER_PID; do kill -TERM "$p" 2>/dev/null || true; done
  for p in $API_PID $WORKER_PID; do for _ in $(seq 1 100); do kill -0 "$p" 2>/dev/null || break; sleep 0.1; done; done
  for p in $API_PID $WORKER_PID; do kill -KILL "$p" 2>/dev/null || true; done
  API_PID="" WORKER_PID=""
}
trap stop EXIT
start() {
  node apps/worker/dist/main.js >>"$WORK/worker-$1.log" 2>&1 </dev/null &
  WORKER_PID=$!
  node apps/api/dist/main.js >>"$WORK/api-$1.log" 2>&1 </dev/null &
  API_PID=$!
  for _ in $(seq 1 120); do curl -fsS "http://localhost:$API_PORT/readyz" >/dev/null 2>&1 && return 0; sleep 0.5; done
  echo "API not ready"
  tail -50 "$WORK/api-$1.log"
  return 1
}

overall=0
for rep in $(seq 1 "$REPS"); do
  WORK="$TMPDIR/doh-rep-$rep"
  rm -rf "$WORK"
  mkdir -p "$WORK/evidence" "$RUN_DIR/rep-$rep"
  export EVIDENCE_STORAGE_DRIVER=filesystem EVIDENCE_STORAGE_PATH="$WORK/evidence"
  echo
  echo "################ repetition $rep of $REPS $(date -u +%FT%TZ)"
  psql "$ADMIN" -q -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS mth WITH (FORCE)"
  [ "$rep" = 1 ] && psql "$ADMIN" -q -v ON_ERROR_STOP=1 -c "CREATE ROLE mth_owner NOLOGIN" -c "CREATE ROLE mth_app NOLOGIN"
  psql "$ADMIN" -q -v ON_ERROR_STOP=1 \
    -c "CREATE DATABASE mth OWNER mth_owner ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0"
  DATABASE_URL="$(url mth_app)" DATABASE_OWNER_URL="$(url mth_owner)"
  export DATABASE_URL DATABASE_OWNER_URL
  node packages/db/dist/cli.js migrate | tail -1

  echo "== rep $rep generate default (patched copy) start $(date -u +%FT%TZ)"
  s=$(date +%s%N)
  node "$GEN" --profile default | grep -v '^hash ' | tail -3
  echo "generate exit=${PIPESTATUS[0]} wall_ms=$((($(date +%s%N) - s) / 1000000)) end $(date -u +%FT%TZ)"
  psql "$D" -qAtc "select to_jsonb(m)-'generated_at' from load_dataset_marker m" \
    -c "select 'audit_event ' || count(*) from audit_event" \
    -c "select 'transformation ' || count(*) from transformation" \
    -c "select 'initiative ' || count(*) from initiative" \
    -c "select 'initiative in LOAD-T01 ' || count(*) from initiative i join transformation t on t.id = i.transformation_id where t.code = 'LOAD-T01'" \
    -c "select 'raid_entry ' || count(*) from raid_entry" \
    -c "select 'kpi_actual ' || count(*) from kpi_actual" \
    -c "select 'non-RFC initiative ids ' || count(*) from initiative where id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\$'" \
    -c "select 'export_job before proof ' || count(*) from export_job" \
    -c "select 'database size ' || pg_size_pretty(pg_database_size('mth'))"

  echo "== rep $rep sessions $(date -u +%FT%TZ)"
  node deploy/load/sessions.mjs --duration-minutes 240 --out "$WORK/sessions.json"

  echo "== rep $rep search index: reindex before any measurement $(date -u +%FT%TZ)"
  start index
  n=0 t=0
  for _ in $(seq 1 360); do
    n=$(psql "$D" -qAtc "select count(*) from pgboss.job where name = 'search.reindex' and state = 'completed'")
    t=$(psql "$D" -qAtc "select count(*) from search_index_state where status <> 'idle'")
    [ "$n" -ge 1 ] && [ "$t" = 0 ] && break
    sleep 5
  done
  echo "search index: reindex completed jobs $n, types not idle $t $(date -u +%FT%TZ)"
  stop

  echo "== rep $rep fresh API and worker $(date -u +%FT%TZ)"
  start "proof"
  echo "pgboss queued/active reports.export jobs: $(psql "$D" -qAtc "select count(*) from pgboss.job where name like 'reports.export%' and state in ('created','retry','active')")"
  w0=$(date +%s)
  why="timeout"
  while [ $(($(date +%s) - w0)) -lt "$IDLE_MAX_S" ]; do
    l1=$(cut -d' ' -f1 /proc/loadavg)
    if awk -v l="$l1" -v m="$IDLE_LOAD" 'BEGIN { exit !(l <= m) }'; then why="load1 $l1 <= $IDLE_LOAD"; break; fi
    sleep 5
  done
  echo "idle wait: $(($(date +%s) - w0)) s, ended by: $why"
  host "rep-$rep-before-proof"
  set +e
  node deploy/load/export-proof.mjs --sessions "$WORK/sessions.json" --base-url "http://127.0.0.1:$API_PORT" \
    --db-url "$D" --out "$RUN_DIR/rep-$rep/export-proof.json" --label "do-h-idle-rep-$rep"
  prc=$?
  set -e
  host "rep-$rep-after-proof"
  echo "rep $rep export-proof exit=$prc"
  [ "$prc" = 0 ] || overall=1
  stop
  echo "api error-level log lines: $(grep -c '"level":50' "$WORK/api-proof.log" || true); worker: $(grep -c '"level":50' "$WORK/worker-proof.log" || true)"
  psql "$D" -qAtc "select 'export_job ' || status || ' ' || count(*) from export_job group by status order by 1"
done
host driver-end
echo "== driver end $(date -u +%FT%TZ); proofs overall exit $overall (0 = every assertion held in every repetition)"

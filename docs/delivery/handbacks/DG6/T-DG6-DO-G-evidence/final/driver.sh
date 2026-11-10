#!/usr/bin/env bash
# T-DG6-DO-G, the FINAL load run on the frozen tree (ADR-0058 §3-§7; p6-work-split §H/G.10). The exact driver used.
# It is the run-1 driver (T-DG6-DO-F-evidence/load/run-1/driver.sh) plus BE-S's cluster set-up and export proof
# (T-DG6-BE-S-evidence/load-driver.sh.txt), unchanged in method: same dataset profile and seed, same 100 users, same mix,
# 2 min warm-up, 10 min steady state, 3 repetitions each on a freshly started API and worker, product default rate
# limits, then the ADR-0058 §7 export proof on a freshly started API and worker. Nothing is tuned (p6-plan R4).
#
# Run INSIDE tests/qa/support/with-pg.sh (a disposable PostgreSQL 16 cluster in this process tree):
#
#   QA_PG_PORT=26800 MTH_PORT_POOL=26801-26829 tests/qa/support/with-pg.sh \
#     bash docs/delivery/handbacks/DG6/T-DG6-DO-G-evidence/final/driver.sh
#
# GEN is DO-F's generate-rfc-uuid.patch applied to a scratch copy of deploy/load/generate.mjs (sha256 6b2a9007…, the
# same copy run-1 and BE-S used): the tree's generator writes ids that are not RFC UUIDs, which the API refuses
# (DO-F/DO-FB §5 item 1; no orchestrator decision yet). Processes are stopped by their own PIDs only. The OIDC issuer is
# never contacted (nobody logs in; the sessions are minted by deploy/load/sessions.mjs). No secret is involved: the
# cluster uses trust authentication on loopback only, and the session file stays under $TMPDIR.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
RUN_DIR=docs/delivery/handbacks/DG6/T-DG6-DO-G-evidence/final
GEN="${GEN:-$TMPDIR/gen/deploy/load/generate.mjs}"
API_PORT="${API_PORT:-26840}"
REPS="${REPS:-3}" WARMUP_S="${WARMUP_S:-120}" STEADY_S="${STEADY_S:-600}"
ADMIN="$TEST_DATABASE_ADMIN_URL"
BASE_PG="${ADMIN%/postgres}"
url() { echo "$BASE_PG/mth?options=-c%20role%3D$1"; }
D="$BASE_PG/mth"
WORK="$TMPDIR/loadrun"
mkdir -p "$RUN_DIR" "$WORK/evidence"

echo "== driver start $(date -u +%FT%TZ); git HEAD $(git rev-parse HEAD); node $(node -v); load average $(cut -d' ' -f1-3 /proc/loadavg)"
git status --short -- apps packages deploy | sed 's/^/uncommitted product file: /' || true
sha256sum "$GEN" deploy/load/generate.mjs deploy/load/sessions.mjs deploy/load/workload.mjs deploy/load/report.mjs \
  deploy/load/export-proof.mjs apps/api/dist/main.js apps/worker/dist/main.js
ls packages/db/migrations | tail -3

psql "$ADMIN" -q -v ON_ERROR_STOP=1 -c "CREATE ROLE mth_owner NOLOGIN" -c "CREATE ROLE mth_app NOLOGIN" \
  -c "CREATE DATABASE mth OWNER mth_owner ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0"
export NODE_ENV=production
DATABASE_OWNER_URL="$(url mth_owner)" DATABASE_URL="$(url mth_app)" node packages/db/dist/cli.js migrate | tail -1
echo "applied migrations: $(psql "$D" -qAtc "select count(*) from schema_migrations" 2>/dev/null || echo n/a)"

echo "== generate default (patched copy) start $(date -u +%FT%TZ)"
s=$(date +%s%N)
DATABASE_OWNER_URL="$(url mth_owner)" node "$GEN" --profile default | grep -v '^hash ' | tail -8
echo "generate exit=${PIPESTATUS[0]} wall_ms=$((($(date +%s%N) - s) / 1000000)) end $(date -u +%FT%TZ)"
psql "$D" -qAtc "select to_jsonb(m)-'generated_at' from load_dataset_marker m" \
  -c "select 'audit_event ' || count(*) from audit_event" \
  -c "select 'transformation ' || count(*) from transformation" \
  -c "select 'initiative ' || count(*) from initiative" \
  -c "select 'kpi_actual ' || count(*) from kpi_actual" \
  -c "select 'non-RFC initiative ids ' || count(*) from initiative where id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\$'" \
  -c "select 'deployment_environment rows ' || count(*) from deployment_environment" \
  -c "select 'database size ' || pg_size_pretty(pg_database_size('mth'))" || true

export MTH_LOAD_DB_URL="$D"
export MTH_ENV=load AUTH_MODE=oidc LOG_LEVEL=warn APP_BASE_URL="http://localhost:$API_PORT" PORT="$API_PORT"
export OIDC_ISSUER_URL="https://idp.example.invalid/realms/mth-load" OIDC_CLIENT_ID=mth-load OIDC_CLIENT_SECRET=not-used-load-run
DATABASE_URL="$(url mth_app)" DATABASE_OWNER_URL="$(url mth_owner)"
export DATABASE_URL DATABASE_OWNER_URL
export EVIDENCE_STORAGE_DRIVER=filesystem EVIDENCE_STORAGE_PATH="$WORK/evidence"
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

echo "== sessions $(date -u +%FT%TZ)"
node deploy/load/sessions.mjs --duration-minutes 240 --out "$WORK/sessions.json"

echo "== search index: the worker runs the generator's requested search.reindex before any measurement $(date -u +%FT%TZ)"
start index
n=0 t=0
for _ in $(seq 1 360); do
  n=$(psql "$D" -qAtc "select count(*) from pgboss.job where name = 'search.reindex' and state = 'completed'")
  t=$(psql "$D" -qAtc "select count(*) from search_index_state where status <> 'idle'")
  [ "$n" -ge 1 ] && [ "$t" = 0 ] && break
  sleep 5
done
psql "$D" -qAtc "select record_type, status, documents_count, last_audit_seq from search_index_state order by 1"
echo "search index: reindex completed jobs $n, types not idle $t $(date -u +%FT%TZ)"
stop

echo "== infrastructure $(date -u +%FT%TZ)"
PGDATA_DIR="$(psql "$ADMIN" -qAtc 'show data_directory')"
node deploy/load/report.mjs capture-infra --out "$RUN_DIR/infrastructure.json" --pgdata "$PGDATA_DIR" \
  --api-processes 1 --api-pool 20 --worker-processes 1 --worker-pool 5

for rep in $(seq 1 "$REPS"); do
  echo "== repetition $rep: fresh API and worker $(date -u +%FT%TZ); load average $(cut -d' ' -f1-3 /proc/loadavg)"
  start "rep$rep"
  set +e
  node deploy/load/workload.mjs --sessions "$WORK/sessions.json" --base-url "http://127.0.0.1:$API_PORT" \
    --out "$RUN_DIR/rep-$rep" --warmup-s "$WARMUP_S" --steady-s "$STEADY_S" --repetition "$rep"
  rc=$?
  set -e
  echo "repetition $rep workload exit=$rc $(date -u +%FT%TZ); load average $(cut -d' ' -f1-3 /proc/loadavg)"
  stop
  echo "api error-level log lines: $(grep -c '"level":50' "$WORK/api-rep$rep.log" || true); worker: $(grep -c '"level":50' "$WORK/worker-rep$rep.log" || true)"
  [ "$rc" = 0 ] || exit "$rc"
done

echo "== report $(date -u +%FT%TZ)"
node deploy/load/report.mjs report --run "$RUN_DIR" --title "DG6 final load run (T-DG6-DO-G, frozen tree)"

echo "== export proof (ADR-0058 §7): fresh API and worker $(date -u +%FT%TZ); load average $(cut -d' ' -f1-3 /proc/loadavg)"
start proof
set +e
node deploy/load/export-proof.mjs --sessions "$WORK/sessions.json" --base-url "http://127.0.0.1:$API_PORT" \
  --db-url "$D" --out "$RUN_DIR/export-proof.json" --label final
prc=$?
set -e
echo "export-proof exit=$prc $(date -u +%FT%TZ); load average $(cut -d' ' -f1-3 /proc/loadavg)"
stop
echo "api error-level log lines: $(grep -c '"level":50' "$WORK/api-proof.log" || true); worker: $(grep -c '"level":50' "$WORK/worker-proof.log" || true)"
psql "$D" -qAtc "select 'export_job ' || status || ' ' || count(*) from export_job group by status order by 1"
echo "== driver end $(date -u +%FT%TZ)"

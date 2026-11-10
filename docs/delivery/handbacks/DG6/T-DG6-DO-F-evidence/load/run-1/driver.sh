#!/usr/bin/env bash
# T-DG6-DO-F, load run 1 (the first run; ADR-0058 §3-§6). The exact driver used for run-1, kept as evidence.
#
# Prerequisites (done by the caller, see the handback): a disposable PostgreSQL 16 cluster on 127.0.0.1:$PG_PORT with
# the database `mth` migrated and generated with `deploy/load/generate.mjs --profile default` (seed 20261027).
#
#   PG_PORT=25650 API_PORT=25680 RUN_DIR=docs/delivery/handbacks/DG6/T-DG6-DO-F-evidence/load/run-1 \
#     docs/delivery/handbacks/DG6/T-DG6-DO-F-evidence/load/run-1/driver.sh
#
# Per repetition: a freshly started API and worker (MTH_ENV=load, NODE_ENV=production, AUTH_MODE=oidc; product default
# rate limits), then `workload.mjs` (2 min warm-up, 10 min steady state), then both are stopped. Processes are stopped by
# their own PIDs only. The OIDC issuer below is never contacted: nobody logs in, the sessions are minted by
# deploy/load/sessions.mjs. No secret is involved: the database runs with trust authentication on loopback only.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
: "${PG_PORT:?}" "${API_PORT:?}" "${RUN_DIR:?}"
REPS="${REPS:-3}" WARMUP_S="${WARMUP_S:-120}" STEADY_S="${STEADY_S:-600}"
WORK="$TMPDIR/load"
mkdir -p "$RUN_DIR" "$WORK/evidence"
url() { echo "postgresql://postgres@127.0.0.1:$PG_PORT/mth?options=-c%20role%3D$1"; }
export MTH_LOAD_DB_URL="postgresql://postgres@127.0.0.1:$PG_PORT/mth"
export NODE_ENV=production MTH_ENV=load AUTH_MODE=oidc LOG_LEVEL=warn
export APP_BASE_URL="http://localhost:$API_PORT" PORT="$API_PORT"
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

echo "== driver start $(date -u +%FT%TZ); git HEAD $(git rev-parse HEAD)"
sha256sum deploy/load/generate.mjs deploy/load/sessions.mjs deploy/load/workload.mjs deploy/load/report.mjs

echo "== sessions $(date -u +%FT%TZ)"
node deploy/load/sessions.mjs --duration-minutes 240 --out "$WORK/sessions.json"

if [ "${SKIP_INDEX:-0}" != 1 ]; then
  echo "== search index: start the worker so it runs the requested search.reindex $(date -u +%FT%TZ)"
  start index
  n=0 t=0
  for _ in $(seq 1 360); do
    # Ready = the generator's requested search.reindex job has completed and no record type is still reindexing.
    n=$(psql "$MTH_LOAD_DB_URL" -qAtc "select count(*) from pgboss.job where name = 'search.reindex' and state = 'completed'")
    t=$(psql "$MTH_LOAD_DB_URL" -qAtc "select count(*) from search_index_state where status <> 'idle'")
    [ "$n" -ge 1 ] && [ "$t" = 0 ] && break
    sleep 5
  done
  psql "$MTH_LOAD_DB_URL" -qAtc "select record_type, status, documents_count, last_audit_seq from search_index_state order by 1" \
    -c "select name, state, count(*) from pgboss.job where name like 'search.%' group by 1, 2 order by 1, 2" \
    -c "select record_type, count(*) from search_document group by 1 order by 1"
  echo "search index: reindex completed jobs $n, types not idle $t $(date -u +%FT%TZ)"
  stop
fi

echo "== infrastructure $(date -u +%FT%TZ)"
node deploy/load/report.mjs capture-infra --out "$RUN_DIR/infrastructure.json" --pgdata "$WORK/pgroot/pg" \
  --api-processes 1 --api-pool 20 --worker-processes 1 --worker-pool 5

for rep in $(seq 1 "$REPS"); do
  echo "== repetition $rep: fresh API and worker $(date -u +%FT%TZ)"
  start "rep$rep"
  set +e
  node deploy/load/workload.mjs --sessions "$WORK/sessions.json" --base-url "http://127.0.0.1:$API_PORT" \
    --out "$RUN_DIR/rep-$rep" --warmup-s "$WARMUP_S" --steady-s "$STEADY_S" --repetition "$rep"
  rc=$?
  set -e
  echo "repetition $rep workload exit=$rc $(date -u +%FT%TZ)"
  stop
  echo "api error-level log lines: $(grep -c '"level":50' "$WORK/api-rep$rep.log" || true)"
  [ "$rc" = 0 ] || exit "$rc"
done

echo "== report $(date -u +%FT%TZ)"
node deploy/load/report.mjs report --run "$RUN_DIR" --title "DG6 load run 1 (first run, draft report; T-DG6-DO-F)"
echo "== driver end $(date -u +%FT%TZ)"

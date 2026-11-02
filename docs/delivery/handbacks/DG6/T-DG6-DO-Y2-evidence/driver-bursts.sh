#!/usr/bin/env bash
# T-DG6-DO-Y2 supplementary run: on ONE fresh full `default` load database (shipped generator), the API and worker
# started after eval "$(node deploy/load/rate-limits.mjs)", BURSTS bursts of N=50 simultaneous live-selection starts
# (export-burst-snapshot.mjs: BE-Y4's export-burst.mjs plus the ADR-0058 amendment T2 snapshotId checks), each followed
# until every job finishes. No idle wait: it ran while `pnpm test` ran on the same host (a LOADED data point); the load
# average is printed before and after each burst. Run INSIDE tests/qa/support/with-pg.sh from the tree's root:
#   QA_PG_PORT=28540 MTH_PORT_POOL=28541-28544 tests/qa/support/with-pg.sh bash docs/delivery/handbacks/DG6/T-DG6-DO-Y2-evidence/driver-bursts.sh
# Synthetic data; PROVISIONAL sandbox figures, not Mobily production capacity.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
HERE=docs/delivery/handbacks/DG6/T-DG6-DO-Y2-evidence
API_PORT="${API_PORT:-28546}" N="${N:-50}" BURSTS="${BURSTS:-3}"
ADMIN="$TEST_DATABASE_ADMIN_URL"; BASE_PG="${ADMIN%/postgres}"
url() { echo "$BASE_PG/mth?options=-c%20role%3D$1"; }
D="$BASE_PG/mth"; WORK="$TMPDIR/doy2-bursts"; rm -rf "$WORK"; mkdir -p "$WORK/evidence"
host() { echo "host $1: $(date -u +%FT%TZ) loadavg $(cut -d' ' -f1-3 /proc/loadavg) nproc $(nproc)"; }
echo "== start $(date -u +%FT%TZ); HEAD $(git rev-parse HEAD)"
sha256sum deploy/load/generate.mjs deploy/load/rate-limits.mjs "$HERE/export-burst-snapshot.mjs" apps/api/dist/main.js
psql "$ADMIN" -q -c "CREATE ROLE mth_owner NOLOGIN" -c "CREATE ROLE mth_app NOLOGIN" -c "CREATE DATABASE mth OWNER mth_owner ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0"
export NODE_ENV=production MTH_LOAD_DB_URL="$D"
export DATABASE_URL="$(url mth_app)" DATABASE_OWNER_URL="$(url mth_owner)"
node packages/db/dist/cli.js migrate | tail -1
node deploy/load/generate.mjs --profile default | grep -E '"seconds"'; echo "generate exit=${PIPESTATUS[0]}"
psql "$D" -qAtc "select 'transformation ' || count(*) from transformation" -c "select 'initiative ' || count(*) from initiative" -c "select 'audit_event ' || count(*) from audit_event"
export MTH_ENV=load AUTH_MODE=oidc LOG_LEVEL=warn APP_BASE_URL="http://localhost:$API_PORT" PORT="$API_PORT"
export OIDC_ISSUER_URL="https://idp.example.invalid/realms/mth-load" OIDC_CLIENT_ID=mth-load OIDC_CLIENT_SECRET=not-used-load-run
export EVIDENCE_STORAGE_DRIVER=filesystem EVIDENCE_STORAGE_PATH="$WORK/evidence"
unset RATE_LIMIT_PER_MINUTE AUTH_RATE_LIMIT_PER_MINUTE UPLOAD_RATE_LIMIT_PER_MINUTE SEARCH_RATE_LIMIT_PER_MINUTE ASSISTANT_RATE_LIMIT_PER_MINUTE WEBHOOK_RATE_LIMIT_PER_MINUTE EXPORT_RATE_LIMIT_PER_MINUTE
eval "$(node deploy/load/rate-limits.mjs)"
node deploy/load/sessions.mjs --duration-minutes 120 --out "$WORK/sessions.json" 2>&1 | tail -1 | sed "s#$TMPDIR#\$TMPDIR#"
API_PID="" WORKER_PID=""
stop() { for p in $API_PID $WORKER_PID; do kill -TERM "$p" 2>/dev/null || true; done; sleep 2; for p in $API_PID $WORKER_PID; do kill -KILL "$p" 2>/dev/null || true; done; API_PID="" WORKER_PID=""; }
trap stop EXIT
node apps/worker/dist/main.js >>"$WORK/worker.log" 2>&1 </dev/null & WORKER_PID=$!
node apps/api/dist/main.js >>"$WORK/api.log" 2>&1 </dev/null & API_PID=$!
for _ in $(seq 1 240); do curl -fsS "http://localhost:$API_PORT/readyz" >/dev/null 2>&1 && break; sleep 0.5; done
overall=0
for i in $(seq 1 "$BURSTS"); do
  host "before-burst-$i"
  node "$HERE/export-burst-snapshot.mjs" --sessions "$WORK/sessions.json" --base-url "http://127.0.0.1:$API_PORT" --db-url "$D" --n "$N" --label "do-y2-burst-$i" --wait
  rc=$?; echo "burst-$i exit=$rc"; [ "$rc" = 0 ] || overall=1
  host "after-burst-$i"
done
psql "$D" -qAtc "select 'export_job ' || status || ' ' || count(*) from export_job group by status order by 1" -c "select 'jobs with no snapshot ' || count(*) from export_job where snapshot_id is null"
stop
echo "api error-level log lines: $(grep -cE '\"level\":(50|60)' "$WORK/api.log"); worker: $(grep -cE '\"level\":(50|60)' "$WORK/worker.log"); class 429 lines: $(grep -c 'rate limit class exceeded' "$WORK/api.log")"
rm -f "$WORK/sessions.json"
echo "== end $(date -u +%FT%TZ) overall $overall"; exit "$overall"

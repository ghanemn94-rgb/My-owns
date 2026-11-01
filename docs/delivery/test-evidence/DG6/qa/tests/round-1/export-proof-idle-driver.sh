#!/usr/bin/env bash
# qa-verifier DG6 round 1: the REQ-S20-030 export proof alone on an IDLE host, DO-H's method (D-202): a fresh load
# database from the patched generator copy (the one every DG6 load figure used), sessions, the reindex, a fresh API and
# worker, then wait until the 1-minute load average is <= IDLE_LOAD (1.0) or IDLE_MAX_S (900 s), then
# deploy/load/export-proof.mjs unchanged. Run inside tests/qa/support/with-pg.sh from the root of a disposable copy.
# Synthetic data; figures from one shared sandbox host, PROVISIONAL, not Mobily production capacity.
set -uo pipefail
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
OUT="${OUT:?}"; PATCH="${PATCH:?}"; API_PORT="${API_PORT:-28047}"; IDLE_LOAD="${IDLE_LOAD:-1.0}"; IDLE_MAX_S="${IDLE_MAX_S:-900}"
ADMIN="$TEST_DATABASE_ADMIN_URL"; BASE_PG="${ADMIN%/postgres}"
url() { echo "$BASE_PG/mth?options=-c%20role%3D$1"; }
D="$BASE_PG/mth"; WORK="$TMPDIR/qa-proof"; rm -rf "$WORK"; mkdir -p "$OUT" "$WORK/evidence" "$WORK/gen/deploy/load"
host() { echo "host $1: $(date -u +%FT%TZ) loadavg $(cut -d' ' -f1-3 /proc/loadavg) nproc $(nproc)"; }
cp deploy/load/generate.mjs "$WORK/gen/deploy/load/generate.mjs"; ln -s "$PWD/packages" "$WORK/gen/packages"
(cd "$WORK/gen" && patch -p0 --no-backup-if-mismatch < "$PATCH") >/dev/null || { echo "BLOCKED: patch"; exit 3; }
sha256sum "$WORK/gen/deploy/load/generate.mjs" deploy/load/export-proof.mjs | sed "s#$TMPDIR#\$TMPDIR#"
psql "$ADMIN" -q -c "CREATE ROLE mth_owner NOLOGIN" -c "CREATE ROLE mth_app NOLOGIN" -c "CREATE DATABASE mth OWNER mth_owner ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0"
export NODE_ENV=production
DATABASE_OWNER_URL="$(url mth_owner)" DATABASE_URL="$(url mth_app)" node packages/db/dist/cli.js migrate | tail -1
DATABASE_OWNER_URL="$(url mth_owner)" node "$WORK/gen/deploy/load/generate.mjs" --profile default | grep -E '"seconds"' ; echo "generate exit=${PIPESTATUS[0]}"
export MTH_LOAD_DB_URL="$D" MTH_ENV=load AUTH_MODE=oidc LOG_LEVEL=warn APP_BASE_URL="http://localhost:$API_PORT" PORT="$API_PORT"
export OIDC_ISSUER_URL="https://idp.example.invalid/realms/mth-load" OIDC_CLIENT_ID=mth-load OIDC_CLIENT_SECRET=not-used-load-run
export DATABASE_URL="$(url mth_app)" DATABASE_OWNER_URL="$(url mth_owner)" EVIDENCE_STORAGE_DRIVER=filesystem EVIDENCE_STORAGE_PATH="$WORK/evidence"
unset RATE_LIMIT_PER_MINUTE AUTH_RATE_LIMIT_PER_MINUTE SEARCH_RATE_LIMIT_PER_MINUTE EXPORT_RATE_LIMIT_PER_MINUTE
node deploy/load/sessions.mjs --duration-minutes 120 --out "$WORK/sessions.json" 2>&1 | tail -1 | sed "s#$TMPDIR#\$TMPDIR#"
API_PID="" WORKER_PID=""
stop() { for p in $API_PID $WORKER_PID; do kill -TERM "$p" 2>/dev/null || true; done; sleep 2; for p in $API_PID $WORKER_PID; do kill -KILL "$p" 2>/dev/null || true; done; API_PID="" WORKER_PID=""; }
trap stop EXIT
start() { node apps/worker/dist/main.js >>"$WORK/worker-$1.log" 2>&1 </dev/null & WORKER_PID=$!; node apps/api/dist/main.js >>"$WORK/api-$1.log" 2>&1 </dev/null & API_PID=$!
  for _ in $(seq 1 240); do curl -fsS "http://localhost:$API_PORT/readyz" >/dev/null 2>&1 && return 0; sleep 0.5; done; echo "API not ready"; return 1; }
start index; for _ in $(seq 1 360); do n=$(psql "$D" -qAtc "select count(*) from pgboss.job where name='search.reindex' and state='completed'"); t=$(psql "$D" -qAtc "select count(*) from search_index_state where status <> 'idle'"); [ "$n" -ge 1 ] && [ "$t" = 0 ] && break; sleep 5; done; echo "reindex done $n/$t"; stop
start proof
w0=$(date +%s); why=timeout
while [ $(($(date +%s) - w0)) -lt "$IDLE_MAX_S" ]; do l1=$(cut -d' ' -f1 /proc/loadavg); if awk -v l="$l1" -v m="$IDLE_LOAD" 'BEGIN{exit !(l<=m)}'; then why="load1 $l1 <= $IDLE_LOAD"; break; fi; sleep 5; done
echo "idle wait $(($(date +%s) - w0)) s, ended by: $why"; host before-proof
node deploy/load/export-proof.mjs --sessions "$WORK/sessions.json" --base-url "http://127.0.0.1:$API_PORT" --db-url "$D" --out "$OUT/export-proof-idle.json" --label qa-dg6-r1-idle
echo "export-proof exit=$?"; host after-proof
stop; rm -f "$WORK/sessions.json"

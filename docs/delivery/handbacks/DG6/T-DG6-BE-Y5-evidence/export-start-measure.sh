#!/usr/bin/env bash
# T-DG6-BE-Y4 (F-DG6-147): the QA reviewer's export-proof procedure (docs/delivery/test-evidence/DG6/qa/tests/round-1/
# export-proof-idle-driver.sh) on a SMALL local dataset: generator profile `smoke`, from a copy of the tree's
# generator with PATCH applied (the RFC 9562 UUID patch docs/delivery/handbacks/DG6/T-DG6-DO-F-evidence/
# generate-rfc-uuid.patch, as QA's driver did; the generator itself is being repaired separately, F-DG6-101/142), sessions, the reindex, a fresh API and worker, then
# deploy/load/export-proof.mjs unchanged and BURSTS bursts of N simultaneous starts (export-burst.mjs). No idle wait:
# the host load average is printed before each measurement instead. The API may run with --cpu-prof (CPU_PROF=dir).
# EXPORT_RATE_LIMIT_PER_MINUTE is raised for the measurement (export-proof part A starts 16 exports from one user in a
# minute, over the class default of 10 that this task wires; F-DG6-141). Run inside tests/qa/support/with-pg.sh from
# the tree's root. Synthetic data; figures from one shared sandbox host, PROVISIONAL, not Mobily production capacity.
set -uo pipefail
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
OUT="${OUT:?}"; PATCH="${PATCH:?}"; API_PORT="${API_PORT:-28260}"; N="${N:-50}"; BURSTS="${BURSTS:-3}"; HERE="$(cd "$(dirname "$0")" && pwd)"
ADMIN="$TEST_DATABASE_ADMIN_URL"; BASE_PG="${ADMIN%/postgres}"
url() { echo "$BASE_PG/mth?options=-c%20role%3D$1"; }
D="$BASE_PG/mth"; WORK="$TMPDIR/be-y4-proof"; rm -rf "$WORK"; mkdir -p "$OUT" "$WORK/evidence"
host() { echo "host $1: $(date -u +%FT%TZ) loadavg $(cut -d' ' -f1-3 /proc/loadavg) nproc $(nproc)"; }
mkdir -p "$WORK/gen/deploy/load"; cp deploy/load/generate.mjs "$WORK/gen/deploy/load/generate.mjs"; ln -s "$PWD/packages" "$WORK/gen/packages"
(cd "$WORK/gen" && patch -p0 --no-backup-if-mismatch < "$PATCH") >/dev/null || { echo "BLOCKED: patch"; exit 3; }
sha256sum "$WORK/gen/deploy/load/generate.mjs" deploy/load/export-proof.mjs | sed "s#$TMPDIR#\$TMPDIR#"
psql "$ADMIN" -q -c "CREATE ROLE mth_owner NOLOGIN" -c "CREATE ROLE mth_app NOLOGIN" -c "CREATE DATABASE mth OWNER mth_owner ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0"
export NODE_ENV=production
DATABASE_OWNER_URL="$(url mth_owner)" DATABASE_URL="$(url mth_app)" node packages/db/dist/cli.js migrate | tail -1
DATABASE_OWNER_URL="$(url mth_owner)" node "$WORK/gen/deploy/load/generate.mjs" --profile smoke | grep -E '"seconds"'; echo "generate exit=${PIPESTATUS[0]}"
export MTH_LOAD_DB_URL="$D" MTH_ENV=load AUTH_MODE=oidc LOG_LEVEL=warn APP_BASE_URL="http://localhost:$API_PORT" PORT="$API_PORT"
export OIDC_ISSUER_URL="https://idp.example.invalid/realms/mth-load" OIDC_CLIENT_ID=mth-load OIDC_CLIENT_SECRET=not-used-load-run
export DATABASE_URL="$(url mth_app)" DATABASE_OWNER_URL="$(url mth_owner)" EVIDENCE_STORAGE_DRIVER=filesystem EVIDENCE_STORAGE_PATH="$WORK/evidence"
unset RATE_LIMIT_PER_MINUTE AUTH_RATE_LIMIT_PER_MINUTE SEARCH_RATE_LIMIT_PER_MINUTE
export EXPORT_RATE_LIMIT_PER_MINUTE=100000
node deploy/load/sessions.mjs --duration-minutes 120 --out "$WORK/sessions.json" 2>&1 | tail -1 | sed "s#$TMPDIR#\$TMPDIR#"
API_PID="" WORKER_PID=""
stop() { for p in $API_PID $WORKER_PID; do kill -TERM "$p" 2>/dev/null || true; done; sleep 2; for p in $API_PID $WORKER_PID; do kill -KILL "$p" 2>/dev/null || true; done; API_PID="" WORKER_PID=""; }
trap stop EXIT
start() { node apps/worker/dist/main.js >>"$WORK/worker-$1.log" 2>&1 </dev/null & WORKER_PID=$!
  if [ -n "${CPU_PROF:-}" ] && [ "$1" = proof ]; then node --cpu-prof --cpu-prof-dir="$CPU_PROF" apps/api/dist/main.js >>"$WORK/api-$1.log" 2>&1 </dev/null & API_PID=$!
  else node apps/api/dist/main.js >>"$WORK/api-$1.log" 2>&1 </dev/null & API_PID=$!; fi
  for _ in $(seq 1 240); do curl -fsS "http://localhost:$API_PORT/readyz" >/dev/null 2>&1 && return 0; sleep 0.5; done; echo "API not ready"; tail -20 "$WORK/api-$1.log"; return 1; }
# The search reindex step of QA's driver is skipped: export start reads no search index (and on this host the
# smoke reindex job did not complete within 4 min in the first run, log 10-...-BEFORE-attempt1).
start proof
host before-proof
node deploy/load/export-proof.mjs --sessions "$WORK/sessions.json" --base-url "http://127.0.0.1:$API_PORT" --db-url "$D" --out "$OUT/export-proof.json" --label be-y4 | head -8
echo "export-proof exit=${PIPESTATUS[0]}"
for i in $(seq 1 "$BURSTS"); do host "before-burst-$i"; node "$HERE/export-burst.mjs" --sessions "$WORK/sessions.json" --base-url "http://127.0.0.1:$API_PORT" --db-url "$D" --n "$N" --label "burst-$i" --wait; echo "burst-$i exit=$?"; done
host after
# Graceful stop so --cpu-prof writes its profile (SIGINT).
[ -n "$API_PID" ] && kill -INT "$API_PID" 2>/dev/null; sleep 3; stop
grep -ciE '"level":(50|60)' "$WORK/api-proof.log" | sed 's/^/api error lines: /'
cp "$WORK/api-proof.log" "$OUT/api-proof.log" 2>/dev/null; rm -f "$WORK/sessions.json"

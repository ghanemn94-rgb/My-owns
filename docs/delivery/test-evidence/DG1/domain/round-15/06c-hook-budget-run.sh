#!/usr/bin/env bash
# DG1 round-15 domain-reviewer: F-DG1-136 behavioural probe. Run from the disposable clone root (commit f27b5a6).
# Throwaway PostgreSQL 16 under $TMPDIR (the integration globalSetup needs one). Runs 06c-hook-budget-probe.test.ts through
# the `integration` project with the candidate vitest.config.ts, then (control) with the round-14 config 985d0fa:vitest.config.ts.
#   bash 06c-hook-budget-run.sh <evidence-dir> [port]
set -uo pipefail
EV="$1"; PORT="${2:-54641}"
PGBIN="$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)"
W="$(mktemp -d "$TMPDIR/dom-hook.XXXXXX")"; chmod 777 "$W"
AS_PG=(unshare --user --map-user=1000 --map-group=1000)
"${AS_PG[@]}" "$PGBIN/initdb" -D "$W/pg" -U postgres --auth=trust >/dev/null
"${AS_PG[@]}" "$PGBIN/postgres" -D "$W/pg" -c unix_socket_directories='' -c listen_addresses=127.0.0.1 -p "$PORT" -c fsync=off >"$W/pg.log" 2>&1 &
PG_PID=$!
URL="postgresql://postgres@127.0.0.1:${PORT}/postgres"
for _ in $(seq 1 60); do psql "$URL" -qAtc "select 1" >/dev/null 2>&1 && break; sleep 0.5; done
echo "clone HEAD: $(git rev-parse HEAD); node: $(node --version)"
P=apps/api/test/integration/zz-dom-r15-hook.test.ts
cp "$EV/06c-hook-budget-probe.test.ts" "$P"
echo "==== A) candidate vitest.config.ts ($(grep -c 'hookTimeout: 30_000' vitest.config.ts) x 'hookTimeout: 30_000'), expect PASS"
TEST_DATABASE_ADMIN_URL="$URL" node node_modules/vitest/vitest.mjs run --project integration "$P" 2>&1 | grep -vE '^\s*$' | tail -15
A=${PIPESTATUS[0]}; echo "A exit=$A"
cp vitest.config.ts "$W/vitest.config.ts.candidate"
git show 985d0fa:vitest.config.ts > vitest.config.ts
echo "==== B) CONTROL round-14 vitest.config.ts ($(grep -c hookTimeout vitest.config.ts) x hookTimeout), expect FAIL 'Hook timed out in 10000ms'"
TEST_DATABASE_ADMIN_URL="$URL" node node_modules/vitest/vitest.mjs run --project integration "$P" 2>&1 | grep -vE '^\s*$' | tail -15
B=${PIPESTATUS[0]}; echo "B exit=$B"
cp "$W/vitest.config.ts.candidate" vitest.config.ts; rm -f "$P"
echo "---- restored: git status --short (expect empty)"; git status --short
kill -INT "$PG_PID" 2>/dev/null; sleep 1; rm -rf "$W"
[ "$A" -eq 0 ] && [ "$B" -ne 0 ] && { echo "RESULT PASS (fixed config completes a 12 s hook; round-14 config times out)"; exit 0; }
echo "RESULT FAIL"; exit 1

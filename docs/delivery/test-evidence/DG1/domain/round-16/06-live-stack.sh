#!/usr/bin/env bash
# DG1 round-16 domain-reviewer (candidate 56f3eb885c6cf3db, commit 13418b8): disposable stack on PRIVATE ports (throwaway PostgreSQL 16 under $TMPDIR, API serving the
# built web), then the live scenario 06-live-scenario.mjs. Run from the disposable clone root after `pnpm -r build`.
#   bash 07-live-stack.sh <evidence-dir>
set -euo pipefail
EV="$1"
PGBIN="$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)"
PG_PORT=54934
API_PORT=3458
WORK="$(mktemp -d "$TMPDIR/dom-stack.XXXXXX")"; chmod 777 "$WORK"
PG_PID=""; API_PID=""
cleanup() {
  [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null || true
  [ -n "$PG_PID" ] && kill -INT "$PG_PID" 2>/dev/null || true
  sleep 1; rm -rf "$WORK"
}
trap cleanup EXIT
AS_PG=(unshare --user --map-user=1000 --map-group=1000)
"${AS_PG[@]}" "$PGBIN/initdb" -D "$WORK/pg" -U postgres --auth=trust >/dev/null
"${AS_PG[@]}" "$PGBIN/postgres" -D "$WORK/pg" -c unix_socket_directories='' -c listen_addresses=127.0.0.1 \
  -p "$PG_PORT" -c fsync=off >"$WORK/pg.log" 2>&1 &
PG_PID=$!
ADMIN_URL="postgresql://postgres@127.0.0.1:${PG_PORT}/postgres"
for _ in $(seq 1 60); do psql "$ADMIN_URL" -qAtc "select 1" >/dev/null 2>&1 && break; sleep 0.5; done
echo "clone HEAD: $(git rev-parse HEAD)"; echo "node: $(node --version)"
psql "$ADMIN_URL" -qAtc "select 'cluster: ' || version()"
psql "$ADMIN_URL" -q -v ON_ERROR_STOP=1 \
  -c "CREATE ROLE mth_owner NOLOGIN" -c "CREATE ROLE mth_app NOLOGIN" -c "CREATE DATABASE mth OWNER mth_owner"
role_url() { node -e 'const u=new URL(process.argv[1]);u.pathname="/mth";u.searchParams.set("options","-c role="+process.argv[2]);console.log(u.toString())' "$ADMIN_URL" "$1"; }
export NODE_ENV=development AUTH_MODE=dev PORT=$API_PORT APP_BASE_URL=http://localhost:$API_PORT LOG_LEVEL=warn
export DATABASE_OWNER_URL="$(role_url mth_owner)" DATABASE_URL="$(role_url mth_app)"
export AUTH_RATE_LIMIT_PER_MINUTE=1000 RATE_LIMIT_PER_MINUTE=10000
node packages/db/dist/cli.js migrate
node packages/db/dist/cli.js seed-dev
node apps/api/dist/main.js >"$WORK/api.log" 2>&1 &
API_PID=$!
for _ in $(seq 1 60); do curl -fsS "http://localhost:$API_PORT/readyz" >/dev/null 2>&1 && break; sleep 0.5; done
echo "readyz: $(curl -fsS "http://localhost:$API_PORT/readyz")"
mkdir -p "$EV/screens"
set +e
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers BASE="http://localhost:$API_PORT" SHOTS="$EV/screens" \
  DB="postgresql://postgres@127.0.0.1:${PG_PORT}/mth" node "$EV/06-live-scenario.mjs"
STATUS=$?
set -e
[ "$STATUS" -ne 0 ] && { echo "---- api.log tail"; tail -30 "$WORK/api.log"; }
echo "exit=$STATUS"
exit "$STATUS"

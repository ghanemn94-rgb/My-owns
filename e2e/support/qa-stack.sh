#!/usr/bin/env bash
# qa-verifier: run a command against a REAL local stack built from the current tree (acceptance e2e, root e2e/**):
#   disposable PostgreSQL -> `mth-db migrate` (built CLI) -> `mth-db seed-dev` (SYNTHETIC users) -> API
#   (AUTH_MODE=dev) serving the built SPA (apps/web/dist) on http://localhost:3060 (or the port actually used) ->
#   "$@" -> teardown.
# Nothing leaves the machine. Prerequisite: `pnpm -r build` in this tree.
#
#   e2e/support/qa-stack.sh npx playwright test e2e --workers=1
#
# Environment: PGBIN (default: newest /usr/lib/postgresql/*/bin), QA_E2E_PG_PORT (default 24361), QA_E2E_API_PORT
# (default 3060; was a fixed 3000, now distinct from apps/web/e2e/support/with-stack.sh). The run exports
# E2E_BASE_URL=http://localhost:<port actually used> for Playwright (playwright.config.ts) and PORT/APP_BASE_URL for
# the API. Port policy (tests/qa/support/pg-port.sh, F-DG2-310): defaults lie below the Linux ephemeral range
# (32768-60999); a requested port is the STARTING point and, if postgres or the API fails to bind (EADDRINUSE, e.g. a
# client socket in TIME_WAIT), the harness retries on a free port from MTH_PORT_POOL (default 25000-31999), up to
# MTH_PORT_RETRIES (10) times, logging each retry. QA_E2E_PG_STRICT_PORT=1 / QA_E2E_API_STRICT_PORT=1 (or
# MTH_STRICT_PORT=1) turn a conflict into BLOCKED instead.
# Missing prerequisites, PostgreSQL not starting, or ports exhausted -> exit 3 with "BLOCKED: ..." (never a silent
# pass); the API not becoming ready for another reason -> exit 4.
# The cluster is ALWAYS UTF8 with the C locale (T-DG2-BE9), whatever the shell's LANG/LC_*: without them initdb
# would make a SQL_ASCII cluster, where char_length counts bytes. C (not C.UTF-8) because it exists on every platform
# and sorts by code point independent of the C library version.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PG_PORT="${QA_E2E_PG_PORT:-24361}"
API_PORT="${QA_E2E_API_PORT:-3060}"
# shellcheck source=../../tests/qa/support/pg-port.sh
. "$ROOT/tests/qa/support/pg-port.sh"
[ -n "$PGBIN" ] && [ -x "$PGBIN/initdb" ] || { echo "BLOCKED: PostgreSQL binaries not found (set PGBIN)"; exit 3; }
command -v psql >/dev/null || { echo "BLOCKED: psql not found"; exit 3; }
for f in apps/api/dist/main.js apps/web/dist/index.html packages/db/dist/cli.js; do
  [ -f "$f" ] || { echo "BLOCKED: $f missing; run 'pnpm -r build' first"; exit 3; }
done
[ -n "${PLAYWRIGHT_BROWSERS_PATH:-}" ] || export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers

WORK="$(mktemp -d "${TMPDIR:-/tmp}/qa-e2e.XXXXXX")"
chmod 777 "$WORK"
PG_PID=""
API_PID=""
cleanup() {
  [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null || true
  if [ -n "$PG_PID" ]; then
    kill -INT "$PG_PID" 2>/dev/null || true
    for _ in $(seq 1 50); do kill -0 "$PG_PID" 2>/dev/null || break; sleep 0.1; done
    kill -KILL "$PG_PID" 2>/dev/null || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

if [ "$(id -u)" = "0" ]; then AS_PG=(unshare --user --map-user=1000 --map-group=1000); else AS_PG=(); fi
"${AS_PG[@]}" "$PGBIN/initdb" -D "$WORK/pg" -U postgres --auth=trust --encoding=UTF8 --locale=C >/dev/null
mth_pg_start "$PGBIN" "$WORK/pg" "$WORK/pg.log" "$PG_PORT" QA_E2E_PG_STRICT_PORT PG_PID || exit 3
PG_PORT="$MTH_PG_PORT"
ADMIN_URL="postgresql://postgres@127.0.0.1:${PG_PORT}/postgres"
psql "$ADMIN_URL" -qAtc "select 'qa e2e cluster: ' || version()" || { echo "BLOCKED: PostgreSQL did not start"; cat "$WORK/pg.log"; exit 3; }
psql "$ADMIN_URL" -q -v ON_ERROR_STOP=1 \
  -c "CREATE ROLE mth_owner NOLOGIN" -c "CREATE ROLE mth_app NOLOGIN" \
  -c "CREATE DATABASE mth OWNER mth_owner ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0"
psql "$ADMIN_URL" -qAtc "select 'qa e2e database mth: server_encoding ' || pg_encoding_to_char(encoding) || ', lc_collate ' || datcollate || ', lc_ctype ' || datctype from pg_database where datname = 'mth'"

role_url() { node -e 'const u=new URL(process.argv[1]);u.pathname="/mth";u.searchParams.set("options","-c role="+process.argv[2]);console.log(u.toString())' "$ADMIN_URL" "$1"; }
export NODE_ENV=development AUTH_MODE=dev LOG_LEVEL=warn
export DATABASE_OWNER_URL="$(role_url mth_owner)" DATABASE_URL="$(role_url mth_app)"
# Many sign-ins per minute in tests; production defaults are untouched.
export AUTH_RATE_LIMIT_PER_MINUTE=1000 RATE_LIMIT_PER_MINUTE=10000
# P2 evidence uploads need a writable store; the default /var/lib/mth/evidence is not writable
# in the sandbox and returned 503, which skipped the serial P2 journey (F-DG2-206). Mirror with-stack.sh.
export EVIDENCE_STORAGE_DRIVER=filesystem EVIDENCE_STORAGE_PATH="$WORK/evidence"

node packages/db/dist/cli.js migrate
node packages/db/dist/cli.js seed-dev
# PORT / APP_BASE_URL / E2E_BASE_URL follow the port of each attempt; after the start they hold the port in use.
launch_api() {
  export PORT="$1" APP_BASE_URL="http://localhost:$1" E2E_BASE_URL="http://localhost:$1"
  node apps/api/dist/main.js >>"$WORK/api.log" 2>&1 </dev/null &
  MTH_LAUNCHED_PID=$!
}
api_ready() { curl -fsS "http://localhost:$1/readyz" >/dev/null 2>&1; }
RC=0
mth_start_with_port_retry "API" "$API_PORT" QA_E2E_API_STRICT_PORT API_PID "$WORK/api.log" 30 launch_api api_ready || RC=$?
[ "$RC" = 3 ] && exit 3
[ "$RC" = 0 ] || { echo "API not ready"; cat "$WORK/api.log"; exit 4; }
API_PORT="$MTH_PORT"
echo "API:     $E2E_BASE_URL"
echo "healthz: $(curl -fsS "$E2E_BASE_URL/healthz")"
READYZ="$(curl -fsS "$E2E_BASE_URL/readyz")" || { echo "API not ready"; cat "$WORK/api.log"; exit 4; }
echo "readyz:  $READYZ"

set +e
"$@"
STATUS=$?
set -e
if [ "$STATUS" -ne 0 ]; then echo "---- api.log (tail)"; tail -40 "$WORK/api.log"; fi
exit "$STATUS"

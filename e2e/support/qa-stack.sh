#!/usr/bin/env bash
# qa-verifier: run a command against a REAL local stack built from the current tree (acceptance e2e, root e2e/**):
#   disposable PostgreSQL -> `mth-db migrate` (built CLI) -> `mth-db seed-dev` (SYNTHETIC users) -> API
#   (AUTH_MODE=dev) serving the built SPA (apps/web/dist) on http://localhost:3000 -> "$@" -> teardown.
# Nothing leaves the machine. Prerequisite: `pnpm -r build` in this tree.
#
#   e2e/support/qa-stack.sh npx playwright test e2e --workers=1
#
# Environment: PGBIN (default: newest /usr/lib/postgresql/*/bin), QA_E2E_PG_PORT (default 54361).
# Missing prerequisites -> exit 3 with "BLOCKED: ..." (never a silent pass).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PG_PORT="${QA_E2E_PG_PORT:-54361}"
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
"${AS_PG[@]}" "$PGBIN/initdb" -D "$WORK/pg" -U postgres --auth=trust >/dev/null
"${AS_PG[@]}" "$PGBIN/postgres" -D "$WORK/pg" -c unix_socket_directories='' -c listen_addresses=127.0.0.1 \
  -p "$PG_PORT" -c fsync=off >"$WORK/pg.log" 2>&1 &
PG_PID=$!
ADMIN_URL="postgresql://postgres@127.0.0.1:${PG_PORT}/postgres"
for _ in $(seq 1 60); do psql "$ADMIN_URL" -qAtc "select 1" >/dev/null 2>&1 && break; sleep 0.5; done
psql "$ADMIN_URL" -qAtc "select 'qa e2e cluster: ' || version()" || { echo "BLOCKED: PostgreSQL did not start"; cat "$WORK/pg.log"; exit 3; }
psql "$ADMIN_URL" -q -v ON_ERROR_STOP=1 \
  -c "CREATE ROLE mth_owner NOLOGIN" -c "CREATE ROLE mth_app NOLOGIN" -c "CREATE DATABASE mth OWNER mth_owner"

role_url() { node -e 'const u=new URL(process.argv[1]);u.pathname="/mth";u.searchParams.set("options","-c role="+process.argv[2]);console.log(u.toString())' "$ADMIN_URL" "$1"; }
export NODE_ENV=development AUTH_MODE=dev PORT=3000 APP_BASE_URL=http://localhost:3000 LOG_LEVEL=warn
export DATABASE_OWNER_URL="$(role_url mth_owner)" DATABASE_URL="$(role_url mth_app)"
# Many sign-ins per minute in tests; production defaults are untouched.
export AUTH_RATE_LIMIT_PER_MINUTE=1000 RATE_LIMIT_PER_MINUTE=10000

node packages/db/dist/cli.js migrate
node packages/db/dist/cli.js seed-dev
node apps/api/dist/main.js >"$WORK/api.log" 2>&1 &
API_PID=$!
for _ in $(seq 1 60); do curl -fsS http://localhost:3000/readyz >/dev/null 2>&1 && break; sleep 0.5; done
echo "healthz: $(curl -fsS http://localhost:3000/healthz)"
echo "readyz:  $(curl -fsS http://localhost:3000/readyz)" || { echo "API not ready"; cat "$WORK/api.log"; exit 4; }

set +e
"$@"
STATUS=$?
set -e
if [ "$STATUS" -ne 0 ]; then echo "---- api.log (tail)"; tail -40 "$WORK/api.log"; fi
exit "$STATUS"

#!/usr/bin/env bash
# Runs a command against a REAL local stack for the web journeys (apps/web/e2e):
#   disposable PostgreSQL -> `mth-db migrate` -> `mth-db seed-dev` (SYNTHETIC users) -> API (AUTH_MODE=dev) serving
#   the built SPA from apps/web/dist on http://localhost:3000 -> "$@" -> teardown (the cluster is deleted).
# Nothing leaves the machine: no network access is needed. Prerequisite: `pnpm -r build`.
#
# Usage (from the repository root):
#   apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1
#
# Environment: PGBIN (PostgreSQL bin dir; default: newest /usr/lib/postgresql/*/bin), E2E_PG_PORT (default 54331).
# When run as uid 0 (sandboxes), PostgreSQL is started in a user namespace as uid 1000 because it refuses root.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PG_PORT="${E2E_PG_PORT:-54331}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/mth-web-e2e.XXXXXX")"
chmod 777 "$WORK"
PG_PID=""
API_PID=""

as_pg() {
  if [ "$(id -u)" = "0" ]; then unshare --user --map-user=1000 --map-group=1000 "$@"; else "$@"; fi
}
cleanup() {
  [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null || true
  [ -n "$PG_PID" ] && kill "$PG_PID" 2>/dev/null || true
  sleep 1
  rm -rf "$WORK"
}
trap cleanup EXIT

[ -x "$PGBIN/initdb" ] || { echo "BLOCKED: PostgreSQL binaries not found (set PGBIN)"; exit 3; }
[ -f apps/api/dist/main.js ] && [ -f apps/web/dist/index.html ] || { echo "BLOCKED: run 'pnpm -r build' first"; exit 3; }

as_pg "$PGBIN/initdb" -D "$WORK/pg" -U postgres --auth=trust >/dev/null
as_pg "$PGBIN/postgres" -D "$WORK/pg" -c unix_socket_directories='' -c listen_addresses=127.0.0.1 \
  -p "$PG_PORT" -c fsync=off >"$WORK/pg.log" 2>&1 &
PG_PID=$!
ADMIN_URL="postgresql://postgres@127.0.0.1:${PG_PORT}/postgres"
for _ in $(seq 1 60); do psql "$ADMIN_URL" -qAtc "select 1" >/dev/null 2>&1 && break; sleep 0.5; done
psql "$ADMIN_URL" -q -v ON_ERROR_STOP=1 \
  -c "CREATE ROLE mth_owner NOLOGIN" -c "CREATE ROLE mth_app NOLOGIN" -c "CREATE DATABASE mth OWNER mth_owner"

role_url() { node -e 'const u=new URL(process.argv[1]);u.pathname="/mth";u.searchParams.set("options","-c role="+process.argv[2]);console.log(u.toString())' "$ADMIN_URL" "$1"; }
export NODE_ENV=development AUTH_MODE=dev PORT=3000 APP_BASE_URL=http://localhost:3000 LOG_LEVEL=warn
export DATABASE_OWNER_URL="$(role_url mth_owner)" DATABASE_URL="$(role_url mth_app)"
# The journeys sign in many times in a minute; production defaults are unchanged.
export AUTH_RATE_LIMIT_PER_MINUTE=1000 RATE_LIMIT_PER_MINUTE=10000

node packages/db/dist/cli.js migrate
node packages/db/dist/cli.js seed-dev
node apps/api/dist/main.js >"$WORK/api.log" 2>&1 &
API_PID=$!
for _ in $(seq 1 60); do curl -fsS http://localhost:3000/readyz >/dev/null 2>&1 && break; sleep 0.5; done
curl -fsS http://localhost:3000/readyz || { echo "API not ready"; cat "$WORK/api.log"; exit 4; }
echo

set +e
"$@"
STATUS=$?
set -e
if [ "$STATUS" -ne 0 ]; then echo "---- api.log (tail)"; tail -50 "$WORK/api.log"; fi
exit "$STATUS"

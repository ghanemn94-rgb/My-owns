#!/usr/bin/env bash
# Runs a command against a REAL local stack for the web journeys (apps/web/e2e):
#   disposable PostgreSQL -> `mth-db migrate` -> `mth-db seed-dev` (SYNTHETIC users) -> API (AUTH_MODE=dev) serving
#   the built SPA from apps/web/dist on http://localhost:3000 -> "$@" -> teardown (the cluster is deleted).
# Nothing leaves the machine: no network access is needed. Prerequisite: `pnpm -r build`.
#
# Usage (from the repository root):
#   apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1
#
# Environment: PGBIN (PostgreSQL bin dir; default: newest /usr/lib/postgresql/*/bin), E2E_PG_PORT or QA_PG_PORT
# (default 54331), E2E_API_PORT (default 3000; the run exports E2E_BASE_URL=http://localhost:<port> for Playwright, so
# two stacks on one machine never share a port).
# When run as uid 0 (sandboxes), PostgreSQL is started in a user namespace as uid 1000 because it refuses root.
# The cluster is ALWAYS UTF8 with the C locale (T-DG2-BE9), whatever the shell's LANG/LC_*: without them initdb
# would make a SQL_ASCII cluster, where char_length counts bytes. C (not C.UTF-8) because it exists on every platform
# and sorts by code point independent of the C library version.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PG_PORT="${E2E_PG_PORT:-${QA_PG_PORT:-54331}}"
API_PORT="${E2E_API_PORT:-3000}"
export E2E_BASE_URL="http://localhost:${API_PORT}"
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

as_pg "$PGBIN/initdb" -D "$WORK/pg" -U postgres --auth=trust --encoding=UTF8 --locale=C >/dev/null
as_pg "$PGBIN/postgres" -D "$WORK/pg" -c unix_socket_directories='' -c listen_addresses=127.0.0.1 \
  -p "$PG_PORT" -c fsync=off >"$WORK/pg.log" 2>&1 &
PG_PID=$!
ADMIN_URL="postgresql://postgres@127.0.0.1:${PG_PORT}/postgres"
for _ in $(seq 1 60); do psql "$ADMIN_URL" -qAtc "select 1" >/dev/null 2>&1 && break; sleep 0.5; done
psql "$ADMIN_URL" -q -v ON_ERROR_STOP=1 \
  -c "CREATE ROLE mth_owner NOLOGIN" -c "CREATE ROLE mth_app NOLOGIN" \
  -c "CREATE DATABASE mth OWNER mth_owner ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0"
psql "$ADMIN_URL" -qAtc "select 'e2e database mth: server_encoding ' || pg_encoding_to_char(encoding) || ', lc_collate ' || datcollate || ', lc_ctype ' || datctype from pg_database where datname = 'mth'"

role_url() { node -e 'const u=new URL(process.argv[1]);u.pathname="/mth";u.searchParams.set("options","-c role="+process.argv[2]);console.log(u.toString())' "$ADMIN_URL" "$1"; }
export NODE_ENV=development AUTH_MODE=dev PORT="$API_PORT" APP_BASE_URL="$E2E_BASE_URL" LOG_LEVEL=warn
# Evidence file revisions (P2) go to a private directory of this run; it is deleted with the cluster at teardown.
mkdir -p "$WORK/evidence"
export EVIDENCE_STORAGE_DRIVER=filesystem EVIDENCE_STORAGE_PATH="$WORK/evidence"
export DATABASE_OWNER_URL="$(role_url mth_owner)" DATABASE_URL="$(role_url mth_app)"
# The journeys sign in many times in a minute; production defaults are unchanged.
export AUTH_RATE_LIMIT_PER_MINUTE=1000 RATE_LIMIT_PER_MINUTE=10000

node packages/db/dist/cli.js migrate
node packages/db/dist/cli.js seed-dev
node apps/api/dist/main.js >"$WORK/api.log" 2>&1 &
API_PID=$!
for _ in $(seq 1 60); do curl -fsS "$E2E_BASE_URL/readyz" >/dev/null 2>&1 && break; sleep 0.5; done
curl -fsS "$E2E_BASE_URL/readyz" || { echo "API not ready"; cat "$WORK/api.log"; exit 4; }
echo

set +e
"$@"
STATUS=$?
set -e
if [ "$STATUS" -ne 0 ]; then echo "---- api.log (tail)"; tail -50 "$WORK/api.log"; fi
exit "$STATUS"

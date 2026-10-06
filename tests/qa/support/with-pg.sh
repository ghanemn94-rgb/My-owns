#!/usr/bin/env bash
# qa-verifier: run a command against a DISPOSABLE PostgreSQL cluster (created, used and deleted inside this one
# process tree), exporting TEST_DATABASE_ADMIN_URL for the Vitest `integration` project (packages/db/test/global-setup).
#
#   tests/qa/support/with-pg.sh pnpm test:integration
#   tests/qa/support/with-pg.sh npx vitest run --project integration tests/qa/integration
#
# Environment: PGBIN (default: newest /usr/lib/postgresql/*/bin), QA_PG_PORT (default 54351).
# No network is used. When run as uid 0 (build sandboxes), PostgreSQL runs in a user namespace as uid 1000 because it
# refuses to run as root. Missing binaries -> exit 3 and "BLOCKED" (never a silent pass).
# The cluster is ALWAYS UTF8 with the C locale (T-DG2-BE9), whatever the shell's LANG/LC_*: without them initdb
# would make a SQL_ASCII cluster, where char_length counts bytes. C (not C.UTF-8) because it exists on every platform
# and sorts by code point independent of the C library version.
set -euo pipefail

PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PG_PORT="${QA_PG_PORT:-54351}"
[ -n "$PGBIN" ] && [ -x "$PGBIN/initdb" ] && [ -x "$PGBIN/postgres" ] || {
  echo "BLOCKED: PostgreSQL server binaries not found (set PGBIN)"
  exit 3
}
command -v psql >/dev/null || { echo "BLOCKED: psql not found"; exit 3; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/qa-pg.XXXXXX")"
chmod 777 "$WORK"
PG_PID=""
as_pg() { if [ "$(id -u)" = "0" ]; then unshare --user --map-user=1000 --map-group=1000 "$@"; else "$@"; fi; }
cleanup() {
  # Fast shutdown of the postmaster itself (not only the launching process), then wait until the port is free.
  if [ -n "$PG_PID" ]; then
    kill -INT "$PG_PID" 2>/dev/null || true
    for _ in $(seq 1 50); do kill -0 "$PG_PID" 2>/dev/null || break; sleep 0.1; done
    kill -KILL "$PG_PID" 2>/dev/null || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

as_pg "$PGBIN/initdb" -D "$WORK/pg" -U postgres --auth=trust --encoding=UTF8 --locale=C >/dev/null
PG_ARGS=(-D "$WORK/pg" -c unix_socket_directories='' -c listen_addresses=127.0.0.1 -p "$PG_PORT" -c fsync=off
  -c max_connections=200)
# Started directly (not through a shell function) so $! is the postmaster: `unshare` without --fork execs it.
if [ "$(id -u)" = "0" ]; then
  unshare --user --map-user=1000 --map-group=1000 "$PGBIN/postgres" "${PG_ARGS[@]}" >"$WORK/pg.log" 2>&1 &
else
  "$PGBIN/postgres" "${PG_ARGS[@]}" >"$WORK/pg.log" 2>&1 &
fi
PG_PID=$!
export TEST_DATABASE_ADMIN_URL="postgresql://postgres@127.0.0.1:${PG_PORT}/postgres"
for _ in $(seq 1 60); do psql "$TEST_DATABASE_ADMIN_URL" -qAtc "select 1" >/dev/null 2>&1 && break; sleep 0.5; done
psql "$TEST_DATABASE_ADMIN_URL" -qAtc "select 'qa disposable cluster: ' || version() || '; server_encoding ' || current_setting('server_encoding') || ', lc_collate ' || datcollate || ', lc_ctype ' || datctype from pg_database where datname = current_database()" || {
  echo "BLOCKED: disposable PostgreSQL did not start"
  cat "$WORK/pg.log"
  exit 3
}

set +e
"$@"
STATUS=$?
set -e
exit "$STATUS"

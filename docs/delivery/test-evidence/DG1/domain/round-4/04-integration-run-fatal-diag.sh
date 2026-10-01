#!/usr/bin/env bash
# DG1 round-4 domain-reviewer: same as 03-integration-run.sh, but prints every FATAL/ERROR line of the throwaway
# server log (with log_line_prefix showing the database and application name), so a server-side FATAL can be told
# apart from a client-visible unhandled 57P01. Run from the disposable clone root.
#   bash 04-integration-run-fatal-diag.sh [port]
set -uo pipefail
PGBIN="$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)"
PORT="${1:-54402}"
W="$(mktemp -d "$TMPDIR/dom-int.XXXXXX")"; chmod 777 "$W"
AS_PG=(unshare --user --map-user=1000 --map-group=1000)
"${AS_PG[@]}" "$PGBIN/initdb" -D "$W/pg" -U postgres --auth=trust >/dev/null
"${AS_PG[@]}" "$PGBIN/postgres" -D "$W/pg" -c unix_socket_directories='' -c listen_addresses=127.0.0.1 \
  -p "$PORT" -c fsync=off -c "log_line_prefix=[db=%d app=%a] " >"$W/pg.log" 2>&1 &
PG_PID=$!
URL="postgresql://postgres@127.0.0.1:${PORT}/postgres"
for _ in $(seq 1 60); do psql "$URL" -qAtc "select 1" >/dev/null 2>&1 && break; sleep 0.5; done
echo "cluster: $(psql "$URL" -qAtc 'select version()')"
echo "clone HEAD: $(git rev-parse HEAD)"
TEST_DATABASE_ADMIN_URL="$URL" npx vitest run --project integration 2>&1 | tail -8
STATUS=${PIPESTATUS[0]}
echo "---- leftover databases:"
psql "$URL" -qAtc "select datname from pg_database order by 1"
echo "---- pg.log FATAL lines (with the line before and after):"
grep -n -B1 -A1 "FATAL" "$W/pg.log" || echo "(none)"
kill -INT "$PG_PID" 2>/dev/null; sleep 1; rm -rf "$W"
echo "exit=$STATUS"
exit "$STATUS"

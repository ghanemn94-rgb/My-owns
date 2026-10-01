#!/usr/bin/env bash
# DG1 round-10 domain-reviewer (D-055 default-deny no-regression + closure recheck): full integration project against a FRESH throwaway
# PostgreSQL 16 cluster started in the same sandboxed shell (initdb under $TMPDIR, private port, removed afterwards).
# Run from the disposable clone root of commit 265af7e (candidate 18fee1617d617cfd). One cluster per invocation.
#   bash 04-integration-run.sh [port]
set -uo pipefail
PGBIN="$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)"
PORT="${1:-54392}"
W="$(mktemp -d "$TMPDIR/dom-int.XXXXXX")"; chmod 777 "$W"
AS_PG=(unshare --user --map-user=1000 --map-group=1000)
"${AS_PG[@]}" "$PGBIN/initdb" -D "$W/pg" -U postgres --auth=trust >/dev/null
"${AS_PG[@]}" "$PGBIN/postgres" -D "$W/pg" -c unix_socket_directories='' -c listen_addresses=127.0.0.1 \
  -p "$PORT" -c fsync=off >"$W/pg.log" 2>&1 &
PG_PID=$!
URL="postgresql://postgres@127.0.0.1:${PORT}/postgres"
for _ in $(seq 1 60); do psql "$URL" -qAtc "select 1" >/dev/null 2>&1 && break; sleep 0.5; done
echo "cluster: $(psql "$URL" -qAtc 'select version()')"
echo "clone HEAD: $(git rev-parse HEAD)"
START=$(date +%s.%N)
TEST_DATABASE_ADMIN_URL="$URL" npx vitest run --project integration --reporter=verbose 2>&1
STATUS=$?
END=$(date +%s.%N)
echo "wall_seconds=$(echo "$END - $START" | bc)"
echo "---- leftover databases on the cluster after the run (expect only postgres/template0/template1):"
psql "$URL" -qAtc "select datname from pg_database order by 1"
echo "---- pg.log FATAL/57P01 lines:"
grep -c -E "FATAL|57P01" "$W/pg.log" || true
kill -INT "$PG_PID" 2>/dev/null; sleep 1; rm -rf "$W"
echo "exit=$STATUS"
exit "$STATUS"

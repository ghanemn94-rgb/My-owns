#!/usr/bin/env bash
# DG1 round-3 domain-reviewer: full integration project against a throwaway PostgreSQL 16 cluster started in the
# same sandboxed shell (initdb under $TMPDIR, private port, removed afterwards). Run from the disposable clone root.
#   bash 03-integration-run.sh
set -uo pipefail
PGBIN="$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)"
PORT=54382
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
TEST_DATABASE_ADMIN_URL="$URL" npx vitest run --project integration --reporter=verbose 2>&1
STATUS=$?
kill -INT "$PG_PID" 2>/dev/null; sleep 1; rm -rf "$W"
echo "exit=$STATUS"
exit "$STATUS"

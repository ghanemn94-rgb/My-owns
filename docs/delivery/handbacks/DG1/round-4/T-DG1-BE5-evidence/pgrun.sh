#!/usr/bin/env bash
# One full integration pass on a FRESH disposable PostgreSQL 16 cluster (initdb under $TMPDIR, unique port,
# unprivileged via a user namespace), removed afterwards.  Usage: PORT=5481 pgrun.sh <tree> [vitest args]
set -u
PORT=${PORT:-5481}; PGBIN="$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)"
W="$(mktemp -d "$TMPDIR/pgc.XXXXXX")"; chmod 777 "$W"
AS_PG=(unshare --user --map-user=1000 --map-group=1000)
"${AS_PG[@]}" "$PGBIN/initdb" -D "$W/pg" -U postgres --auth=trust >/dev/null || exit 90
"${AS_PG[@]}" "$PGBIN/postgres" -D "$W/pg" -c unix_socket_directories='' -c listen_addresses=127.0.0.1 \
  -p "$PORT" -c fsync=off >"$W/pg.log" 2>&1 &
PG_PID=$!
URL="postgresql://postgres@127.0.0.1:${PORT}/postgres"
for _ in $(seq 1 60); do psql "$URL" -qAtc "select 1" >/dev/null 2>&1 && break; sleep 0.5; done
echo "cluster: $(psql "$URL" -qAtc 'select version()') port $PORT"
cd "$1"; shift; echo "tree HEAD: $(git rev-parse HEAD)"
TEST_DATABASE_ADMIN_URL="$URL" timeout 900 pnpm exec vitest run --project integration "$@" 2>&1
rc=$?
kill -INT "$PG_PID" 2>/dev/null; wait "$PG_PID" 2>/dev/null; rm -rf "$W"
echo "EXIT=$rc"; exit $rc

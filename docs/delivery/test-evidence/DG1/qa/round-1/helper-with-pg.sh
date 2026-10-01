#!/usr/bin/env bash
# with-pg.sh PORT CMD... : fresh disposable PG16 cluster, export TEST_DATABASE_ADMIN_URL, run CMD, teardown.
set -u
PGBIN=$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)
PORT=$1; shift
DIR=$(mktemp -d "$TMPDIR/pg.XXXXXX"); chmod 777 "$DIR"
if [ "$(id -u)" = "0" ]; then AS=(unshare --user --map-user=1000 --map-group=1000); else AS=(); fi
"${AS[@]}" "$PGBIN/initdb" -D "$DIR/pg" -U postgres --auth=trust >/dev/null
"${AS[@]}" "$PGBIN/postgres" -D "$DIR/pg" -c unix_socket_directories='' -c listen_addresses=127.0.0.1 -p "$PORT" -c fsync=off >"$DIR/pg.log" 2>&1 &
PID=$!
trap 'kill -INT $PID 2>/dev/null; sleep 1; kill -KILL $PID 2>/dev/null; rm -rf "$DIR"' EXIT
export TEST_DATABASE_ADMIN_URL="postgresql://postgres@127.0.0.1:$PORT/postgres"
for _ in $(seq 1 60); do psql "$TEST_DATABASE_ADMIN_URL" -qAtc "select 'cluster: '||version()" 2>/dev/null && break; sleep 0.5; done
"$@"

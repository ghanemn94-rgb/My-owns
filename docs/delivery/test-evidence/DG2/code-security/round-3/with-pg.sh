#!/usr/bin/env bash
# Usage: with-pg.sh <port> <command...>  — starts a disposable PG16 cluster (nested user ns, uid 1000), runs the command
# with TEST_DATABASE_ADMIN_URL set, then stops and deletes the cluster.
set -u
PORT=$1; shift
PG=/usr/lib/postgresql/16/bin
D=$(mktemp -d "$TMPDIR/pg.XXXX"); chmod 777 "$D"
U="unshare --user --map-user=1000 --map-group=1000"
$U $PG/initdb -D "$D/data" -U postgres --auth=trust -E UTF8 >"$D/initdb.log" 2>&1 || { cat "$D/initdb.log"; exit 90; }
$U $PG/pg_ctl -D "$D/data" -o "-p $PORT -c unix_socket_directories='' -c listen_addresses=127.0.0.1" -l "$D/log" -w -t 30 start >/dev/null || { cat "$D/log"; exit 91; }
export TEST_DATABASE_ADMIN_URL="postgres://postgres@127.0.0.1:$PORT/postgres"
"$@"; rc=$?
$U $PG/pg_ctl -D "$D/data" -m fast stop >/dev/null 2>&1
rm -rf "$D"
exit $rc

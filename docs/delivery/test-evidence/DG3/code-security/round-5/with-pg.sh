#!/usr/bin/env bash
# code-security-reviewer DG3 round-5 helper (copied unchanged from round 4) (identical in behaviour to the round-1/round-2 helper).
# Usage: bash with-pg.sh <port> <command...>. Starts a disposable PostgreSQL 16 cluster (nested user namespace, uid 1000)
# on 127.0.0.1:<port>, runs the command with TEST_DATABASE_ADMIN_URL set, then stops and deletes the cluster.
# DELIBERATELY passes NO --encoding/--locale to initdb: the cluster default follows the caller's LANG/LC_* (LANG unset
# -> SQL_ASCII, LANG=C.UTF-8 -> UTF8), so the product's own locale independence is tested. Fails (92) if the port is
# already in use rather than silently attaching to another cluster.
set -u
PORT=$1; shift
PG=/usr/lib/postgresql/16/bin
if (exec 3<>/dev/tcp/127.0.0.1/$PORT) 2>/dev/null; then echo "[with-pg] port $PORT already in use"; exit 92; fi
D=$(mktemp -d "$TMPDIR/pg.XXXX"); chmod 777 "$D"
U="unshare --user --map-user=1000 --map-group=1000"
$U $PG/initdb -D "$D/data" -U postgres --auth=trust >"$D/initdb.log" 2>&1 || { cat "$D/initdb.log"; exit 90; }
grep -E 'encoding|locale' "$D/initdb.log" | sed 's/^/[with-pg initdb] /'
$U $PG/pg_ctl -D "$D/data" -o "-p $PORT -c unix_socket_directories='' -c listen_addresses=127.0.0.1 -c max_connections=200" -l "$D/log" -w -t 30 start >/dev/null || { cat "$D/log"; exit 91; }
export TEST_DATABASE_ADMIN_URL="postgres://postgres@127.0.0.1:$PORT/postgres"
psql "$TEST_DATABASE_ADMIN_URL" -qAtc "select '[with-pg] cluster template1 encoding ' || pg_encoding_to_char(encoding) || ', collate ' || datcollate from pg_database where datname='template1'"
"$@"; rc=$?
$U $PG/pg_ctl -D "$D/data" -m fast stop >/dev/null 2>&1
rm -rf "$D"
exit $rc

#!/usr/bin/env bash
# code-security-reviewer DG2 round-6 helper (unchanged from round 5). Usage: with-pg.sh <port> <command...>
# Starts a disposable PostgreSQL 16 cluster (nested user namespace, uid 1000) on 127.0.0.1:<port>, runs the command
# with TEST_DATABASE_ADMIN_URL set, then stops and deletes the cluster.
# DELIBERATELY passes NO --encoding/--locale to initdb (unlike round 4): the cluster's default encoding follows the
# caller's LANG/LC_* so the product's own locale independence (explicit UTF8 scratch databases, T-DG2-BE9) is tested.
# With LANG/LC_ALL/LC_CTYPE unset this yields a SQL_ASCII cluster; with LANG=C.UTF-8 a UTF8 cluster. Logged below.
set -u
PORT=$1; shift
PG=/usr/lib/postgresql/16/bin
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

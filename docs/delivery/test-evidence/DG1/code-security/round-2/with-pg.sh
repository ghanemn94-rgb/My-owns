#!/bin/bash
# usage: with-pg.sh <port> <command...> : fresh disposable PG16 cluster (trust, TCP-only) for the duration of the command.
PORT=$1; shift
D=$(mktemp -d "$TMPDIR/pgd.XXXX")
unshare --user --map-user=1000 --map-group=1000 /usr/lib/postgresql/16/bin/initdb -D "$D/data" -U postgres -A trust >"$D/initdb.log" 2>&1 || { echo "initdb failed"; cat "$D/initdb.log"; exit 90; }
unshare --user --map-user=1000 --map-group=1000 /usr/lib/postgresql/16/bin/postgres -D "$D/data" -p "$PORT" -c unix_socket_directories= -c listen_addresses=127.0.0.1 -c max_connections=300 >"$D/pg.log" 2>&1 &
PGPID=$!
for i in $(seq 1 30); do psql -h 127.0.0.1 -p "$PORT" -U postgres -Atc "select 1" >/dev/null 2>&1 && break; sleep 0.5 2>/dev/null || python3 -c 'import time;time.sleep(0.5)'; done
echo "# pg: $(psql -h 127.0.0.1 -p "$PORT" -U postgres -Atc 'select version()')"
"$@"; RC=$?
kill $PGPID; wait $PGPID 2>/dev/null; rm -rf "$D"
exit $RC

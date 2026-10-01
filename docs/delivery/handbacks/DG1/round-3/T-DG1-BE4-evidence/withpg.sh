#!/bin/bash
# Scratch wrapper (NOT in the candidate): disposable PostgreSQL 16 on 127.0.0.1:5460 for one command, then destroyed.
B=/usr/lib/postgresql/16/bin; D=$(mktemp -d "$TMPDIR/pg5460.XXXX")
inner() {
  $B/initdb -D "$D/data" -U postgres --auth=trust -E UTF8 >"$D/initdb.log" 2>&1 || { cat "$D/initdb.log"; exit 3; }
  $B/postgres -D "$D/data" -p 5460 -c listen_addresses=127.0.0.1 -c unix_socket_directories='' -c fsync=off >"$D/pg.log" 2>&1 &
  for i in $(seq 1 50); do $B/pg_isready -h 127.0.0.1 -p 5460 -q && break; sleep 0.2; done
  $B/psql -h 127.0.0.1 -p 5460 -U postgres -Atc "select version()"
  export TEST_DATABASE_ADMIN_URL=postgresql://postgres@127.0.0.1:5460/postgres QA_E2E_PG_PORT=5460
  bash -c "$CMD"; rc=$?
  kill %1; wait; exit $rc
}
export -f inner; export B D CMD="$*"
unshare --user --map-user=1000 --map-group=1000 bash -c inner; rc=$?
rm -rf "$D"; exit $rc

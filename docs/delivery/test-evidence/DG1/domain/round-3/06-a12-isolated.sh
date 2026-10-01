#!/usr/bin/env bash
# DG1 round-3 domain-reviewer: is the a12 "a denied create wrote a row" failure (full-run 2) a product leak or
# cross-file interference on the shared per-run database? Runs ONLY tests/qa/integration/a12-cross-scope.test.ts,
# N times, each against its own throwaway PostgreSQL 16 cluster. Then counts the rows the denied creates leave behind
# by name ("QA denied create") in a last full run. Run from the disposable clone root.
set -uo pipefail
N="${1:-5}"
PGBIN="$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)"
AS_PG=(unshare --user --map-user=1000 --map-group=1000)
start_pg() {
  W="$(mktemp -d "$TMPDIR/dom-a12.XXXXXX")"; chmod 777 "$W"
  "${AS_PG[@]}" "$PGBIN/initdb" -D "$W/pg" -U postgres --auth=trust >/dev/null
  "${AS_PG[@]}" "$PGBIN/postgres" -D "$W/pg" -c unix_socket_directories='' -c listen_addresses=127.0.0.1 \
    -p 54383 -c fsync=off >"$W/pg.log" 2>&1 &
  PG_PID=$!
  URL="postgresql://postgres@127.0.0.1:54383/postgres"
  for _ in $(seq 1 60); do psql "$URL" -qAtc "select 1" >/dev/null 2>&1 && break; sleep 0.5; done
}
stop_pg() { kill -INT "$PG_PID" 2>/dev/null; sleep 1; rm -rf "$W"; }
FAILS=0
for i in $(seq 1 "$N"); do
  start_pg
  out="$(TEST_DATABASE_ADMIN_URL="$URL" npx vitest run --project integration tests/qa/integration/a12-cross-scope.test.ts 2>&1)"
  rc=$?
  echo "isolated run $i: rc=$rc $(echo "$out" | grep -E '^ +Tests ' | tr -s ' ')"
  [ "$rc" -ne 0 ] && { FAILS=$((FAILS+1)); echo "$out" | grep -E 'FAIL|Assertion' | head -5; }
  stop_pg
done
echo "isolated a12: $FAILS failure(s) in $N run(s)"
exit "$FAILS"

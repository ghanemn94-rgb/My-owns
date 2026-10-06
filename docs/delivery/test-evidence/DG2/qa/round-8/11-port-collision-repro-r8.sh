#!/usr/bin/env bash
# qa-verifier round-8 independent repro of F-DG2-310 against the repaired harnesses (run from the clone root).
# usage: 11-port-collision-repro-r8.sh <evidence-dir>
set -uo pipefail
EV="$1"; TW="python3 -I $EV/11-tw.py"; W="$(mktemp -d "$TMPDIR/r8pc.XXXX")"
res() { echo "RESULT $1: $2"; }
echo "== R0 round-7 mechanism repro (unchanged script)"; python3 -I "$EV/11-port-collision-repro.py"
echo "== R1 kernel-assigned client ports never fall below 32768"; python3 -I "$EV/11-ephemeral-sample.py"
echo "== R1b default PostgreSQL/API ports of every harness"; grep -nE '^(PG_PORT|API_PORT)=' tests/qa/support/with-pg.sh apps/web/e2e/support/with-stack.sh e2e/support/qa-stack.sh e2e/clean-start/a18-clean-start.sh deploy/scripts/clean-start-local.sh

PROBE='echo "E2E_BASE_URL=$E2E_BASE_URL PORT=$PORT APP_BASE_URL=$APP_BASE_URL"; curl -fsS "$E2E_BASE_URL/readyz"; echo; echo "pg port in DATABASE_URL: $(node -e "console.log(new URL(process.env.DATABASE_URL).port)")"'
echo; echo "== R2 with-stack.sh (real product stack) with TIME_WAIT on its default PG 24331 AND API 3000"
$TW 24331 3000 || { echo BLOCKED; exit 3; }
env -u E2E_PG_PORT -u QA_PG_PORT -u E2E_API_PORT apps/web/e2e/support/with-stack.sh bash -c "$PROBE" >"$W/r2.log" 2>&1; rc=$?
grep -vE '^[0-9-]+ [0-9:.]+ ' "$W/r2.log"; echo "exit $rc"
u=$(sed -n 's/^E2E_BASE_URL=http:\/\/localhost:\([0-9]*\) .*/\1/p' "$W/r2.log")
[ $rc = 0 ] && grep -q 'port 24331 is in use (EADDRINUSE' "$W/r2.log" && grep -q 'port 3000 is in use (EADDRINUSE' "$W/r2.log" && [ -n "$u" ] && [ "$u" != 3000 ] && grep -q "PORT=$u APP_BASE_URL=http://localhost:$u" "$W/r2.log" && grep -q '"status":"ready"' "$W/r2.log" && res R2 PASS || res R2 FAIL

echo; echo "== R3 qa-stack.sh with TIME_WAIT on its default PG 24361 AND API 3060"
$TW 24361 3060 || { echo BLOCKED; exit 3; }
env -u QA_E2E_PG_PORT -u QA_E2E_API_PORT e2e/support/qa-stack.sh bash -c "$PROBE" >"$W/r3.log" 2>&1; rc=$?
grep -vE '^[0-9-]+ [0-9:.]+ ' "$W/r3.log"; echo "exit $rc"
u=$(sed -n 's/^E2E_BASE_URL=http:\/\/localhost:\([0-9]*\) .*/\1/p' "$W/r3.log")
[ $rc = 0 ] && grep -q 'port 24361 is in use (EADDRINUSE' "$W/r3.log" && grep -q 'port 3060 is in use (EADDRINUSE' "$W/r3.log" && [ -n "$u" ] && [ "$u" != 3060 ] && grep -q '"status":"ready"' "$W/r3.log" && grep -q 'server_encoding UTF8' "$W/r3.log" && res R3 PASS || res R3 FAIL

SHOW='psql "$TEST_DATABASE_ADMIN_URL" -qAtc "select '"'"'url '"'"' || '"'"'$TEST_DATABASE_ADMIN_URL'"'"' || '"'"' server port '"'"' || current_setting('"'"'port'"'"') || '"'"' datadir '"'"' || current_setting('"'"'data_directory'"'"')"; sleep 4'
echo; echo "== R4 concurrency: two with-pg.sh at once on the same QA_PG_PORT=24441"
QA_PG_PORT=24441 tests/qa/support/with-pg.sh bash -c "$SHOW" >"$W/r4a.log" 2>&1 & A=$!
QA_PG_PORT=24441 tests/qa/support/with-pg.sh bash -c "$SHOW" >"$W/r4b.log" 2>&1 & B=$!
wait $A; ra=$?; wait $B; rb=$?
for x in a b; do grep -E 'port-policy|^url|BLOCKED' "$W/r4$x.log" | sed "s/^/  [$x] /"; done; echo "exit a=$ra b=$rb"
pa=$(sed -n 's/.* server port \([0-9]*\) .*/\1/p' "$W/r4a.log"); pb=$(sed -n 's/.* server port \([0-9]*\) .*/\1/p' "$W/r4b.log")
da=$(sed -n 's/.* datadir //p' "$W/r4a.log"); db=$(sed -n 's/.* datadir //p' "$W/r4b.log")
[ $ra = 0 ] && [ $rb = 0 ] && [ -n "$pa" ] && [ -n "$pb" ] && [ "$pa" != "$pb" ] && [ "$da" != "$db" ] && grep -q "127.0.0.1:$pa/" "$W/r4a.log" && grep -q "127.0.0.1:$pb/" "$W/r4b.log" && res R4 PASS || res R4 FAIL

echo; echo "== R5 a foreign server already accepting on QA_PG_PORT=24442 is never mistaken for ours"
python3 -I -c 'import socket,time;s=socket.socket();s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);s.bind(("127.0.0.1",24442));s.listen();time.sleep(60)' & F=$!; sleep 0.5
QA_PG_PORT=24442 tests/qa/support/with-pg.sh bash -c "$SHOW" >"$W/r5.log" 2>&1; rc=$?; kill $F
grep -E 'port-policy|^url|BLOCKED' "$W/r5.log"; echo "exit $rc"
p=$(sed -n 's/.* server port \([0-9]*\) .*/\1/p' "$W/r5.log")
[ $rc = 0 ] && grep -q 'port 24442 is in use (already accepting connections' "$W/r5.log" && [ -n "$p" ] && [ "$p" != 24442 ] && res R5 PASS || res R5 FAIL

echo; echo "== R6 a startup failure that is NOT a bind conflict is not retried (fake postgres exits with FATAL)"
mkdir -p "$W/fakebin"; for b in "$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)"/*; do ln -s "$b" "$W/fakebin/"; done
rm "$W/fakebin/postgres"; printf '#!/bin/sh\necho "FATAL:  qa-induced startup failure (not a bind conflict)" >&2\nexit 1\n' >"$W/fakebin/postgres"; chmod 755 "$W/fakebin/postgres"
PGBIN="$W/fakebin" QA_PG_PORT=24443 tests/qa/support/with-pg.sh bash -c 'echo SHOULD-NOT-RUN' >"$W/r6.log" 2>&1; rc=$?
cat "$W/r6.log"; echo "exit $rc"
[ $rc = 3 ] && grep -q 'not a bind conflict; no retry' "$W/r6.log" && grep -q 'BLOCKED: disposable PostgreSQL did not start' "$W/r6.log" && ! grep -q retrying "$W/r6.log" && ! grep -q SHOULD-NOT-RUN "$W/r6.log" && res R6 PASS || res R6 FAIL

echo; echo "== R7 retries exhausted (MTH_PORT_RETRIES=0) -> BLOCKED exit 3, command not run"
$TW 24444 || { echo BLOCKED; exit 3; }
MTH_PORT_RETRIES=0 QA_PG_PORT=24444 tests/qa/support/with-pg.sh bash -c 'echo SHOULD-NOT-RUN' >"$W/r7.log" 2>&1; rc=$?
grep -vE '^[0-9-]+ [0-9:.]+ ' "$W/r7.log"; echo "exit $rc"
[ $rc = 3 ] && grep -q '^BLOCKED: PostgreSQL could not bind after 1 attempts' "$W/r7.log" && ! grep -q SHOULD-NOT-RUN "$W/r7.log" && res R7 PASS || res R7 FAIL

echo; echo "== R8 strict API port (E2E_API_STRICT_PORT=1) with TIME_WAIT on 3001 -> BLOCKED exit 3"
$TW 3001 || { echo BLOCKED; exit 3; }
E2E_PG_PORT=24445 E2E_API_PORT=3001 E2E_API_STRICT_PORT=1 apps/web/e2e/support/with-stack.sh bash -c 'echo SHOULD-NOT-RUN' >"$W/r8.log" 2>&1; rc=$?
grep -vE '^[0-9-]+ [0-9:.]+ |mth-db migrate: applying' "$W/r8.log"; echo "exit $rc"
[ $rc = 3 ] && grep -q '^BLOCKED: API port 3001 is in use (EADDRINUSE) and E2E_API_STRICT_PORT=1' "$W/r8.log" && ! grep -q SHOULD-NOT-RUN "$W/r8.log" && res R8 PASS || res R8 FAIL
rm -rf "$W"

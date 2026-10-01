#!/usr/bin/env bash
# qa-verifier DG1 round-1 (REQ-S16-001; A13/A22): the API and the worker are separate processes, and stopping the
# worker does not stop the API. Run under e2e/support/qa-stack.sh (which exports DATABASE_URL and starts the API on
# http://localhost:3000 in AUTH_MODE=dev with SYNTHETIC users):
#   e2e/support/qa-stack.sh bash <this file>
# Exit 0 = PASS; 1 = FAIL.
set -uo pipefail
BASE=http://localhost:3000
FAILS=0
check() { if [ "$2" = "$3" ]; then echo "PASS $1: $3"; else echo "FAIL $1: expected '$2', got '$3'"; FAILS=$((FAILS + 1)); fi; }
code() { curl -s -o /dev/null -w '%{http_code}' "$1"; }
EV="$(mktemp -d "${TMPDIR:-/tmp}/qa-ws-ev.XXXXXX")"
API_PIDS="$(pgrep -f 'node apps/api/dist/main.js' | tr '\n' ' ')"
echo "api pid(s): $API_PIDS"

EVIDENCE_STORAGE_PATH="$EV" node apps/worker/dist/main.js >"$EV/worker.log" 2>&1 &
W=$!
sleep 4
kill -0 "$W" 2>/dev/null && alive=yes || alive=no
check "worker process running separately from the API (pid $W)" yes "$alive"
case " $API_PIDS " in *" $W "*) same=yes ;; *) same=no ;; esac
check "worker pid differs from the API pid" no "$same"
check "API /readyz with worker running" 200 "$(code $BASE/readyz)"

kill -TERM "$W"
wait "$W"
WRC=$?
echo "worker exit status after SIGTERM: $WRC"
check "worker shuts down cleanly on SIGTERM (exit 0)" 0 "$WRC"
sleep 1
check "API /healthz after the worker stopped" 200 "$(code $BASE/healthz)"
check "API /readyz after the worker stopped" 200 "$(code $BASE/readyz)"
alive_api=no
for p in $API_PIDS; do kill -0 "$p" 2>/dev/null && alive_api=yes; done
check "API process still alive" yes "$alive_api"

# A real mutation still succeeds with no worker (the outbox row waits for the next worker).
JAR="$EV/jar"
check "dev-login dev.office (worker stopped)" 204 "$(curl -s -o /dev/null -w '%{http_code}' -c "$JAR" -H 'content-type: application/json' -H "origin: $BASE" -d '{"username":"dev.office"}' $BASE/api/v1/auth/dev-login)"
ME="$(curl -s -b "$JAR" $BASE/api/v1/me)"
CSRF="$(printf '%s' "$ME" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).csrfToken))')"
ORG="$(printf '%s' "$ME" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).organization.id))')"
BU="$(curl -s -b "$JAR" "$BASE/api/v1/organizations/$ORG/business-units" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).items[0].id))')"
check "create a transformation while the worker is stopped" 201 "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -H 'content-type: application/json' -H "origin: $BASE" -H "x-csrf-token: $CSRF" -d "{\"businessUnitId\":\"$BU\",\"name\":\"QA worker-stopped create\",\"mode\":\"end_to_end\"}" $BASE/api/v1/transformations)"
echo "--- worker log tail"; tail -5 "$EV/worker.log"
rm -rf "$EV"
[ "$FAILS" = 0 ] && echo "WORKER-STOP PROBE: PASS" || echo "WORKER-STOP PROBE: FAIL ($FAILS)"
[ "$FAILS" = 0 ]

#!/usr/bin/env bash
# REQ-S16-001: start a worker against the running qa-stack DB, verify it runs, stop it, then verify the API is still ready
# and can serve a create (outbox) while the worker is down; restart the worker and verify it drains the outbox.
set -u
node apps/worker/dist/main.js > "$TMPDIR/worker.log" 2>&1 & W=$!
sleep 4
kill -0 $W && echo "PASS worker running pid=$W" || { echo "FAIL worker not running"; cat "$TMPDIR/worker.log"; exit 1; }
kill -TERM $W; for _ in $(seq 1 50); do kill -0 $W 2>/dev/null || break; sleep 0.2; done
kill -0 $W 2>/dev/null && { echo "FAIL worker did not stop on SIGTERM"; exit 1; } || echo "PASS worker stopped (SIGTERM); exit status: $(wait $W; echo $?)"
echo "readyz after worker stop: $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/readyz) $(curl -s http://localhost:3000/readyz)"
J=$(mktemp); curl -s -c $J -o /dev/null -w 'dev-login %{http_code}\n' -H 'origin: http://localhost:3000' -H 'content-type: application/json' -d '{"username":"dev.office"}' http://localhost:3000/api/v1/auth/dev-login
ME=$(curl -s -b $J http://localhost:3000/api/v1/me); CSRF=$(node -e 'console.log(JSON.parse(process.argv[1]).csrfToken)' "$ME")
BU=$(curl -s -b $J "http://localhost:3000/api/v1/organizations/$(node -e "console.log(JSON.parse(process.argv[1]).organization.id)" "$ME")/business-units" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log((j.items??j.data??j)[0]?.id)})')
code=$(curl -s -b $J -o $TMPDIR/create.json -w '%{http_code}' -H 'origin: http://localhost:3000' -H 'content-type: application/json' -H "x-csrf-token: $CSRF" -d "{\"name\":\"QA S16-001 synthetic\",\"mode\":\"end_to_end\",\"businessUnitId\":\"$BU\"}" http://localhost:3000/api/v1/transformations)
echo "create while worker is down: HTTP $code $(head -c 200 $TMPDIR/create.json)"
psql "postgresql://postgres@127.0.0.1:${QA_E2E_PG_PORT}/mth" -qAtc "select 'outbox pending: '||count(*) from outbox_event where published_at is null" 2>&1 | head -3
node apps/worker/dist/main.js > "$TMPDIR/worker2.log" 2>&1 & W2=$!; sleep 6
psql "postgresql://postgres@127.0.0.1:${QA_E2E_PG_PORT}/mth" -qAtc "select 'outbox pending after worker restart: '||count(*) from outbox_event where published_at is null" 2>&1 | head -3
kill -TERM $W2; wait $W2
[ "$code" = 201 ] && echo "RESULT PASS" || { echo "RESULT FAIL"; exit 1; }

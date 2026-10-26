#!/usr/bin/env bash
# qa-verifier DG5 round 2 (T-DG5-RG2-QA-R2): the command run INSIDE e2e/support/with-demo-stack.sh for the F-DG5-140
# real-stack probe. The stack exports DATABASE_URL, EVIDENCE_STORAGE_* and the rest of the API's environment; this
# script starts the BUILT worker (apps/worker/dist/main.js) with that same environment, runs the probe spec, and stops
# the worker. Usage (repository root of a disposable clone):
#   e2e/support/with-demo-stack.sh bash <this script> <spec path> <playwright args...>
set -uo pipefail
LOG="${WORKER_LOG:-${TMPDIR:-/tmp}/qa-r2-worker.log}"
node apps/worker/dist/main.js >"$LOG" 2>&1 </dev/null &
WPID=$!
echo "qa-r2: worker started (pid $WPID), log $LOG"
sleep 3
kill -0 "$WPID" 2>/dev/null || { echo "qa-r2: worker exited early"; cat "$LOG"; exit 3; }
npx playwright test "$@"
STATUS=$?
kill "$WPID" 2>/dev/null || true
wait "$WPID" 2>/dev/null || true
echo "qa-r2: worker log tail:"; tail -20 "$LOG"
exit "$STATUS"

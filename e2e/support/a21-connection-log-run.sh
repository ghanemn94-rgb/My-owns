#!/usr/bin/env bash
# qa-verifier A21 (DG6, T-DG6-QA-D): run Playwright specs on the REAL stack (apps/web/e2e/support/with-stack.sh) with
# the connection log (ADR-0059 §12) on for every Node process of the run (the API, migrate/seed, the Playwright
# runner), then check it with e2e/support/connection-log-check.ts. The log goes to QA_CONNECTION_LOG (default
# test-results/qa-a21-p6/connection-log.jsonl). QA_STACK names the stack script (default
# apps/web/e2e/support/with-stack.sh; e2e/support/with-demo-stack.sh for the guided-lifecycle specs on a demo database).
#   e2e/support/a21-connection-log-run.sh npx playwright test e2e/a21-p6-degradation.spec.ts --workers=1
# Exit: the Playwright status if it failed; else the checker's status (0 PASS, 1 a non-local destination, 3 BLOCKED).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
LOG="${QA_CONNECTION_LOG:-$ROOT/test-results/qa-a21-p6/connection-log.jsonl}"
mkdir -p "$(dirname "$LOG")"
: >"$LOG"
export MTH_CONNECTION_LOG="$LOG"
export NODE_OPTIONS="${NODE_OPTIONS:-} --import $ROOT/e2e/support/connection-log-preload.mjs"
set +e
"${QA_STACK:-apps/web/e2e/support/with-stack.sh}" "$@"
STATUS=$?
set -e
unset NODE_OPTIONS
echo "---- connection-log check"
set +e
node "$ROOT/e2e/support/connection-log-check.ts" "$LOG"
CHECK=$?
set -e
[ "$STATUS" -ne 0 ] && exit "$STATUS"
exit "$CHECK"

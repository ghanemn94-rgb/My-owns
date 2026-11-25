#!/usr/bin/env bash
# qa-verifier DG7 round 4, wave 2a (rv2): the A02 demo specs (62), the offline drill (63) and the keyboard walkthrough
# on the demo stack (64), both Playwright projects, one worker.
set -u
. "$(dirname "$0")/env.sh"
export QA_CLONE="$TMPDIR/rv2"
export E2E_PG_PORT=32552 E2E_API_PORT=32553
bash $S/run.sh 62-e2e-demo e2e/support/with-demo-stack.sh npx playwright test --workers=1 --trace=off --reporter=list e2e/a02-demo-labels.spec.ts e2e/a02-demo-users-walkthrough.spec.ts e2e/a02-guided-walkthrough.spec.ts
mkdir -p "$E/offline"
bash $S/run.sh 63-offline-drill deploy/scripts/offline-drill.sh --out "$E/offline"
export E2E_PG_PORT=32532 E2E_API_PORT=32533
bash $S/run.sh 64-e2e-keyboard-walkthrough-demo e2e/support/with-demo-stack.sh npx playwright test --workers=1 --trace=off --reporter=list apps/web/e2e/p6-walkthrough-keyboard.spec.ts
echo "w2-rv2 done $(date -u +%FT%TZ)"

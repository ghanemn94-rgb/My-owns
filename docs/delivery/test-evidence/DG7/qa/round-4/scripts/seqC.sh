#!/usr/bin/env bash
# qa-verifier DG7 round 4, sequence C (after seqA, in $TMPDIR/rv): Playwright product journeys and visual specs
# (apps/web/e2e) on the real stack (with-stack.sh), both projects (chromium-en LTR, chromium-ar RTL), one worker,
# Chromium from /opt/pw-browsers (never downloaded). Then the keyboard walkthrough spec on the demo stack.
# The A17 webhook signing secret is a random SYNTHETIC value generated here for this run only (never stored).
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG7/qa/round-4/scripts
R="bash $S/run.sh"
until grep -q 'seqA done' "$S/../seqA.out" 2>/dev/null; do sleep 20; done
MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET="qa-synthetic-$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
export MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET
E2E_PG_PORT=32530 E2E_API_PORT=32531 $R 60-e2e-product apps/web/e2e/support/with-stack.sh npx playwright test --workers=1 --trace=off --reporter=list apps/web/e2e
E2E_PG_PORT=32532 E2E_API_PORT=32533 $R 64-e2e-keyboard-walkthrough-demo e2e/support/with-demo-stack.sh npx playwright test --workers=1 --trace=off --reporter=list apps/web/e2e/p6-walkthrough-keyboard.spec.ts
echo "seqC done $(date -u +%FT%TZ)"

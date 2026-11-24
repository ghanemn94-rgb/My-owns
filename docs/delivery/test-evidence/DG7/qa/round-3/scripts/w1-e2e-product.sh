#!/usr/bin/env bash
# qa-verifier DG7 round 3, wave 1d (rv): product journeys and visual specs (apps/web/e2e) on the real stack, both
# projects (chromium-en LTR, chromium-ar RTL), one worker; Chromium from /opt/pw-browsers (never downloaded).
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG7/qa/round-3/scripts
MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET="qa-synthetic-$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
export MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET
E2E_PG_PORT=32530 E2E_API_PORT=32531 bash $S/run.sh 60-e2e-product apps/web/e2e/support/with-stack.sh npx playwright test --workers=1 --trace=off --reporter=list apps/web/e2e
echo "w1-e2e-product done $(date -u +%FT%TZ)"

#!/usr/bin/env bash
# qa-verifier DG7 round 1, sequence C: Playwright e2e on the disposable clone, both projects (chromium-en LTR,
# chromium-ar RTL), one worker, Chromium from /opt/pw-browsers (never downloaded).
#  60 product journeys and visual specs (apps/web/e2e) on the real stack (with-stack.sh)
#  61 root acceptance specs except the demo ones (e2e/a03..a22), on the real stack with the A21 connection log
#  62 demo acceptance specs (e2e/a02-*) on the demo stack
# The A17 webhook signing secret is a random SYNTHETIC value generated here for this run only (never stored).
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG7/qa/round-1/scripts
E=/home/user/My-owns/docs/delivery/test-evidence/DG7/qa/round-1
R="bash $S/run.sh"
cd "$TMPDIR/rv" || exit 2
MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET="qa-synthetic-$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
export MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET
export E2E_PG_PORT=32530 E2E_API_PORT=32531
$R 60-e2e-product apps/web/e2e/support/with-stack.sh npx playwright test --workers=1 --trace=off --reporter=list apps/web/e2e
# 11:06Z: the root (61) and demo (62) runs were moved to seqC2.sh in a second clone ($TMPDIR/rv2) so that they run
# in parallel and inside this run's 2-hour background limit; this sequence ends after 60.
exit 0

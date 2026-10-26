#!/usr/bin/env bash
# domain-reviewer DG5 r2: root acceptance e2e specs in the disposable clone (660f40c), demo stack then production stack.
set -uo pipefail
EV=/home/user/My-owns/docs/delivery/test-evidence/DG5/domain/round-2
cd "$TMPDIR/review-dg5"
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers MTH_PORT_POOL=26484-26499
export E2E_SCREENSHOT_DIR="$TMPDIR/e2e-shots" QA_EVIDENCE_DIR="$TMPDIR/qa-ev"
echo "### $(date -u +%FT%TZ) load=$(cut -d' ' -f1-3 /proc/loadavg) HEAD $(git rev-parse HEAD) DEMO stack"
E2E_PG_PORT=26480 E2E_API_PORT=26481 e2e/support/with-demo-stack.sh npx playwright test e2e/a02-demo-users-walkthrough.spec.ts e2e/a02-demo-labels.spec.ts e2e/a21-no-ai-operation.spec.ts --workers=1 --reporter=list
echo "### demo exit=$? $(date -u +%FT%TZ)"
echo "### $(date -u +%FT%TZ) load=$(cut -d' ' -f1-3 /proc/loadavg) PRODUCTION stack"
E2E_PG_PORT=26482 E2E_API_PORT=26483 apps/web/e2e/support/with-stack.sh npx playwright test e2e/a06-configuration-change.spec.ts e2e/a07-historical-integrity.spec.ts e2e/a15-reporting.spec.ts e2e/a16-health-launch.spec.ts apps/web/e2e/p5-dependency-slip-impact.spec.ts apps/web/e2e/p5-reader-branding-demo.spec.ts --workers=1 --reporter=list
echo "### prod exit=$? $(date -u +%FT%TZ)"

#!/bin/bash
# targeted e2e on the disposable clone (Node 24, pre-installed Chromium), ports in 32451-32499
set -u
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers MTH_PORT_POOL=32451-32499 E2E_PG_PORT=32470 E2E_API_PORT=32480 QA_PG_PORT=32470
export E2E_SCREENSHOT_DIR=$TMPDIR/shots
mkdir -p $E2E_SCREENSHOT_DIR
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/code-security/round-3
cd $TMPDIR/rv
hdr() { echo "# $(date -u +%FT%TZ) $1 (\$TMPDIR/rv at $(git rev-parse --short=9 HEAD); Node $(node -v); E2E_SCREENSHOT_DIR=\$TMPDIR/shots; load $(cut -d' ' -f1-3 /proc/loadavg))"; }
pw() { "$@" 2>&1 | grep -v "mth-db migrate: applying"; echo "exit=${PIPESTATUS[0]}"; echo "# end $(date -u +%FT%TZ) load $(cut -d' ' -f1-3 /proc/loadavg)"; }
{ hdr "apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/p6-assistant.spec.ts --workers=1"
  pw apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/p6-assistant.spec.ts --workers=1; } > $E/50-e2e-p6-assistant.log
{ hdr "e2e/support/qa-stack.sh npx playwright test e2e/a12-p6-scope-isolation.spec.ts e2e/a21-no-ai-operation.spec.ts --workers=1"
  pw e2e/support/qa-stack.sh npx playwright test e2e/a12-p6-scope-isolation.spec.ts e2e/a21-no-ai-operation.spec.ts --workers=1; } > $E/52-e2e-a12-a21.log
{ hdr "e2e/support/a21-connection-log-run.sh npx playwright test e2e/a21-p6-degradation.spec.ts --workers=1"
  pw e2e/support/a21-connection-log-run.sh npx playwright test e2e/a21-p6-degradation.spec.ts --workers=1; } > $E/53-e2e-a21-connection-log.log
export MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET=qa-a17-synthetic-signing-secret-0001
{ hdr "e2e/support/qa-stack.sh npx playwright test e2e/a17-failing-connector-exception.spec.ts e2e/a14-compare-reapply.spec.ts --workers=1 (MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET = the synthetic test value)"
  pw e2e/support/qa-stack.sh npx playwright test e2e/a17-failing-connector-exception.spec.ts e2e/a14-compare-reapply.spec.ts --workers=1; git status --short; } > $E/54-e2e-a17-a14.log
echo E2E-DONE >> $E/54-e2e-a17-a14.log

#!/bin/bash
set -u
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers MTH_PORT_POOL=32651-32699 E2E_PG_PORT=32670 E2E_API_PORT=32660 QA_PG_PORT=32670
export E2E_SCREENSHOT_DIR=$TMPDIR/shots
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/code-security/round-2
cd $TMPDIR/rv
hdr() { echo "# $(date -u +%FT%TZ) $1 (\$TMPDIR/rv at $(git rev-parse --short=9 HEAD); Node $(node -v); E2E_SCREENSHOT_DIR=\$TMPDIR/shots; load $(cut -d' ' -f1-3 /proc/loadavg))"; }
{ hdr "e2e/support/qa-stack.sh npx playwright test e2e/a12-p6-scope-isolation.spec.ts e2e/a21-no-ai-operation.spec.ts --workers=1"
  e2e/support/qa-stack.sh npx playwright test e2e/a12-p6-scope-isolation.spec.ts e2e/a21-no-ai-operation.spec.ts --workers=1 2>&1 | grep -v "mth-db migrate: applying"; echo "exit=${PIPESTATUS[0]}"; echo "# end $(date -u +%FT%TZ) load $(cut -d' ' -f1-3 /proc/loadavg)"; } > $E/52-e2e-a12-a21.log
{ hdr "e2e/support/a21-connection-log-run.sh npx playwright test e2e/a21-p6-degradation.spec.ts --workers=1"
  e2e/support/a21-connection-log-run.sh npx playwright test e2e/a21-p6-degradation.spec.ts --workers=1 2>&1 | grep -v "mth-db migrate: applying"; echo "exit=${PIPESTATUS[0]}"; echo "# end $(date -u +%FT%TZ)"; git status --short; } > $E/53-e2e-a21-connection-log.log
echo E2E2-DONE >> $E/53-e2e-a21-connection-log.log

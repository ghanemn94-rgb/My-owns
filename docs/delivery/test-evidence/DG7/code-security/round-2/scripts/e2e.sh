#!/bin/bash
# F-DG7-913: the T-E25 Retention e2e spec in both languages, against the built SPA + API + disposable PostgreSQL
set -u
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
export E2E_PG_PORT=32461 E2E_API_PORT=32462 MTH_PORT_POOL=32463-32499
E=/home/user/My-owns/docs/delivery/test-evidence/DG7/code-security/round-2
cd $TMPDIR/rv
{ echo "# $(date -u +%FT%TZ) with-stack.sh playwright test apps/web/e2e/p7-retention.spec.ts (Node $(node -v), cwd \$TMPDIR/rv at $(git rev-parse --short=9 HEAD), dist built by setup.sh, load $(cut -d' ' -f1-3 /proc/loadavg))"
  apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/p7-retention.spec.ts --trace off --reporter=list 2>&1 | grep -v "^npm warn" | tail -30; echo "exit=${PIPESTATUS[0]}"; echo "# end $(date -u +%FT%TZ)"; } > $E/31-e2e-retention.log

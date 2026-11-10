#!/bin/bash
# targeted e2e on the disposable clone (Node 24, pre-installed Chromium), ports 32660+ (API) / 32670+ (PG)
set -u
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers MTH_PORT_POOL=32651-32699 E2E_PG_PORT=32670 E2E_API_PORT=32660
export E2E_SCREENSHOT_DIR=$TMPDIR/shots
mkdir -p $E2E_SCREENSHOT_DIR
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/code-security/round-2
cd $TMPDIR/rv
hdr() { echo "# $(date -u +%FT%TZ) $1 (\$TMPDIR/rv at $(git rev-parse --short=9 HEAD); Node $(node -v); E2E_SCREENSHOT_DIR=\$TMPDIR/shots; load $(cut -d' ' -f1-3 /proc/loadavg))"; }
{ hdr "apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/p4-benefits.spec.ts apps/web/e2e/p6-assistant.spec.ts --workers=1"
  apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/p4-benefits.spec.ts apps/web/e2e/p6-assistant.spec.ts --workers=1 2>&1 | grep -v "mth-db migrate: applying"; echo "exit=${PIPESTATUS[0]}"; echo "# end $(date -u +%FT%TZ) load $(cut -d' ' -f1-3 /proc/loadavg)"; } > $E/50-e2e-p4-benefits-p6-assistant.log
cp /home/user/My-owns/docs/delivery/test-evidence/DG6/domain/round-1/probes/zz-domain-demo-probe.spec.ts e2e/
{ hdr "F-DG6-900 round-1 reproduction (the domain reviewer's round-1 probe, unedited): e2e/support/with-demo-stack.sh npx playwright test e2e/zz-domain-demo-probe.spec.ts --workers=1"
  e2e/support/with-demo-stack.sh npx playwright test e2e/zz-domain-demo-probe.spec.ts --workers=1 2>&1 | grep -v "mth-db migrate: applying"; echo "exit=${PIPESTATUS[0]}"; echo "# end $(date -u +%FT%TZ) load $(cut -d' ' -f1-3 /proc/loadavg)"; } > $E/51-e2e-f900-domain-probe-demo-stack.log
rm -f e2e/zz-domain-demo-probe.spec.ts
mkdir -p $E/screenshots
for l in en ar; do for f in $E2E_SCREENSHOT_DIR/$l/dom-d1-benefit-realized-explained.png $E2E_SCREENSHOT_DIR/$l/p4ben-09c-explanation-panel.png; do [ -f $f ] && cp $f $E/screenshots/$l-$(basename $f); done; done
ls -la $E/screenshots >> $E/51-e2e-f900-domain-probe-demo-stack.log
git status --short >> $E/51-e2e-f900-domain-probe-demo-stack.log
echo E2E-DONE >> $E/51-e2e-f900-domain-probe-demo-stack.log

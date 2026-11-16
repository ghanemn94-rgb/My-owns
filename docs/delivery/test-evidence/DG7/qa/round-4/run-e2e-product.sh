#!/usr/bin/env bash
# qa-verifier DG7 round 4: product e2e (apps/web/e2e) in both locales, then the demo keyboard spec, in the clone.
set -u; cd "${QA_REPO:?}"; E="${QA_E:?}"; export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
for p in chromium-en chromium-ar; do
  echo "$p start $(date -u +%T)"
  env -u LANG -u LC_ALL E2E_PG_PORT=32520 E2E_API_PORT=32521 MTH_PORT_POOL=32522-32529 apps/web/e2e/support/with-stack.sh \
    npx playwright test apps/web/e2e --project=$p --workers=1 --trace=off --reporter=list --output=$TMPDIR/pw-out-$p > "$E/10-e2e-$p.log" 2>&1
  echo "$p exit $? $(date -u +%T)"; rm -rf "$TMPDIR/pw-out-$p"
done
echo "demo keyboard start $(date -u +%T)"
env -u LANG -u LC_ALL E2E_PG_PORT=32520 E2E_API_PORT=32521 MTH_PORT_POOL=32522-32529 e2e/support/with-demo-stack.sh \
  npx playwright test apps/web/e2e/p6-walkthrough-keyboard.spec.ts --workers=1 --trace=off --reporter=list --output=$TMPDIR/pw-out-kb > "$E/10-e2e-demo-keyboard.log" 2>&1
echo "demo keyboard exit $? $(date -u +%T)"; rm -rf "$TMPDIR/pw-out-kb"

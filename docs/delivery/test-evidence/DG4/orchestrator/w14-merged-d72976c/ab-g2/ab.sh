#!/bin/bash
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
cd /home/user/wt/verify
for c in 97e16dd d72976c1c01f8a26782bf52ee47e8d1632ddb1a7 97e16dd d72976c1c01f8a26782bf52ee47e8d1632ddb1a7; do
  git checkout -q --detach $c && pnpm install --frozen-lockfile --offline >/dev/null 2>&1 && pnpm -r build >/dev/null 2>&1
  echo "== $c built $(date -u +%T) load $(cut -d' ' -f1 /proc/loadavg)"
  env -u LANG -u LC_ALL -u LC_CTYPE QA_PG_PORT=24550 E2E_API_PORT=24551 MTH_PORT_POOL=24552-24590 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/p2-journeys.spec.ts --workers=1 --project=chromium-en 2>&1 | grep -E "Define → G2|[0-9]+ passed|[0-9]+ failed"
done
echo ABDONE

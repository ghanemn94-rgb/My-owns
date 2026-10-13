#!/usr/bin/env bash
# domain-reviewer DG4 round 9: targeted unit test files for the re-verified findings (load envelope: no pnpm test, no integration, no e2e).
# Read-only node_modules copy in the clone; Vitest config loader needs --configLoader runner (QA-A's finding).
set -u
cd "$TMPDIR/review-r9"; export PATH=/opt/nvm/versions/node/v24.21.0/bin:/usr/bin:/bin
E=/home/user/My-owns/docs/delivery/test-evidence/DG4/domain/round-9
echo "### node $(node -v) HEAD $(git rev-parse HEAD) load=$(cut -d' ' -f1-3 /proc/loadavg)"
echo "### unit-node: F-DG4-121/123/126/127 (benefits totals, value basis, areas), F-DG4-128 (config load)"
npx vitest run --configLoader runner --project unit-node apps/api/src/modules/benefits/totals.test.ts apps/api/src/modules/reporting/dashboards/n4-value-basis.test.ts apps/api/src/modules/reporting/dashboards/areas.test.ts packages/config/src/load.test.ts 2>&1; echo "### exit=$? load=$(cut -d' ' -f1-3 /proc/loadavg)"
echo "### unit-web: F-DG4-120 (governance T11 notice), F-DG4-121 (benefits labels), F-DG4-122/125 (percentKpi, kpiUnit), F-DG4-123 (valueHeadlines), F-DG4-126/127 (n4Value)"
npx vitest run --configLoader runner --project unit-web apps/web/src/pages/raci/governance.test.tsx apps/web/src/pages/benefits/benefits.test.tsx apps/web/src/pages/dashboards/percentKpi.test.tsx apps/web/src/pages/dashboards/kpiUnit.test.tsx apps/web/src/pages/dashboards/valueHeadlines.test.tsx apps/web/src/pages/dashboards/n4Value.test.tsx 2>&1; echo "### exit=$? load=$(cut -d' ' -f1-3 /proc/loadavg)"

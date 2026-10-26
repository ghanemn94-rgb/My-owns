#!/usr/bin/env bash
# domain-reviewer DG5 r2: provenance/claim and DG0-DG7 text scans, scoring units and the round-1->2 reporting units, in the clone.
set -uo pipefail
cd "$TMPDIR/review-dg5"
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH QA_PG_PORT=26415 MTH_PORT_POOL=26416-26429
echo "### $(date -u +%FT%TZ) load=$(cut -d' ' -f1-3 /proc/loadavg) HEAD $(git rev-parse HEAD)"
npx vitest run --configLoader runner --project unit-node tests/qa/unit/a22-s21-001-text-scan.test.ts packages/shared/src/text-scan/text-scan.test.ts \
  packages/shared/src/health/scoring.test.ts packages/shared/src/scoring.test.ts packages/reporting/src/labels.test.ts packages/reporting/src/xml-chars.test.ts 2>&1
echo "### unit exit=$?"
tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration apps/api/test/integration/text-scan/export-templates.test.ts apps/api/test/integration/text-scan/ui-strings.test.ts apps/api/test/integration/branding/branding.test.ts 2>&1
echo "### integration exit=$? $(date -u +%FT%TZ)"

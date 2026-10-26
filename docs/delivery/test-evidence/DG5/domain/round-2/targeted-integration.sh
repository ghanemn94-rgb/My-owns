#!/usr/bin/env bash
# domain-reviewer DG5 round 2: the DG5 acceptance suites and the domain-relevant implementer integration tests,
# on a disposable PostgreSQL (tests/qa/support/with-pg.sh), in the clone at 660f40c. Ports 26400-26499.
set -uo pipefail
cd "$TMPDIR/review-dg5"
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH QA_PG_PORT=26410 MTH_PORT_POOL=26411-26449
echo "### $(date -u +%FT%TZ) load=$(cut -d' ' -f1-3 /proc/loadavg) HEAD $(git rev-parse HEAD) node $(node -v)"
tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration \
  tests/qa/integration/a02-a21-complete-lifecycle.test.ts tests/qa/integration/a06-configuration-change.test.ts \
  tests/qa/integration/a07-historical-integrity.test.ts tests/qa/integration/a13-dependency-slip-rule-b.test.ts \
  tests/qa/integration/a13-starters-run.test.ts tests/qa/integration/a13-starter-jobs.test.ts \
  tests/qa/integration/a15-demo-transformation-outputs.test.ts tests/qa/integration/a15-outputs-every-definition.test.ts \
  tests/qa/integration/a15-selected-records-and-injection.test.ts tests/qa/integration/a15-snapshots-and-packs.test.ts \
  tests/qa/integration/a16-health-check.test.ts tests/qa/integration/a16-launch-plan.test.ts \
  tests/qa/integration/a22-operational-readiness.test.ts \
  apps/api/test/integration/methodology/reader-search-provenance.test.ts apps/api/test/integration/environment/demo-traceability-chains.test.ts \
  packages/db/test/integration/demo-roaming.test.ts apps/api/test/integration/navigation/navigation.test.ts \
  apps/api/test/integration/methodology/scoring-defaults.test.ts apps/api/test/integration/methodology/studio-review-publish.test.ts \
  apps/api/test/integration/methodology/methodology-migrations.test.ts apps/api/test/integration/benefits/financial-metrics.test.ts \
  apps/api/test/integration/kpi/formula-preview.test.ts apps/api/test/integration/workflows/approval-routes.test.ts \
  apps/api/test/integration/procedures/adopted-step-authorization.test.ts apps/api/test/integration/automation/dependency-slip-relay.test.ts \
  apps/api/test/integration/reporting/owner-updates.test.ts apps/api/test/integration/branding/branding.test.ts \
  apps/api/test/integration/methodology/playbook-blocks.test.ts apps/api/test/integration/procedures/coverage.test.ts \
  apps/api/test/integration/workflows/gate-conditions.test.ts apps/api/test/integration/environment/demo-pending-approval.test.ts apps/api/test/integration/reporting/exports-xml-chars.test.ts \
  2>&1
echo "### exit=$?  $(date -u +%FT%TZ)"

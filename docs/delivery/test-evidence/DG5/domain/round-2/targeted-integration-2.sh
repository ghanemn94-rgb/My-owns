#!/usr/bin/env bash
# domain-reviewer DG5 round 2, batch 2: the remaining DG5 rows' integration suites (forms, procedures, Studio checks,
# automation durability/failures, notification timing, evidence register, entity groups, demo isolation, restatement),
# on a disposable PostgreSQL in the clone at 660f40c. Ports 26430-26449.
set -uo pipefail
cd "$TMPDIR/review-dg5"
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH QA_PG_PORT=26430 MTH_PORT_POOL=26431-26449
echo "### $(date -u +%FT%TZ) load=$(cut -d' ' -f1-3 /proc/loadavg) HEAD $(git rev-parse HEAD) node $(node -v)"
tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration \
  apps/api/test/integration/forms/form-framework.test.ts apps/api/test/integration/forms/form-records.test.ts \
  apps/api/test/integration/forms/form-schemas.test.ts apps/api/test/integration/forms/form-bulk-registers.test.ts \
  apps/api/test/integration/procedures/procedure-definitions.test.ts apps/api/test/integration/procedures/procedure-instances.test.ts \
  apps/api/test/integration/methodology/studio-checks.test.ts apps/api/test/integration/automation/automation-failures.test.ts \
  apps/api/test/integration/tasks/notification-delivery.test.ts apps/api/test/integration/evidence/evidence-register.test.ts \
  apps/api/test/integration/methodology/entity-group.test.ts apps/api/test/integration/procedures/entity-group.test.ts \
  apps/api/test/integration/health/s16-021-group.test.ts tests/qa/integration/a16-s16-021-entities.test.ts \
  tests/qa/integration/a13-durable-automation.test.ts tests/qa/integration/a13-job-idempotency.test.ts tests/qa/integration/a13-jobs-rerun.test.ts \
  apps/worker/test/integration/gate-condition-escalation.test.ts apps/worker/test/integration/starters.test.ts \
  apps/api/test/integration/reporting/exports-paged.test.ts apps/api/test/integration/reporting/table-totals-demo.test.ts \
  apps/api/test/integration/kpi-restatements/decisions.test.ts \
  packages/db/test/integration/demo.test.ts packages/db/test/integration/demo-dev-binding.test.ts \
  2>&1
echo "### exit=$?  $(date -u +%FT%TZ)"

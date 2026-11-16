#!/usr/bin/env bash
# qa-verifier DG7 round 6: root acceptance specs (A03-A22) on the real stack with the A21 connection log, in the clone.
# The A17 webhook signing secret is random per run and never written.
set -u; cd "${QA_REPO:?}"; E="${QA_E:?}"; export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
SPECS="e2e/a03-modular-entry.spec.ts e2e/a04-kpi-update.spec.ts e2e/a06-configuration-change.spec.ts e2e/a07-historical-integrity.spec.ts e2e/a08-a09-gates-decisions.spec.ts e2e/a12-p6-scope-isolation.spec.ts e2e/a13-automation-recovery.spec.ts e2e/a13-connector-run-once.spec.ts e2e/a14-compare-reapply.spec.ts e2e/a15-reporting.spec.ts e2e/a16-health-launch.spec.ts e2e/a17-failing-connector-exception.spec.ts e2e/a17-import-and-integration.spec.ts e2e/a20-bilingual-shell.spec.ts e2e/a20-p6-axe.spec.ts e2e/a20-p6-layout-brand.spec.ts e2e/a20-p6-ux.spec.ts e2e/a20-s15-014-term-scan.spec.ts e2e/a21-no-ai-operation.spec.ts e2e/a21-p6-degradation.spec.ts e2e/a22-operations-jobs.spec.ts e2e/a22-p6-operability.spec.ts"
date -u; echo "specs: $SPECS"
echo '$ env -u LANG -u LC_ALL MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET=<random, not recorded> QA_CONNECTION_LOG=$TMPDIR/conn-root.jsonl E2E_PG_PORT=32530 E2E_API_PORT=32531 MTH_PORT_POOL=32532-32539 e2e/support/a21-connection-log-run.sh npx playwright test $SPECS --workers=1 --trace=off --reporter=list --output=$TMPDIR/pw-root'
MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET="$(head -c 32 /dev/urandom | base64 | tr -dc A-Za-z0-9)" \
env -u LANG -u LC_ALL QA_CONNECTION_LOG=$TMPDIR/conn-root.jsonl E2E_PG_PORT=32530 E2E_API_PORT=32531 MTH_PORT_POOL=32532-32539 \
  e2e/support/a21-connection-log-run.sh npx playwright test $SPECS --workers=1 --trace=off --reporter=list --output=$TMPDIR/pw-root
rc=$?; echo "root acceptance exit $rc $(date -u +%T)"; rm -rf "$TMPDIR/pw-root" "$TMPDIR/conn-root.jsonl"; exit $rc

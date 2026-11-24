#!/usr/bin/env bash
# qa-verifier DG7 round 3, sequence E (after seqA, in $TMPDIR/rv): tool test suites (fixtures only), backup-restore
# tests T-E1..T-E13 (DO-D12's T-E13 for F-DG7-1053) under with-pg.sh, the A19 restore drill (container-free half) and
# the production-init/dictionary check (REQ-S19-005).
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG7/qa/round-3/scripts
E=/home/user/My-owns/docs/delivery/test-evidence/DG7/qa/round-3
R="bash $S/run.sh"
$R 70-validator-tests node --test tools/gates/tests/validator.test.mjs
$R 71-sandbox-tests node --test tools/gates/tests/sandbox.test.mjs
MTH_PNPM_STORE="$TMPDIR/store" $R 72-release-tool-tests bash -c 'node --test tools/release/tests/*.test.mjs licenses/tests/*.test.mjs'
$R 73-deploy-tool-tests node --test deploy/scripts/tests/check-ci-needs.test.mjs deploy/scripts/tests/pin-images.test.mjs deploy/scripts/tests/log-scan.test.mjs deploy/scripts/tests/check-virtual-store.test.mjs deploy/scripts/tests/image-bundle.test.mjs deploy/scripts/tests/offline-drill.test.mjs deploy/scripts/tests/dockerfile-context.test.mjs
QA_PG_PORT=32544 $R 73b-backup-restore-tests bash tests/qa/support/with-pg.sh node --test deploy/scripts/tests/backup-restore.test.mjs
$R 73c-backup-compose-layout npx vitest run --configLoader runner deploy/scripts/tests/backup-compose-layout.vitest.mjs
QA_PG_PORT=32540 $R 74-transfer-drill-tests bash tests/qa/support/with-pg.sh node --test deploy/scripts/tests/transfer-drill.test.mjs
mkdir -p "$E/a19"
QA_PG_PORT=32542 $R 76-a19-restore-drill bash tests/qa/support/with-pg.sh bash -c 'deploy/scripts/restore-drill.sh --admin-url "$TEST_DATABASE_ADMIN_URL" --work "$TMPDIR/qa-a19-drill" --out '"$E/a19"'; rc=$?; rm -rf "$TMPDIR/qa-a19-drill"; exit $rc'
QA_PG_PORT=32546 $R 57-dictionary-and-init bash tests/qa/support/with-pg.sh bash $S/dictionary.sh
QA_PG_PORT=32512 $R 41-integration-tests-qa-cutf8 env LANG=C.UTF-8 LC_ALL=C.UTF-8 tests/qa/support/with-pg.sh npx vitest run --project integration tests/qa/integration
echo "seqE done $(date -u +%FT%TZ)"

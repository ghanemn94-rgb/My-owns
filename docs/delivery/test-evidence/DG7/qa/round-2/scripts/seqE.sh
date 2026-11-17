#!/usr/bin/env bash
# qa-verifier DG7 round 2, sequence E: tool test suites in the disposable clone $TMPDIR/rv (fixtures only), the A19
# drill and the production-init/dictionary check. backup-restore.test.mjs (T-E1..T-E12, DO-D11) runs under with-pg.sh.
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG7/qa/round-2/scripts
E=/home/user/My-owns/docs/delivery/test-evidence/DG7/qa/round-2
R="bash $S/run.sh"
$R 70-validator-tests node --test tools/gates/tests/validator.test.mjs
$R 71-sandbox-tests node --test tools/gates/tests/sandbox.test.mjs
MTH_PNPM_STORE="$TMPDIR/store" $R 72-release-tool-tests bash -c 'node --test tools/release/tests/*.test.mjs licenses/tests/*.test.mjs'
$R 73-deploy-tool-tests node --test deploy/scripts/tests/check-ci-needs.test.mjs deploy/scripts/tests/pin-images.test.mjs deploy/scripts/tests/log-scan.test.mjs deploy/scripts/tests/check-virtual-store.test.mjs deploy/scripts/tests/image-bundle.test.mjs deploy/scripts/tests/offline-drill.test.mjs deploy/scripts/tests/dockerfile-context.test.mjs
QA_PG_PORT=32544 $R 73b-backup-restore-tests bash tests/qa/support/with-pg.sh node --test deploy/scripts/tests/backup-restore.test.mjs
QA_PG_PORT=32540 $R 74-transfer-drill-tests bash tests/qa/support/with-pg.sh node --test deploy/scripts/tests/transfer-drill.test.mjs
mkdir -p "$E/a19"
QA_PG_PORT=32542 $R 76-a19-restore-drill bash tests/qa/support/with-pg.sh bash -c 'deploy/scripts/restore-drill.sh --admin-url "$TEST_DATABASE_ADMIN_URL" --work "$TMPDIR/qa-a19-drill" --out '"$E/a19"'; rc=$?; rm -rf "$TMPDIR/qa-a19-drill"; exit $rc'
QA_PG_PORT=32546 $R 57-dictionary-and-init bash tests/qa/support/with-pg.sh bash $S/dictionary.sh
echo "seqE done $(date -u +%FT%TZ)"

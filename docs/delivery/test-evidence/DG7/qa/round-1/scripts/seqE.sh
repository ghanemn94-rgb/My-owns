#!/usr/bin/env bash
# qa-verifier DG7 round 1, sequence E: tool test suites in the disposable clone (fixtures only), then the A19 drill.
#  70 validator self-tests (A23/A24/A25/A28 validator tests), 71 sandbox tests
#  72 release-tool and licence tests, 73 deploy-tool tests (node --test), 74 transfer-drill tests (with-pg)
#  75 deploy vitest files (dep-audit, load, log-scan) through vitest's unit-node project if they belong to it
#  76 A19 restore drill (container-free half) on a disposable cluster
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG7/qa/round-1/scripts
E=/home/user/My-owns/docs/delivery/test-evidence/DG7/qa/round-1
R="bash $S/run.sh"
$R 70-validator-tests node --test tools/gates/tests/validator.test.mjs
$R 71-sandbox-tests node --test tools/gates/tests/sandbox.test.mjs
$R 72-release-tool-tests bash -c 'node --test tools/release/tests/*.test.mjs licenses/tests/*.test.mjs'
$R 73-deploy-tool-tests node --test deploy/scripts/tests/check-ci-needs.test.mjs deploy/scripts/tests/pin-images.test.mjs deploy/scripts/tests/log-scan.test.mjs deploy/scripts/tests/check-virtual-store.test.mjs deploy/scripts/tests/image-bundle.test.mjs deploy/scripts/tests/offline-drill.test.mjs deploy/scripts/tests/dockerfile-context.test.mjs deploy/scripts/tests/backup-restore.test.mjs
QA_PG_PORT=32540 $R 74-transfer-drill-tests bash tests/qa/support/with-pg.sh node --test deploy/scripts/tests/transfer-drill.test.mjs
mkdir -p "$E/a19"
QA_PG_PORT=32542 $R 76-a19-restore-drill bash tests/qa/support/with-pg.sh bash -c 'deploy/scripts/restore-drill.sh --admin-url "$TEST_DATABASE_ADMIN_URL" --work "$TMPDIR/qa-a19-drill" --out '"$E/a19"'; rc=$?; rm -rf "$TMPDIR/qa-a19-drill"; exit $rc'
echo "seqE done $(date -u +%FT%TZ)"

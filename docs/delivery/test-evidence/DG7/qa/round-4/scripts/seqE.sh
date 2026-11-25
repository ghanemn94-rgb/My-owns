#!/usr/bin/env bash
# qa-verifier DG7 round 4, sequence E (in $TMPDIR/rv, after the build): tool test suites (fixtures only), the
# backup-restore tests T-E1..T-E14c under with-pg.sh, the Compose layout tests, the transfer-drill tests, the A19
# restore drill (container-free half), production-init/dictionary (REQ-S19-005), handover tools with the rg4 report.
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG7/qa/round-4/scripts
E=/home/user/My-owns/docs/delivery/test-evidence/DG7/qa/round-4
R="bash $S/run.sh"
$R 70-validator-tests node --test tools/gates/tests/validator.test.mjs
$R 71-sandbox-tests node --test tools/gates/tests/sandbox.test.mjs
QA_PG_PORT=32544 $R 73b-backup-restore-tests bash tests/qa/support/with-pg.sh node --test deploy/scripts/tests/backup-restore.test.mjs
$R 73c-backup-compose-layout npx vitest run --configLoader runner deploy/scripts/tests/backup-compose-layout.vitest.mjs
$R 73-deploy-tool-tests node --test deploy/scripts/tests/check-ci-needs.test.mjs deploy/scripts/tests/pin-images.test.mjs deploy/scripts/tests/log-scan.test.mjs deploy/scripts/tests/check-virtual-store.test.mjs deploy/scripts/tests/image-bundle.test.mjs deploy/scripts/tests/offline-drill.test.mjs deploy/scripts/tests/dockerfile-context.test.mjs
mkdir -p "$E/a19"
QA_PG_PORT=32542 $R 76-a19-restore-drill bash tests/qa/support/with-pg.sh bash -c 'deploy/scripts/restore-drill.sh --admin-url "$TEST_DATABASE_ADMIN_URL" --work "$TMPDIR/qa-a19-drill" --out '"$E/a19"'; rc=$?; rm -rf "$TMPDIR/qa-a19-drill"; exit $rc'
QA_PG_PORT=32546 $R 57-dictionary-and-init bash tests/qa/support/with-pg.sh bash $S/dictionary.sh
RP=/home/user/My-owns/docs/delivery/test-evidence/DG7/orchestrator/protocol-audit/protocol-audit-rg4.json
$R 54-handover-tools bash -c 'echo "## claims-scan"; node tools/release/claims-scan.mjs 2>&1 | tail -3; echo "exit=${PIPESTATUS[0]}"; echo "## check-handover (strict, the rg4 report)"; MTH_STRICT_HANDOVER=1 node tools/release/check-handover.mjs --protocol-audit '"$RP"' 2>&1 | tail -14; echo "exit=${PIPESTATUS[0]}"; echo "## release-notes --check"; node tools/release/release-notes.mjs --csv docs/delivery/requirements.csv --deps docs/handover/external-dependencies.json --provisional apps/web/src/i18n --out docs/handover/release-notes.md --check 2>&1 | tail -3; echo "exit=${PIPESTATUS[0]}"; echo "## known-limitations --check"; node tools/release/known-limitations.mjs --protocol-audit '"$RP"' --check 2>&1 | tail -3; echo "exit=${PIPESTATUS[0]}"'
QA_PG_PORT=32540 $R 74-transfer-drill-tests bash tests/qa/support/with-pg.sh node --test deploy/scripts/tests/transfer-drill.test.mjs
MTH_PNPM_STORE="$TMPDIR/store" $R 72-release-tool-tests bash -c 'node --test tools/release/tests/*.test.mjs licenses/tests/*.test.mjs'
echo "seqE done $(date -u +%FT%TZ)"

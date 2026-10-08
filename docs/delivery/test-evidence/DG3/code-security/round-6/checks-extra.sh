#!/usr/bin/env bash
# code-security-reviewer DG3 round-6 follow-up harness. Runs AFTER checks.sh, in the same disposable clone $TMPDIR/review-p6
# at 36411df (built by checks.sh). Probe files are run UNCHANGED from their committed paths (sha256 printed), copied into
# the clone and removed afterwards (git status printed at the end).
#  1. probe C (round-1 formula fuzz with the exact oracle) in unit-node AND in unit-formula-nocodegen (with
#     codegen.nocodegen.test.ts), Node 22 and Node 24: the engine's formula results are unchanged.
#  2. probes A (AUD-403 sweep), B (integrity), D (inherited approval), the round-3 CSP probe and the round-4 API EvalError
#     probe revision 2 on throwaway PostgreSQL: Node 22 with LANG/LC_ALL/LC_CTYPE unset (port 26330), Node 24 with
#     LANG=C.UTF-8 (port 26332).
EV=/home/user/My-owns/docs/delivery/test-evidence/DG3/code-security/round-6
PR3=/home/user/My-owns/docs/delivery/test-evidence/DG3/code-security/round-3/probes
PR4=/home/user/My-owns/docs/delivery/test-evidence/DG3/code-security/round-4/probes
cd $TMPDIR/review-p6 || exit 2
N22=/opt/node22/bin; N24=/opt/nvm/versions/node/v24.21.0/bin
run() { # name env-path cmd...
  local name=$1 p=$2; shift 2
  { echo "# command: $*"; echo "# node: $(PATH=$p:$PATH node --version)  commit: $(git rev-parse HEAD)  LANG=${LANG-<unset>} LC_ALL=${LC_ALL-<unset>} LC_CTYPE=${LC_CTYPE-<unset>}  started: $(date -u +%FT%TZ)"; } > $EV/$name.log
  PATH=$p:$PATH "$@" >> $EV/$name.log 2>&1; local rc=$?
  echo "# exit_status: $rc  finished: $(date -u +%FT%TZ)" >> $EV/$name.log
  echo "$name $rc" >> $EV/summary-extra.txt
}
: > $EV/summary-extra.txt
sha256sum $PR3/sec-r1-formula-fuzz.test.ts $PR3/sec-r1-aud-sweep.test.ts $PR3/sec-r1-integrity.test.ts $PR3/sec-r2-inherited-approval.test.ts $PR3/sec-r3-csp.test.ts $PR4/sec-r4-evalerror-api-v2.test.ts >> $EV/summary-extra.txt
cp $PR3/sec-r1-formula-fuzz.test.ts packages/shared/src/formula/zz-sec-r1-fuzz.test.ts
run probe-C-unit-node-node22 $N22 pnpm exec vitest run --project unit-node packages/shared/src/formula/zz-sec-r1-fuzz.test.ts
run probe-C-nocodegen-node22 $N22 pnpm exec vitest run --project unit-formula-nocodegen packages/shared/src/formula/zz-sec-r1-fuzz.test.ts packages/shared/src/formula/codegen.nocodegen.test.ts
run probe-C-unit-node-node24 $N24 pnpm exec vitest run --project unit-node packages/shared/src/formula/zz-sec-r1-fuzz.test.ts
run probe-C-nocodegen-node24 $N24 pnpm exec vitest run --project unit-formula-nocodegen packages/shared/src/formula/zz-sec-r1-fuzz.test.ts packages/shared/src/formula/codegen.nocodegen.test.ts
rm -f packages/shared/src/formula/zz-sec-r1-fuzz.test.ts
mkdir -p apps/api/test/integration/zz-sec-r1 apps/api/test/integration/zz-sec-r2 apps/api/test/integration/zz-sec-r3 apps/api/test/integration/zz-sec-r4
cp $PR3/sec-r1-aud-sweep.test.ts $PR3/sec-r1-integrity.test.ts apps/api/test/integration/zz-sec-r1/
cp $PR3/sec-r2-inherited-approval.test.ts apps/api/test/integration/zz-sec-r2/
cp $PR3/sec-r3-csp.test.ts apps/api/test/integration/zz-sec-r3/
cp $PR4/sec-r4-evalerror-api-v2.test.ts apps/api/test/integration/zz-sec-r4/
Z="apps/api/test/integration/zz-sec-r1 apps/api/test/integration/zz-sec-r2 apps/api/test/integration/zz-sec-r3 apps/api/test/integration/zz-sec-r4"
( unset LANG LC_ALL LC_CTYPE; run probes-ABD-CSP-E-node22-lang-unset $N22 bash $EV/with-pg.sh 26330 pnpm exec vitest run --project integration $Z --reporter=verbose )
( unset LC_ALL LC_CTYPE; export LANG=C.UTF-8; run probes-ABD-CSP-E-node24-lang-c-utf8 $N24 bash $EV/with-pg.sh 26332 pnpm exec vitest run --project integration $Z --reporter=verbose )
rm -rf $Z
echo "git status --porcelain after cleanup: '$(git status --porcelain)'" >> $EV/summary-extra.txt
echo DONE >> $EV/summary-extra.txt

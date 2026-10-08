#!/usr/bin/env bash
# code-security-reviewer DG3 round-3 follow-up harness (T-DG3-REV-SEC-R3B). Runs AFTER checks.sh, in the same disposable
# clone $TMPDIR/review-r3b at ce988e20 (built by checks.sh), while no other probe loads the machine.
#  1. unit-node24-rerun: `pnpm test` on Node 24 again (checks.sh's Node 24 run failed one unit-web test under CPU load
#     from the reviewer's concurrent probes; that log is kept and disclosed).
#  2. unit-list-node22: the FIRST pnpm-test invocation with --reporter=verbose (pnpm passes extra args only to the second
#     command of the `test` script), to compare the per-test list with round 2 (1565 tests).
#  3. probe C (round-1 formula fuzz, unchanged) in unit-node AND in unit-formula-nocodegen, Node 22 and Node 24.
#  4. probes A (AUD sweep), B (integrity), D (inherited approval) and the round-3 CSP probe on throwaway PostgreSQL:
#     Node 22 with LANG/LC_ALL/LC_CTYPE unset (port 26310), Node 24 with LANG=C.UTF-8 (port 26312).
# Probe files are copied into the clone and removed afterwards (git status printed at the end).
EV=/home/user/My-owns/docs/delivery/test-evidence/DG3/code-security/round-3
PR=$EV/probes
cd $TMPDIR/review-r3b || exit 2
N22=/opt/node22/bin; N24=/opt/nvm/versions/node/v24.21.0/bin
run() { # name env-path cmd...
  local name=$1 p=$2; shift 2
  { echo "# command: $*"; echo "# node: $(PATH=$p:$PATH node --version)  commit: $(git rev-parse HEAD)  LANG=${LANG-<unset>} LC_ALL=${LC_ALL-<unset>} LC_CTYPE=${LC_CTYPE-<unset>}  started: $(date -u +%FT%TZ)"; } > $EV/$name.log
  PATH=$p:$PATH "$@" >> $EV/$name.log 2>&1; local rc=$?
  echo "# exit_status: $rc  finished: $(date -u +%FT%TZ)" >> $EV/$name.log
  echo "$name $rc" >> $EV/summary-extra.txt
}
: > $EV/summary-extra.txt
run unit-node24-rerun $N24 pnpm test --reporter=verbose
run unit-list-node22 $N22 pnpm exec vitest run --project unit-node --project unit-web --reporter=verbose
cp $PR/sec-r1-formula-fuzz.test.ts packages/shared/src/formula/zz-sec-r1-fuzz.test.ts
run probe-C-unit-node-node22 $N22 pnpm exec vitest run --project unit-node packages/shared/src/formula/zz-sec-r1-fuzz.test.ts
run probe-C-nocodegen-node22 $N22 pnpm exec vitest run --project unit-formula-nocodegen packages/shared/src/formula/zz-sec-r1-fuzz.test.ts packages/shared/src/formula/codegen.nocodegen.test.ts
run probe-C-unit-node-node24 $N24 pnpm exec vitest run --project unit-node packages/shared/src/formula/zz-sec-r1-fuzz.test.ts
run probe-C-nocodegen-node24 $N24 pnpm exec vitest run --project unit-formula-nocodegen packages/shared/src/formula/zz-sec-r1-fuzz.test.ts packages/shared/src/formula/codegen.nocodegen.test.ts
rm -f packages/shared/src/formula/zz-sec-r1-fuzz.test.ts
mkdir -p apps/api/test/integration/zz-sec-r1 apps/api/test/integration/zz-sec-r2 apps/api/test/integration/zz-sec-r3
cp $PR/sec-r1-aud-sweep.test.ts $PR/sec-r1-integrity.test.ts apps/api/test/integration/zz-sec-r1/
cp $PR/sec-r2-inherited-approval.test.ts apps/api/test/integration/zz-sec-r2/
cp $PR/sec-r3-csp.test.ts apps/api/test/integration/zz-sec-r3/
( unset LANG LC_ALL LC_CTYPE; run probes-ABD-CSP-node22-lang-unset $N22 bash $EV/with-pg.sh 26310 pnpm exec vitest run --project integration apps/api/test/integration/zz-sec-r1 apps/api/test/integration/zz-sec-r2 apps/api/test/integration/zz-sec-r3 --reporter=verbose )
( unset LC_ALL LC_CTYPE; export LANG=C.UTF-8; run probes-ABD-CSP-node24-lang-c-utf8 $N24 bash $EV/with-pg.sh 26312 pnpm exec vitest run --project integration apps/api/test/integration/zz-sec-r1 apps/api/test/integration/zz-sec-r2 apps/api/test/integration/zz-sec-r3 --reporter=verbose )
rm -rf apps/api/test/integration/zz-sec-r1 apps/api/test/integration/zz-sec-r2 apps/api/test/integration/zz-sec-r3
echo "git status --porcelain after cleanup: '$(git status --porcelain)'" >> $EV/summary-extra.txt
echo DONE >> $EV/summary-extra.txt

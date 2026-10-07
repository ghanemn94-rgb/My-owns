#!/bin/bash
# qa-verifier DG2 round 13: integration series on clone $TMPDIR/review-dg2 @5699f72 (freeze; candidate 6824b8b8, source aa0a68f1),
# 3 runs per locale setting, each on its own disposable PostgreSQL (unique port, tests/qa/support/with-pg.sh). The
# qa-verifier evidence suites (dg2-qa-acceptance, round-2 design/journey, round-3 blank-sweep/regress) are copied into
# tests/qa/integration of the CLONE only (never the candidate tree).
cd $TMPDIR/review-dg2
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
Q=/home/user/My-owns/docs/delivery/test-evidence/DG2/qa/tests
cp $Q/dg2-qa-acceptance.test.ts $Q/round-2/dg2-qa-design-r2.test.ts $Q/round-2/dg2-qa-journey-r2.test.ts \
   $Q/round-3/dg2-qa-blank-sweep-r3.test.ts $Q/round-3/dg2-qa-regress-r3.test.ts tests/qa/integration/
E=/home/user/My-owns/docs/delivery/test-evidence/DG2/qa/round-13/integration
port=24931
for n in 1 2 3; do
 for loc in unset cutf8; do
  if [ $loc = unset ]; then L="env -u LANG -u LC_ALL"; else L="env -u LC_ALL LANG=C.UTF-8"; fi
  f=$E/integration-$loc-run$n.log
  { echo "\$ $L QA_PG_PORT=$port tests/qa/support/with-pg.sh npx vitest run --project integration --reporter=verbose"; echo "# clone @5699f72 + 5 qa-verifier suites in tests/qa/integration (clone only); node $(node -v); $(date -u +%FT%TZ)";
    $L QA_PG_PORT=$port tests/qa/support/with-pg.sh npx vitest run --project integration --reporter=verbose 2>&1; echo "exit $?"; } | sed "s#$TMPDIR#\$TMPDIR#g" > $f
  port=$((port+1))
 done
done
echo done

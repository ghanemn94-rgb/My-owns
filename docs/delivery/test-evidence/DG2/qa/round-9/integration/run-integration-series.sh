#!/bin/bash
# qa-verifier DG2 round 9: integration series, 3 runs per locale setting, disposable PostgreSQL (unique ports).
cd $TMPDIR/review-dg2
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
E=/home/user/My-owns/docs/delivery/test-evidence/DG2/qa/round-9/integration
port=24611
for n in 1 2 3; do
 for loc in unset cutf8; do
  if [ $loc = unset ]; then L="env -u LANG -u LC_ALL"; else L="env -u LC_ALL LANG=C.UTF-8"; fi
  f=$E/integration-$loc-run$n.log
  { echo "\$ $L QA_PG_PORT=$port tests/qa/support/with-pg.sh npx vitest run --project integration --reporter=verbose"; echo "# node $(node -v); $(date -u +%FT%TZ)";
    $L QA_PG_PORT=$port tests/qa/support/with-pg.sh npx vitest run --project integration --reporter=verbose 2>&1; echo "exit $?"; } > $f
  port=$((port+1))
 done
done
echo done

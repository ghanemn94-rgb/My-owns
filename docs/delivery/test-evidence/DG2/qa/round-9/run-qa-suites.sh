#!/bin/bash
cd $TMPDIR/review-dg2
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
E=/home/user/My-owns/docs/delivery/test-evidence/DG2/qa/round-9
for spec in "unset 24641" "cutf8 24642"; do set -- $spec
 if [ $1 = unset ]; then L="env -u LANG -u LC_ALL"; else L="env -u LC_ALL LANG=C.UTF-8"; fi
 { echo "\$ $L QA_PG_PORT=$2 tests/qa/support/with-pg.sh npx vitest run --project integration --reporter=verbose"; echo "# clone @7854770e + qa-verifier evidence suites copied into tests/qa/integration (clone only); node $(node -v); $(date -u +%FT%TZ)";
   $L QA_PG_PORT=$2 tests/qa/support/with-pg.sh npx vitest run --project integration --reporter=verbose 2>&1; echo "exit $?"; } | sed "s#$TMPDIR#\$TMPDIR#g" > $E/13-integration-with-qa-suites-$1.log
done

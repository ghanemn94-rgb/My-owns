#!/usr/bin/env bash
# qa-verifier DG5 r7: integration project on a disposable PostgreSQL (tests/qa/support/with-pg.sh).
# $1 = label, $2 = starting PG port (26600-26699), rest = extra vitest args (e.g. tests/qa).
set -u
C=$TMPDIR/review-qa; E=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-7
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
LBL=$1; PORT=$2; shift 2
[ "$LBL" = testsqa ] && [ -z "${QA_RUN_TESTSQA:-}" ] && { echo "tests/qa alone deferred to its own task (2 h task limit)"; exit 0; }
cd "$C"; L=$E/04-integration-$LBL.log; S=$E/04-integration-$LBL-samples.log; : > $S; rm -f $TMPDIR/i$LBL.stop
bash $E/scripts/sampler.sh $S $TMPDIR/i$LBL.stop & SP=$!
{ echo "\$ QA_PG_PORT=$PORT MTH_PORT_POOL=26600-26699 tests/qa/support/with-pg.sh pnpm test:integration $*  (node $(node -v), $(date -u +%FT%TZ))"; uptime
QA_PG_PORT=$PORT MTH_PORT_POOL=26600-26699 tests/qa/support/with-pg.sh pnpm test:integration "$@" 2>&1 | sed "s#$TMPDIR#\$TMPDIR#g"
echo "EXIT ${PIPESTATUS[0]}"; date -u +%FT%TZ; uptime; } > "$L" 2>&1
touch $TMPDIR/i$LBL.stop; wait $SP
sed 's/\x1b\[[0-9;]*m//g' "$L" | grep -E "Test Files|Tests |Duration|^EXIT" | tail -5

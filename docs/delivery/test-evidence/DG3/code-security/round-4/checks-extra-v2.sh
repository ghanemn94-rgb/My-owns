#!/usr/bin/env bash
# code-security-reviewer DG3 round-4: re-runs ONLY the API EvalError probe, revision 2 (probes/sec-r4-evalerror-api-v2.test.ts),
# after revision 1 failed in checks-extra.sh (both runs: 2 failed / 88 passed, the 2 failures being revision 1's two tests,
# refused by the harness's contract check before their assertions ran; disclosed in the record). Same disposable clone
# $TMPDIR/review-r4 at 171a0b57, same two environments: Node 22 LANG unset (port 26320), Node 24 LANG=C.UTF-8 (port 26322).
EV=/home/user/My-owns/docs/delivery/test-evidence/DG3/code-security/round-4
cd $TMPDIR/review-r4 || exit 2
N22=/opt/node22/bin; N24=/opt/nvm/versions/node/v24.21.0/bin
run() { # name env-path cmd...
  local name=$1 p=$2; shift 2
  { echo "# command: $*"; echo "# node: $(PATH=$p:$PATH node --version)  commit: $(git rev-parse HEAD)  LANG=${LANG-<unset>} LC_ALL=${LC_ALL-<unset>} LC_CTYPE=${LC_CTYPE-<unset>}  started: $(date -u +%FT%TZ)"; } > $EV/$name.log
  PATH=$p:$PATH "$@" >> $EV/$name.log 2>&1; local rc=$?
  echo "# exit_status: $rc  finished: $(date -u +%FT%TZ)" >> $EV/$name.log
  echo "$name $rc" >> $EV/summary-extra-v2.txt
}
: > $EV/summary-extra-v2.txt
sha256sum $EV/probes/sec-r4-evalerror-api-v2.test.ts >> $EV/summary-extra-v2.txt
mkdir -p apps/api/test/integration/zz-sec-r4
cp $EV/probes/sec-r4-evalerror-api-v2.test.ts apps/api/test/integration/zz-sec-r4/
( unset LANG LC_ALL LC_CTYPE; run probe-E-v2-node22-lang-unset $N22 bash $EV/with-pg.sh 26320 pnpm exec vitest run --project integration apps/api/test/integration/zz-sec-r4 --reporter=verbose )
( unset LC_ALL LC_CTYPE; export LANG=C.UTF-8; run probe-E-v2-node24-lang-c-utf8 $N24 bash $EV/with-pg.sh 26322 pnpm exec vitest run --project integration apps/api/test/integration/zz-sec-r4 --reporter=verbose )
rm -rf apps/api/test/integration/zz-sec-r4
echo "git status --porcelain after cleanup: '$(git status --porcelain)'" >> $EV/summary-extra-v2.txt
echo DONE >> $EV/summary-extra-v2.txt

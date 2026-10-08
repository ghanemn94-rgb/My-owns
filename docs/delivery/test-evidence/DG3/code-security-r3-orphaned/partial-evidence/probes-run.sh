#!/usr/bin/env bash
# code-security-reviewer DG3 round-3 probe runner. Disposable clone ONLY: $TMPDIR/review-p2 at 0e820ae (built with
# pnpm -r build; offline frozen install). Copies the probes in, runs them, removes them (git clean) at the end.
#   probe C  sec-r1-formula-fuzz.test.ts  -> packages/shared/src/formula/zz-sec-r1-fuzz.test.ts
#            unit-node on Node 22 and Node 24, and in the unit-formula-nocodegen project (Node 22 and Node 24)
#   probe A  sec-r1-aud-sweep.test.ts         -> apps/api/test/integration/zz-sec-r1/
#   probe B  sec-r1-integrity.test.ts         -> apps/api/test/integration/zz-sec-r1/
#   probe D  sec-r2-inherited-approval.test.ts -> apps/api/test/integration/zz-sec-r2/
#   probe E  sec-r3-csp-web-bundle.test.ts    -> apps/api/test/integration/zz-sec-r3/
#   A+B+D+E twice: Node 22 with LANG/LC_ALL/LC_CTYPE unset (port 26310) and Node 24 with LANG=C.UTF-8 (port 26312).
EV=/home/user/My-owns/docs/delivery/test-evidence/DG3/code-security/round-3
cd "$TMPDIR/review-p2" || exit 2
N22=/opt/node22/bin; N24=/opt/nvm/versions/node/v24.21.0/bin
run() { # name env-path cmd...
  local name=$1 p=$2; shift 2
  { echo "# command: $*"; echo "# node: $(PATH=$p:$PATH node --version)  commit: $(git rev-parse HEAD)  LANG=${LANG-<unset>} LC_ALL=${LC_ALL-<unset>} LC_CTYPE=${LC_CTYPE-<unset>}  started: $(date -u +%FT%TZ)"; } > $EV/$name.log
  PATH=$p:$PATH "$@" >> $EV/$name.log 2>&1; local rc=$?
  echo "# exit_status: $rc  finished: $(date -u +%FT%TZ)" >> $EV/$name.log
  echo "$name $rc" >> $EV/probes-summary.txt
}
: > $EV/probes-summary.txt
mkdir -p apps/api/test/integration/zz-sec-r1 apps/api/test/integration/zz-sec-r2 apps/api/test/integration/zz-sec-r3
cp $EV/probes/sec-r1-formula-fuzz.test.ts packages/shared/src/formula/zz-sec-r1-fuzz.test.ts
cp $EV/probes/sec-r1-aud-sweep.test.ts $EV/probes/sec-r1-integrity.test.ts apps/api/test/integration/zz-sec-r1/
cp $EV/probes/sec-r2-inherited-approval.test.ts apps/api/test/integration/zz-sec-r2/
cp $EV/probes/sec-r3-csp-web-bundle.test.ts apps/api/test/integration/zz-sec-r3/
C=packages/shared/src/formula/zz-sec-r1-fuzz.test.ts
run probe-C-formula-fuzz-node22 $N22 pnpm vitest run --project unit-node $C --reporter=verbose
run probe-C-formula-fuzz-node24 $N24 pnpm vitest run --project unit-node $C --reporter=verbose
run probe-C-formula-fuzz-nocodegen-node22 $N22 pnpm vitest run --project unit-formula-nocodegen $C --reporter=verbose
run probe-C-formula-fuzz-nocodegen-node24 $N24 pnpm vitest run --project unit-formula-nocodegen $C --reporter=verbose
I="apps/api/test/integration/zz-sec-r1 apps/api/test/integration/zz-sec-r2 apps/api/test/integration/zz-sec-r3"
( unset LANG LC_ALL LC_CTYPE; run probes-ABDE-node22-lang-unset $N22 bash $EV/with-pg.sh 26310 pnpm vitest run --project integration $I --reporter=verbose )
( unset LC_ALL LC_CTYPE; export LANG=C.UTF-8; run probes-ABDE-node24-lang-c-utf8 $N24 bash $EV/with-pg.sh 26312 pnpm vitest run --project integration $I --reporter=verbose )
rm -rf apps/api/test/integration/zz-sec-r1 apps/api/test/integration/zz-sec-r2 apps/api/test/integration/zz-sec-r3 "$C"
echo "git status after cleanup: '$(git status --porcelain)'" >> $EV/probes-summary.txt
echo DONE >> $EV/probes-summary.txt

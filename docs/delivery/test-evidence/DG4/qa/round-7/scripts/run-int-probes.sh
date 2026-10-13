#!/usr/bin/env bash
# qa-verifier DG4 round 7: regression of my earlier integration probes (latest revision of each, unchanged) on this candidate,
# in the disposable copy $TMPDIR/rv4 (copied into tests/qa/integration/ only for the run, removed afterwards).
set -u
E=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/round-7; T=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/tests
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
C=$TMPDIR/rv4; cd $C
P="$T/round-2/integration/dg4-qa-r1-probes.test.ts $T/round-2/integration/dg4-qa-r1-scope-totals.test.ts $T/round-2/integration/dg4-qa-r2-repairs.test.ts $T/round-3/integration/dg4-qa-r3-headlines.test.ts $T/round-4/integration/dg4-qa-r4-value-basis.test.ts"
F=""; for p in $P; do cp $p tests/qa/integration/; F="$F tests/qa/integration/$(basename $p)"; done
L=$E/03-integration-qa-probes-r1-r4.log
{ echo "\$ QA_PG_PORT=26590 MTH_PORT_POOL=26500-26699 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration --reporter=verbose$F   (node $(node -v), $(date -u +%FT%TZ))"
  for p in $P; do echo "   probe $(basename $p) sha256 $(sha256sum $p | cut -c1-16) (from ${p#/home/user/My-owns/})"; done; uptime
  QA_PG_PORT=26590 MTH_PORT_POOL=26500-26699 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration --reporter=verbose $F 2>&1 | sed "s#$TMPDIR#\$TMPDIR#g"
  echo "EXIT ${PIPESTATUS[0]}"; date -u +%FT%TZ; uptime; } > $L 2>&1
rm -f $F; ls tests/qa/integration | grep -c dg4-qa >> $L
grep -E "^ +(Test Files|Tests) |^EXIT" $L

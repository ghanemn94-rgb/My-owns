#!/usr/bin/env bash
# qa-verifier DG7 round 4, sequence F (after seqE, in $TMPDIR/rv):
#  58b the A26 drill's QA regression test (orchestrator/a26/reviewers/qa/qa-a26-bu-update-authz.test.ts) against the
#      frozen candidate: a temporary copy in the clone's tests/qa/integration, run, then removed;
#  a18 the A18 driver (one archive of the candidate: build-archive --candidate, --verify, transfer-drill D0-D11, harness).
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG7/qa/round-4/scripts
E=/home/user/My-owns/docs/delivery/test-evidence/DG7/qa/round-4
R="bash $S/run.sh"
T="$TMPDIR/rv/tests/qa/integration/zz-qa-a26-bu-update-authz.test.ts"
cp /home/user/My-owns/docs/delivery/test-evidence/DG7/orchestrator/a26/reviewers/qa/qa-a26-bu-update-authz.test.ts "$T"
QA_PG_PORT=32548 $R 58b-a26-regression-on-candidate bash tests/qa/support/with-pg.sh npx vitest run --project integration tests/qa/integration/zz-qa-a26-bu-update-authz.test.ts
rm -f "$T"; echo "A26 copy removed: $( [ -e "$T" ] && echo NO || echo yes)"
mkdir -p "$E/a18"
QA_PG_PORT=32520 $R a18-driver bash tests/qa/support/with-pg.sh bash $S/a18-driver.sh
mv "$E/a18-driver.log" "$E/a18/a18-driver.log" 2>/dev/null; mv "$E/a18-driver.rc" "$E/a18/a18-driver.rc" 2>/dev/null
echo "seqF done $(date -u +%FT%TZ)"

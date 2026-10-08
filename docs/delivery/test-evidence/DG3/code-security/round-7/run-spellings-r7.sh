#!/usr/bin/env bash
# code-security-reviewer DG3 round 7: re-run of my round-6 independent L1–L7 spellings against THIS candidate, in the
# DISPOSABLE clone $TMPDIR/review-p3 at d22938f (never the candidate tree). The round-6 filter-widening sed is no longer
# needed (the candidate's own lintText test now lints every row except the two LINT_EXCLUDED rows), so the only change
# to fuzz.test.ts is appending round-6/probes/spellings-r6.append.ts VERBATIM (sha256 printed). Restored afterwards.
EV=/home/user/My-owns/docs/delivery/test-evidence/DG3/code-security/round-7
AP=/home/user/My-owns/docs/delivery/test-evidence/DG3/code-security/round-6/probes/spellings-r6.append.ts
C=$TMPDIR/review-p3; F=packages/shared/src/formula/fuzz.test.ts
export PATH=/opt/node22/bin:$PATH
cd $C || exit 2
echo "# run-spellings-r7.sh; node $(node -v); clone $C at $(git rev-parse HEAD); git status '$(git status --porcelain)'; $(sha256sum $AP | cut -c1-64) spellings-r6.append.ts; $(date -u +%FT%TZ)"
cp $F $TMPDIR/fuzz.test.ts.orig
cat $AP >> $F
pnpm exec vitest run --project unit-node $F --reporter=verbose 2>&1; rc=$?
cp $TMPDIR/fuzz.test.ts.orig $F; rm -f $TMPDIR/fuzz.test.ts.orig
echo "# exit_status: $rc; restored; git status '$(git status --porcelain)'; $(date -u +%FT%TZ)"

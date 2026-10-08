#!/usr/bin/env bash
# code-security-reviewer DG3 round 6: lint + scan spelling check in the DISPOSABLE clone $TMPDIR/review-p3 (never the
# candidate tree). Two modifications of packages/shared/src/formula/fuzz.test.ts, restored afterwards:
#  (1) the candidate's lintText test filter /^(catch|finally|\.then|Promise|generator|then|fromAsync)/ is widened to
#      every probe-table row except the two "unbalanced" rows (which are not valid modules), so ESLint lints ALL rows;
#  (2) probes/spellings-r6.append.ts (independent L1–L7 spellings) is appended.
# Run: vitest --project unit-node on fuzz.test.ts, Node 22.22.2.
EV=/home/user/My-owns/docs/delivery/test-evidence/DG3/code-security/round-6
C=$TMPDIR/review-p3; F=packages/shared/src/formula/fuzz.test.ts
export PATH=/opt/node22/bin:$PATH
cd $C || exit 2
echo "# run-spellings-r6.sh; node $(node -v); clone $C at $(git rev-parse HEAD); git status '$(git status --porcelain)'; $(date -u +%FT%TZ)"
cp $F $TMPDIR/fuzz.test.ts.orig
grep -c '/^(catch|finally|\\.then|Promise|generator|then|fromAsync)/.test(what)' $F | sed 's/^/# filter occurrences before edit: /'
sed -i 's#/^(catch|finally|\\.then|Promise|generator|then|fromAsync)/.test(what)#!/^unbalanced/.test(what)#' $F
grep -c '!/^unbalanced/.test(what)' $F | sed 's/^/# widened filter occurrences after edit: /'
cat $EV/probes/spellings-r6.append.ts >> $F
pnpm exec vitest run --project unit-node $F --reporter=verbose 2>&1; rc=$?
cp $TMPDIR/fuzz.test.ts.orig $F; rm -f $TMPDIR/fuzz.test.ts.orig
echo "# exit_status: $rc; restored; git status '$(git status --porcelain)'; $(date -u +%FT%TZ)"

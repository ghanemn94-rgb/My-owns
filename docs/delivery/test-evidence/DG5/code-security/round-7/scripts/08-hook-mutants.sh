#!/usr/bin/env bash
# code-security-reviewer DG5 r7: the D-181 hook. The shipped test (apps/web/src/api/all-transformations.test.tsx) plus my
# probe repro/all-transformations-cancel.r7.test.tsx on the candidate, then three mutants of fetchAllTransformations in
# apps/web/src/api/queries.ts (disposable clone), each run against both files, then reverted:
#   M1 the cursor is never followed (the list stops after page 1)        -> H2/P1 must fail;
#   M2 the request signal is not passed to the page requests              -> H5 and my C1/C3 must fail;
#   M3 the repeated-cursor guard is removed                               -> H4 must fail.
set -u
C=$TMPDIR/review-r7; E=/home/user/My-owns/docs/delivery/test-evidence/DG5/code-security/round-7
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
F=apps/web/src/api/queries.ts; P=apps/web/src/api/zz-sec-r7-all-transformations-cancel.test.tsx; S=apps/web/src/api/all-transformations.test.tsx
L=$E/08-hook-mutants.log; cd $C
run() { npx vitest run --configLoader runner --project unit-web $S $P 2>&1 | sed "s#$TMPDIR#\$TMPDIR#g; s/\x1b\[[0-9;]*m//g" | grep -E '✓|×|FAIL|Tests |Test Files|Error:' | head -40; echo "EXIT ${PIPESTATUS[0]}"; }
{ echo "## $(date -u +%FT%TZ) D-181 hook probe and mutants; clone HEAD $(git rev-parse --short HEAD); node $(node -v); locale unset; load: $(cut -d' ' -f1-3 /proc/loadavg)"
cp $E/repro/all-transformations-cancel.r7.test.tsx $P; echo "copy probe -> $P ($(sha256sum $P | cut -c1-16))"
echo; echo "### unmutated candidate"; echo "\$ npx vitest run --configLoader runner --project unit-web $S $P"; run
for m in M1 M2 M3; do
  git checkout -q -- $F
  case $m in
    M1) sed -i 's/    if (!page.nextCursor) return out;/    return out;/' $F;;
    M2) perl -0pi -e 's/(\.\.\.\(cursor \? \{ cursor \} : \{\}\),\n      \},\n)      signal,\n/$1/' $F;;
    M3) sed -i '/if (seen.has(page.nextCursor)) throw new Error/d' $F;;
  esac
  echo; echo "### mutant $m: git diff"; git diff -- $F
  echo "\$ npx vitest run --configLoader runner --project unit-web $S $P   (non-zero expected: the mutant must be killed)"; run
done
git checkout -q -- $F; rm -f $P
echo; echo "clone git status --short lines after revert: $(git status --short | wc -l)"
echo "## end $(date -u +%FT%TZ)"; } > $L 2>&1
grep -E '^### |Tests |^EXIT|status --short' $L

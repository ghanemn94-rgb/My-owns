#!/usr/bin/env bash
# code-security-reviewer DG5 r6: negative control for the new probe form-export-label.r6.test.ts. Two mutants of
# apps/api/src/modules/forms/export.ts in the disposable clone, each run against the probe alone, then reverted:
#   M1: the environment read is ignored (synthetic always false)  -> the labelled-reader test must fail;
#   M2: the CSV formula-trigger neutralization is removed            -> the CSV writer test must fail.
set -u
C=$TMPDIR/review-r6; E=/home/user/My-owns/docs/delivery/test-evidence/DG5/code-security/round-6
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
F=apps/api/src/modules/forms/export.ts; P=apps/api/test/integration/forms/zz-sec-r6-form-export-label.test.ts
L=$E/08-probe-mutants.log; cd $C
{ echo "## $(date -u +%FT%TZ) probe negative controls; clone HEAD $(git rev-parse --short HEAD); node $(node -v); locale unset"
cp $E/repro/form-export-label.r6.test.ts $P
for m in M1 M2; do
  git checkout -q -- $F
  case $m in
    M1) sed -i 's/const synthetic = (await readDeploymentEnvironment(db)).synthetic;/const synthetic = false \&\& (await readDeploymentEnvironment(db)).synthetic;/' $F;;
    M2) sed -i 's/return csvField(FORMULA_TRIGGERS.has(text.charAt(0)) ? `'"'"'${text}` : text);/return csvField(text);/' $F;;
  esac
  echo; echo "### mutant $m: git diff"; git diff -- $F
  echo "\$ env -u LANG -u LC_ALL QA_PG_PORT=26580 MTH_PORT_POOL=26581-26599 bash tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration $P"
  env -u LANG -u LC_ALL -u LC_CTYPE QA_PG_PORT=26580 MTH_PORT_POOL=26581-26599 bash tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration $P 2>&1 | sed "s#$TMPDIR#\$TMPDIR#g; s/\x1b\[[0-9;]*m//g" | grep -E '✓|×|FAIL|Tests |Test Files|AssertionError' | head -40
  echo "EXIT ${PIPESTATUS[0]} (non-zero expected: the mutant must be killed)"
done
git checkout -q -- $F; rm -f $P
echo; echo "clone git status --short lines after revert: $(git status --short | wc -l)"
echo "## end $(date -u +%FT%TZ)"; } > $L 2>&1
grep -E '^### |Tests |^EXIT|status --short' $L

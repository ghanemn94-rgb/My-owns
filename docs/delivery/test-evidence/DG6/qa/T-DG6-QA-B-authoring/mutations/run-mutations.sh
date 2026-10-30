#!/usr/bin/env bash
# Baseline + one run per mutation of tests/qa/integration/a12-p6-scope-isolation.test.ts in the DISPOSABLE copy.
set -u
SRC=/home/user/wt/dg6-qa-b; M=$TMPDIR/qa-b-mut; OUT=$SRC/docs/delivery/test-evidence/DG6/qa/T-DG6-QA-B-authoring/mutations
mkdir -p $OUT
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
FILES="apps/api/src/modules/reporting/reports/snapshots.ts apps/api/src/modules/search/query.ts apps/api/src/modules/reporting/exports/jobs.ts apps/api/src/modules/evidence/access.ts apps/api/src/modules/tasks/deep-links.ts apps/api/src/modules/assistant/prompt.ts apps/api/src/modules/access/read-scope.ts"
restore() { for f in $FILES; do cp $SRC/$f $M/$f; done; }
LIST="${*:-M0-baseline M1-search-scope M2-export-owner M3-evidence-gate M4-deeplink-reauth M5-assistant-data-as-instructions M6-sensitivity-clause}"
for m in $LIST; do
  restore
  if [ $m != M0-baseline ]; then python3 $TMPDIR/qa-b-tools/mutate.py $M $m > $OUT/$m.log || { echo "$m: ANCHOR MISSING" >> $OUT/summary.txt; continue; }; fi
  (cd $M && git diff --no-index $SRC/apps/api/src $M/apps/api/src > $OUT/$m.diff 2>/dev/null)
  (cd $M && QA_PG_PORT=26436 MTH_PORT_POOL=26437-26449 timeout 900 tests/qa/support/with-pg.sh pnpm vitest run --configLoader runner --project integration tests/qa/integration/a12-p6-scope-isolation.test.ts >> $OUT/$m.log 2>&1); rc=$?
  echo "$m: exit=$rc $(grep -E '^\s+Tests ' $OUT/$m.log | sed 's/\x1b\[[0-9;]*m//g' | tr -s ' ')" >> $OUT/summary.txt
  grep -E '^\s+×' $OUT/$m.log | sed 's/\x1b\[[0-9;]*m//g' | sed "s/^/    $m FAILED: /" | cut -c1-260 >> $OUT/summary.txt
done
restore
(cd $M && git diff --no-index --stat $SRC/apps/api/src $M/apps/api/src) > $OUT/final-restore-check.txt 2>&1
echo "restore check (empty = identical): $(wc -c < $OUT/final-restore-check.txt) bytes" >> $OUT/summary.txt
echo DONE >> $OUT/summary.txt

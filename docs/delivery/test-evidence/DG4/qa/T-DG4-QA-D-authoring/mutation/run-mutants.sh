#!/usr/bin/env bash
# Mutation driver (T-DG4-QA-D). Runs ONLY in the disposable copy $M; the worktree $W is only read.
set -u
W=/home/user/wt/dg4-qa-d
M=$TMPDIR/review-qa-d-mut
S=$(dirname "$0")
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
FILES="apps/api/src/modules/portfolio/dashboard-facts.ts apps/api/src/modules/reporting/traceability.ts apps/api/src/modules/reporting/dashboards/engine.ts apps/api/src/modules/transformations/register-kit.ts apps/api/src/modules/workflows/scale.ts"
A01=tests/qa/integration/a01-one-source-of-truth-scorecard.test.ts
A02=tests/qa/integration/a02-a08-drafts-before-g2-scale-after-g5.test.ts
cp "$W/$A01" "$M/$A01"; cp "$W/$A02" "$M/$A02"
restore() { for f in $FILES; do cp "$W/$f" "$M/$f"; done; }
run() { # $1 label, $2 test file
  ( cd "$M" && QA_PG_PORT=25650 MTH_PORT_POOL=25651-25699 tests/qa/support/with-pg.sh pnpm vitest run --configLoader runner --project integration "$2" ) >"$OUT/$1.log" 2>&1
  local rc=$?
  echo "== $1 ($2): exit $rc"
  grep -E '^\s+(✓|×)|Tests +[0-9]|AssertionError|→ ' "$OUT/$1.log" | head -8
}
OUT=${OUT:?}
mkdir -p "$OUT"
restore
for f in $FILES; do cmp -s "$W/$f" "$M/$f" || { echo "restore failed: $f"; exit 9; }; done
run baseline-a01 "$A01"
run baseline-a02 "$A02"
for mid in PB010-scorecard-stale-copy PB010-traceability-stale-copy PB010-scorecard-label-code; do
  restore; python3 "$S/mutate.py" "$M" "$mid" || { echo "== $mid: NOT APPLIED"; continue; }
  run "$mid" "$A01"
done
for mid in S03004-design-draft-blocked-before-g2 S03004-pre-g5-wrong-code S03004-pre-g5-detail-without-g5 S03004-g5-approval-ignored; do
  restore; python3 "$S/mutate.py" "$M" "$mid" || { echo "== $mid: NOT APPLIED"; continue; }
  run "$mid" "$A02"
done
restore
run restored-a01 "$A01"
run restored-a02 "$A02"

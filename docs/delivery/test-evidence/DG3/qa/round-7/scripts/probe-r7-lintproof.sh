#!/usr/bin/env bash
# qa-verifier DG3 round 7: acceptance-side mutation probe of the T-DG3-KBE-I repair (F-DG3-280).
# Weakens one guard selector in eslint.config.js at a time (throwaway, probe clone only), runs the repaired
# fuzz.test.ts lintText test, and restores. The test must fail and name the probe rows the weakened selector covered.
set -u
C="$1"; cd "$C" || exit 2
T='ESLint refuses the round-5 handler forms'
run() {
  echo "\$ npx vitest run --project unit-node packages/shared/src/formula/fuzz.test.ts -t '$T' --reporter=verbose"
  npx vitest run --project unit-node packages/shared/src/formula/fuzz.test.ts -t "$T" --reporter=verbose > "$TMPDIR/qa/lp.log" 2>&1; rc=$?
  sed 's/\x1b\[[0-9;]*m//g' "$TMPDIR/qa/lp.log" | grep -vE "^\s*↓|npm warn" | grep -E "^\s+(✓|×) |^\s+→ |^AssertionError|Test Files|^\s+Tests " | cut -c1-300
  # (the test stops at its first failing row, so the arrow line names the first probe row the weakened selector covered)
  echo "EXIT $rc"
}
mut() { # label python-replacement (old) (new)
  local label="$1" old="$2" new="$3"
  echo "=================== $label"
  OLD="$old" NEW="$new" python3 - eslint.config.js <<'PY'
import os,sys
p=sys.argv[1]; s=open(p).read(); o=os.environ['OLD']; n=os.environ['NEW']
c=s.count(o); assert c==1, f"anchor count {c}"; open(p,'w').write(s.replace(o,n))
PY
  git --no-pager diff -U0 -- eslint.config.js | cut -c1-400
  run
  git checkout -- eslint.config.js; echo "restored: git status --short = [$(git status --short)]"
}
echo "=================== control (unmodified candidate)"
run
mut "P1 remove ForOfStatement[await=true] from the async selector" ", ForOfStatement[await=true]" ""
mut "P2 remove the PrivateIdentifier part of the round-6 name selector" "PrivateIdentifier[name=/^(then|catch|finally|fromAsync|asyncIterator)$/], " ""
mut "P3 remove the generator selector (:function[generator=true], YieldExpression -> a selector matching nothing)" '":function[generator=true], YieldExpression"' '"Identifier[name=\"qaNeverUsedName\"]"'
mut "P4 remove the Literal part of the round-6 name selector" "Literal[value=/^(then|catch|finally|fromAsync|asyncIterator)$/], " ""
echo "=================== control after restore"
run
echo "git status --porcelain = '$(git status --porcelain)'"

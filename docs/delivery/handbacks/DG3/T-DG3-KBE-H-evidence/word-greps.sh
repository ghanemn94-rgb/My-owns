#!/usr/bin/env bash
# T-DG3-KBE-H: the words refused by L1-L7 in decimal.js 10.6.0 and in the seven engine sources (ADR-0024 §6 claims).
cd /home/user/wt/dg3-kbe-h
D=$(dirname "$(node -p "require.resolve('decimal.js/package.json',{paths:['packages/shared']})")")
RE='\byield\b|function\s*\*|\bthen\b|\bfromAsync\b|\basyncIterator\b|\bPromise\b|\basync\b|\bawait\b|\btry\b|\bcatch\b|\bfinally\b|\beval\s*\(|\bFunction\s*\('
echo "# decimal.js $(node -p "require('$D/package.json').version") at $D; $(date -u +%FT%TZ)"
for f in decimal.js decimal.mjs; do
  echo "## $f: every line matching the words:"
  grep -nE "$RE" "$D/$f"
  echo "## $f: of which not a comment line (expected none):"
  grep -nE "$RE" "$D/$f" | grep -vE '^[0-9]+:\s*(//|\*|/\*)'
  echo "# grep exit (1 = none): $?"
done
S=packages/shared/src
echo "## engine sources: then/yield/fromAsync/asyncIterator/finally/function*:"
grep -nE '\b(then|yield|fromAsync|asyncIterator|finally)\b|function\s*\*' $S/formula/evaluate.ts $S/formula/index.ts $S/formula/parse.ts $S/formula/tokenize.ts $S/formula/typecheck.ts $S/formula/types.ts $S/value.ts
echo "## engine sources: catch clauses (code lines):"
grep -nE '^\s*\}\s*catch\b' $S/formula/evaluate.ts $S/formula/index.ts $S/formula/parse.ts $S/formula/tokenize.ts $S/formula/typecheck.ts $S/formula/types.ts $S/value.ts

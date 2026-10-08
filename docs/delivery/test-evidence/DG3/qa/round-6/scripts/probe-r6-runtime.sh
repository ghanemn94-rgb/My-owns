#!/usr/bin/env bash
# qa-verifier DG3 round 6: run-time layer (unit-formula-nocodegen) mutation probe, M1-M4 as in round 5 (throwaway, probe clone).
set -u
C="$1"; cd "$C" || exit 2
MUT='{ (Math.max as unknown as Record<string, (b: string) => () => unknown>)[["con", "struc", "tor"].join("")]!("return 0")(); } // QA MUTATION (throwaway)'
mut() { # label file anchor-regex [before]
  local label="$1" f="$2" anchor="$3" pos="${4:-after}"
  echo "=================== $label: mutated $f (diff):"
  MUT="$MUT" ANCHOR="$anchor" POS="$pos" python3 - "$f" <<'PY'
import os,sys,re
p=sys.argv[1]; s=open(p).read().split('\n'); a=re.compile(os.environ['ANCHOR'])
i=next(i for i,l in enumerate(s) if a.search(l)); ind=re.match(r'\s*',s[i]).group(0)
s.insert(i+(0 if os.environ['POS']=='before' else 1), ind+os.environ['MUT']); open(p,'w').write('\n'.join(s))
PY
  git --no-pager diff -- "$f"
  echo "\$ npx vitest run --project unit-node packages/shared/src/formula packages/shared/src/value.test.ts  (normal process)"
  npx vitest run --project unit-node packages/shared/src/formula packages/shared/src/value.test.ts 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Test Files|^\s+Tests "; echo "EXIT ${PIPESTATUS[0]}"
  echo "\$ npx vitest run --project unit-formula-nocodegen"
  npx vitest run --project unit-formula-nocodegen > "$TMPDIR/qa/nc.log" 2>&1; rc=$?
  sed 's/\x1b\[[0-9;]*m//g' "$TMPDIR/qa/nc.log" | grep -E "Failed Tests|Test Files|^\s+Tests "; echo "EXIT $rc"
  echo "EvalError lines: $(grep -c EvalError $TMPDIR/qa/nc.log)"
  echo "'could not be processed' lines: $(grep -c 'could not be processed' $TMPDIR/qa/nc.log)"
  sed 's/\x1b\[[0-9;]*m//g' "$TMPDIR/qa/nc.log" | grep -E "^ FAIL " | head -4
  git checkout -- "$f"; echo "restored: git status --short = [$(git status --short)]"
}
mut M1-validateFormula-try packages/shared/src/formula/index.ts 'const vars = checkVariables\(variables\);'
mut M2-evaluateAst-walk packages/shared/src/formula/evaluate.ts 'const walk = \(node: ExprNode\): Dec => \{'
mut M3-formatDecimal-try packages/shared/src/value.ts '^\s+d = fromStored\(value\);' before   # as in round 5: before the conversion
mut M4-parseFormula-try packages/shared/src/formula/parse.ts 'if \(p.peek\(\).type === "end"\) throw new ParseFailure'
echo "=================== control after restore"
echo "\$ npx vitest run --project unit-formula-nocodegen"; npx vitest run --project unit-formula-nocodegen 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Test Files|^\s+Tests "; echo "EXIT ${PIPESTATUS[0]}"

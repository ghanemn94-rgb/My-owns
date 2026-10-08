#!/usr/bin/env bash
# code-security-reviewer DG3 round-7 static scans of the repair diff c40232b0..d3e6fe62 (T-DG3-KBE-I) and of the frozen
# tree, in the disposable clone $TMPDIR/rev (git and grep only; nothing modified).
cd "$TMPDIR/rev" || exit 2
B=c40232b01b7ec3cbf24759617bc645847a517a7e; C=d3e6fe62d9a4a3a0e8d08fcf273aef74857b3e81; R3=ce988e20f7ea2752cd3283995fbf7ed05b704485
echo "# diff-scan $(date -u +%FT%TZ) base $B source $C clone HEAD $(git rev-parse HEAD)"
echo "## D0 freeze commit vs source commit: files differing (expect delivery metadata only)"; git diff --name-only $C HEAD | sed 's/^/  /'
echo "## D1 files changed by the repair outside docs/delivery:"; git diff --name-only $B..$C | grep -v '^docs/delivery/' | sed 's/^/  /'
echo "## D2 changed files under apps/ packages/db migrations openapi vitest config package.json lockfile .github deploy (expect none):"
git diff --name-only $B..$C -- apps packages/db docs/api vitest.config.ts package.json 'apps/*/package.json' 'packages/*/package.json' pnpm-lock.yaml .github deploy | sed 's/^/  /'; echo "  (exit ${PIPESTATUS[0]}; nothing listed = none)"
echo "## D3 non-test product source changed (expect none: T-DG3-KBE-I changed no engine source):"; git diff --name-only $B..$C -- packages | grep -vE '\.test\.ts$' | sed 's/^/  /'
echo "## D4 repair commits and authors"; git log --format='  %h %an %s' $B..$C -- packages eslint.config.js docs/architecture
echo "## D5 full non-comment code diff of the seven closure sources and eslint.config.js (expect empty)"
git diff -U0 $B..$C -- packages/shared/src/formula/{evaluate,index,parse,tokenize,typecheck,types}.ts packages/shared/src/value.ts eslint.config.js | grep -E '^[-+][^-+]' | grep -vE '^[-+]\s*(//|\*|/\*\*)' | sed 's/^/  /'
echo "## D6 every try/catch/finally/yield/function*/Promise/then/EventTarget/addEventListener/hasInstance in the 7-file closure"
for f in packages/shared/src/formula/{evaluate,index,parse,tokenize,typecheck,types}.ts packages/shared/src/value.ts; do
  sed -e 's://.*$::' $f | grep -nE '\b(try|catch|finally|yield|Promise|then|EventTarget|addEventListener|hasInstance|Symbol)\b|function\s*\*' | sed "s|^|  $f:|"
done
echo "## D7 decimal.js 10.6.0 sources: eval( / Function( / try / catch / finally / Promise / async / yield / function* counts"
for f in node_modules/.pnpm/decimal.js@10.6.0/node_modules/decimal.js/decimal.js node_modules/.pnpm/decimal.js@10.6.0/node_modules/decimal.js/decimal.mjs; do
  printf '  %s:' "$(basename $f)"; for w in 'eval\(' 'Function\(' '\btry\b' '\bcatch\b' '\bfinally\b' '\bPromise\b' '\basync\b' '\byield\b' 'function\s*\*'; do printf ' %s=%s' "$w" "$(grep -cE "$w" $f)"; done; echo
done
echo "## D8 engine-source lint config: rules present for each closure file (calculateConfigForFile via --print-config)"
for f in packages/shared/src/formula/{evaluate,index,parse,tokenize,typecheck,types}.ts packages/shared/src/value.ts; do
  npx eslint --print-config $f 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const c=JSON.parse(s).rules;const sel=JSON.stringify(c["no-restricted-syntax"]);console.log("  '"$f"': no-unsafe-finally="+JSON.stringify(c["no-unsafe-finally"])+" catchSelector="+sel.includes("CatchClause:not(")+" evalErrorSelector="+sel.includes("Identifier[name=\x27EvalError\x27]")+" asyncSelector="+sel.includes("AwaitExpression")+" generatorSelector="+/generator|YieldExpression/.test(sel))})'
done
echo "## D9 secrets / CDN sweep on added product lines (expect none)"
git diff $B..$C -- apps packages eslint.config.js vitest.config.ts docs/architecture | grep -E '^\+' | grep -niE "(api[_-]?key|secret|password|token)\s*[:=]\s*['\"][^'\"]{8,}" || echo "  secrets: none"
git diff $B..$C -- apps packages eslint.config.js vitest.config.ts | grep -E '^\+' | grep -nE "https?://" | grep -vE "example\.invalid|localhost|127\.0\.0\.1" | sed 's/^/  /' || echo "  urls: none"
echo "## D10 eslint-disable comments added by the repair in engine sources (expect none)"; git diff $B..$C -- packages/shared/src/formula packages/shared/src/value.ts | grep -E '^\+.*eslint-disable' | grep -v '\.test\.' | sed 's/^/  /'; echo "  (end)"
echo "## D11 fuzz.test.ts diff: removed assertions (lines starting '-' with expect/it/test)"; git diff $B..$C -- packages/shared/src/formula/fuzz.test.ts | grep -E '^-\s*.*\b(expect|it|test)\(' | sed 's/^/  /'; echo "  (end)"
echo "## L1 advisory-lock keys 7302xx in source (expect 730219-730223, each defined once):"; git grep -nE "7302(19|2[0-9])" -- apps packages | grep -vE '\.test\.ts:' | sed 's/^/  /'
echo "## M1 migrations 0020-0027 present; changed since round 3 ($R3) or by the repair (expect none)"; ls packages/db/migrations | grep -E '^002[0-7]' | sed 's/^/  /'; git diff --name-status $R3..$C -- packages/db/migrations; echo "  (end)"
echo "## C1 p3-pending lists (expect every list empty: 0 entries)"; for f in $(git ls-files | grep 'p3-pending-.*\.ts$'); do printf '  %s: ' $f; grep -cE '^\s*"[a-zA-Z]+",?\s*$' $f; done
echo "## C2 OpenAPI operationIds"; grep -cE '^\s+operationId:' docs/api/openapi.yaml
echo "# end"

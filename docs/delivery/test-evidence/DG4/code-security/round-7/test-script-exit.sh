#!/usr/bin/env bash
# code-security-reviewer DG4 round 7: does the root `test` script still exit non-zero on any failure (T-DG4-FE-R10)?
# Part A: the EXACT script string from package.json (read with node at run time) is executed by /bin/sh (dash, the shell
# pnpm uses here) with a stub `vitest` first on PATH. The stub logs its arguments and exits with the code configured
# for its --project. All 8 pass/fail combinations; expected: rc 0 only when all three pass, all three invocations
# always run. Part B: the same with an extra argument appended, as `pnpm test <arg>` does.
set -u
REPO=${1:-/home/user/My-owns}
S=$(node -e "console.log(require('$REPO/package.json').scripts.test)")
echo "# script: $S"
W=$(mktemp -d "$TMPDIR/ts.XXXX"); mkdir -p $W/bin
cat > $W/bin/vitest <<'STUB'
#!/bin/sh
p=""; prev=""; for a in "$@"; do [ "$prev" = "--project" ] && p=$a; prev=$a; done
echo "vitest-stub $*" >> "$STUB_LOG"
case "$p" in unit-node) exit $RC_NODE;; unit-web) exit $RC_WEB;; unit-formula-nocodegen) exit $RC_FORM;; esac; exit 99
STUB
chmod +x $W/bin/vitest
fail=0
for n in 0 1; do for w in 0 1; do for f in 0 1; do
  : > $W/log; STUB_LOG=$W/log RC_NODE=$n RC_WEB=$w RC_FORM=$f PATH=$W/bin:$PATH /bin/sh -c "$S"; rc=$?
  runs=$(wc -l < $W/log); exp=$(( n|w|f ))
  ok=PASS; { [ $rc -ne 0 ] && [ $exp -eq 0 ]; } && ok=FAIL; { [ $rc -eq 0 ] && [ $exp -eq 1 ]; } && ok=FAIL; [ $runs -eq 3 ] || ok=FAIL
  [ $ok = PASS ] || fail=1
  echo "A node=$n web=$w formula=$f -> rc=$rc invocations=$runs expected_nonzero=$exp $ok"
done; done; done
for n in 0 1; do
  : > $W/log; STUB_LOG=$W/log RC_NODE=$n RC_WEB=0 RC_FORM=0 PATH=$W/bin:$PATH /bin/sh -c "$S --reporter=verbose"; rc=$?
  echo "B (appended --reporter=verbose) node=$n -> rc=$rc; stub received: $(tr '\n' '|' < $W/log)"
done
rm -rf $W
echo "# part A overall: $([ $fail -eq 0 ] && echo PASS || echo FAIL)"
exit $fail

#!/usr/bin/env bash
# qa-verifier mutation (negative-control) check: each mutation must make the matching acceptance suite FAIL.
set -u
M=$TMPDIR/mut
cd "$M"
run() { # run <label> <file> <python-replace-old> <new> <suite>
  local label="$1" file="$2" old="$3" new="$4" suite="$5"
  git checkout -q -- apps packages
  python3 - "$file" "$old" "$new" <<'PY'
import sys
p,o,n=sys.argv[1:4]
s=open(p).read()
assert s.count(o)==1, f"pattern not unique/absent in {p}: {s.count(o)}"
open(p,'w').write(s.replace(o,n))
PY
  echo "=== $label: $file"
  git diff --stat -- apps packages | tail -1
  bash tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration "$suite" > "$TMPDIR/mut-$label.log" 2>&1
  local rc=$?
  grep -E "Tests +[0-9]|✗|×|FAIL" "$TMPDIR/mut-$label.log" | head -8
  if [ $rc -ne 0 ]; then echo "RESULT $label: suite FAILED under mutation (exit $rc) -> mutation killed"; else echo "RESULT $label: suite PASSED under mutation -> mutation SURVIVED"; fi
}
run M1-read-not-denied apps/api/src/modules/access/policy.ts \
  "  if (!d.allowed) throw problems.notFound().withDenial(denialOf(permission, d.target));" \
  "  // mutated: denial ignored" tests/qa/integration/a12-cross-scope.test.ts
run M2-ledger-ignored apps/worker/src/handlers.ts \
  "    if (!ledger) return \"duplicate\";" "    // mutated: ledger result ignored" tests/qa/integration/a13-job-idempotency.test.ts
run M3-stale-accepted apps/api/src/modules/transformations/routes.ts \
  "  if (current.version !== expected) throw problems.versionConflict(current.version);" \
  "  // mutated: stale If-Match accepted" tests/qa/integration/a14-concurrency.test.ts
run M4-missing-ifmatch-accepted apps/api/src/modules/platform/http.ts \
  "  if (raw === undefined || raw === \"\") throw problems.preconditionRequired();" \
  "  if (raw === undefined || raw === \"\") return 1; // mutated" tests/qa/integration/a14-concurrency.test.ts
git checkout -q -- apps packages
echo "=== unmutated control"
bash tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration tests/qa > "$TMPDIR/mut-control.log" 2>&1; echo "control exit $?"; grep -E "Test Files|Tests " "$TMPDIR/mut-control.log"

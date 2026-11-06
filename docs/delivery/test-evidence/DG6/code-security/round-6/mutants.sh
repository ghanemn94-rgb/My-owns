#!/usr/bin/env bash
# code-security-reviewer, DG6 round 6 (T-DG6-REV-CS-R6): mutants that revert each round-5 repair, run in the disposable
# clone $TMPDIR/r/w3 (shared clone at 031945d8, node_modules hard-linked from w1; never the candidate tree). Each mutant
# edits product source in w3 only, runs the tests that should catch it, and restores the file (git checkout).
# Usage: mutants.sh <M1|M2|M3|M4|M0>   Logs: 5x-mutant-*.log, each ends "exit=<n>" (a mutant CAUGHT = non-zero exit).
set -u
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/code-security/round-6
W=$TMPDIR/r/w3
OLD=d7b21bad306f6aacf10eaea5848d5449dbc4043e
export PATH=/opt/node22/bin:$PATH MTH_PORT_POOL=30270-30279 QA_PG_PORT=30270
export MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET=qa-a17-synthetic-signing-secret-0001
unset LANG LC_ALL
cd "$W" || exit 2
SWEEP=apps/api/test/integration/access/sensitive-reach-sweep.test.ts
Z7B=apps/api/test/integration/access/sensitive-reach-dashboards-reports.test.ts
Z8=apps/api/test/integration/operations/concurrent-exception-recurrence.test.ts
vt() { tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration "$@"; }
run() {
  local name=$1
  shift
  {
    echo "# $name  started $(date -u +%FT%TZ)  node=$(node -v)  load=$(cut -d' ' -f1-3 /proc/loadavg)  commit=$(git rev-parse HEAD)"
    echo "## mutation (git diff of w3):"
    git diff --stat
    git diff
    echo "\$ $*"
    "$@"
    echo "exit=$?  finished $(date -u +%FT%TZ)"
  } >"$E/$name.log" 2>&1
  git checkout -q -- apps packages
  echo "restored: $(git status --short | wc -l) changed paths" >>"$E/$name.log"
  tail -2 "$E/$name.log"
}
case "$1" in
  M1)
    # F-DG6-360: the Executive Overview as in round 5 (no restriction, no flag).
    git show "$OLD:apps/api/src/modules/reporting/executive-overview.ts" >apps/api/src/modules/reporting/executive-overview.ts
    run 50-mutant-M1-overview-unrestricted vt "$SWEEP" "$Z7B"
    ;;
  M2)
    # F-DG6-361: hides() back to "default: false" and withoutRestrictedRefs without the shared SENSITIVE_CHILD_SOURCES rule.
    f=apps/api/src/modules/reporting/dashboards/restricted.ts
    python3 - "$f" <<'EOF'
import sys
p = sys.argv[1]; s = open(p).read()
a = "        return b !== undefined && benefits.restricted.has(b);\n      }\n    }"
assert a in s
s = s.replace(a, "        return false && b !== undefined && benefits.restricted.has(b);\n      }\n    }", 1)
b = "  const restricted = await restrictedRecordRefs(db, principal, refs);"
assert b in s
s = s.replace(b, "  const restricted = new Set<string>(); void refs; void restrictedRecordRefs;", 1)
open(p, "w").write(s)
EOF
    run 51-mutant-M2-drill-default-false vt "$SWEEP" "$Z7B"
    ;;
  M3)
    # F-DG6-340: report sections without the read-time includesRestrictedRecords member.
    f=apps/api/src/modules/reporting/reports/restricted.ts
    python3 - "$f" <<'EOF'
import sys
p = sys.argv[1]; s = open(p).read()
a = "      ? { includesRestrictedRecords: keys.some((k) => restricted.has(k)) }"
assert a in s
s = s.replace(a, "      ? {}", 1)
open(p, "w").write(s)
EOF
    run 52-mutant-M3-report-flag-removed vt "$Z7B"
    ;;
  M4)
    # F-DG6-380: last_occurred_at from the JavaScript Date again (both twins).
    for f in apps/api/src/modules/operations/exceptions.ts apps/worker/src/kit.ts; do
      python3 - "$f" <<'EOF'
import sys
p = sys.argv[1]; s = open(p).read()
a = "sql<Date>`greatest(now(), operational_exception.last_occurred_at)`"
assert a in s
s = s.replace(a, "sql<Date>`greatest(now(), ${current.last_occurred_at}::timestamptz)`", 1)
open(p, "w").write(s)
EOF
    done
    cp "$E/repro/zz-qa-dg6r5-concurrent-job-failure.test.ts" apps/api/test/integration/operations/zz-qa-dg6r5-concurrent-job-failure.test.ts
    run 53-mutant-M4-occurrence-js-date vt "$Z8" apps/api/test/integration/operations/zz-qa-dg6r5-concurrent-job-failure.test.ts
    rm -f apps/api/test/integration/operations/zz-qa-dg6r5-concurrent-job-failure.test.ts
    ;;
  M0)
    # The same tests on the unmutated candidate (control), plus the QA round-5 concurrency probe.
    cp "$E/repro/zz-qa-dg6r5-concurrent-job-failure.test.ts" apps/api/test/integration/operations/zz-qa-dg6r5-concurrent-job-failure.test.ts
    run 54-control-unmutated vt "$SWEEP" "$Z7B" "$Z8" apps/api/test/integration/operations/zz-qa-dg6r5-concurrent-job-failure.test.ts
    rm -f apps/api/test/integration/operations/zz-qa-dg6r5-concurrent-job-failure.test.ts
    ;;
esac

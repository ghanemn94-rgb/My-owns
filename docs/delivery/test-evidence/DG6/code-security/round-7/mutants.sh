#!/usr/bin/env bash
# code-security-reviewer, DG6 round 7 (T-DG6-REV-CS-R7): mutants that revert the F-DG6-420 repair (BE-Z10), run in the
# disposable clone $TMPDIR/r/w3 (shared clone at 70f05ed4, node_modules copied; never the candidate tree). Each mutant
# edits product source in w3 only, runs the tests that should catch it, and restores the file (git checkout).
# Usage: mutants.sh <M1|M2|M0>   Logs: 5x-mutant-*.log, each ends "exit=<n>" (a mutant CAUGHT = non-zero exit).
set -u
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/code-security/round-7
W=$TMPDIR/r/w3
export PATH=/opt/node22/bin:$PATH MTH_PORT_POOL=30470-30479 QA_PG_PORT=30470
export MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET=qa-a17-synthetic-signing-secret-0001
unset LANG LC_ALL
cd "$W" || exit 2
IDREFS=apps/api/test/integration/access/sensitive-reach-id-refs.test.ts
PROBE=tests/qa/integration/zz-cs-r7-id-refs.test.ts
vt() { tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration "$@"; }
run() {
  local name=$1
  shift
  cp "$E/repro/zz-cs-r7-id-refs.test.ts" "$PROBE"
  {
    echo "# $name  started $(date -u +%FT%TZ)  node=$(node -v)  load=$(cut -d' ' -f1-3 /proc/loadavg)  commit=$(git rev-parse HEAD)"
    echo "## mutation (git diff of w3, product paths):"
    git diff --stat -- apps/api/src
    git diff -- apps/api/src
    echo "\$ $*"
    "$@"
    echo "exit=$?  finished $(date -u +%FT%TZ)"
  } >"$E/$name.log" 2>&1
  rm -f "$PROBE"
  git checkout -q -- apps packages
  echo "restored: $(git status --short | wc -l) changed paths" >>"$E/$name.log"
  tail -2 "$E/$name.log"
}
case "$1" in
  M1)
    # F-DG6-420 groups: presentGroups no longer consults restrictedIdsOf (every member and the counted member shown).
    f=apps/api/src/modules/benefits/groups.ts
    python3 - "$f" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
a = '  const hidden = await restrictedIdsOf(db, principal, "benefit", ['
assert a in s
s = s.replace(a, '  const hidden = new Set<string>(); void principal; void restrictedIdsOf; void ([', 1)
open(p, "w").write(s)
PY
    run 50-mutant-M1-groups-unfiltered vt "$IDREFS" "$PROBE" -t "group|F-DG6-420"
    ;;
  M2)
    # F-DG6-420 measurements: evidenceIds no longer filtered.
    f=apps/api/src/modules/benefits/measurements.ts
    python3 - "$f" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
a = '  const hiddenEvidence = await restrictedIdsOf(db, principal, "evidence", [...evidence.values()].flat());'
assert a in s
s = s.replace(a, '  const hiddenEvidence = new Set<string>(); void principal; void restrictedIdsOf;', 1)
open(p, "w").write(s)
PY
    run 51-mutant-M2-measurement-evidence-unfiltered vt "$IDREFS" "$PROBE" -t "measurement|F-DG6-420"
    ;;
  M0)
    run 52-control-unmutated vt "$IDREFS" "$PROBE" -t "F-DG6-420"
    ;;
esac

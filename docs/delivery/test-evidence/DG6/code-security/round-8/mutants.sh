#!/usr/bin/env bash
# code-security-reviewer, DG6 round 8 (T-DG6-REV-CS-R8): mutants that revert parts of the F-DG6-480 repair (BE-Z12,
# BE-Z12B), run in the disposable clone $TMPDIR/r/w1 (shared clone at d84d11a6, node_modules copied; never the candidate
# tree). Each mutant edits product source in w3 only, runs the tests that should catch it (the in-tree BE-Z12 test and,
# for the launch task, the in-tree sweep), and restores the file (git checkout).
# Usage: mutants.sh <M1|M2|M3|M0>   Logs: 5x-mutant-*.log, each ends "exit=<n>" (a mutant CAUGHT = non-zero exit).
set -u
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/code-security/round-8
W=${W:-$TMPDIR/r/w1}
export PATH=/opt/node22/bin:$PATH MTH_PORT_POOL=30670-30679 QA_PG_PORT=30670
export MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET=qa-a17-synthetic-signing-secret-0001
unset LANG LC_ALL
cd "$W" || exit 2
Z12=apps/api/test/integration/access/sensitive-reach-id-refs-z12.test.ts
SWEEP=apps/api/test/integration/access/sensitive-reach-sweep.test.ts
Z12B=apps/api/test/integration/access/sensitive-reference-pending-z12b.test.ts
REG=apps/api/test/integration/access/sensitive-reach-registers.test.ts
vt() { tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration "$@"; }
mutate() {
  python3 - "$1" "$2" "$3" <<'PY'
import sys
p, a, b = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
assert a in s, f"anchor not found in {p}: {a!r}"
open(p, "w").write(s.replace(a, b, 1))
PY
}
run() {
  local name=$1
  shift
  {
    echo "# $name  started $(date -u +%FT%TZ)  node=$(node -v)  load=$(cut -d' ' -f1-3 /proc/loadavg)  commit=$(git rev-parse HEAD)"
    echo "## mutation (git diff of w3, product paths):"
    git diff --stat -- apps/api/src
    git diff -- apps/api/src
    echo "\$ $*"
    "$@"
    echo "exit=$?  finished $(date -u +%FT%TZ)"
  } >"$E/$name.log" 2>&1
  git checkout -q -- apps packages
  echo "restored: $(git status --short | grep -v '^??' | wc -l) changed tracked paths" >>"$E/$name.log"
  tail -2 "$E/$name.log"
}
case "$1" in
  M1)
    # launch task read: presentTasks no longer hides a restricted outputRecordId.
    mutate apps/api/src/modules/launch/tasks.ts \
      '  return hideRestrictedTypedRefs(db, principal, tasks, "outputRecordType", "outputRecordId");' \
      '  void hideRestrictedTypedRefs; void principal; return tasks;'
    run 50-mutant-M1-launch-task-output-unhidden vt "$Z12" -t "B3"
    ;;
  M2)
    # launch task write: a hidden output is no longer refused as an unknown id (the round-7 200 oracle).
    mutate apps/api/src/modules/launch/tasks.ts \
      '  if (typeof body.outputRecordId === "string" && (await refIsRestricted(tx, ctx.principal, outputType, outputId)))' \
      '  if (false as boolean)'
    run 51-mutant-M2-launch-task-write-oracle vt "$Z12" -t "B3"
    ;;
  M3)
    # work items (BE-Z12B, D-222): a restricted work item keeps its subject id and link again.
    mutate apps/api/src/modules/tasks/routes.ts \
      '        subjectId: null,
        linkPath: restrictedWorkItemLink(r.transformation_id),' \
      '        subjectId: r.subject_id,
        linkPath: r.link_path,'
    run 52-mutant-M3-work-item-ids-kept vt "$REG" -t "D-222"
    ;;
  M4)
    # benefit parent (BE-Z12): presentBenefits no longer hides a restricted parentBenefitId.
    mutate apps/api/src/modules/benefits/register.ts \
      '  const parents = await hideRestrictedRefs(db, principal, "benefit", shown, "parentBenefitId");' \
      '  const parents = shown;'
    run 53-mutant-M4-benefit-parent-unhidden vt "$Z12" -t "B1"
    ;;
  M0)
    run 59-control-unmutated vt "$Z12" "$Z12B" "$REG"
    ;;
esac

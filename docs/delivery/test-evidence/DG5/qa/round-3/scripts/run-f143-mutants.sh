#!/usr/bin/env bash
# qa-verifier DG5 round 3: adversarial check of the F-DG5-143 repair (the auditor test of
# apps/web/e2e/p3-prioritization-roadmap.spec.ts must still detect an approve or move control shown to the read-only
# auditor). Each mutant edits ONE guard in the disposable clone's web source, rebuilds apps/web/dist, runs the whole
# p3-prioritization-roadmap spec (its serial tests build the state the auditor test reads) in chromium-en and
# chromium-ar on the real stack, then restores the file (git checkout) — nothing else of mine may use the clone's dist
# meanwhile. A mutant is KILLED when the auditor test fails on the APPROVE_OR_MOVE assertion in both projects.
#  M1 RoadmapPage.tsx: canApprove = true   -> "Approve date of …" / «اعتماد تاريخ …» rendered for the auditor
#  M2 RoadmapPage.tsx: canMove = true      -> "Move …" / «نقل …» rendered for the auditor
# Afterwards the clone is restored, dist rebuilt from the frozen source, and the candidate id re-checked.
# $1 = unset|cutf8 locale mode, $2 = first PG port (uses $2..$2+5).
set -u
MODE=$1 P=$2
C=${CLONE:-$TMPDIR/review-dg5}; E=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-3
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
F=apps/web/src/pages/roadmap/RoadmapPage.tsx
L=$E/09-f143-mutation-setup-$MODE.log
cd "$C"
build() { (cd apps/web && pnpm build) > $TMPDIR/web-build.log 2>&1; echo "web build EXIT $? ($(tail -1 $TMPDIR/web-build.log | sed "s#$TMPDIR#\$TMPDIR#g"))"; }
{
for M in M1 M2; do
  git checkout -q -- $F
  case $M in
    M1) sed -i 's/const canApprove = can("roadmap.approve");/const canApprove = true; \/\/ QA MUTANT M1/' $F;;
    M2) sed -i 's/const canMove = can("roadmap.edit") || can("initiative.edit");/const canMove = true; \/\/ QA MUTANT M2/' $F;;
  esac
  echo "== $M ($(date -u +%FT%TZ)) diff:"; git diff -- $F | sed -n '1,40p'
  build
  bash $E/scripts/run-e2e.sh $MODE $P $((P+1)) f143-$M product apps/web/e2e/p3-prioritization-roadmap.spec.ts
  P=$((P+2))
done
git checkout -q -- $F
echo "== restore ($(date -u +%FT%TZ)): tracked changes: $(git status --porcelain --untracked-files=no | wc -l)"
build
node tools/gates/candidate.mjs --stage DG5
} > $L 2>&1
cat $L

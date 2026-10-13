#!/usr/bin/env bash
# qa-verifier DG4 round 9: B2 re-verification of qa's closed findings on the rewritten history (in the disposable clone).
# For each finding: fix_revision is a commit and an ancestor of f2ae717; each listed fix commit is an ancestor of fix_revision and of f2ae717;
# each remapped commit maps back to its old id in the SHA map; the old and new commits change the same content outside docs/delivery.
set -u
C=$TMPDIR/review-dg4r9; M=/home/user/My-owns/docs/delivery/test-evidence/DG4/history-rewrite-D-136.shamap.txt; SRC=f2ae7170630456a772e1ceac90ab6d96b68e3f5c
cd $C
chk() { local id=$1 fr=$2; shift 2; echo "=== $id fix_revision $fr"
  echo "  type: $(git cat-file -t $fr)  ancestor-of-src: $(git merge-base --is-ancestor $fr $SRC && echo yes || echo NO)"
  for fc in "$fr" "$@"; do full=$(git rev-parse $fc); old=$(awk -v n=$full '$2==n{print $1}' $M)
    echo "  commit $full: ancestor-of-src $(git merge-base --is-ancestor $full $SRC && echo yes || echo NO); ancestor-of-fix_revision $(git merge-base --is-ancestor $full $fr && echo yes || echo NO)"
    echo "    subject: $(git log -1 --format=%s $full | cut -c1-150)"
    if [ -n "$old" ]; then
      echo "    maps from old $old (subject equal: $([ "$(git log -1 --format=%s%aI%cI $old)" = "$(git log -1 --format=%s%aI%cI $full)" ] && echo yes || echo NO))"
      a=$(git diff $old^ $old -- . ':!docs/delivery' | sha256sum | cut -c1-16); b=$(git diff $full^ $full -- . ':!docs/delivery' | sha256sum | cut -c1-16)
      echo "    product diff (outside docs/delivery) old $a new $b equal: $([ $a = $b ] && echo yes || echo NO); files: $(git diff --name-only $full^ $full -- . ':!docs/delivery' | tr '\n' ' ')"
      a=$(git diff $old^ $old | sha256sum | cut -c1-16); b=$(git diff $full^ $full | sha256sum | cut -c1-16); echo "    full commit diff equal: $([ $a = $b ] && echo yes || echo "no (differs only if restored run paths are touched)")"
      echo "    delivery files: $(git diff --name-only $full^ $full -- docs/delivery | tr '\n' ' ' | cut -c1-400)"
    else echo "    NOT IN SHA MAP"; fi
  done; }
chk F-DG4-140 12bb5c81b7c25972d8099b792b0b86178586343b 12bb5c81b7
chk F-DG4-141 07b72f32611295d979b3055dc04cdfa830126d2a 07b72f3261
chk F-DG4-143 5f68ba25a2b49d4ed48f066a4c77635847d56249 5f68ba25a2
chk F-DG4-144 5f68ba25a2b49d4ed48f066a4c77635847d56249 5f68ba25a2
chk F-DG4-145 9b6b3ed17aceaba5eb6500129160a66bfa9a4e82 9d66f671c9 9b6b3ed17a
chk F-DG4-146 c675003488f6d10fbd3b0b914ecf2a740109be5d c675003488
chk F-DG4-147 c675003488f6d10fbd3b0b914ecf2a740109be5d c675003488
echo DONE

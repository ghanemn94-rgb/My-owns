#!/usr/bin/env bash
# domain-reviewer DG4 round 9: check the D-136 history-rewrite claim in the complete clone $TMPDIR/review-r9
# (the old commits are reachable only via origin/backup/pre-dg4-writeonce-repair-72c0e653a3).
set -u
R=/home/user/My-owns; C="$TMPDIR/review-r9"; cd "$C"
MAP=$R/docs/delivery/test-evidence/DG4/history-rewrite-D-136.shamap.txt
RP=$R/docs/delivery/test-evidence/DG4/history-rewrite-D-136.restored-paths.txt
B=origin/backup/pre-dg4-writeonce-repair-72c0e653a3
echo "### backup ref $(git rev-parse $B)"
echo "### git diff $B a445b2470b --stat"; git diff $B a445b2470b --stat; echo "exit=$?"
echo "### name-status summary"; git diff --name-status $B a445b2470b | cut -f1 | sort | uniq -c
echo "### all paths under docs/delivery/runs/DG4? non-runs count: $(git diff --name-only $B a445b2470b | grep -vc '^docs/delivery/runs/DG4/')"
echo "### paths equal restored-paths.txt list?"; diff <(git diff --name-only $B a445b2470b | sort) <(grep -v '^#' $RP | awk '{print $4}' | sort) && echo "IDENTICAL (33 expected: $(grep -vc '^#' $RP))"
echo "### restored blobs equal those listed?"; bad=0; while read -r oc mode blob path; do [ "$oc" = "#" ] && continue; nb=$(git rev-parse a445b2470b:"$path"); [ "$nb" = "$blob" ] || { bad=$((bad+1)); echo "MISMATCH $path $nb vs $blob"; }; done < <(grep -v '^#' $RP); echo "blob mismatches=$bad"
echo "### map: $(grep -vc '^#' $MAP) pairs; every old in backup ancestry, every new in f2ae717 ancestry?"
nb=0; nn=0; while read -r o n; do git merge-base --is-ancestor $o $B || nb=$((nb+1)); git merge-base --is-ancestor $n a445b2470b || nn=$((nn+1)); done < <(grep -v '^#' $MAP); echo "old-not-in-backup=$nb new-not-in-a445b24=$nn"
echo "### full-map comparison: subject, author name/email/date, committer name/email/date equal for every pair"
mm=0; while read -r o n; do a=$(git log -1 --format='%s|%an|%ae|%aI|%cn|%ce|%cI' $o); b=$(git log -1 --format='%s|%an|%ae|%aI|%cn|%ce|%cI' $n); [ "$a" = "$b" ] || { mm=$((mm+1)); echo "META MISMATCH $o $n"; }; done < <(grep -v '^#' $MAP); echo "metadata mismatches=$mm"
echo "### full-map tree comparison: git diff <old> <new> lists only restored run files"
tm=0; while read -r o n; do x=$(git diff --name-only $o $n | grep -vxFf <(grep -v '^#' $RP | awk '{print $4}') | wc -l); [ "$x" = 0 ] || { tm=$((tm+1)); echo "TREE EXTRA $o $n: $x"; }; done < <(grep -v '^#' $MAP); echo "pairs with non-restored differences=$tm"
echo "### detailed spot checks (5 lines of the map)"
for o in 8553323d6938d5c5077661070ab9f8df2d8dc969 7a261742f1a9496266967281ee5bc9d8d5cae18c $(grep -v '^#' $MAP | awk 'NR==120{print $1}') $(grep -v '^#' $MAP | awk 'NR==250{print $1}') $(grep -v '^#' $MAP | tail -1 | awk '{print $1}'); do
  n=$(awk -v o=$o '$1==o{print $2}' $MAP); echo "-- old $o -> new $n"
  echo "   old: $(git log -1 --format='%s | author %aI | committer %cI' $o)"
  echo "   new: $(git log -1 --format='%s | author %aI | committer %cI' $n)"
  echo "   git diff old new --name-only:"; git diff --name-only $o $n | sed 's/^/     /'; echo "   (count $(git diff --name-only $o $n | wc -l), non-runs $(git diff --name-only $o $n | grep -vc '^docs/delivery/runs/DG4/'))"
done
echo "### eda5588 parent untouched (rewrite start): first map old commit's parent mapped? $(git log -1 --format=%P $(grep -v '^#' $MAP | tail -1 | awk '{print $1}')) vs new parent $(git log -1 --format=%P $(grep -v '^#' $MAP | tail -1 | awk '{print $2}'))"

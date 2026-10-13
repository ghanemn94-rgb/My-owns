#!/usr/bin/env bash
# code-security-reviewer DG4 round 9: independent check of the D-136 history rewrite (read-only git, repository tree).
set -u
R=/home/user/My-owns; cd $R
MAP=docs/delivery/test-evidence/DG4/history-rewrite-D-136.shamap.txt
RP=docs/delivery/test-evidence/DG4/history-rewrite-D-136.restored-paths.txt
OLD=backup/pre-dg4-writeonce-repair-72c0e653a3; NEW=a445b2470b
echo "# D-136 rewrite check $(date -u +%FT%TZ) load $(cut -d' ' -f1-3 /proc/loadavg)"
echo "\$ git rev-parse $OLD $NEW"; git rev-parse $OLD $NEW
echo "\$ git diff $OLD $NEW --stat"; git diff $OLD $NEW --stat
echo "\$ git diff --name-status $OLD $NEW | cut -f1 | sort | uniq -c   (expect 33 A)"; git diff --name-status $OLD $NEW | cut -f1 | sort | uniq -c
echo "\$ paths added vs restored-paths.txt (expect identical)"
diff <(git diff --name-only $OLD $NEW | sort) <(grep -v '^#' $RP | awk '{print $4}' | sort) && echo "IDENTICAL (33 paths)"
echo "\$ blob of each restored path at $NEW and at <deletion-commit>^ in the old history equals restored-paths.txt blob"
bad=0; while read -r del mode blob path; do
  [ "${del:0:1}" = "#" ] && continue
  nb=$(git rev-parse "$NEW:$path" 2>/dev/null); ob=$(git rev-parse "$del^:$path" 2>/dev/null); od=$(git cat-file -e "$del:$path" 2>/dev/null && git rev-parse "$del:$path" || echo ABSENT)
  [ "$nb" = "$blob" ] && [ "$ob" = "$blob" ] && [ "$od" = "ABSENT" ] || { echo "MISMATCH $path new=$nb old-parent=$ob at-deletion=$od"; bad=$((bad+1)); }
done < $RP; echo "blob mismatches: $bad (33 checked; each absent at its old deletion commit, present at its parent)"
echo "\$ every map pair: subject, author name/email/date, committer name/email/date equal; product diff empty; diff only restored run paths"
n=0; f=0; while read -r o nw; do
  [ "${o:0:1}" = "#" ] && continue; n=$((n+1))
  a=$(git log -1 --format='%s%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%P' $o | sed 's/\x00/|/g')
  b=$(git log -1 --format='%s%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI' $nw | sed 's/\x00/|/g')
  am=${a%|*}; [ "$am" = "$b" ] || { echo "META DIFF $o $nw"; f=$((f+1)); }
  extra=$(git diff --name-only $o $nw | grep -vxF -f <(grep -v '^#' $RP | awk '{print $4}') | wc -l)
  [ "$extra" = 0 ] || { echo "NON-RESTORED DIFF $o $nw ($extra paths)"; f=$((f+1)); }
done < $MAP; echo "pairs checked: $n, failures: $f"
echo "\$ spot-checks (verbose) for 3 pairs: round-8 source, round-7 source, the old HEAD"
for p in "8553323d6938d5c5077661070ab9f8df2d8dc969 5cd1e06ca83b0b916566024bd99102c060e86e0b" "dab4562c71ab4f0a8e5b89b32ad93a0861539598 8953eec337fe75dc6329ef01d8a7057d90f37da4" "72c0e653a39b0eaec6721ed891e41cdd19c5b169 a445b2470bbbf8fbde2e78dcdc2955a94547414b"; do
  set -- $p; echo "-- old $1 / new $2"
  git log -1 --format='   old: %s | author %an %aI | committer %cn %cI' $1
  git log -1 --format='   new: %s | author %an %aI | committer %cn %cI' $2
  echo "   git diff old new --name-only | cut -d/ -f1-4 | uniq -c:"; git diff --name-only $1 $2 | cut -d/ -f1-4 | sort | uniq -c
  echo "   git diff --quiet old new -- . ':!docs/delivery/runs' -> $(git diff --quiet $1 $2 -- . ':!docs/delivery/runs'; echo rc=$?)"
done
echo "\$ DG3 gate commit bc8f455 is an ancestor of both heads and of eda5588's parent (rewrite starts after it)"
for c in $OLD $NEW eda5588^; do git merge-base --is-ancestor bc8f455 $c; echo "bc8f455 ancestor of $c: rc=$?"; done
echo "\$ commit count rewritten: old eda5588^..$OLD = $(git rev-list --count eda5588^..$OLD), map pairs = $n"
echo "\$ new history contains no old (pre-rewrite) commit from the map: $(git rev-list f2ae717 | grep -cxF -f <(grep -v '^#' $MAP | awk '{print $1}'))"
echo "# done"

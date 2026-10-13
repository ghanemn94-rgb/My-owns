#!/usr/bin/env bash
# qa-verifier DG4 round 9: D-136 rewrite checks in the disposable clone (which carries origin/backup/pre-dg4-writeonce-repair-72c0e653a3).
# 1) 72c0e65 vs a445b24 diff (expect 33 added run files = restored-paths list); 2) every SHA-map pair: same subject, author name/email/date,
# committer name/email/date, and tree diff old->new lists only restored paths; 3) per-commit product patch (outside docs/delivery) identical.
set -u
C=$TMPDIR/review-dg4r9; M=/home/user/My-owns/docs/delivery/test-evidence/DG4/history-rewrite-D-136.shamap.txt; RP=/home/user/My-owns/docs/delivery/test-evidence/DG4/history-rewrite-D-136.restored-paths.txt
cd $C
echo "## backup ref: $(git rev-parse origin/backup/pre-dg4-writeonce-repair-72c0e653a3)"
echo "## git diff origin/backup/pre-dg4-writeonce-repair-72c0e653a3 a445b2470b --stat (tail)"; git diff origin/backup/pre-dg4-writeonce-repair-72c0e653a3 a445b2470b --stat | tail -3
echo "## name-status letters:"; git diff --name-status origin/backup/pre-dg4-writeonce-repair-72c0e653a3 a445b2470b | cut -f1 | sort | uniq -c
grep -v '^#' $RP | awk '{print $4}' | sort > $TMPDIR/restored.txt
git diff --name-only origin/backup/pre-dg4-writeonce-repair-72c0e653a3 a445b2470b | sort > $TMPDIR/headdiff.txt
echo "## restored list n=$(wc -l < $TMPDIR/restored.txt); head diff n=$(wc -l < $TMPDIR/headdiff.txt); identical sets: $(cmp -s $TMPDIR/restored.txt $TMPDIR/headdiff.txt && echo yes || echo NO)"
echo "## all files under docs/delivery/runs/DG4: $(grep -vc '^docs/delivery/runs/DG4/' $TMPDIR/headdiff.txt) outside"
echo "## blob check: restored blobs equal the recorded blob in a445b24"
bad=0; while read -r dc mode blob path; do [ "${dc:0:1}" = "#" ] && continue; nb=$(git rev-parse "a445b2470b:$path" 2>/dev/null); [ "$nb" = "$blob" ] || { echo "  BLOB MISMATCH $path"; bad=$((bad+1)); }; done < $RP; echo "  mismatches: $bad"
n=0; fs=0; ft=0; fp=0
while read -r old new; do [ "${old:0:1}" = "#" ] && continue; n=$((n+1))
  a=$(git log -1 --format='%s|%an|%ae|%aI|%cn|%ce|%cI|%P' $old | sed 's/|[^|]*$//'); b=$(git log -1 --format='%s|%an|%ae|%aI|%cn|%ce|%cI|%P' $new | sed 's/|[^|]*$//')
  [ "$a" = "$b" ] || { fs=$((fs+1)); echo "  META DIFF $old $new"; }
  extra=$(git diff --name-only $old $new | grep -vxF -f $TMPDIR/restored.txt | wc -l); [ $extra -eq 0 ] || { ft=$((ft+1)); echo "  TREE DIFF outside restored $old $new: $extra"; }
  po=$(git diff $old^ $old -- . ':!docs/delivery' 2>/dev/null | git patch-id --stable | cut -d' ' -f1); pn=$(git diff $new^ $new -- . ':!docs/delivery' 2>/dev/null | git patch-id --stable | cut -d' ' -f1)
  [ "$po" = "$pn" ] || { fp=$((fp+1)); echo "  PRODUCT PATCH DIFF $old $new"; }
done < $M
echo "## pairs checked: $n; metadata mismatches: $fs; tree diffs outside restored paths: $ft; product first-parent patch mismatches: $fp"
echo "## spot-check lines (3):"; for L in 11 40 200; do read -r old new < <(sed -n ${L}p $M); echo "line $L: $old -> $new"; git log -1 --format='  old: %s | a=%aI c=%cI' $old; git log -1 --format='  new: %s | a=%aI c=%cI' $new; echo "  git diff old new --name-only:"; git diff --name-only $old $new | sed 's/^/    /'; echo "  (end)"; done
echo "## diff 5cd1e06..f2ae717 outside docs/delivery:"; git diff --name-only 5cd1e06..f2ae7170630456a772e1ceac90ab6d96b68e3f5c -- . ':!docs/delivery' | wc -l
echo "## diff 5cd1e06..f2ae717 file list:"; git diff --name-status 5cd1e06..f2ae7170630456a772e1ceac90ab6d96b68e3f5c
echo "## requirements.csv diff lines 5cd1e06..f2ae717: $(git diff 5cd1e06..f2ae717 -- docs/delivery/requirements.csv | wc -l)"
echo "## 5cd1e06 maps from 8553323: $(grep -c '^8553323d6938d5c5077661070ab9f8df2d8dc969 5cd1e06' $M)"
echo "## old 8553323 vs new 5cd1e06 tree outside docs/delivery: $(git diff --name-only 8553323d6938 5cd1e06 -- . ':!docs/delivery' | wc -l)"
echo "## old dab4562 (round-7 source) product tree vs f2ae717: $(git diff --name-only dab4562 f2ae717 -- . ':!docs/delivery' | wc -l)"
echo DONE

#!/usr/bin/env bash
# domain-reviewer DG4 round 9: re-verify F-DG4-120..128 after the D-136 rewrite, in the complete clone $TMPDIR/review-r9.
# (1) fix_revision and every listed fix commit are commits and ancestors of the candidate source f2ae717;
# (2) each remapped commit maps to its old id in the SHA map, and old vs new change the same product content;
# (3) the fix is still present at f2ae717: the fix commits' added product lines still present verbatim in the candidate files.
set -u
R=/home/user/My-owns; C="$TMPDIR/review-r9"; cd "$C"
MAP=$R/docs/delivery/test-evidence/DG4/history-rewrite-D-136.shamap.txt
SRC=f2ae7170630456a772e1ceac90ab6d96b68e3f5c
declare -A FIXREV=( [F-DG4-120]=07b72f32611295d979b3055dc04cdfa830126d2a [F-DG4-121]=f68c87a86ba3a19a27728d866011e3d0e29cf3ea [F-DG4-122]=f9bcba1bf17d535ff76a145ac735b9c964676c8c [F-DG4-123]=8ed26e89c096873e90280bf04ca28bf48d1a05ae [F-DG4-124]=276623e3bf96fa2d35aeef795126931d5504d01d [F-DG4-125]=228e499c6627d0a149329257a6d4be786afd94c8 [F-DG4-126]=f8ed23c4fad9cc4fa21b71b307b2470f81536c83 [F-DG4-127]=f8ed23c4fad9cc4fa21b71b307b2470f81536c83 [F-DG4-128]=8178750761c511c243c6b9a342dc4f39d5966bcc )
declare -A FIXES=( [F-DG4-120]="07b72f3261" [F-DG4-121]="a7bfc9d8b6 70fcefa172 07b72f3261" [F-DG4-122]="f9bcba1bf1" [F-DG4-123]="042f258287 8a468432e0 f9bcba1bf1" [F-DG4-124]="276623e3bf" [F-DG4-125]="0595b87a8e 68b8ba658f 23eadb5d31 b9d41dd9f3" [F-DG4-126]="22ef6c7832 4336273321 0595b87a8e" [F-DG4-127]="22ef6c7832 4336273321 0595b87a8e" [F-DG4-128]="8178750761" )
echo "### findings.json state of F-DG4-120..128 (repo HEAD)"
node -e 'const f=require(process.argv[1]);const a=f.findings||f;for(const x of a){if(/^F-DG4-12[0-8]$/.test(x.id))console.log(x.id,x.severity,"mandatory="+x.mandatory_violation,x.status,"fix_revision="+x.fix_revision,"reported_by="+x.reported_by)}' $R/docs/delivery/findings.json
pd() { git diff "$1^" "$1" -- . ':!docs/delivery' | grep -v '^index ' ; }
for F in F-DG4-120 F-DG4-121 F-DG4-122 F-DG4-123 F-DG4-124 F-DG4-125 F-DG4-126 F-DG4-127 F-DG4-128; do
  echo; echo "================ $F  fix_revision ${FIXREV[$F]}"
  for c in ${FIXREV[$F]} ${FIXES[$F]}; do
    full=$(git rev-parse --verify -q "$c^{commit}") || { echo "  NOT A COMMIT $c"; continue; }
    git merge-base --is-ancestor $full $SRC; anc=$?
    old=$(awk -v n=$full '$2==n{print $1}' $MAP)
    if [ -n "$old" ]; then
      a=$(pd $old | sha256sum | cut -c1-16); b=$(pd $full | sha256sum | cut -c1-16)
      same=$([ "$a" = "$b" ] && echo SAME || echo DIFFERENT)
      ma=$(git log -1 --format='%s|%aI|%cI' $old); mb=$(git log -1 --format='%s|%aI|%cI' $full); meta=$([ "$ma" = "$mb" ] && echo meta-equal || echo META-DIFF)
      ob=$(git merge-base --is-ancestor $old origin/backup/pre-dg4-writeonce-repair-72c0e653a3 && echo in-backup || echo NOT-in-backup)
    else a=-; b=-; same="NO-MAP-ENTRY"; meta=-; ob=-; fi
    echo "  $c -> $full ancestor-of-f2ae717=$([ $anc = 0 ] && echo yes || echo NO) old=$old ($ob) product-diff old=$a new=$b $same $meta"
    echo "     subject: $(git log -1 --format=%s $full | cut -c1-160)"
  done
  # (3) presence: added product lines of each listed fix commit still present in the candidate file
  for c in ${FIXES[$F]}; do
    full=$(git rev-parse $c); tot=0; pres=0; files=0
    while read -r f; do files=$((files+1))
      if git cat-file -e $SRC:"$f" 2>/dev/null; then
        cand=$(git show $SRC:"$f")
        while IFS= read -r l; do t="$(echo "$l" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"; [ ${#t} -lt 12 ] && continue; tot=$((tot+1)); grep -qF -- "$t" <<< "$cand" && pres=$((pres+1)); done < <(git diff $full^ $full -- "$f" | grep '^+' | grep -v '^+++' | cut -c2-)
      fi
    done < <(git diff --name-only $full^ $full -- . ':!docs/delivery')
    echo "  presence $c: product files touched=$files, substantive added lines=$tot, still present verbatim at f2ae717=$pres"
  done
done

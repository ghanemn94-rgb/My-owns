#!/usr/bin/env bash
# code-security-reviewer DG4 round 9: B2 re-verification, parts 1 and 2 (ancestry; SHA map; old vs new product content).
set -u; cd /home/user/My-owns
MAP=docs/delivery/test-evidence/DG4/history-rewrite-D-136.shamap.txt
CAND=f2ae7170630456a772e1ceac90ab6d96b68e3f5c
old_of() { awk -v n="$1" '$2==n{print $1}' $MAP; }
echo "# $(date -u +%FT%TZ) load $(cut -d' ' -f1-3 /proc/loadavg); candidate source $CAND"
check() { # finding fix_revision fixcommits...
  local f=$1 fr=$2; shift 2
  echo "== $f fix_revision $fr"
  echo "   findings.json fix_revision: $(python3 -c "import json,sys;d=json.load(open('docs/delivery/findings.json'));d=d['findings'] if isinstance(d,dict) else d;print([x.get('fix_revision') for x in d if x['id']=='$f'][0])")"
  for c in $fr "$@"; do
    full=$(git rev-parse --verify -q "$c^{commit}") || { echo "   $c NOT A COMMIT"; continue; }
    git merge-base --is-ancestor $full $CAND; anc=$?
    o=$(old_of $full)
    if [ -n "$o" ]; then
      a=$(git diff $o^ $o -- . ':!docs/delivery' | sha256sum | cut -c1-16); b=$(git diff $full^ $full -- . ':!docs/delivery' | sha256sum | cut -c1-16)
      na=$(git diff --name-only $o^ $o -- . ':!docs/delivery' | wc -l)
      same=$([ "$a" = "$b" ] && echo SAME || echo DIFFERENT)
      sub=$( [ "$(git log -1 --format=%s%aI $o)" = "$(git log -1 --format=%s%aI $full)" ] && echo same-subject-date || echo SUBJECT-DIFF)
      echo "   $full ancestor-of-candidate rc=$anc | old $o | $sub | product diff (excl docs/delivery) old $a new $b ($na files) $same"
      echo "     subject: $(git log -1 --format=%s $full | cut -c1-140)"
      echo "     files: $(git diff --name-only $full^ $full -- . ':!docs/delivery' | tr '\n' ' ' | cut -c1-600)"
    else echo "   $full ancestor rc=$anc | NOT IN MAP"; fi
  done
}
check F-DG4-100 5d6f4802f9f737f9f93f033dc9f48b54d43ab526 70fcefa172 bff9725eb2
echo "   F-DG4-100 fix_revision contains both fix commits: $(git merge-base --is-ancestor 70fcefa172 5d6f4802f9; echo rc=$?) $(git merge-base --is-ancestor bff9725eb2 5d6f4802f9; echo rc=$?)"
check F-DG4-101 70fcefa172ef522a3dfc9515bfd53e179a9e49b2 70fcefa172
check F-DG4-102 07b72f32611295d979b3055dc04cdfa830126d2a 07b72f3261
check F-DG4-103 bff9725eb2769df6df885f4fbcc113dd9ddfa7b5 bff9725eb2
check F-DG4-104 276623e3bf96fa2d35aeef795126931d5504d01d 276623e3bf
check F-DG4-105 433627332166c48e73a032b095ebefaa29b72169 22ef6c7832 4336273321
echo "   F-DG4-105 fix_revision contains 22ef6c7832: $(git merge-base --is-ancestor 22ef6c7832 4336273321; echo rc=$?)"
check F-DG4-106 9b6b3ed17aceaba5eb6500129160a66bfa9a4e82 9d66f671c9 9b6b3ed17a
echo "   F-DG4-106 fix_revision contains 9d66f671c9: $(git merge-base --is-ancestor 9d66f671c9 9b6b3ed17a; echo rc=$?)"
echo "== F-DG4-104 is a records fix: diff of its commit (docs/delivery included), old vs new"
o=$(old_of $(git rev-parse 276623e3bf)); echo "   old $o"; a=$(git diff $o^ $o | sha256sum|cut -c1-16); b=$(git diff 276623e3bf^ 276623e3bf | sha256sum|cut -c1-16); echo "   full diff old $a new $b"; git diff --stat 276623e3bf^ 276623e3bf | tail -4
echo "# done"

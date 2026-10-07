#!/bin/bash
# qa-verifier DG2 round 17: `pnpm test` on clone $TMPDIR/review-dg2 @805da3e2 (candidate ddaab3cc), 3x Node 22.22.2 and
# 3x Node 24.21.0 alternating the locale setting ('unset' = env -u LANG -u LC_ALL; 'cutf8' = env -u LC_ALL LANG=C.UTF-8),
# then once on Node 24 under moderate CPU load (2 busy loops on a 4-CPU host, killed afterwards).
cd $TMPDIR/review-dg2
E=/home/user/My-owns/docs/delivery/test-evidence/DG2/qa/round-17/unit
one() { nodebin=$1; name=$2; loc=$3
  if [ $loc = unset ]; then L="env -u LANG -u LC_ALL"; else L="env -u LC_ALL LANG=C.UTF-8"; fi
  { echo "\$ $L PATH=$nodebin:\$PATH pnpm test"; echo "# clone @805da3e2; node $(PATH=$nodebin:$PATH node -v); $(date -u +%FT%TZ)";
    $L PATH=$nodebin:$PATH pnpm test 2>&1; echo "exit $?"; } | sed "s#$TMPDIR#\$TMPDIR#g" > $E/$name.log
  echo "$name: $(grep -E '^\s+Tests ' $E/$name.log | tail -n 1) $(tail -n 1 $E/$name.log)"; }
N22=/opt/node22/bin; N24=/opt/nvm/versions/node/v24.21.0/bin
one $N22 node22-run1-unset unset
one $N24 node24-run1-unset unset
one $N22 node22-run2-cutf8 cutf8
one $N24 node24-run2-cutf8 cutf8
one $N22 node22-run3-unset unset
one $N24 node24-run3-cutf8 cutf8
echo "loadavg-before: $(cat /proc/loadavg)" > $E/node24-load-cutf8.loadavg
( while :; do :; done ) & b1=$!; ( while :; do :; done ) & b2=$!
one $N24 node24-load-cutf8 cutf8
kill $b1 $b2
echo "loadavg-after: $(cat /proc/loadavg)" >> $E/node24-load-cutf8.loadavg
echo unit-done

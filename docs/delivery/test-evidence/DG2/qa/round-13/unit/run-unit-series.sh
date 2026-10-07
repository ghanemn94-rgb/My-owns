#!/bin/bash
# qa-verifier DG2 round 13: pnpm test series on the disposable clone $TMPDIR/review-dg2 @5699f72 (freeze; candidate
# 6824b8b8, source aa0a68f1). Node 22 and Node 24, 3 runs each, alternating locale settings; plus one run under CPU load.
cd $TMPDIR/review-dg2
E=/home/user/My-owns/docs/delivery/test-evidence/DG2/qa/round-13/unit
for spec in "22 1 unset" "24 1 unset" "22 2 cutf8" "24 2 cutf8" "22 3 unset" "24 3 cutf8"; do
 set -- $spec; v=$1; n=$2; loc=$3
 if [ $v = 22 ]; then P=/opt/node22/bin; else P=/opt/nvm/versions/node/v24.21.0/bin; fi
 if [ $loc = unset ]; then L="env -u LANG -u LC_ALL"; else L="env -u LC_ALL LANG=C.UTF-8"; fi
 f=$E/node$v-run$n-$loc.log
 { echo "\$ PATH=$P:\$PATH $L pnpm test"; echo "# node $($P/node -v); $(date -u +%FT%TZ)"; PATH=$P:/opt/nvm/versions/node/v24.21.0/bin:$PATH $L pnpm test 2>&1; echo "exit $?"; } | sed "s#$TMPDIR#\$TMPDIR#g" > $f
done
f=$E/node24-load-cutf8.log
P=/opt/nvm/versions/node/v24.21.0/bin
for i in 1 2 3; do ( timeout 400 sh -c 'while :; do :; done' ) & done
{ echo '$ (3 busy-loop CPU hogs on 4 CPUs) env -u LC_ALL LANG=C.UTF-8 pnpm test'; echo "loadavg-before: $(cat /proc/loadavg)"; PATH=$P:$PATH env -u LC_ALL LANG=C.UTF-8 pnpm test 2>&1; rc=$?; echo "loadavg-after: $(cat /proc/loadavg)"; echo "exit $rc"; } | sed "s#$TMPDIR#\$TMPDIR#g" > $f
kill $(jobs -p) 2>/dev/null
echo done

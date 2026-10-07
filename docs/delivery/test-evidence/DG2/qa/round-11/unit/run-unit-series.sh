#!/bin/bash
cd $TMPDIR/review-dg2  # clone @309aff2 (candidate 23e6c0a2)
E=/home/user/My-owns/docs/delivery/test-evidence/DG2/qa/round-11/unit
for spec in "22 1 unset" "24 1 unset" "22 2 cutf8" "24 2 cutf8" "22 3 unset" "24 3 unset"; do
 set -- $spec; v=$1; n=$2; loc=$3
 if [ $v = 22 ]; then P=/opt/node22/bin; else P=/opt/nvm/versions/node/v24.21.0/bin; fi
 if [ $loc = unset ]; then L="env -u LANG -u LC_ALL"; else L="env -u LC_ALL LANG=C.UTF-8"; fi
 f=$E/node$v-run$n-$loc.log
 { echo "\$ PATH=$P:\$PATH $L pnpm test"; echo "# node $($P/node -v); $(date -u +%FT%TZ)"; PATH=$P:/opt/nvm/versions/node/v24.21.0/bin:$PATH $L pnpm test 2>&1; echo "exit $?"; } > $f
done
# load run
f=$E/node24-load-unset.log
P=/opt/nvm/versions/node/v24.21.0/bin
for i in 1 2 3; do ( timeout 400 sh -c 'while :; do :; done' ) & done
{ echo '$ (3 busy-loop CPU hogs) env -u LANG -u LC_ALL pnpm test'; echo "loadavg-before: $(cat /proc/loadavg)"; PATH=$P:$PATH env -u LANG -u LC_ALL pnpm test 2>&1; rc=$?; echo "loadavg-after: $(cat /proc/loadavg)"; echo "exit $rc"; } > $f
kill $(jobs -p) 2>/dev/null
echo done

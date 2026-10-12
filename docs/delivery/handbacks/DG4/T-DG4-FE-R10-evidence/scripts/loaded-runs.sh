#!/usr/bin/env bash
# 5 full `pnpm test` runs, each under a CPU load held by N self-terminating busy loops (stopped by PID afterwards).
cd /home/user/wt/dg4-fe-r10 || exit 9
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
S=$TMPDIR/scripts; EV=$TMPDIR/ev; N=${LOOPS:-11}
for i in 1 2 3 4 5; do
  if [ $((i % 2)) = 1 ]; then LOC=unset; else LOC=C.UTF-8; fi
  echo "run $i free: $(df -h . | tail -1)" >>"$EV/40-summary.txt"
  $S/load.sh "$N" 1500; sleep 45
  L=$EV/40-run$i-$LOC.log; SM=$EV/40-run$i-load-samples.log; : >"$SM"
  $S/sample.sh "$SM" 1450 & SP=$!
  echo "start $(date -u +%T) loadavg=$(cat /proc/loadavg) locale=$LOC loops=$N" >"$L"
  if [ "$LOC" = unset ]; then env -u LANG -u LC_ALL -u LC_CTYPE TZ=UTC CI=1 MTH_UNIT_WEB_WARMUP_REPORT=1 pnpm test >>"$L" 2>&1; rc=$?
  else env LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC CI=1 MTH_UNIT_WEB_WARMUP_REPORT=1 pnpm test >>"$L" 2>&1; rc=$?; fi
  echo "exit=$rc end $(date -u +%T) loadavg=$(cat /proc/loadavg)" >>"$L"
  kill $SP; $S/load-stop.sh
  stats=$(awk '{print $2}' "$SM" | sort -n | awk '{a[NR]=$1} END{print "1-min load samples n="NR" min="a[1]" median="a[int((NR+1)/2)]" max="a[NR]}')
  echo "run $i locale=$LOC exit=$rc $stats" >>"$EV/40-summary.txt"
  sed 's/\x1b\[[0-9;]*m//g' "$L" | grep -E "Test Files|Tests  |FAIL" >>"$EV/40-summary.txt"
done
echo DONE >>"$EV/40-summary.txt"

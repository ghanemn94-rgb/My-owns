#!/bin/bash
# usage: run.sh <logname> <node22|node24> <cmd...>   (cwd: the disposable clone $TMPDIR/rv unless RV is set)
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/qa/round-5
# Guard (added 11:45Z): the chains started from seqA.sh and seqA1.sh ran at the same time on one clone (the first was not
# stopped by pkill, which cannot see another sandbox's processes). Any run.sh call from either chain stops that chain.
p=$PPID; chain=""
while [ -n "$p" ] && [ "$p" -gt 1 ]; do
  if tr '\0' ' ' < /proc/$p/cmdline 2>/dev/null | grep -Eq 'scripts/seqA1?\.sh'; then chain="$chain $p"; break; fi
  chain="$chain $p"; p=$(awk '{print $4}' /proc/$p/stat 2>/dev/null)
done
if tr '\0' ' ' < /proc/${p:-1}/cmdline 2>/dev/null | grep -Eq 'scripts/seqA1?\.sh'; then
  echo "$(date -u +%FT%TZ) run.sh $1: stopping stale chain pids:$chain" >> /home/user/My-owns/docs/delivery/test-evidence/DG6/qa/round-5/09-stale-chain-stop.log
  kill -TERM $chain 2>/dev/null; exit 0
fi
name=$1; shift; nv=$1; shift
if [ "$nv" = node22 ]; then export PATH=/opt/node22/bin:$PATH; else export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH; fi
export MTH_PORT_POOL=32500-32599
cd "${RV:-$TMPDIR/rv}" || exit 9
{
echo "## start $(date -u +%FT%TZ) node $(node -v) cwd $(pwd) load: $(cut -d' ' -f1-3 /proc/loadavg)"
echo "## cmd: $*"
"$@"
rc=$?
echo "## end $(date -u +%FT%TZ) rc=$rc"
} > "$E/$name.log" 2>&1
echo $rc > "$E/$name.rc"
exit 0

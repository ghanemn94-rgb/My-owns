#!/bin/bash
# usage: run.sh <logname> <node22|node24> <cmd...>   (cwd: the disposable clone $TMPDIR/rv unless RV is set)
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/qa/round-7
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

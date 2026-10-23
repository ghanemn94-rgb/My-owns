#!/usr/bin/env bash
# qa-verifier DG5 round 1: one `pnpm test` run in the disposable clone. $1 = node22|node24, $2 = unset|C, $3 = log suffix
set -u
C=${CLONE:-$TMPDIR/review-dg5}; E=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-1
NV=$1; M=$2; SUF=${3:-}; cd "$C"
if [ $NV = node22 ]; then NP=/opt/node22/bin; else NP=/opt/nvm/versions/node/v24.21.0/bin; fi
L=$E/02-unit-$NV-$M$SUF.log
if [ $M = unset ]; then ENVP=(env -u LANG -u LC_ALL -u LC_CTYPE); LBL="env -u LANG -u LC_ALL -u LC_CTYPE"; else ENVP=(env LANG=C.UTF-8 LC_ALL=C.UTF-8); LBL="env LANG=C.UTF-8 LC_ALL=C.UTF-8"; fi
{
  echo "\$ [$LBL] TZ=UTC CI=1 PATH=$NP:\$PATH pnpm test  (node $(PATH=$NP:$PATH node -v), $(date -u +%FT%TZ))"; echo "loadavg at start: $(cat /proc/loadavg)"
  "${ENVP[@]}" TZ=UTC CI=1 PATH=$NP:$PATH pnpm test 2>&1 | sed "s#$TMPDIR#\$TMPDIR#g"
  echo "EXIT ${PIPESTATUS[0]}"; date -u +%FT%TZ; echo "loadavg at end: $(cat /proc/loadavg)"
} > "$L" 2>&1
echo "$(date -u +%T) $NV $M$SUF: $(sed 's/\x1b\[[0-9;]*m//g' $L | grep -E '^ +Tests |^EXIT' | tr '\n' ' ')"

#!/usr/bin/env bash
# qa-verifier DG4 round 1: pnpm test on node22/node24 x LANG unset/C.UTF-8 in the disposable clone. $1 = log suffix (optional)
set -u
C=$TMPDIR/rv; E=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/round-1
cd "$C"
for NV in node22 node24; do
  if [ $NV = node22 ]; then NP=/opt/node22/bin; else NP=/opt/nvm/versions/node/v24.21.0/bin; fi
  for M in unset C; do
    L=$E/02-unit-$NV-$M${1:-}.log
    if [ $M = unset ]; then ENVP=(env -u LANG -u LC_ALL -u LC_CTYPE); LBL="env -u LANG -u LC_ALL -u LC_CTYPE"; else ENVP=(env LANG=C.UTF-8 LC_ALL=C.UTF-8); LBL="env LANG=C.UTF-8 LC_ALL=C.UTF-8"; fi
    {
      echo "\$ [$LBL] TZ=UTC CI=1 PATH=$NP:\$PATH pnpm test  (node $(PATH=$NP:$PATH node -v), $(date -u +%FT%TZ))"; uptime
      "${ENVP[@]}" TZ=UTC CI=1 PATH=$NP:$PATH pnpm test 2>&1 | sed "s#$TMPDIR#\$TMPDIR#g"
      echo "EXIT ${PIPESTATUS[0]}"; date -u +%FT%TZ; uptime
    } > "$L" 2>&1
    echo "$NV $M: $(grep -E '^ +Tests ' $L | tr '\n' ' ') $(grep ^EXIT $L)"
  done
done

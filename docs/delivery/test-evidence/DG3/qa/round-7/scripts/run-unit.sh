#!/usr/bin/env bash
# qa-verifier DG3 round 7: pnpm test on node22/node24 x LANG unset/C.UTF-8. $1 = suffix for log names (optional)
set -u
C=$TMPDIR/review-dg3; E=/home/user/My-owns/docs/delivery/test-evidence/DG3/qa/round-7
cd "$C"
for NV in node22 node24; do
  if [ $NV = node22 ]; then NP=/opt/node22/bin; else NP=/opt/nvm/versions/node/v24.21.0/bin; fi
  for M in unset C; do
    L=$E/02-unit-$NV-$M${1:-}.log
    if [ $M = unset ]; then ENVP=(env -u LANG -u LC_ALL -u LC_CTYPE); LBL="env -u LANG -u LC_ALL"; else ENVP=(env LANG=C.UTF-8 LC_ALL=C.UTF-8); LBL="env LANG=C.UTF-8 LC_ALL=C.UTF-8"; fi
    {
      echo "\$ [$LBL] TZ=UTC CI=1 PATH=$NP:\$PATH pnpm test  (node $(PATH=$NP:$PATH node -v), $(date -u +%FT%TZ))"; uptime
      "${ENVP[@]}" TZ=UTC CI=1 PATH=$NP:$PATH pnpm test
      echo "EXIT $?"; date -u +%FT%TZ; uptime
    } > "$L" 2>&1
    echo "$NV $M: $(tail -3 $L | head -1)"
  done
done

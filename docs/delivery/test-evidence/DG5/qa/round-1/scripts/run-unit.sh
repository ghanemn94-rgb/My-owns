#!/usr/bin/env bash
# qa-verifier DG5 r1C: pnpm test (unit-node, unit-web, unit-formula-nocodegen) in the disposable clone.
# $1 = node22|node24, $2 = unset|cutf8
set -u
C=$TMPDIR/review-dg5; E=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-1
if [ "$1" = node22 ]; then export PATH=/opt/node22/bin:$PATH; else export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH; fi
if [ "$2" = unset ]; then ENVP=(env -u LANG -u LC_ALL -u LC_CTYPE); else ENVP=(env LANG=C.UTF-8 LC_ALL=C.UTF-8); fi
cd "$C"; L=$E/02-unit-$1-$2.log; S=$E/02-unit-$1-$2-samples.log; : > $S; rm -f $TMPDIR/u$1$2.stop
bash $E/scripts/sampler.sh $S $TMPDIR/u$1$2.stop & SP=$!
{ echo "\$ ${ENVP[*]} pnpm test   (node $(node -v), pnpm $(pnpm -v), $(date -u +%FT%TZ)) clone node_modules is writable, so vitest's default config loader works (no --configLoader runner needed)"; uptime
"${ENVP[@]}" pnpm test 2>&1 | sed "s#$TMPDIR#\$TMPDIR#g"; echo "EXIT ${PIPESTATUS[0]}"; date -u +%FT%TZ; uptime; } > "$L" 2>&1
touch $TMPDIR/u$1$2.stop; wait $SP
sed 's/\x1b\[[0-9;]*m//g' "$L" | grep -E "Test Files|Tests |^EXIT" 

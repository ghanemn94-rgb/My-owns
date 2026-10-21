#!/usr/bin/env bash
# code-security-reviewer DG5 r5: `pnpm test` equivalent (the three unit projects, each its own vitest invocation, exactly
# as the root script), with --configLoader runner (sandbox requirement; see assignment). $1 = node24|node22.
set -u
C=$TMPDIR/review-r5; E=/home/user/My-owns/docs/delivery/test-evidence/DG5/code-security/round-5
case "$1" in node24) export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH;; node22) export PATH=/opt/node22/bin:/opt/nvm/versions/node/v24.21.0/bin:$PATH;; esac
L=$E/03-unit-$1${2:+-$2}.log; cd $C
{ echo "## $(date -u +%FT%TZ) node $(node -v) LANG=${LANG:-unset} load: $(cut -d' ' -f1-3 /proc/loadavg)"
s=0
for p in unit-node unit-web unit-formula-nocodegen; do
  echo; echo "\$ npx vitest run --configLoader runner --project $p   ($(date -u +%T)Z)"
  npx vitest run --configLoader runner --project $p 2>&1 | sed "s#$TMPDIR#\$TMPDIR#g; s/\x1b\[[0-9;]*m//g"; r=${PIPESTATUS[0]}; echo "EXIT $r"; [ $r = 0 ] || s=1
done
echo "## end $(date -u +%FT%TZ) overall exit $s load: $(cut -d' ' -f1-3 /proc/loadavg)"; } > $L 2>&1
grep -E '^\$|Test Files|^ +Tests |^EXIT|^## end' $L

#!/usr/bin/env bash
# qa-verifier DG5 round 1: static checks in the disposable clone $TMPDIR/r (9c6f468 = 601d7d2 + freeze records). $@ = subset
set -u
C=$TMPDIR/r; E=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-1
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
cd "$C"
run() { local name=$1; shift; local L=$E/01-$name.log
  { echo "\$ $* (node $(node -v), $(date -u +%FT%TZ)) load: $(cut -d' ' -f1-3 /proc/loadavg)"; "$@" 2>&1 | sed "s#$TMPDIR#\$TMPDIR#g"; echo "EXIT ${PIPESTATUS[0]}"; date -u +%FT%TZ; } > "$L" 2>&1
  echo "$name: $(tail -2 $L | head -1)"; }
SEL=("$@"); [ ${#SEL[@]} -eq 0 ] && SEL=(pnpm-r-build pnpm-r-typecheck pnpm-lint pnpm-openapi-lint pnpm-check-no-cdn pnpm-format-check pnpm-check-contrast)
for s in "${SEL[@]}"; do case $s in
 pnpm-r-build) run $s pnpm -r build;;
 pnpm-r-typecheck) run $s pnpm -r typecheck;;
 pnpm-lint) run $s pnpm lint;;
 pnpm-openapi-lint) run $s pnpm openapi:lint;;
 pnpm-check-no-cdn) run $s pnpm check:no-cdn;;
 pnpm-format-check) run $s pnpm format:check;;
 pnpm-check-contrast) run $s pnpm --filter @mth/design-tokens run check:contrast;;
esac; done

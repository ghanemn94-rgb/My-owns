#!/usr/bin/env bash
# qa-verifier DG4 round 9: static checks in the disposable clone $TMPDIR/review-dg4r9 (f2ae717 + freeze 01ad2e1). $@ = subset of check names (default all)
set -u
C=$TMPDIR/review-dg4r9; E=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/round-9
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
cd "$C"
run() { local name=$1; shift; local L=$E/01-$name.log
  { echo "\$ $* (node $(node -v), $(date -u +%FT%TZ)) load: $(cut -d' ' -f1-3 /proc/loadavg)"; "$@" 2>&1 | sed "s#$TMPDIR#\$TMPDIR#g"; echo "EXIT ${PIPESTATUS[0]}"; date -u +%FT%TZ; } > "$L" 2>&1
  echo "$name: $(tail -2 $L | head -1)"; }
want() { [ $# -eq 0 ] && return 0; for w in "${SEL[@]}"; do [ "$w" = "$1" ] && return 0; done; return 1; }
SEL=("$@"); [ ${#SEL[@]} -eq 0 ] && SEL=(pnpm-r-build pnpm-r-typecheck pnpm-lint pnpm-openapi-lint pnpm-check-no-cdn pnpm-format-check pnpm-check-contrast)
want pnpm-r-build && run pnpm-r-build pnpm -r build
want pnpm-r-typecheck && run pnpm-r-typecheck pnpm -r typecheck
want pnpm-lint && run pnpm-lint pnpm lint
want pnpm-openapi-lint && run pnpm-openapi-lint pnpm openapi:lint
want pnpm-check-no-cdn && run pnpm-check-no-cdn pnpm check:no-cdn
want pnpm-format-check && run pnpm-format-check pnpm format:check
want pnpm-check-contrast && run pnpm-check-contrast pnpm --filter @mth/design-tokens run check:contrast

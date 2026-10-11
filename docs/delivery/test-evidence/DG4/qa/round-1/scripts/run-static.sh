#!/usr/bin/env bash
# qa-verifier DG4 round 1: static checks in the disposable clone
set -u
C=$TMPDIR/rv; E=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/round-1
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
cd "$C"
run() { local name=$1; shift; local L=$E/01-$name.log
  { echo "\$ $* (node $(node -v), $(date -u +%FT%TZ))"; "$@" 2>&1 | sed "s#$TMPDIR#\$TMPDIR#g"; echo "EXIT ${PIPESTATUS[0]}"; date -u +%FT%TZ; } > "$L" 2>&1
  echo "$name: $(tail -2 $L | head -1)"; }
run pnpm-r-typecheck pnpm -r typecheck
run pnpm-r-build pnpm -r build
run pnpm-lint pnpm lint
run pnpm-openapi-lint pnpm openapi:lint
run pnpm-check-no-cdn pnpm check:no-cdn
run pnpm-format-check pnpm format:check
run pnpm-check-contrast pnpm --filter @mth/design-tokens run check:contrast

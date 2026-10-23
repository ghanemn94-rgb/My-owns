#!/usr/bin/env bash
# code-security-reviewer DG5 r7: static checks in the clone (Node 24).
set -u
C=$TMPDIR/review-r7; E=/home/user/My-owns/docs/delivery/test-evidence/DG5/code-security/round-7
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
cd $C
{ echo "## $(date -u +%FT%TZ) node $(node -v) pnpm $(pnpm -v) load: $(cut -d' ' -f1-3 /proc/loadavg)"
for c in "pnpm -r build" "pnpm -r typecheck" "pnpm lint" "pnpm openapi:lint" "pnpm check:no-cdn" "pnpm format:check" "pnpm deps:verify"; do
  echo; echo "\$ $c   ($(date -u +%T)Z)"; $c 2>&1 | sed "s#$TMPDIR#\$TMPDIR#g" | tail -25; echo "EXIT ${PIPESTATUS[0]}"
done; } > $E/02-static-node24.log 2>&1
grep -E '^\$|^EXIT' $E/02-static-node24.log

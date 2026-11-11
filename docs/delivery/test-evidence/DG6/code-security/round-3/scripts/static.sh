#!/bin/bash
set -u
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/code-security/round-3
cd $TMPDIR/rv
hdr() { echo "# $(date -u +%FT%TZ) $1 (Node $(node -v), cwd \$TMPDIR/rv at $(git rev-parse --short=9 HEAD), load $(cut -d' ' -f1-3 /proc/loadavg))"; }
{ hdr "pnpm -r typecheck"; pnpm -r typecheck 2>&1 | tail -40; echo "exit=${PIPESTATUS[0]}"; } > $E/04-typecheck.log
{ hdr "pnpm lint"; pnpm lint 2>&1 | tail -40; echo "exit=${PIPESTATUS[0]}"; } > $E/05-lint.log
{ hdr "pnpm format:check"; pnpm format:check 2>&1 | tail -40; echo "exit=${PIPESTATUS[0]}"; } > $E/06-format.log
{ hdr "pnpm openapi:lint"; pnpm openapi:lint 2>&1 | tail -40; echo "exit=${PIPESTATUS[0]}"; echo "plain operationId count: $(grep -c '^\s*operationId:' docs/api/openapi.yaml)"; grep -m1 -n "^  version:" docs/api/openapi.yaml; } > $E/07-openapi-lint.log
{ hdr "pnpm check:no-cdn"; pnpm check:no-cdn 2>&1 | tail -40; echo "exit=${PIPESTATUS[0]}"; } > $E/08-no-cdn.log
{ hdr "p6-pending lists, module graph, config.consumes, media-type pin";
  for f in $(git ls-files | grep 'p6-pending.*\.ts$'); do echo "== $f"; grep -v '^\s*//' $f | tr -d '\n' | grep -o '\[[^]]*\]' | head -3; done
  echo "== worker imports of apps/api:"; grep -rn "from ['\"].*apps/api\|@mth/api" apps/worker/src | head; echo "(end)"
} > $E/20-contract-pending-graph.log 2>&1
echo STATIC-DONE >> $E/20-contract-pending-graph.log

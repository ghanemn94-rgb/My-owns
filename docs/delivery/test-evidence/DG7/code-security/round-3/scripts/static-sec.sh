#!/bin/bash
# Static checks on the round-3 delta and the security release tooling, in the disposable clone.
set -u
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
E=/home/user/My-owns/docs/delivery/test-evidence/DG7/code-security/round-3
cd $TMPDIR/rv
export MTH_PNPM_STORE=$TMPDIR/pstore/v10
hdr() { echo "# $(date -u +%FT%TZ) $1 (Node $(node -v), cwd \$TMPDIR/rv at $(git rev-parse --short=9 HEAD), load $(cut -d' ' -f1-3 /proc/loadavg))"; }
D="deploy/scripts/drill/cleanup.sh deploy/scripts/tests/transfer-drill.test.mjs deploy/scripts/transfer-drill.sh packages/db/test/integration/p7-transfer-guards.test.ts"
{
hdr "pnpm --filter @mth/db typecheck (the changed .ts test is in packages/db)"; pnpm --filter @mth/db typecheck 2>&1 | tail -5; echo "exit=${PIPESTATUS[0]}"
hdr "pnpm lint"; pnpm lint 2>&1 | tail -6; echo "exit=${PIPESTATUS[0]}"
hdr "prettier --check on the changed files"; npx prettier --check $D 2>&1 | tail -6; echo "exit=${PIPESTATUS[0]}"
hdr "bash -n on the drill scripts"; bash -n deploy/scripts/drill/cleanup.sh && bash -n deploy/scripts/transfer-drill.sh; echo "exit=$?"
hdr "shellcheck (if installed)"; if command -v shellcheck >/dev/null; then shellcheck -x deploy/scripts/drill/cleanup.sh deploy/scripts/transfer-drill.sh 2>&1 | tail -20; echo "exit=${PIPESTATUS[0]}"; else echo "shellcheck not installed: not run"; fi
hdr "pnpm openapi:lint"; pnpm openapi:lint 2>&1 | tail -4; echo "exit=${PIPESTATUS[0]}"
} > $E/10-static.log 2>&1
{ hdr "node --test secret-scan, claims-scan, security-controls, scan-assets, seal, verify-seal, release-notes, protocol-audit tests"
  node --test tools/release/tests/secret-scan.test.mjs tools/release/tests/claims-scan.test.mjs tools/release/tests/security-controls.test.mjs $(ls tools/release/tests/scan-assets*.test.mjs tools/release/tests/asset*.test.mjs 2>/dev/null) tools/release/tests/seal.test.mjs tools/release/tests/verify-seal.test.mjs tools/release/tests/release-notes.test.mjs tools/release/tests/protocol-audit.test.mjs 2>&1 | grep -E "^ℹ|✖|not ok" | head -60; echo "exit=${PIPESTATUS[0]}"
  hdr "secret-scan --scope payload"; node tools/release/secret-scan.mjs --scope payload 2>&1 | tail -4; echo "exit=${PIPESTATUS[0]}"
  hdr "secret-scan --scope history"; node tools/release/secret-scan.mjs --scope history 2>&1 | tail -4; echo "exit=${PIPESTATUS[0]}"
  hdr "claims-scan"; node tools/release/claims-scan.mjs 2>&1 | tail -4; echo "exit=${PIPESTATUS[0]}"
  hdr "no public CDN references in shipped web sources (grep)"; grep -rnE "https?://(cdn\.|unpkg\.com|cdnjs\.|fonts\.googleapis|fonts\.gstatic|jsdelivr)" apps/web/src apps/web/index.html apps/api/src apps/worker/src packages/*/src 2>/dev/null | grep -v "\.test\." | head; echo "grep matches above (none expected)"
} > $E/22-security-tools.log 2>&1
echo DONE >> $E/22-security-tools.log

#!/bin/bash
# security-relevant release tooling on the candidate: scanner, seal and verify-seal self-tests; payload and history
# secret scans; claims scan; asset-scan allow-list loader tests
set -u
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
E=/home/user/My-owns/docs/delivery/test-evidence/DG7/code-security/round-2
cd $TMPDIR/rv
export MTH_PNPM_STORE=$TMPDIR/pstore/v10
hdr() { echo "# $(date -u +%FT%TZ) $1 (Node $(node -v), cwd \$TMPDIR/rv at $(git rev-parse --short=9 HEAD), load $(cut -d' ' -f1-3 /proc/loadavg))"; }
{ hdr "node --test secret-scan, claims-scan, security-controls, scan-assets, seal, verify-seal, release-notes tests"
  ls tools/release/tests/ | tr '\n' ' '; echo
  node --test tools/release/tests/secret-scan.test.mjs tools/release/tests/claims-scan.test.mjs tools/release/tests/security-controls.test.mjs $(ls tools/release/tests/scan-assets*.test.mjs tools/release/tests/asset*.test.mjs 2>/dev/null) tools/release/tests/seal.test.mjs tools/release/tests/verify-seal.test.mjs tools/release/tests/release-notes.test.mjs 2>&1 | grep -E "^ℹ|✖|# Subtest|not ok" | head -60; echo "exit=${PIPESTATUS[0]}"; } > $E/22-release-sec-tool-tests.log
{ hdr "secret-scan --scope payload"; node tools/release/secret-scan.mjs --scope payload 2>&1 | tail -5; echo "exit=${PIPESTATUS[0]}"
  hdr "secret-scan --scope history"; node tools/release/secret-scan.mjs --scope history 2>&1 | tail -5; echo "exit=${PIPESTATUS[0]}"
  hdr "claims-scan"; node tools/release/claims-scan.mjs 2>&1 | tail -5; echo "exit=${PIPESTATUS[0]}"
} > $E/23-secret-claims-asset-scans.log 2>&1
echo SEC-DONE >> $E/23-secret-claims-asset-scans.log

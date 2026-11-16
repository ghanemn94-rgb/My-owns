#!/bin/bash
# Static checks on the round-4 delta, the security release tooling and the handover disclosure checks, in the
# disposable clone $TMPDIR/rv (never the candidate tree).
set -u
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
E=/home/user/My-owns/docs/delivery/test-evidence/DG7/code-security/round-4
cd $TMPDIR/rv
export MTH_PNPM_STORE=$TMPDIR/pstore/v10
hdr() { echo "# $(date -u +%FT%TZ) $1 (Node $(node -v), cwd \$TMPDIR/rv at $(git rev-parse --short=9 HEAD), load $(cut -d' ' -f1-3 /proc/loadavg))"; }
NEW=apps/api/test/integration/transfer/export-scope.test.ts
{
hdr "source delta round-3 source 8323dacae -> round-4 source 471072d6 outside docs/ (only the new test expected)"
git diff --stat 8323dacae51a98c8f555fb95d8e1dd0a1e747ea8 471072d6481a346c356e985d07b49721ebdda571 -- . ':!docs'; echo "exit=$?"
hdr "pnpm --filter @mth/api typecheck (the new .ts test is in apps/api)"; pnpm --filter @mth/api typecheck 2>&1 | tail -5; echo "exit=${PIPESTATUS[0]}"
hdr "pnpm lint"; pnpm lint 2>&1 | tail -6; echo "exit=${PIPESTATUS[0]}"
hdr "prettier --check on the new test"; npx prettier --check $NEW 2>&1 | tail -4; echo "exit=${PIPESTATUS[0]}"
hdr "pnpm openapi:lint"; pnpm openapi:lint 2>&1 | tail -4; echo "exit=${PIPESTATUS[0]}"
} > $E/10-static.log 2>&1
{ hdr "node --test release tool tests (secret-scan, claims-scan, security-controls, scan-assets, seal, verify-seal, release-notes, protocol-audit, known-limitations, check-handover)"
  node --test tools/release/tests/secret-scan.test.mjs tools/release/tests/claims-scan.test.mjs tools/release/tests/security-controls.test.mjs $(ls tools/release/tests/scan-assets*.test.mjs tools/release/tests/asset*.test.mjs 2>/dev/null) tools/release/tests/seal.test.mjs tools/release/tests/verify-seal.test.mjs tools/release/tests/release-notes.test.mjs tools/release/tests/protocol-audit.test.mjs $(ls tools/release/tests/known-limitations*.test.mjs tools/release/tests/check-handover*.test.mjs 2>/dev/null) 2>&1 | grep -E "^ℹ|✖|not ok|# (tests|pass|fail|skipped|todo)" | head -60; echo "exit=${PIPESTATUS[0]}"
  hdr "secret-scan --scope payload"; node tools/release/secret-scan.mjs --scope payload 2>&1 | tail -4; echo "exit=${PIPESTATUS[0]}"
  hdr "secret-scan --scope history"; node tools/release/secret-scan.mjs --scope history 2>&1 | tail -4; echo "exit=${PIPESTATUS[0]}"
  hdr "claims-scan"; node tools/release/claims-scan.mjs 2>&1 | tail -4; echo "exit=${PIPESTATUS[0]}"
  hdr "no public CDN references in shipped sources (grep)"; grep -rnE "https?://(cdn\.|unpkg\.com|cdnjs\.|fonts\.googleapis|fonts\.gstatic|jsdelivr)" apps/web/src apps/web/index.html apps/api/src apps/worker/src packages/*/src 2>/dev/null | grep -v "\.test\." | head; echo "grep matches above (none expected)"
} > $E/22-security-tools.log 2>&1
RN="node tools/release/release-notes.mjs --csv docs/delivery/requirements.csv --deps docs/handover/external-dependencies.json --provisional apps/web/src/i18n --out docs/handover/release-notes.md"
PA=docs/delivery/test-evidence/DG7/orchestrator/protocol-audit/protocol-audit-r4.json
{ hdr "handover disclosure checks for F-DG7-920/960"
  echo "== register sha256 vs release notes"; sha256sum docs/delivery/requirements.csv; grep -n "SHA-256" docs/handover/release-notes.md | head -3
  echo "== release-notes --check"; $RN --check; echo "exit=$?"
  echo "== known-limitations --check against protocol-audit-r4"; node tools/release/known-limitations.mjs --protocol-audit $PA --check; echo "exit=$?"
  echo "== check-handover (default and strict) with protocol-audit-r4"
  node tools/release/check-handover.mjs --protocol-audit $PA 2>&1 | tail -4; echo "exit=${PIPESTATUS[0]}"
  MTH_STRICT_HANDOVER=1 node tools/release/check-handover.mjs --protocol-audit $PA 2>&1 | tail -4; echo "exit=${PIPESTATUS[0]}"
  echo "== revert-to-fail: the round-3 release notes (git show 9c69cd117:docs/handover/release-notes.md) against this register"
  cp docs/handover/release-notes.md $TMPDIR/rn.keep
  git show 9c69cd117:docs/handover/release-notes.md > docs/handover/release-notes.md; $RN --check; echo "exit=$? (expected 1)"
  cp $TMPDIR/rn.keep docs/handover/release-notes.md
  echo "== revert-to-fail: the round-3 known-limitations against protocol-audit-r4"
  cp docs/handover/known-limitations.md $TMPDIR/kl.keep
  git show 9c69cd117:docs/handover/known-limitations.md > docs/handover/known-limitations.md; node tools/release/known-limitations.mjs --protocol-audit $PA --check; echo "exit=$? (expected 1)"
  cp $TMPDIR/kl.keep docs/handover/known-limitations.md
  echo "== AN-P7G and BE-R8 handback headings (C3 sections)"
  for f in docs/delivery/handbacks/DG7/T-DG7-AN-P7G-transformation-analyst.md docs/delivery/handbacks/DG7/T-DG7-BE-R8-backend-workflow-engineer.md; do echo "-- $f"; grep -n "^#" $f | head -12; done
  echo "== final git status (must be clean)"; git status --short | head
} > $E/20-f920-f960-handover.log 2>&1
{ hdr "deploy/scripts/tests/transfer-drill.test.mjs (includes the real-PostgreSQL td_stop_pg and td_stop_pg_dir cases)"
  node --test deploy/scripts/tests/transfer-drill.test.mjs 2>&1 | grep -E "^ℹ|✖|not ok|td_stop_pg|BLOCKED" | head -40; echo "exit=${PIPESTATUS[0]}"
} > $E/34-drill-tests.log 2>&1
echo DONE >> $E/34-drill-tests.log

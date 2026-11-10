#!/usr/bin/env bash
# code-security-reviewer, DG6 round 12: read-only source checks on the candidate tree (/home/user/My-owns at HEAD
# 895b1e43, whose product tree equals the source commit 2495e036). Output: 60-source-checks.log.
set -u
cd /home/user/My-owns
C=2495e036c4d933788044756ab3c41415e3873cf3
R11=33db1a46ca498d917d9e33793e9771533269c446
DG5=660f40c7d141b6fb73c145e0ee7a053ceb5905de
echo "## product paths differing between HEAD and the source commit (expect 0)"
git diff --name-only $C HEAD -- apps packages tests e2e docs/api deploy tools | wc -l
echo "## files changed since round 11 (all paths except delivery records)"
git diff --name-status $R11 $C | grep -v "docs/delivery/" ; echo "(delivery records changed: $(git diff --name-only $R11 $C -- docs/delivery | wc -l))"
echo "## server, worker, shared, db, contract, tests and e2e unchanged since round 11 (expect empty)"
git diff --name-only $R11 $C -- apps/api apps/worker packages docs/api tests e2e apps/web/e2e deploy tools
echo "## operationId count (plain) and contract version"
grep -c "operationId:" docs/api/openapi.yaml
grep -n "^  version:" docs/api/openapi.yaml
echo "## p6-pending lists: quoted entries"
for f in apps/api/test/support/p6-pending-*.ts; do echo "$f: $(grep -cE '^\s*"' "$f") quoted lines"; done
echo "## migrations: count, gaps, P6 range"
ls packages/db/migrations/*.sql | wc -l
ls packages/db/migrations/ | grep -E '^[0-9]{4}_' | awk -F_ '{n=$1+0; if (p && n!=p+1) print "gap after " sprintf("%04d",p) " -> " sprintf("%04d",n); p=n}'
ls packages/db/migrations/ | grep -E '^0(09[8-9]|1[0-9][0-9])_'
echo "## migrations modified/deleted since DG5 (forward-only; expect none)"
git diff --name-status $DG5 $C -- packages/db/migrations | grep -v '^A' || echo none
echo "## worker imports API code? (expect none)"
grep -rnE "from ['\"](\.\./)+.*apps/api|from ['\"]@mth/api" apps/worker/src || echo none
echo "## public CDN references in web sources/index (expect none)"
grep -rnE "https?://(cdn\.|unpkg|jsdelivr|fonts\.googleapis|fonts\.gstatic|cdnjs)" apps/web/src apps/web/index.html || echo none
echo "## secret-looking literals added since round 11 in product code (expect none)"
git diff $R11 $C -- apps packages | grep -E '^\+' | grep -iE "(api[_-]?key|password|secret|token|key)\s*[:=]\s*['\"][A-Za-z0-9/+_-]{16,}['\"]" | grep -v test || echo none
echo "## the problem key restricted_token_stale in both locales, and the 409 key changedReapply"
grep -c "automation_rule__restricted_token_stale" apps/web/src/i18n/en/problems.json apps/web/src/i18n/ar/problems.json
grep -rn "changedReapply" apps/web/src/i18n/*/workflowsP5.json 2>/dev/null || grep -rln "changedReapply" apps/web/src/i18n
echo "## the API's English detail for restricted_token_stale (unchanged; direct API clients)"
grep -rn "restricted_token_stale" apps/api/src | grep -v test
echo "## every web consumer of restricted_token_stale (expect RulePage.tsx only, plus the i18n files)"
grep -rn "restricted_token_stale" apps/web/src | grep -v "\.test\."
echo "## the web never parses or computes the tag (expect none)"
grep -rn "AUTOMATION_RESTRICTED_TOKEN_PATTERN\|TAG_HEX_LENGTH\|createHmac" apps/web/src | grep -v "\.test\." || echo none
echo "## exit=0"

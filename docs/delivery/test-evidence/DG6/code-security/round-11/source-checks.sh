#!/usr/bin/env bash
# code-security-reviewer, DG6 round 11: read-only source checks on the candidate tree (/home/user/My-owns at HEAD
# 4492cdfd, whose product tree equals the source commit 33db1a46). Output: 60-source-checks.log.
set -u
cd /home/user/My-owns
C=33db1a46ca498d917d9e33793e9771533269c446
R10=cde6036571064c12c812d240b48e3289c78d7d48
DG5=660f40c7d141b6fb73c145e0ee7a053ceb5905de
echo "## product paths differing between HEAD and the source commit (expect 0)"
git diff --name-only $C HEAD -- apps packages tests e2e docs/api deploy tools | wc -l
echo "## files changed since round 10 (all paths)"
git diff --name-status $R10 $C | grep -v "docs/delivery/" ; echo "(delivery records changed: $(git diff --name-only $R10 $C -- docs/delivery | wc -l))"
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
echo "## migrations changed since round 10 (expect only A 0127)"
git diff --name-status $R10 $C -- packages/db/migrations; echo "(end)"
echo "## worker imports API code? (expect none)"
grep -rnE "from ['\"](\.\./)+.*apps/api|from ['\"]@mth/api" apps/worker/src || echo none
echo "## public CDN references in web sources/index (expect none)"
grep -rnE "https?://(cdn\.|unpkg|jsdelivr|fonts\.googleapis|fonts\.gstatic|cdnjs)" apps/web/src apps/web/index.html || echo none
echo "## secret-looking literals added since round 10 in product code (expect none)"
git diff $R10 $C -- apps packages | grep -E '^\+' | grep -iE "(api[_-]?key|password|secret|token|key)\s*[:=]\s*['\"][A-Za-z0-9/+_-]{16,}['\"]" | grep -v test || echo none
echo "## restricted_token_key: every reference outside tests and dist (expect migration 0127, schema.ts, versions.ts only)"
grep -rn "restricted_token_key" apps packages --include=*.ts --include=*.tsx --include=*.sql | grep -v "/dist/\|\.test\.ts\|/test/"
echo "## the key is in no web source, no OpenAPI and no shared schema (expect none)"
grep -rn "restricted_token_key\|restrictedTokenKey" apps/web/src docs/api/openapi.yaml packages/shared/src || echo none
echo "## token constructors and resolvers (every call site)"
grep -rn "automationRestrictedToken(\|resolveRestrictedTokens(\|redactConditionLiterals(\|restrictedTokenTag(" apps packages --include=*.ts --include=*.tsx | grep -v '\.test\.ts\|/dist/'
echo "## retired-form literals [restricted:<n>:<k>] or [restricted:<k>] left in product code (expect only the RETIRED pattern)"
grep -rnE "\[restricted:[0-9]+(:[0-9]+)?\]|restricted:\\$\{version\}" apps/web/src apps/api/src packages/shared/src apps/worker/src docs/api/openapi.yaml || echo none
echo "## the web never parses or computes the tag (expect no TOKEN_PATTERN use beyond a marker test)"
grep -rn "AUTOMATION_RESTRICTED_TOKEN_PATTERN\|TAG_HEX_LENGTH\|createHmac" apps/web/src | grep -v "\.test\." || echo none
echo "## en/ar problem keys for restricted_token_stale present in both locales"
grep -c "automation_rule__restricted_token_stale" apps/web/src/i18n/en/problems.json apps/web/src/i18n/ar/problems.json
echo "## exit=0"

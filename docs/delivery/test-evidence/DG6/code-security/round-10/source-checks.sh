#!/usr/bin/env bash
# code-security-reviewer, DG6 round 10: read-only source checks on the candidate tree (/home/user/My-owns at HEAD
# de4e7d23, whose product tree equals cde60365). Output: 60-source-checks.log.
set -u
cd /home/user/My-owns
C=cde6036571064c12c812d240b48e3289c78d7d48
R9=d974011fbc6e106c1628819d60a6efe1bbbafa65
R8=d84d11a62f52932dd5c0aa932c5c1790c13e7e8b
DG5=660f40c7d141b6fb73c145e0ee7a053ceb5905de
echo "## product paths differing between HEAD and the source commit (expect none)"
git diff --name-only $C HEAD -- apps packages tests e2e docs/api deploy tools | wc -l
echo "## operationId count (plain) and contract version"
grep -c "operationId:" docs/api/openapi.yaml
grep -n "^  version:" docs/api/openapi.yaml
echo "## p6-pending lists: quoted entries"
for f in apps/api/test/support/p6-pending-*.ts; do echo "$f: $(grep -cE '^\s*"' "$f") quoted lines"; done
echo "## migrations: count, first, last, gaps"
ls packages/db/migrations/*.sql | wc -l
ls packages/db/migrations/ | grep -E '^[0-9]{4}_' | awk -F_ '{n=$1+0; if (p && n!=p+1) print "gap after " sprintf("%04d",p) " -> " sprintf("%04d",n); p=n}'
ls packages/db/migrations/ | grep -E '^0(09[8-9]|1[0-9][0-9])_'
echo "## migrations modified/deleted since DG5 (forward-only; expect none)"
git diff --name-status $DG5 $C -- packages/db/migrations | grep -v '^A' || echo none
echo "## migrations changed since round 9 / round 8 (expect none)"
git diff --name-status $R9 $C -- packages/db/migrations; git diff --name-status $R8 $R9 -- packages/db/migrations; echo "(end)"
echo "## worker imports API code? (expect none)"
grep -rnE "from ['\"](\.\./)+.*apps/api|from ['\"]@mth/api" apps/worker/src || echo none
echo "## public CDN references in web sources/index (expect none)"
grep -rnE "https?://(cdn\.|unpkg|jsdelivr|fonts\.googleapis|fonts\.gstatic|cdnjs)" apps/web/src apps/web/index.html || echo none
echo "## secret-looking literals added since round 8 in product code (expect none)"
git diff $R8 $C -- apps packages | grep -E '^\+' | grep -iE "(api[_-]?key|password|secret|token)\s*[:=]\s*['\"][A-Za-z0-9/+_-]{16,}['\"]" | grep -v test || echo none
echo "## serializer sweep inputs: API modules matching the notification patterns"
grep -rlE "selectFrom\(\s*[\"']inbox_notification\b|\binbox_notification\b|(:\s*|<|\bas\s+)(InboxNotification|NotificationDigest|NotificationDigestItem)\b" apps/api/src --include=*.ts | grep -v '\.test\.ts'
echo "## token constructors and resolvers (every call site of automationRestrictedToken / resolveRestrictedTokens / redactConditionLiterals)"
grep -rn "automationRestrictedToken(\|resolveRestrictedTokens(\|redactConditionLiterals(" apps packages --include=*.ts --include=*.tsx | grep -v '\.test\.ts'
echo "## other [restricted: literal forms in web sources (old token form left behind?)"
grep -rnE "\[restricted:[0-9]+\]" apps/web/src apps/api/src packages/shared/src apps/worker/src docs/api/openapi.yaml || echo none
echo "## exit=0"

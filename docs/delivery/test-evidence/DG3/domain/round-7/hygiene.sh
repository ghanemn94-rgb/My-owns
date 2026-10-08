#!/usr/bin/env bash
# domain-reviewer DG3 round 7: hygiene greps on the candidate tree, and classification of the repair diff c40232b0..d3e6fe62d9a4a3a0e8d08fcf273aef74857b3e81.
cd /home/user/My-owns
echo "## certification / official PMI claims (apps, packages, docs/api)"
grep -rIlE "certified|certification|official PMI|PMI[- ]certified|PMI standard" apps packages docs/api --include=*.json --include=*.ts --include=*.tsx --include=*.md 2>/dev/null | grep -v node_modules | grep -v /dist/
grep -rIhnoE ".{0,80}(certified by|official PMI|not an official).{0,120}" apps/web/src/i18n 2>/dev/null
echo "## #0078FF"
grep -rIn "#0078FF" apps packages --include=*.json --include=*.ts --include=*.tsx 2>/dev/null | grep -v node_modules | grep -v /dist/ | cut -c1-200
echo "## repair diff: all changed files (product)"
git diff --name-only c40232b0..d3e6fe62d9a4a3a0e8d08fcf273aef74857b3e81 -- . ':!docs/delivery'
echo "## repair diff: new i18n strings"
git diff c40232b0..d3e6fe62d9a4a3a0e8d08fcf273aef74857b3e81 -- 'apps/web/src/i18n/**'
echo "(none above = no i18n change)"
echo "## repair diff: apps/ and packages/db, packages/shared/src/schemas"
git diff --stat c40232b0..d3e6fe62d9a4a3a0e8d08fcf273aef74857b3e81 -- apps packages/db packages/shared/src/schemas
echo "(none above = no API/DB/web/contract change)"
echo "## repair diff: formula engine non-test sources (+/- lines)"
git diff --name-only c40232b0..d3e6fe62d9a4a3a0e8d08fcf273aef74857b3e81 -- packages/shared/src | grep -vE "\.test\.tsx?$"; echo "(empty = no non-test change under packages/shared/src)"
echo "## repair diff: every non-test file under packages/ and apps/ (empty = only tests changed in code)"
git diff --name-only c40232b0..d3e6fe62d9a4a3a0e8d08fcf273aef74857b3e81 -- apps packages | grep -vE '\.test\.tsx?$'
echo "(end)"
echo "## repair diff: commits"
git log --oneline c40232b0..d3e6fe62d9a4a3a0e8d08fcf273aef74857b3e81
echo "## provisional wordmark / provisional Arabic strings in i18n"
grep -rIhoiE ".{0,60}provisional.{0,60}" apps/web/src/i18n 2>/dev/null | head -12
echo "## repair diff: full product diff (excluding docs/delivery)"
git diff c40232b0..d3e6fe62d9a4a3a0e8d08fcf273aef74857b3e81 -- . ':!docs/delivery'

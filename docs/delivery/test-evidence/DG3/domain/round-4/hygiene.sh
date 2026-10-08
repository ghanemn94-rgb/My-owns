#!/usr/bin/env bash
# domain-reviewer DG3 round 4: hygiene greps on the candidate tree, and classification of the repair diff ce988e20..171a0b57.
cd /home/user/My-owns
echo "## certification / official PMI claims (apps, packages, docs/api)"
grep -rIlE "certified|certification|official PMI|PMI[- ]certified|PMI standard" apps packages docs/api --include=*.json --include=*.ts --include=*.tsx --include=*.md 2>/dev/null | grep -v node_modules | grep -v /dist/
grep -rIhnoE ".{0,80}(certified by|official PMI|not an official).{0,120}" apps/web/src/i18n 2>/dev/null
echo "## #0078FF"
grep -rIn "#0078FF" apps packages --include=*.json --include=*.ts --include=*.tsx 2>/dev/null | grep -v node_modules | grep -v /dist/ | cut -c1-200
echo "## repair diff: all changed files (product)"
git diff --name-only ce988e20..171a0b57 -- . ':!docs/delivery'
echo "## repair diff: new i18n strings"
git diff ce988e20..171a0b57 -- 'apps/web/src/i18n/**'
echo "(none above = no i18n change)"
echo "## repair diff: apps/ and packages/db, packages/shared/src/schemas"
git diff --stat ce988e20..171a0b57 -- apps packages/db packages/shared/src/schemas
echo "(none above = no API/DB/web/contract change)"
echo "## repair diff: formula engine non-test sources (+/- lines)"
git diff -U0 ce988e20..171a0b57 -- packages/shared/src/formula/evaluate.ts packages/shared/src/formula/index.ts packages/shared/src/formula/parse.ts packages/shared/src/formula/tokenize.ts packages/shared/src/formula/typecheck.ts packages/shared/src/formula/types.ts packages/shared/src/value.ts | grep -E '^[+-][^+-]'

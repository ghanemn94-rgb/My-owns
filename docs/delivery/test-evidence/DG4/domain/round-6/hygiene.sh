#!/usr/bin/env bash
# domain-reviewer DG4 round 6: product hygiene on the disposable clone ($TMPDIR/review-dom at 0e499f2, source 1e0dc5d).
set -u
cd "$TMPDIR/review-dom"; export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
echo "### HEAD $(git rev-parse HEAD)"
echo "### node scripts/check-no-cdn.mjs"; node scripts/check-no-cdn.mjs; echo "### exit=$?"
echo "### affirmative certification / official-standard claims in shipped code and i18n (negations excluded)"
grep -rniE "(official|certified|accredited) (pmi|standard|mobily)|pmi[- ](certified|standard|approved)|certified product" apps/web/src apps/api/src packages/shared/src packages/design-tokens 2>/dev/null \
  | grep -viE "not (an |a )?(official|certified)|never|no (official|certification)|isn't|is not|ليس|ليست|غير معتمد|not certified|\.test\.|disclaimer" ; echo "### grep exit=$? (1 = no affirmative claim found)"
echo "### #0078FF occurrences (non-test)"; grep -rniF "#0078FF" apps packages --include=*.ts --include=*.tsx --include=*.json --include=*.css -l 2>/dev/null | grep -v node_modules | grep -v dist | grep -v "\.test\."
echo "### tokens.json provisional flags"; grep -n "provisional\|NOT verified" packages/design-tokens/src/tokens.json 2>/dev/null | head -5
echo "### provisional wordmark strings"; grep -rn "\"provisional\"\|Provisional\b\|مؤقت\"" apps/web/src/i18n/en/common.json apps/web/src/i18n/ar/common.json | head -6
echo "### N3/FE-R5 new Arabic labelled provisional on screen"; grep -n "arProvisional" apps/web/src/i18n/ar/dashboards.json | head -5
echo "### DG0-DG7 references in product code (non-test)"; grep -rnE "\bDG[0-7]\b" apps/api/src apps/web/src apps/worker/src packages/shared/src 2>/dev/null | grep -v "\.test\." | head -12

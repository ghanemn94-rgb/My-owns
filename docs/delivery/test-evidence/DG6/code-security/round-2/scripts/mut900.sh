#!/bin/bash
set -u
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/code-security/round-2
cd $TMPDIR/rv
T=apps/web/src/components/explanation/explanation.test.tsx
hdr() { echo "# $(date -u +%FT%TZ) $1 (Node $(node -v), \$TMPDIR/rv at $(git rev-parse --short=9 HEAD), load $(cut -d' ' -f1-3 /proc/loadavg))"; }
{ hdr "npx vitest run --project unit-web $T (candidate as is)"; npx vitest run --project unit-web $T 2>&1 | grep -v "^ *✓"; echo "exit=${PIPESTATUS[0]}"; } > $E/35-f900-explanation-test.log
H=$(sha256sum apps/web/src/i18n/en/explanations.json apps/web/src/i18n/ar/explanations.json)
git show 98feb869cd85671b3e95679e13bd255c421cb80d:apps/web/src/i18n/en/explanations.json > apps/web/src/i18n/en/explanations.json
git show 98feb869cd85671b3e95679e13bd255c421cb80d:apps/web/src/i18n/ar/explanations.json > apps/web/src/i18n/ar/explanations.json
{ hdr "MUTANT: en/ar explanations.json reverted to round-1 (98feb869c: 'Basis' / 'Validated'); the F-DG6-900 test must FAIL"; git diff --stat; npx vitest run --project unit-web $T 2>&1 | grep -v "^ *✓"; echo "exit=${PIPESTATUS[0]}"; } > $E/36-f900-mutant-old-labels.log
git checkout -- apps/web/src/i18n/en/explanations.json apps/web/src/i18n/ar/explanations.json
H2=$(sha256sum apps/web/src/i18n/en/explanations.json apps/web/src/i18n/ar/explanations.json)
{ echo "# restore equal: $([ "$H" = "$H2" ] && echo yes || echo NO)"; git status --short; } >> $E/36-f900-mutant-old-labels.log

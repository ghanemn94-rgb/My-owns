#!/bin/bash
# F-DG6-990 reproduction on the candidate (the release auditor's round-4 probe, unchanged), the shipped scan (d), my
# round-5 probe; then two mutants that revert the fix (M1: 0130 removed; M2: 0130 without its kpi.freshness_scan row).
# Runs in $TMPDIR/rv. The clone is restored and checked afterwards.
set -u
R=/home/user/My-owns
S=$R/docs/delivery/test-evidence/DG6/qa/round-5/scripts
E=$R/docs/delivery/test-evidence/DG6/qa/round-5
cd $TMPDIR/rv || exit 9
A=apps/api/test/integration/assistant
T=apps/api/test/integration/text-scan
M=packages/db/migrations/0130_p6_seeded_text_business_terms.sql
cp $R/docs/delivery/test-evidence/DG6/audit/round-4/probes/zz-aud-r4-served-dg-labels.test.ts $A/
cp $R/docs/delivery/test-evidence/DG6/qa/tests/round-5/qa-rg-r5-seeded-0130.test.ts $T/
export QA_PG_PORT=32510
# 1. on the candidate
$S/run.sh 30-f990-audit-probe-and-scan-on-candidate node24 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration $A/zz-aud-r4-served-dg-labels.test.ts $T/seeded-texts.test.ts
$S/run.sh 31-probe-qa-rg-r5-seeded-0130 node24 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration $T/qa-rg-r5-seeded-0130.test.ts
# 2. mutant M1: migration 0130 absent
mv $M $TMPDIR/
ls packages/db/migrations | tail -2 > $E/32-mutant-m1.applied
$S/run.sh 32-mutant-m1-no-0130 node24 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration $A/zz-aud-r4-served-dg-labels.test.ts $T/seeded-texts.test.ts
mv $TMPDIR/0130_p6_seeded_text_business_terms.sql packages/db/migrations/
# 3. mutant M2: 0130 without the kpi.freshness_scan rewrite (partial revert)
cp $M $TMPDIR/0130.orig
python3 - "$M" <<'PY'
import sys,re
p=sys.argv[1]; s=open(p,encoding='utf-8').read()
start=s.index("  ('kpi.freshness_scan',"); end=s.index("  ('operations.exception_alerts',")
s=s[:start]+s[end:]
open(p,'w',encoding='utf-8').write(s)
PY
git diff --stat > $E/33-mutant-m2.applied; git diff >> $E/33-mutant-m2.applied
$S/run.sh 33-mutant-m2-0130-without-freshness node24 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration $A/zz-aud-r4-served-dg-labels.test.ts $T/seeded-texts.test.ts
git checkout -- $M
rm -f $A/zz-aud-r4-served-dg-labels.test.ts $T/qa-rg-r5-seeded-0130.test.ts $TMPDIR/0130.orig
{ echo "## clone state after probes (expect empty)"; git status --short; git diff HEAD --stat; echo "(end)"; } > $E/34-clone-restored.log 2>&1
echo PROBES-DONE

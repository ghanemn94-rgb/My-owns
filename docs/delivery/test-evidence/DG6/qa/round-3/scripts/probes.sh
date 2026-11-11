#!/bin/bash
# Reproductions of F-DG6-960/970/980/971 on the candidate, then two mutants that revert the fix. Runs in $TMPDIR/rv.
set -u
R=/home/user/My-owns
S=$R/docs/delivery/test-evidence/DG6/qa/round-3/scripts
cd $TMPDIR/rv || exit 9
D=apps/api/test/integration/assistant
cp $R/docs/delivery/test-evidence/DG6/qa/tests/round-2/qa-rg-r2-assistant-history.test.ts $D/
cp $R/docs/delivery/test-evidence/DG6/qa/tests/round-3/qa-rg-r3-history-adversarial.test.ts $D/
cp $R/docs/delivery/test-evidence/DG6/code-security/round-2/repro/zz-sec-r2-assistant-history.test.ts $D/
cp $R/docs/delivery/test-evidence/DG6/code-security/round-2/repro/zz-sec-r2-legacy-suggestion-to-draft.test.ts $D/
{ sed -n 1,147p $D/context-recheck.test.ts; cat $R/docs/delivery/test-evidence/DG6/domain/round-2/probes/zz-domain-r2-history-tail.ts; } > $D/zz-domain-r2-history.test.ts
FILES="$D/qa-rg-r2-assistant-history.test.ts $D/zz-sec-r2-assistant-history.test.ts $D/zz-domain-r2-history.test.ts $D/zz-sec-r2-legacy-suggestion-to-draft.test.ts $D/history-recheck.test.ts $D/context-recheck.test.ts"
export QA_PG_PORT=32510
# 1. on the candidate
$S/run.sh 30-probes-findings-on-candidate node24 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration $FILES
$S/run.sh 31-probe-qa-rg-r3-adversarial node24 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration $D/qa-rg-r3-history-adversarial.test.ts
# 2. mutant M1: revert the history repair in the source (conversations.ts, answer.ts) only
git diff 71ff750ed17ea281c99f20a85d9f9663bb07efb8 f56f1b3d24c00d1803f6627c99b3f422a47b3014 -- apps/api/src/modules/assistant/conversations.ts apps/api/src/modules/assistant/answer.ts > $TMPDIR/m1.patch
git apply -R $TMPDIR/m1.patch && echo "M1 applied" > $R/docs/delivery/test-evidence/DG6/qa/round-3/32-mutant-m1.applied
git diff --stat >> $R/docs/delivery/test-evidence/DG6/qa/round-3/32-mutant-m1.applied
$S/run.sh 32-mutant-m1-history-fix-reverted node24 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration $D/qa-rg-r2-assistant-history.test.ts $D/history-recheck.test.ts $D/qa-rg-r3-history-adversarial.test.ts
git checkout -- apps/api/src/modules/assistant/conversations.ts apps/api/src/modules/assistant/answer.ts
# 3. mutant M2: migration 0129 absent (the 0128 NOT VALID CHECKs stay)
mv packages/db/migrations/0129_p6_assistant_context_insert_rule.sql $TMPDIR/
$S/run.sh 33-mutant-m2-no-0129 node24 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration $D/history-recheck.test.ts $D/zz-sec-r2-legacy-suggestion-to-draft.test.ts -t "0128|legacy|pre-0128|F-DG6-971|INSERT"
mv $TMPDIR/0129_p6_assistant_context_insert_rule.sql packages/db/migrations/
rm -f $D/qa-rg-r2-assistant-history.test.ts $D/qa-rg-r3-history-adversarial.test.ts $D/zz-sec-r2-assistant-history.test.ts $D/zz-sec-r2-legacy-suggestion-to-draft.test.ts $D/zz-domain-r2-history.test.ts
{ echo "## clone state after probes (expect empty)"; git status --short; git diff HEAD --stat; echo "(end)"; } > $R/docs/delivery/test-evidence/DG6/qa/round-3/34-clone-restored.log 2>&1
echo PROBES-DONE

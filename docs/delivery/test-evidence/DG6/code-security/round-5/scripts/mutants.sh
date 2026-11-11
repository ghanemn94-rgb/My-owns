#!/bin/bash
# Mutant M1: revert the F-DG6-990 fix (remove migration 0130 from the clone) and show (a) the shipped seeded-texts scan
# FAILS and (b) the round-4 audit probe finds the served DG texts again; then restore and show both pass. Run ONLY when
# no other suite runs in $TMPDIR/rv (it edits the migrations directory).
set -u
export PATH=/opt/node22/bin:$PATH QA_PG_PORT=32465 MTH_PORT_POOL=32451-32499
unset LANG LC_ALL
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/code-security/round-5
AU=/home/user/My-owns/docs/delivery/test-evidence/DG6/audit/round-4/probes/zz-aud-r4-served-dg-labels.test.ts
cd $TMPDIR/rv
[ -f $TMPDIR/pipe2-done ] || { echo "pipe2 still running; refusing"; exit 2; }
hdr() { echo "# $(date -u +%FT%TZ) $1 (Node $(node -v), \$TMPDIR/rv at $(git rev-parse --short=9 HEAD), load $(cut -d' ' -f1-3 /proc/loadavg))"; }
run() { tests/qa/support/with-pg.sh npx vitest run --project integration "$@" 2>&1 | grep -v "^ *✓ "; echo "exit=${PIPESTATUS[0]}"; echo "# end $(date -u +%FT%TZ)"; }
A=apps/api/test/integration/assistant
S=apps/api/test/integration/text-scan/seeded-texts.test.ts
cp $AU $A/
git rm -q --cached packages/db/migrations/0130_p6_seeded_text_business_terms.sql >/dev/null 2>&1 || true
mv packages/db/migrations/0130_p6_seeded_text_business_terms.sql $TMPDIR/0130.sql.saved
{ hdr "MUTANT M1: migration 0130 removed; the seeded-texts scan (tests 1-2) and the audit probe must FAIL"; git status --short; run $S $A/zz-aud-r4-served-dg-labels.test.ts; } > $E/32-mutant-m1-no-0130.log
mv $TMPDIR/0130.sql.saved packages/db/migrations/0130_p6_seeded_text_business_terms.sql
git reset -q -- packages/db/migrations/0130_p6_seeded_text_business_terms.sql
{ hdr "RESTORED: 0130 back; the same two files must PASS"; git status --short; run $S $A/zz-aud-r4-served-dg-labels.test.ts; } > $E/33-mutant-m1-restored.log
rm -f $A/zz-aud-r4-served-dg-labels.test.ts
{ echo "# restore check: git status --short (must be empty):"; git status --short; echo "(end)"; } >> $E/33-mutant-m1-restored.log
echo MUTANTS-DONE >> $E/33-mutant-m1-restored.log

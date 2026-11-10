#!/bin/bash
# targeted assistant runs on the disposable clone rv (Node 22), ports in 32650-32699
set -u
export PATH=/opt/node22/bin:$PATH
export QA_PG_PORT=32650 MTH_PORT_POOL=32651-32699
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/code-security/round-2
R1=/home/user/My-owns/docs/delivery/test-evidence/DG6/code-security/round-1/repro
cd $TMPDIR/rv
D=apps/api/test/integration/assistant
cp $R1/zz-sec-r1-assistant-uncited.test.ts $D/
cp $E/repro/zz-sec-r2-assistant-history.test.ts $D/
hdr() { echo "# $(date -u +%FT%TZ) $1 (Node $(node -v), cwd \$TMPDIR/rv at $(git rev-parse --short=9 HEAD), LANG=${LANG:-<unset>}, load $(cut -d' ' -f1-3 /proc/loadavg))"; }
run() { tests/qa/support/with-pg.sh npx vitest run --project integration "$@" 2>&1; echo "exit=$?"; echo "# end $(date -u +%FT%TZ) load $(cut -d' ' -f1-3 /proc/loadavg)"; }

{ hdr "F-DG6-920 round-1 reproduction (unedited; it asserts the BUG, so on a fixed tree it must FAIL)"; run $D/zz-sec-r1-assistant-uncited.test.ts; } > $E/30-f920-round1-repro-on-candidate.log
{ hdr "context-recheck.test.ts + conversations.test.ts + packages/db catalogue.test.ts (0128)"; run $D/context-recheck.test.ts $D/conversations.test.ts packages/db/test/integration/catalogue.test.ts; } > $E/31-f920-context-recheck-suites.log
{ hdr "SEC-R2 history probe (passes when the history defect is reproduced)"; run $D/zz-sec-r2-assistant-history.test.ts; } > $E/32-repro-assistant-history.log

# mutant: recordRefsOf ignores the stored context (reverts the read path and take-to-draft to citations only)
F=apps/api/src/modules/assistant/conversations.ts
H0=$(sha256sum $F | cut -d' ' -f1)
sed -i 's/  if (Array.isArray(context))$/  if (false \&\& Array.isArray(context))/' $F
{ hdr "MUTANT: recordRefsOf ignores context_records (the F-DG6-920 fix reverted on the read and to-draft paths); context-recheck must FAIL"; echo "original sha256 $H0"; git diff -- $F; run $D/context-recheck.test.ts; } > $E/33-f920-mutant-context-ignored.log
git checkout -- $F
H1=$(sha256sum $F | cut -d' ' -f1)
{ echo "# restore: sha256 $H1 (equal to original: $([ "$H0" = "$H1" ] && echo yes || echo NO))"; git status --short; } >> $E/33-f920-mutant-context-ignored.log
rm -f $D/zz-sec-r1-assistant-uncited.test.ts $D/zz-sec-r2-assistant-history.test.ts
echo TARGETED-DONE >> $E/33-f920-mutant-context-ignored.log

#!/bin/bash
# targeted assistant verification runs on the disposable clone rv (Node 22), ports 32460+ (pool 32451-32499)
set -u
export PATH=/opt/node22/bin:$PATH
export QA_PG_PORT=32460 MTH_PORT_POOL=32451-32499
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/code-security/round-3
R2=/home/user/My-owns/docs/delivery/test-evidence/DG6/code-security/round-2/repro
cd $TMPDIR/rv
D=apps/api/test/integration/assistant
# run ONLY when no other suite runs in $TMPDIR/rv (mutants edit the clone)
[ -f $TMPDIR/pipe2-done ] || { echo "pipe2 still running; refusing"; exit 2; }
cp $E/repro/zz-sec-r3-history-channel.test.ts $D/
hdr() { echo "# $(date -u +%FT%TZ) $1 (Node $(node -v), cwd \$TMPDIR/rv at $(git rev-parse --short=9 HEAD), LANG=${LANG:-<unset>}, load $(cut -d' ' -f1-3 /proc/loadavg))"; }
run() { tests/qa/support/with-pg.sh npx vitest run --project integration "$@" 2>&1; echo "exit=$?"; echo "# end $(date -u +%FT%TZ) load $(cut -d' ' -f1-3 /proc/loadavg)"; }
F=apps/api/src/modules/assistant/conversations.ts
A=apps/api/src/modules/assistant/answer.ts
M=packages/db/migrations/0129_p6_assistant_context_insert_rule.sql
# M1: defence 1 reverted (withheld history answers are no longer dropped)
sed -i 's/candidates.filter((m) => m.author === "user" || !withheld(m, readable))/candidates.filter((m) => m.author === "user" || true || !withheld(m, readable))/' $F
{ hdr "MUTANT M1: historyFor keeps withheld answers (defence 1 reverted); R3-1 must FAIL"; git diff --stat; git diff -- $F; run $D/zz-sec-r3-history-channel.test.ts -t "R3-1"; } > $E/32-mutant-m1-history-not-rechecked.log
git checkout -- $F
# M2: defence 2 reverted (no inherited context)
sed -i 's/contextRecords: mergeContextRecords(contextRecordsOf(items), input.historyContext),/contextRecords: mergeContextRecords(contextRecordsOf(items)),/' $A
{ hdr "MUTANT M2: the new answer does not inherit the history context (defence 2 reverted); R3-2 must FAIL"; git diff --stat; git diff -- $A; run $D/zz-sec-r3-history-channel.test.ts -t "R3-2"; } > $E/33-mutant-m2-no-inheritance.log
git checkout -- $A
# M3: 0129 suggestion part reverted (the NOT VALID CHECK of 0128 stays; no INSERT trigger for suggestions)
python3 - $M <<'PY'
import sys,re
p=sys.argv[1]; s=open(p).read()
a=s.index('ALTER TABLE assistant_suggestion DROP CONSTRAINT'); b=s.index('FOR EACH ROW EXECUTE FUNCTION assistant_suggestion_context_records_required();')+len('FOR EACH ROW EXECUTE FUNCTION assistant_suggestion_context_records_required();')
s=s[:a]+'-- MUTANT M3: suggestion part of 0129 removed\n'+s[b:]
open(p,'w').write(s)
PY
{ hdr "MUTANT M3: 0129's suggestion rule reverted (0128 NOT VALID CHECK kept); R3-3a must FAIL"; git diff --stat; git diff -- $M; run $D/zz-sec-r3-history-channel.test.ts -t "R3-3"; } > $E/34-mutant-m3-0129-suggestion-reverted.log
git checkout -- $M
rm -f $D/zz-sec-r2-assistant-history.test.ts $D/zz-sec-r2-legacy-suggestion-to-draft.test.ts $D/zz-sec-r3-history-channel.test.ts
{ echo "# restore check: git status --short (must be empty):"; git status --short; echo "(end)"; } >> $E/34-mutant-m3-0129-suggestion-reverted.log
echo TARGETED-DONE >> $E/34-mutant-m3-0129-suggestion-reverted.log

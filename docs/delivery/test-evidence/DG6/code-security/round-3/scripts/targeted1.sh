#!/bin/bash
# targeted assistant verification runs on the disposable clone rv (Node 22), ports 32460+ (pool 32451-32499)
set -u
export PATH=/opt/node22/bin:$PATH
export QA_PG_PORT=32460 MTH_PORT_POOL=32451-32499
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/code-security/round-3
R2=/home/user/My-owns/docs/delivery/test-evidence/DG6/code-security/round-2/repro
cd $TMPDIR/rv
D=apps/api/test/integration/assistant
cp $R2/zz-sec-r2-assistant-history.test.ts $R2/zz-sec-r2-legacy-suggestion-to-draft.test.ts $E/repro/zz-sec-r3-history-channel.test.ts $D/
hdr() { echo "# $(date -u +%FT%TZ) $1 (Node $(node -v), cwd \$TMPDIR/rv at $(git rev-parse --short=9 HEAD), LANG=${LANG:-<unset>}, load $(cut -d' ' -f1-3 /proc/loadavg))"; }
run() { tests/qa/support/with-pg.sh npx vitest run --project integration "$@" 2>&1; echo "exit=$?"; echo "# end $(date -u +%FT%TZ) load $(cut -d' ' -f1-3 /proc/loadavg)"; }

{ hdr "round-2 reproductions, UNEDITED (both assert the DEFECT: on a fixed tree they must FAIL)"; run $D/zz-sec-r2-assistant-history.test.ts $D/zz-sec-r2-legacy-suggestion-to-draft.test.ts; } > $E/30-round2-repros-unedited-on-candidate.log
{ hdr "round-3 verification probe zz-sec-r3-history-channel (asserts the FIXED behaviour) + shipped history-recheck, context-recheck, conversations, suggestions"; run $D/zz-sec-r3-history-channel.test.ts $D/history-recheck.test.ts $D/context-recheck.test.ts $D/conversations.test.ts $D/suggestions.test.ts; } > $E/31-r3-probe-and-shipped-assistant-suites.log

rm -f $D/zz-sec-r2-assistant-history.test.ts $D/zz-sec-r2-legacy-suggestion-to-draft.test.ts $D/zz-sec-r3-history-channel.test.ts
{ echo "# git status --short after removing the probe copies (must be empty):"; git status --short; echo "(end)"; } >> $E/31-r3-probe-and-shipped-assistant-suites.log
echo TARGETED1-DONE >> $E/31-r3-probe-and-shipped-assistant-suites.log

#!/bin/bash
# F-DG6-990 probes on the disposable clone (Node 22), ports 32465+ (pool 32451-32499). Adds test files only; removes them.
set -u
export PATH=/opt/node22/bin:$PATH QA_PG_PORT=32465 MTH_PORT_POOL=32451-32499
unset LANG LC_ALL
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/code-security/round-5
AU=/home/user/My-owns/docs/delivery/test-evidence/DG6/audit/round-4/probes/zz-aud-r4-served-dg-labels.test.ts
cd $TMPDIR/rv
hdr() { echo "# $(date -u +%FT%TZ) $1 (Node $(node -v), \$TMPDIR/rv at $(git rev-parse --short=9 HEAD), load $(cut -d' ' -f1-3 /proc/loadavg))"; }
run() { tests/qa/support/with-pg.sh npx vitest run --project integration "$@" 2>&1 | grep -v "^ *✓ "; echo "exit=${PIPESTATUS[0]}"; echo "# end $(date -u +%FT%TZ)"; }
A=apps/api/test/integration/assistant
cp $AU $A/; cp $E/repro/zz-sec-r5-served-text.test.ts $A/
{ hdr "round-4 audit probe UNEDITED (sha256 below) + SEC-R5 extended served-text probe, on this candidate (0001-0130)"; sha256sum $AU $E/repro/zz-sec-r5-served-text.test.ts; run $A/zz-aud-r4-served-dg-labels.test.ts $A/zz-sec-r5-served-text.test.ts; } > $E/30-f990-served-probes.log
rm -f $A/zz-aud-r4-served-dg-labels.test.ts $A/zz-sec-r5-served-text.test.ts
cp $E/repro/zz-sec-r5-upgrade-0130.test.ts packages/db/test/integration/
{ hdr "SEC-R5 0130 upgrade probe (demo-initialized 0129 database, administrator pre-states, idempotency, demo-data scan)"; run packages/db/test/integration/zz-sec-r5-upgrade-0130.test.ts; } > $E/31-upgrade-0130.log
rm -f packages/db/test/integration/zz-sec-r5-upgrade-0130.test.ts
{ echo "# git status --short after removing the probes (must be empty):"; git status --short; echo "(end)"; } >> $E/31-upgrade-0130.log
echo PROBES-DONE >> $E/31-upgrade-0130.log

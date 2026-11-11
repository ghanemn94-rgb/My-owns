#!/bin/bash
# re-run my round-1 probes (unchanged) on this candidate, Node 22, ports 32465+
set -u
export PATH=/opt/node22/bin:$PATH QA_PG_PORT=32465 MTH_PORT_POOL=32451-32499
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/code-security/round-3
R1=/home/user/My-owns/docs/delivery/test-evidence/DG6/code-security/round-1/repro
cd $TMPDIR/rv
[ -f $TMPDIR/pipe2-done ] || { echo "pipe2 still running; refusing"; exit 2; }
hdr() { echo "# $(date -u +%FT%TZ) $1 (Node $(node -v), \$TMPDIR/rv at $(git rev-parse --short=9 HEAD), load $(cut -d' ' -f1-3 /proc/loadavg))"; }
run() { tests/qa/support/with-pg.sh npx vitest run --project integration "$@" 2>&1 | grep -v "^ *✓ "; echo "exit=${PIPESTATUS[0]}"; echo "# end $(date -u +%FT%TZ)"; }
I=apps/api/test/integration
cp $R1/zz-sec-r1-p6-role-sweep.test.ts $R1/zz-sec-r1-p6-aud-valid-bodies.test.ts $I/
cp $R1/old-branch-cs-r11-token-key-adversarial.test.ts $I/access/cs-r11-token-key-adversarial.test.ts
cp $R1/old-branch-zz-qa-dg6r12-condition-token-resave.test.ts $I/access/zz-qa-dg6r12-condition-token-resave.test.ts
cp $R1/old-branch-zz-qa-dg6r5-concurrent-job-failure.test.ts $I/operations/zz-qa-dg6r5-concurrent-job-failure.test.ts
{ hdr "round-1 P6 role sweep, unchanged (pass 1 is exit 1 BY DESIGN: 26 writes answer 400 to the empty body before the 403 gate; pass 2 is the valid-body file)"; run $I/zz-sec-r1-p6-role-sweep.test.ts; } > $E/37-p6-role-sweep.log
{ hdr "round-1 P6 AUD valid-body sweep, unchanged (the round-1 re-run version)"; run $I/zz-sec-r1-p6-aud-valid-bodies.test.ts; } > $E/38-p6-aud-valid-bodies.log
{ hdr "token probes (old-branch cs-r11 issuer-bound key + QA r12 condition-token re-save), unchanged"; run $I/access/cs-r11-token-key-adversarial.test.ts $I/access/zz-qa-dg6r12-condition-token-resave.test.ts; } > $E/39-token-probes.log
{ hdr "F-DG6-380 concurrent last-attempt failure probe, unchanged"; run $I/operations/zz-qa-dg6r5-concurrent-job-failure.test.ts; } > $E/41-f380-probe.log
rm -f $I/zz-sec-r1-p6-role-sweep.test.ts $I/zz-sec-r1-p6-aud-valid-bodies.test.ts $I/access/cs-r11-token-key-adversarial.test.ts $I/access/zz-qa-dg6r12-condition-token-resave.test.ts $I/operations/zz-qa-dg6r5-concurrent-job-failure.test.ts
# the other reviewers' round-2 reproductions of the same defect, unedited (QA) / assembled as raised (domain)
Q=/home/user/My-owns/docs/delivery/test-evidence/DG6/qa/tests/round-2/qa-rg-r2-assistant-history.test.ts
DT=/home/user/My-owns/docs/delivery/test-evidence/DG6/domain/round-2/probes/zz-domain-r2-history-tail.ts
cp $Q $I/assistant/
{ sed -n 1,147p $I/assistant/context-recheck.test.ts; cat $DT; } > $I/assistant/zz-domain-r2-history.test.ts
{ hdr "F-DG6-980 QA round-2 probe (unedited; soft assertions hold when FIXED) and F-DG6-960 domain round-2 probe (context-recheck.test.ts lines 1-147 + the tail, as raised; observations only)"; sha256sum $Q $DT; run $I/assistant/qa-rg-r2-assistant-history.test.ts $I/assistant/zz-domain-r2-history.test.ts; } > $E/35-other-reviewers-round2-probes.log
rm -f $I/assistant/qa-rg-r2-assistant-history.test.ts $I/assistant/zz-domain-r2-history.test.ts
cp $E/repro/zz-sec-r3-upgrade-0128-0129.test.ts packages/db/test/integration/
{ hdr "SEC-R3 migration upgrade probe: 0001-0128 then 0129 on a scratch database vs fresh 0001-0129"; run packages/db/test/integration/zz-sec-r3-upgrade-0128-0129.test.ts; } > $E/40-upgrade-0128-0129.log
rm -f packages/db/test/integration/zz-sec-r3-upgrade-0128-0129.test.ts
git status --short >> $E/41-f380-probe.log; echo PROBES-DONE >> $E/41-f380-probe.log

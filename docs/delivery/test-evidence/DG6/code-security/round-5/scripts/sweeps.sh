#!/bin/bash
# round-1 P6 role sweeps and token probes, unchanged, on this candidate (Node 22, port 32465+). Adds test files; removes them.
set -u
export PATH=/opt/node22/bin:$PATH QA_PG_PORT=32465 MTH_PORT_POOL=32451-32499
unset LANG LC_ALL
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/code-security/round-5
R1=/home/user/My-owns/docs/delivery/test-evidence/DG6/code-security/round-1/repro
cd $TMPDIR/rv
hdr() { echo "# $(date -u +%FT%TZ) $1 (Node $(node -v), \$TMPDIR/rv at $(git rev-parse --short=9 HEAD), load $(cut -d' ' -f1-3 /proc/loadavg))"; }
run() { tests/qa/support/with-pg.sh npx vitest run --project integration "$@" 2>&1 | grep -v "^ *✓ "; echo "exit=${PIPESTATUS[0]}"; echo "# end $(date -u +%FT%TZ)"; }
I=apps/api/test/integration
cp $R1/zz-sec-r1-p6-role-sweep.test.ts $R1/zz-sec-r1-p6-aud-valid-bodies.test.ts $I/
cp $R1/old-branch-cs-r11-token-key-adversarial.test.ts $I/access/cs-r11-token-key-adversarial.test.ts
cp $R1/old-branch-zz-qa-dg6r12-condition-token-resave.test.ts $I/access/zz-qa-dg6r12-condition-token-resave.test.ts
{ hdr "round-1 P6 role sweep, unchanged (pass 1 exits 1 BY DESIGN: 26 writes answer 400 to the empty body before the 403 gate; pass 2 is the valid-body file)"; sha256sum $R1/zz-sec-r1-p6-role-sweep.test.ts; run $I/zz-sec-r1-p6-role-sweep.test.ts; } > $E/37-p6-role-sweep.log
{ hdr "round-1 P6 AUD valid-body sweep, unchanged"; sha256sum $R1/zz-sec-r1-p6-aud-valid-bodies.test.ts; run $I/zz-sec-r1-p6-aud-valid-bodies.test.ts; } > $E/38-p6-aud-valid-bodies.log
{ hdr "token probes (old-branch cs-r11 issuer-bound key + QA r12 condition-token re-save), unchanged"; run $I/access/cs-r11-token-key-adversarial.test.ts $I/access/zz-qa-dg6r12-condition-token-resave.test.ts; } > $E/39-token-probes.log
rm -f $I/zz-sec-r1-p6-role-sweep.test.ts $I/zz-sec-r1-p6-aud-valid-bodies.test.ts $I/access/cs-r11-token-key-adversarial.test.ts $I/access/zz-qa-dg6r12-condition-token-resave.test.ts
{ echo "# git status --short (must be empty):"; git status --short; echo "(end)"; } >> $E/39-token-probes.log

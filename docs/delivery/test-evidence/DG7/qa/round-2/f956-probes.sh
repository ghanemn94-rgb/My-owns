#!/bin/bash
# qa-verifier DG7 r2: F-DG7-956 revert-to-fail on the disposable copy $TMPDIR/m2 (a sparse git clone at f22c97b5 that hashes to the candidate; node_modules symlinked to the main clone).
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
cd $TMPDIR/m2; echo "candidate of this copy: $(node tools/gates/candidate.mjs --stage DG7)"
T=tools/release/tests/check-handover.test.mjs; KL=docs/handover/known-limitations.md
REP=docs/delivery/test-evidence/DG7/orchestrator/protocol-audit/protocol-audit-prefreeze.json
cp $T $TMPDIR/t.orig; cp $KL $TMPDIR/kl.orig
run() { echo "===== $1"; node --test $T > $TMPDIR/nt.log 2>&1; rc=$?; grep -E "^ℹ (tests|pass|fail|skipped)|^✖ " $TMPDIR/nt.log | sort -u; echo "EXIT $rc $1"; }
run P0-candidate
git -C $TMPDIR/rv show a60a962dd9205c21df19de63b73a8bcf51866702:$T > $T; run P1-test-reverted-to-round1-candidate; cp $TMPDIR/t.orig $T
sed -i '0,/| C3 handback-sections | REQ-DLV-012 | DG7 | HIT | 5 |/s//| C3 handback-sections | REQ-DLV-012 | DG7 | HIT | 4 |/' $KL; grep -c "DG7 | HIT | 4 |" $KL; run P2-known-limitations-block-hand-damaged; cp $TMPDIR/kl.orig $KL
mv $REP $REP.hidden; run P3-shipped-report-missing; mv $REP.hidden $REP
cmp $T $TMPDIR/t.orig && cmp $KL $TMPDIR/kl.orig && echo "restored: test and known-limitations byte-equal to candidate"
echo "===== P4 known-limitations.mjs --check with the shipped report / with the current-HEAD qa report"
node tools/release/known-limitations.mjs --protocol-audit $REP --check; echo "EXIT $? (shipped report)"
node tools/release/known-limitations.mjs --protocol-audit /home/user/My-owns/docs/delivery/test-evidence/DG7/qa/round-2/13-protocol-audit-DG7.json --check > $TMPDIR/kl.log 2>&1; rc=$?; tail -3 $TMPDIR/kl.log; echo "EXIT $rc (DG7-only report at abc7254; differs expected: other stages absent and C3 6)"

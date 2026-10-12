#!/usr/bin/env bash
# code-security-reviewer DG4 round 7: re-runs EVERY earlier DG4 probe of this role UNCHANGED (read from its round directory)
# against candidate baa6ff4d, one disposable PostgreSQL each (run-probe.sh), Node 22, LANG/LC_* unset, ports 26350-26369.
# The round-1 sweep, finance and idor-rev1 probes are superseded by the round-2 sweep/finance and the round-1 idor probe (as in round 5) and are not re-run.
EV=/home/user/My-owns/docs/delivery/test-evidence/DG4/code-security/round-7; port=26350
for p in \
  /home/user/My-owns/docs/delivery/test-evidence/DG4/code-security/round-5/probes/sec-dg4-r5-filter-scope.test.ts \
  /home/user/My-owns/docs/delivery/test-evidence/DG4/code-security/round-4/probes/sec-dg4-r4-currency.test.ts \
  /home/user/My-owns/docs/delivery/test-evidence/DG4/code-security/round-4/probes/sec-dg4-r4-outcome-scope.test.ts \
  /home/user/My-owns/docs/delivery/test-evidence/DG4/code-security/round-4/probes/sec-dg4-r4-required-members.test.ts \
  /home/user/My-owns/docs/delivery/test-evidence/DG4/code-security/round-3/probes/sec-dg4-r3-drill-scope.test.ts \
  /home/user/My-owns/docs/delivery/test-evidence/DG4/code-security/round-3/probes/sec-dg4-r3-gross-currency.test.ts \
  /home/user/My-owns/docs/delivery/test-evidence/DG4/code-security/round-3/probes/sec-dg4-r3-required-members.test.ts \
  /home/user/My-owns/docs/delivery/test-evidence/DG4/code-security/round-2/probes/sec-dg4-r2-finance.test.ts \
  /home/user/My-owns/docs/delivery/test-evidence/DG4/code-security/round-2/probes/sec-dg4-r2-gate-commit.test.ts \
  /home/user/My-owns/docs/delivery/test-evidence/DG4/code-security/round-2/probes/sec-dg4-r2-slice-b-ids.test.ts \
  /home/user/My-owns/docs/delivery/test-evidence/DG4/code-security/round-2/probes/sec-dg4-r2-sod-denials.test.ts \
  /home/user/My-owns/docs/delivery/test-evidence/DG4/code-security/round-2/probes/sec-dg4-r2-sweep.test.ts \
  /home/user/My-owns/docs/delivery/test-evidence/DG4/code-security/round-1/probes/sec-dg4-r1-approvals.test.ts \
  /home/user/My-owns/docs/delivery/test-evidence/DG4/code-security/round-1/probes/sec-dg4-r1-body-idor.test.ts \
  /home/user/My-owns/docs/delivery/test-evidence/DG4/code-security/round-1/probes/sec-dg4-r1-idor.test.ts \
; do
  n=$(basename $p .test.ts); echo "$n $(bash $EV/run-probe.sh $p $port rerun-$n-node22-lang-unset)"; port=$((port+1))
done

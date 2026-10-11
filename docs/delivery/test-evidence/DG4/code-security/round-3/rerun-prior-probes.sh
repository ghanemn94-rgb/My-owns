#!/usr/bin/env bash
# code-security-reviewer DG4 round 3: re-runs the round-2 probes (S sweep, D SoD denials, F finance, C gate commit,
# B slice-B ids) and the round-1 probes (approvals, body-idor, idor) UNCHANGED (read from their round directories) against
# candidate 890faa12, one disposable PostgreSQL each (run-probe.sh). Node 22, LANG/LC_* unset.
EV=/home/user/My-owns/docs/delivery/test-evidence/DG4/code-security/round-3
port=26350
for p in /home/user/My-owns/docs/delivery/test-evidence/DG4/code-security/round-2/probes/sec-dg4-r2-sweep.test.ts /home/user/My-owns/docs/delivery/test-evidence/DG4/code-security/round-2/probes/sec-dg4-r2-sod-denials.test.ts /home/user/My-owns/docs/delivery/test-evidence/DG4/code-security/round-2/probes/sec-dg4-r2-finance.test.ts /home/user/My-owns/docs/delivery/test-evidence/DG4/code-security/round-2/probes/sec-dg4-r2-gate-commit.test.ts /home/user/My-owns/docs/delivery/test-evidence/DG4/code-security/round-2/probes/sec-dg4-r2-slice-b-ids.test.ts /home/user/My-owns/docs/delivery/test-evidence/DG4/code-security/round-1/probes/sec-dg4-r1-approvals.test.ts /home/user/My-owns/docs/delivery/test-evidence/DG4/code-security/round-1/probes/sec-dg4-r1-body-idor.test.ts /home/user/My-owns/docs/delivery/test-evidence/DG4/code-security/round-1/probes/sec-dg4-r1-idor.test.ts; do
  n=$(basename $p .test.ts); echo "$n $(bash $EV/run-probe.sh $p $port rerun-$n-node22-lang-unset)"; port=$((port+1))
done

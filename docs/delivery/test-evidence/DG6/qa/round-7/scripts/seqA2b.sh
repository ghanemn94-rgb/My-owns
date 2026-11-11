#!/bin/bash
# Re-launch after the 2-hour background limit stopped track A during integration run 1 (partial log kept in
# interrupted-2h-limit/): integration run 1 (locale unset) alone. The unit runs of seqA2 had completed (rc files).
S=/home/user/My-owns/docs/delivery/test-evidence/DG6/qa/round-7/scripts
QA_PG_PORT=32520 $S/run.sh 10-integration-run1 node24 env -u LANG -u LC_ALL -u LC_CTYPE tests/qa/support/with-pg.sh pnpm test:integration
echo SEQA2B-DONE

#!/usr/bin/env bash
# qa-verifier r1C: copy one probe spec into the disposable clone's e2e/, run it via run-e2e.sh, then remove it.
# $1 = unset|cutf8, $2 = prod|demo, $3 PG port, $4 API port, $5 label, $6 spec file name (in tests/round-1/e2e/)
set -u
C=$TMPDIR/review-dg5; E=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-1; T=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/tests/round-1
cp $T/e2e/$6 $C/e2e/$6
bash $E/scripts/run-e2e.sh $1 $2 $3 $4 $5 e2e/$6
rm -f $C/e2e/$6

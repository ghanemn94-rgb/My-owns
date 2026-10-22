#!/usr/bin/env bash
# qa-verifier r6: copy one probe spec (given by its path in the evidence tree) into the disposable clone's e2e/, run it
# via run-e2e.sh, then remove it from the clone.
# $1 = unset|cutf8, $2 = prod|demo, $3 PG port, $4 API port, $5 label, $6 spec path (absolute), rest = extra playwright args
set -u
C=$TMPDIR/review-qa; E=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-6
SPEC=$6; N=$(basename $SPEC); M=$1 S=$2 P=$3 A=$4 L=$5; shift 6
cp "$SPEC" $C/e2e/$N
bash $E/scripts/run-e2e.sh $M $S $P $A $L "$C/e2e/$N" "$@"   # absolute path: the complete clone also holds tests/round-1/e2e copies under docs/
rm -f $C/e2e/$N

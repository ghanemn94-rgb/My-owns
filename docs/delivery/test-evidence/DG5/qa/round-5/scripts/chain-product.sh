#!/usr/bin/env bash
# qa-verifier DG5 r5: the product journeys (apps/web/e2e, 46 spec files) on the production-initialized stack, split in
# two halves by file name (each half its own stack and log) so each run fits the 2 h task limit.
# $1 = unset|cutf8, $2 = A|B
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-5/scripts
cd $TMPDIR/review-qa
mapfile -t ALL < <(ls apps/web/e2e/*.spec.ts | sort)
if [ "$2" = A ]; then F=("${ALL[@]:0:22}"); P=26624; else F=("${ALL[@]:22}"); P=26626; fi
[ "$1" = cutf8 ] && P=$((P+10))
echo "== product $1 half $2: ${#F[@]} files: ${F[*]}"
QA_RUN_PRODUCT=1 bash $S/run-e2e.sh $1 prod $P $((P+1)) product-$2${3:+-$3} "${F[@]}"   # $3 = optional run suffix (e.g. run2)

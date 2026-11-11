#!/bin/bash
. /home/user/My-owns/docs/delivery/test-evidence/DG6/qa/round-5/scripts/seqB-common.sh
$S/run.sh 20-e2e-product-unset node24 env -u LANG -u LC_ALL -u LC_CTYPE apps/web/e2e/support/with-stack.sh $PW apps/web/e2e
echo SEQB2-DONE

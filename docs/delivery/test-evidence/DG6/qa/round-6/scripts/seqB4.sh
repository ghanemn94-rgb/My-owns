#!/bin/bash
. /home/user/My-owns/docs/delivery/test-evidence/DG6/qa/round-6/scripts/seqB-common.sh
$S/run.sh 24-e2e-product-cutf8 node24 env LANG=C.UTF-8 LC_ALL=C.UTF-8 apps/web/e2e/support/with-stack.sh $PW apps/web/e2e
echo SEQB4-DONE

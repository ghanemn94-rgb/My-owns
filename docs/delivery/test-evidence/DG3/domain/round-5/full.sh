#!/usr/bin/env bash
# domain-reviewer DG3 round 5: checks.sh (Node 22 + 24), then one disposable stack running every probe and the targeted integration suites.
E=/home/user/My-owns/docs/delivery/test-evidence/DG3/domain/round-5
bash $E/checks.sh > $E/checks-run.out 2>&1
PROBES="dg3-api dg3-api-extra dg3-ui-world dg3-ui dg3-ui-inherited dg3-ui-overflow dg3-ui-overflow-r3" bash $E/with-stack.sh bash -c 'bash '$E'/run-all.sh; a=$?; bash '$E'/integ.sh; i=$?; echo "### run-all exit=$a integ exit=$i"; [ $a -eq 0 ] && [ $i -eq 0 ]' > $E/stack-run-1.log 2>&1
echo "stack exit=$?" >> $E/stack-run-1.log
echo ALLDONE >> $E/stack-run-1.log
